import { Router } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { verifyMetaSignature } from '../lib/crypto';
import { ah, HttpError, isUniqueViolation } from '../lib/http';
import { logger } from '../logger';
import { handleInbound } from '../services/inbound';

/**
 * WhatsApp Cloud API webhooks.
 *  GET  /api/webhooks/whatsapp  — Meta verification handshake (hub.challenge)
 *  POST /api/webhooks/whatsapp  — messages and delivery statuses (X-Hub-Signature-256 required)
 */
export const webhookRouter = Router();

webhookRouter.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (!config.whatsapp.verifyToken) {
    res.status(503).json({ error: { code: 'not_configured', message: 'WHATSAPP_VERIFY_TOKEN is not set' } });
    return;
  }
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken && typeof challenge === 'string') {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.status(403).json({ error: { code: 'forbidden', message: 'Verification failed' } });
});

interface CloudMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  button?: { text: string; payload?: string };
}
interface CloudStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errors?: { title?: string; message?: string; code?: number }[];
}
interface CloudChangeValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: CloudMessage[];
  statuses?: CloudStatus[];
}

async function resolveOrg(phoneNumberId?: string): Promise<string | null> {
  if (phoneNumberId) {
    const integrations = await prisma.integration.findMany({ where: { type: 'whatsapp' } });
    const hit = integrations.find(
      (i) => (i.config as { phoneNumberId?: string }).phoneNumberId === phoneNumberId,
    );
    if (hit) return hit.organizationId;
  }
  if (config.whatsapp.orgSlug) {
    const org = await prisma.organization.findUnique({ where: { slug: config.whatsapp.orgSlug } });
    return org?.id ?? null;
  }
  return null;
}

const STATUS_MAP = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' } as const;

webhookRouter.post(
  '/whatsapp',
  ah(async (req, res) => {
    if (!config.whatsapp.appSecret)
      throw new HttpError(
        503,
        'not_configured',
        'WHATSAPP_APP_SECRET is not set; refusing unsigned webhooks',
      );
    if (
      !req.rawBody ||
      !verifyMetaSignature(req.rawBody, req.header('x-hub-signature-256'), config.whatsapp.appSecret)
    ) {
      throw new HttpError(401, 'invalid_signature', 'Invalid webhook signature');
    }
    const body = req.body as {
      object?: string;
      entry?: { changes?: { field?: string; value?: CloudChangeValue }[] }[];
    };
    if (body.object !== 'whatsapp_business_account') {
      res.sendStatus(200);
      return;
    }
    let processed = 0;
    let duplicates = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        if (!v) continue;
        const orgId = await resolveOrg(v.metadata?.phone_number_id);
        if (!orgId) {
          logger.warn({ phoneNumberId: v.metadata?.phone_number_id }, 'Webhook for unknown phone number');
          continue;
        }
        for (const m of v.messages ?? []) {
          const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
          const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
          const text = m.text?.body ?? reply?.title ?? m.button?.text ?? '';
          try {
            const r = await handleInbound(orgId, {
              waId: m.from,
              name,
              text,
              interactiveReplyId: reply?.id ?? m.button?.payload,
              externalId: m.id,
              channel: 'WHATSAPP',
            });
            if (r.duplicate) duplicates++;
            else processed++;
          } catch (e) {
            logger.error({ err: e, messageId: m.id }, 'Failed to process inbound WhatsApp message');
          }
        }
        for (const s of v.statuses ?? []) {
          try {
            await prisma.webhookEvent.create({
              data: {
                organizationId: orgId,
                provider: 'whatsapp',
                externalId: `${s.id}:${s.status}`,
                kind: 'status',
                payload: s as object,
              },
            });
          } catch (e) {
            if (isUniqueViolation(e)) {
              duplicates++;
              continue;
            }
            throw e;
          }
          await prisma.message.updateMany({
            where: { organizationId: orgId, externalId: s.id },
            data: {
              status: STATUS_MAP[s.status],
              ...(s.status === 'failed'
                ? { error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? 'Delivery failed' }
                : {}),
            },
          });
          processed++;
        }
      }
    }
    // Always acknowledge quickly; retries from Meta are absorbed by idempotency.
    res.status(200).json({ processed, duplicates });
  }),
);
