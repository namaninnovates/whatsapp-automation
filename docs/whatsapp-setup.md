# Connecting a real WhatsApp Business number

The platform runs in **simulated mode** by default: all automation works, but replies are only shown in the
simulator and inbox. This guide switches a deployment to the **WhatsApp Cloud API** (Meta). The integration is
implemented and tested with signed sample payloads, but **you must verify it end to end with your own number**
before relying on it.

## 1. Meta prerequisites

1. A Meta Business portfolio and a Meta developer app of type **Business** with the **WhatsApp** product added.
2. A phone number registered in WhatsApp Manager (the test number Meta provides works for development; it can
   only message up to five verified recipient numbers).
3. A **System User** access token with `whatsapp_business_messaging` and `whatsapp_business_management`
   permissions. Temporary tokens from the app dashboard expire after 24 hours.
4. From the app dashboard: the **Phone number ID**, the **WhatsApp Business Account ID** and the **App secret**
   (App settings → Basic).

## 2. Configure the server

In the root `.env`:

```bash
WHATSAPP_MODE=cloud
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321098765   # optional, shown in Settings
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_APP_SECRET=0123456789abcdef...
WHATSAPP_VERIFY_TOKEN=any-long-random-string-you-choose
WHATSAPP_API_VERSION=v21.0
WHATSAPP_ORG_SLUG=brightlane-home              # the workspace that owns this number
```

`WHATSAPP_ORG_SLUG` is the slug of the workspace that should receive messages for this number (the demo
workspace is `brightlane-home`; a workspace created through sign-up gets a slug derived from its name — see the
`Organization` table). Restart the API. **Settings → WhatsApp** should now show _Configured, no webhook received
yet_, and **Settings → Diagnostics** should be all green except the AI provider if you use the mock.

## 3. Expose the webhook over HTTPS

Meta only calls public HTTPS URLs. In production, put the API behind your load balancer or reverse proxy. For
local testing use a tunnel to the API port, for example:

```bash
ngrok http 4000
# → https://<random>.ngrok-free.app
```

The webhook path is `/api/webhooks/whatsapp`.

## 4. Subscribe the webhook in Meta

App dashboard → WhatsApp → Configuration → Webhook:

- **Callback URL**: `https://<your-host>/api/webhooks/whatsapp`
- **Verify token**: the value of `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and save**. Meta sends `GET ...?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`; the
  API echoes the challenge when the token matches.
- Under **Webhook fields**, subscribe to **messages** (this delivers inbound messages and delivery statuses).

## 5. Test

1. From a WhatsApp account (added as a recipient if you use the test number), send `Hi` to the business number.
2. The API logs the webhook; the conversation appears in **Inbox** with channel _WhatsApp_; the welcome workflow
   or menu replies on the phone.
3. **Settings → WhatsApp** now shows _Connected_ with the time of the last webhook.
4. Delivery ticks in the inbox update as Meta sends `sent`, `delivered`, `read` or `failed` statuses.

If nothing arrives: check the tunnel URL, that the app is subscribed to `messages`, and the API logs for
`invalid_signature` (wrong `WHATSAPP_APP_SECRET`) or `Webhook for unknown phone number` (wrong
`WHATSAPP_ORG_SLUG`).

## How the adapter behaves

- **Signature**: every POST must carry `X-Hub-Signature-256`, an HMAC-SHA256 of the raw body with the app secret,
  compared in constant time. Without `WHATSAPP_APP_SECRET` the endpoint refuses all POSTs (503).
- **Idempotency**: message ids (`wamid…`) and status events are stored with unique constraints, so Meta's
  retries never trigger a workflow or action twice.
- **Interactive messages**: menus with up to 3 options are sent as reply buttons (titles ≤ 20 chars), larger
  menus as list messages (≤ 10 rows, titles ≤ 24, descriptions ≤ 72). Button and list replies are mapped back to
  the menu option by id. **Menus → Cloud API payload** shows the exact JSON.
- **24-hour window**: free-form messages are only sent within 24 hours of the customer's last message. Outside it
  the outbound message is stored as failed with an explanation. Template messages are not implemented.
- **Errors and retries**: 429, 5xx and Meta throttling codes are retried up to 3 times with exponential backoff;
  other errors are stored on the message and shown in the inbox. An in-process token bucket limits the send rate.
- **Supported inbound types**: text, button replies and list replies. Other types (media, location, contacts)
  are stored as `[Unsupported message]`.

## Security checklist for production

- Use a System User token, store it in your secret manager, and rotate it.
- Set strong `JWT_SECRET` and `ENCRYPTION_KEY`, `NODE_ENV=production`, HTTPS only, and a strict `CORS_ORIGINS`.
- Never put WhatsApp or AI credentials in `VITE_` variables or in `apps/web/.env`.
- Move inbound processing to a queue for high volume (see README limitations).
