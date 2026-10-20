import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { app, memberAgent, newOrg, sendSim, sign, simpleMenu } from './helpers';

describe('authentication and authorization', () => {
  it('rejects unauthenticated access to protected resources', async () => {
    for (const path of [
      '/api/conversations',
      '/api/workflows',
      '/api/menus',
      '/api/customers',
      '/api/settings/integrations',
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    }
  });

  it('rejects a forged session token', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'wa_session=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('signs up, reads the session and signs in again', async () => {
    const { agent, email } = await newOrg();
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.role).toBe('OWNER');
    await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    await request(app).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
  });

  it('enforces roles: viewers cannot change configuration', async () => {
    const { agent } = await newOrg();
    const viewer = await memberAgent(agent, 'VIEWER');
    await viewer.get('/api/menus').expect(200);
    const res = await viewer.post('/api/menus').send(simpleMenu());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('requires JSON for state-changing requests (CSRF defence)', async () => {
    const { agent } = await newOrg();
    const res = await agent
      .post('/api/menus')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('name=x');
    expect(res.status).toBe(415);
  });
});

describe('organization isolation', () => {
  it("never exposes another organization's data", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const menu = (await a.agent.post('/api/menus').send(simpleMenu()).expect(201)).body;
    await sendSim(a.agent, 'hello there', '919000000111');
    const convA = (await a.agent.get('/api/conversations').expect(200)).body.data[0];

    await b.agent.get(`/api/menus/${menu.id}`).expect(404);
    await b.agent.put(`/api/menus/${menu.id}`).send(simpleMenu()).expect(404);
    await b.agent.delete(`/api/menus/${menu.id}`).expect(404);
    await b.agent.get(`/api/conversations/${convA.id}`).expect(404);
    await b.agent.post(`/api/conversations/${convA.id}/messages`).send({ body: 'hijack' }).expect(404);
    expect((await b.agent.get('/api/menus').expect(200)).body).toHaveLength(0);
    expect((await b.agent.get('/api/conversations').expect(200)).body.total).toBe(0);
    // Workflows cannot reference another organization's menu.
    const wf = await b.agent.post('/api/workflows').send({
      name: 'x',
      definition: {
        trigger: { type: 'incoming_message' },
        steps: [{ id: 'm', type: 'send_menu', menuId: menu.id }],
      },
    });
    expect(wf.status).toBe(400);
  });
});

describe('menus', () => {
  it('creates, edits, reorders and publishes a menu', async () => {
    const { agent } = await newOrg();
    const created = (await agent.post('/api/menus').send(simpleMenu()).expect(201)).body;
    expect(created.options.map((o: { title: string }) => o.title)).toEqual([
      'Opening hours',
      'Talk to support',
    ]);
    const [first, second] = created.options;
    const edited = (
      await agent
        .put(`/api/menus/${created.id}`)
        .send(
          simpleMenu({
            name: 'Main menu',
            options: [
              { ...second, title: 'Support' },
              first,
              { title: 'Prices', actionType: 'PRODUCT_LIST', actionConfig: {} },
            ],
          }),
        )
        .expect(200)
    ).body;
    expect(edited.name).toBe('Main menu');
    expect(edited.options.map((o: { title: string }) => o.title)).toEqual([
      'Support',
      'Opening hours',
      'Prices',
    ]);
    // Existing option ids are preserved when edited.
    expect(edited.options[0].id).toBe(second.id);
    const published = (await agent.post(`/api/menus/${created.id}/publish`).expect(200)).body;
    expect(published.isPublished).toBe(true);
    const preview = (await agent.get(`/api/menus/${created.id}/preview`).expect(200)).body;
    expect(preview.cloudPayload.interactive.type).toBe('button');
  });

  it('validates WhatsApp limits and required action settings', async () => {
    const { agent } = await newOrg();
    const res = await agent.post('/api/menus').send(
      simpleMenu({
        options: [
          { title: 'A title that is far too long for WhatsApp', actionType: 'REPLY', actionConfig: {} },
        ],
      }),
    );
    expect(res.status).toBe(422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('options.0.title');
    expect(paths).toContain('options.0.actionConfig.text');
  });
});

const keywordWorkflow = {
  name: 'Pricing reply',
  definition: {
    trigger: { type: 'keyword', keywords: ['price', 'pricing'] },
    steps: [
      { id: 'reply', type: 'send_text', text: 'Hi {{customer.firstName}}, our prices start at ₹499.' },
      { id: 'tag', type: 'add_tag', tag: 'asked-price' },
    ],
  },
};

describe('workflows', () => {
  it('creates and activates a workflow; incoming messages trigger it', async () => {
    const { agent } = await newOrg();
    const wf = (await agent.post('/api/workflows').send(keywordWorkflow).expect(201)).body;
    // Inactive workflows do not run.
    const before = await sendSim(agent, 'what is the price?', '919000000201');
    expect(before.messages.some((m) => m.body.includes('₹499'))).toBe(false);

    await agent.post(`/api/workflows/${wf.id}/activate`).expect(200);
    const after = await sendSim(agent, 'Pricing please', '919000000202');
    expect(after.outcome.handledBy).toBe('workflow:Pricing reply');
    expect(after.messages.at(-1)?.body).toBe('Hi Test, our prices start at ₹499.');
    const execs = (await agent.get(`/api/workflows/${wf.id}/executions`).expect(200)).body;
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe('SUCCEEDED');
    const customer = await prisma.customer.findFirstOrThrow({
      where: { waId: '919000000202' },
      include: { tags: true },
    });
    expect(customer.tags.map((t) => t.name)).toContain('asked-price');
  });

  it('refuses to activate an invalid (looping) workflow and versions every save', async () => {
    const { agent } = await newOrg();
    const wf = (await agent.post('/api/workflows').send(keywordWorkflow).expect(201)).body;
    const looping = {
      name: 'Loop',
      definition: {
        trigger: { type: 'incoming_message' },
        steps: [
          { id: 'a', type: 'send_text', text: 'a', next: 'b' },
          { id: 'b', type: 'send_text', text: 'b', next: 'a' },
        ],
      },
    };
    const saved = (await agent.put(`/api/workflows/${wf.id}`).send(looping).expect(200)).body;
    expect(saved.latestVersion).toBe(2);
    expect(saved.validation.ok).toBe(false);
    const res = await agent.post(`/api/workflows/${wf.id}/activate`);
    expect(res.status).toBe(422);
    expect(res.body.error.details.join(' ')).toMatch(/Loop detected/);
  });

  it('test mode runs the engine without writing data', async () => {
    const { agent } = await newOrg();
    const wf = (
      await agent
        .post('/api/workflows')
        .send({
          name: 'Lead',
          definition: {
            trigger: { type: 'keyword', keywords: ['bulk'] },
            steps: [
              { id: 'q', type: 'ask_question', question: 'How many?', variable: 'qty', validation: 'number' },
              {
                id: 'l',
                type: 'business_action',
                action: 'create_lead',
                params: { interest: '{{vars.qty}} units' },
              },
              { id: 't', type: 'send_text', text: 'Thanks for {{vars.qty}}' },
            ],
          },
        })
        .expect(201)
    ).body;
    const res = (
      await agent
        .post(`/api/workflows/${wf.id}/test`)
        .send({ message: 'bulk order', answers: ['12'] })
        .expect(200)
    ).body;
    expect(res.matchedTrigger).toBe(true);
    expect(res.finalStatus).toBe('SUCCEEDED');
    expect(res.runs.at(-1).messages.at(-1).text).toBe('Thanks for 12');
    expect(await prisma.lead.count({ where: { interest: '12 units' } })).toBe(0);
  });

  it('records failed executions and hands the conversation to a human', async () => {
    const { agent } = await newOrg();
    const wf = (
      await agent
        .post('/api/workflows')
        .send({
          name: 'Broken lookup',
          definition: {
            trigger: { type: 'keyword', keywords: ['status'] },
            steps: [
              {
                id: 'look',
                type: 'business_action',
                action: 'check_order_status',
                params: { orderNumber: '{{vars.missing}}' },
              },
            ],
          },
        })
        .expect(201)
    ).body;
    await agent.post(`/api/workflows/${wf.id}/activate`).expect(200);
    const r = await sendSim(agent, 'status of my order', '919000000301');
    expect(r.conversation?.status).toBe('NEEDS_HUMAN');
    const [ex] = (await agent.get(`/api/workflows/${wf.id}/executions`).expect(200)).body;
    expect(ex.status).toBe('FAILED');
    expect(ex.error).toMatch(/Invalid input for check_order_status/);
    expect(ex.log.at(-1)).toMatchObject({ stepId: 'look', status: 'error' });
    expect(
      await prisma.toolExecution.count({ where: { tool: 'check_order_status', status: 'REJECTED' } }),
    ).toBeGreaterThan(0);
  });
});

describe('menu selections', () => {
  it('runs the configured action for a selected option', async () => {
    const { agent } = await newOrg();
    const menu = (await agent.post('/api/menus').send(simpleMenu()).expect(201)).body;
    await agent.post(`/api/menus/${menu.id}/publish`).expect(200);
    const wf = (
      await agent
        .post('/api/workflows')
        .send({
          name: 'Welcome',
          definition: {
            trigger: { type: 'first_time_customer' },
            steps: [
              { id: 'hi', type: 'send_text', text: 'Welcome!' },
              { id: 'menu', type: 'send_menu', menuId: menu.id },
            ],
          },
        })
        .expect(201)
    ).body;
    await agent.post(`/api/workflows/${wf.id}/activate`).expect(200);

    const first = await sendSim(agent, 'Hi', '919000000401');
    expect(first.messages.at(-1)?.kind).toBe('menu');
    const pick = await sendSim(agent, '1', '919000000401');
    expect(pick.messages.at(-1)?.body).toBe('We are open 10–8.');
    const inbound = pick.messages.filter((m) => m.direction === 'INBOUND').at(-1);
    expect(inbound?.menuOptionId).toBe(menu.options[0].id);

    // Selecting by interactive reply id (as WhatsApp sends it) for the handoff option.
    await sendSim(agent, 'menu please', '919000000402');
    await sendSim(agent, 'Talk to support', '919000000402');
    const conv = await prisma.conversation.findFirstOrThrow({
      where: { customer: { waId: '919000000402' } },
    });
    expect(conv.status).toBe('NEEDS_HUMAN');
  });
});

describe('assistant (mock provider)', () => {
  it('answers from the knowledge base, escalates on rules and respects approved actions', async () => {
    const { agent } = await newOrg();
    await agent
      .post('/api/knowledge')
      .send({
        category: 'POLICY',
        title: 'Return policy',
        content: 'Returns are accepted within 7 days.',
        keywords: ['return', 'returns'],
      })
      .expect(201);

    const faq = await sendSim(agent, 'What is your return policy?', '919000000501');
    expect(faq.messages.at(-1)).toMatchObject({
      senderType: 'AI',
      body: 'Returns are accepted within 7 days.',
    });

    const esc = await sendSim(agent, 'I need a refund now', '919000000502');
    expect(esc.outcome.handedOff).toBe(true);
    expect(esc.conversation?.status).toBe('NEEDS_HUMAN');

    // Remove product lookups from the approved actions: the tool call is refused.
    const cfg = (await agent.get('/api/assistant').expect(200)).body.config;
    await agent
      .put('/api/assistant')
      .send({ ...cfg, approvedActions: ['search_knowledge'] })
      .expect(200);
    const t = (
      await agent
        .post('/api/assistant/test')
        .send({ message: 'Do you have floor lamps in stock?' })
        .expect(200)
    ).body;
    expect(t.toolCalls[0]).toMatchObject({ name: 'check_product_availability', ok: false });
    expect(t.handoff).toBe(true);
    expect(t.provider).toBe('mock');
  });

  it('requires confirmation before placing an order', async () => {
    const { agent, orgId } = await newOrg();
    await prisma.product.create({
      data: { organizationId: orgId, sku: 'MUG', name: 'Stoneware mug', priceMinor: 49900, stock: 5 },
    });
    const cfg = (await agent.get('/api/assistant').expect(200)).body.config;
    await agent
      .put('/api/assistant')
      .send({ ...cfg, approvedActions: [...cfg.approvedActions, 'place_order'] })
      .expect(200);
    const ask = await sendSim(agent, 'order 2 stoneware mug', '919000000601');
    expect(ask.messages.at(-1)?.body).toMatch(/Reply YES to confirm/);
    expect(await prisma.order.count({ where: { organizationId: orgId } })).toBe(0);
    const yes = await sendSim(agent, 'yes', '919000000601');
    expect(yes.messages.at(-1)?.body).toMatch(/Order ORD-1001 is placed/);
    expect(
      (await prisma.product.findFirstOrThrow({ where: { organizationId: orgId, sku: 'MUG' } })).stock,
    ).toBe(3);
  });
});

describe('WhatsApp webhook', () => {
  it('verifies the subscription handshake', async () => {
    const ok = await request(app)
      .get('/api/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');
    await request(app)
      .get('/api/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })
      .expect(403);
  });

  it('rejects unsigned payloads and ignores duplicate deliveries', async () => {
    const { agent, slug } = await newOrg('Webhook Test Co');
    expect(slug).toBe('webhook-test-co');
    const wf = (await agent.post('/api/workflows').send(keywordWorkflow).expect(201)).body;
    await agent.post(`/api/workflows/${wf.id}/activate`).expect(200);
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PNID' },
                contacts: [{ wa_id: '919000000701', profile: { name: 'Riya' } }],
                messages: [
                  { from: '919000000701', id: 'wamid.TEST.1', type: 'text', text: { body: 'price?' } },
                ],
              },
            },
          ],
        },
      ],
    });
    await request(app)
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload, 'wrong'))
      .send(payload)
      .expect(401);

    const send = () =>
      request(app)
        .post('/api/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(payload))
        .send(payload);
    expect((await send().expect(200)).body).toEqual({ processed: 1, duplicates: 0 });
    expect((await send().expect(200)).body).toEqual({ processed: 0, duplicates: 1 });
    expect(await prisma.message.count({ where: { externalId: 'wamid.TEST.1' } })).toBe(1);
    expect(await prisma.workflowExecution.count({ where: { workflowId: wf.id } })).toBe(1);
    // Replies are not sent because the Cloud API is not configured; the failure is recorded honestly.
    const reply = await prisma.message.findFirstOrThrow({
      where: { direction: 'OUTBOUND', conversation: { customer: { waId: '919000000701' } } },
    });
    expect(reply.status).toBe('FAILED');
    expect(reply.error).toMatch(/not configured/);
  });

  it('simulator duplicate ids are processed once', async () => {
    const { agent } = await newOrg();
    await sendSim(agent, 'hello', '919000000801', { externalId: 'dup-1' });
    const again = await sendSim(agent, 'hello', '919000000801', { externalId: 'dup-1' });
    expect(again.outcome.duplicate).toBe(true);
    expect(again.messages.filter((m) => m.direction === 'INBOUND')).toHaveLength(1);
  });
});

describe('customers and analytics', () => {
  it('exports CSV safely and computes analytics from records', async () => {
    const { agent } = await newOrg();
    await sendSim(agent, 'hello', '919000000901');
    const list = (await agent.get('/api/customers').expect(200)).body;
    await agent
      .patch(`/api/customers/${list.data[0].id}`)
      .send({ name: '=HYPERLINK("x")', tags: ['vip'] })
      .expect(200);
    const csv = await agent.get('/api/customers/export.csv').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);
    const analytics = (await agent.get('/api/analytics?range=7d').expect(200)).body;
    expect(analytics.totals.conversations).toBe(1);
    expect(analytics.volume).toHaveLength(7);
    const dash = (await agent.get('/api/dashboard?range=7d').expect(200)).body;
    expect(dash.totals.conversations).toBe(1);
  });
});
