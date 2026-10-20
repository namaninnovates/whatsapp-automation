import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';

export const app = createApp();

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Signs up a new business and returns a cookie-carrying agent for its owner. */
export async function newOrg(businessName = `Test Co ${uniq()}`) {
  const agent = request.agent(app);
  const email = `owner-${uniq()}@example.test`;
  const res = await agent
    .post('/api/auth/signup')
    .send({ name: 'Owner', email, password: 'password123', businessName });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    agent,
    orgId: res.body.organization.id as string,
    slug: res.body.organization.slug as string,
    email,
  };
}

/** Adds a member with the given role and returns an agent signed in as them. */
export async function memberAgent(owner: request.Agent, role: 'ADMIN' | 'AGENT' | 'VIEWER') {
  const email = `${role.toLowerCase()}-${uniq()}@example.test`;
  const res = await owner.post('/api/settings/team').send({ email, name: role, role });
  if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${JSON.stringify(res.body)}`);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: res.body.temporaryPassword }).expect(200);
  return agent;
}

export const simpleMenu = (overrides: Record<string, unknown> = {}) => ({
  name: 'Main',
  body: 'How can we help?',
  isDefault: true,
  options: [
    { title: 'Opening hours', actionType: 'REPLY', actionConfig: { text: 'We are open 10–8.' } },
    { title: 'Talk to support', actionType: 'HANDOFF', actionConfig: {} },
  ],
  ...overrides,
});

export function sign(body: string, secret = 'test-app-secret') {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export async function sendSim(
  agent: request.Agent,
  text: string,
  from = '919000000001',
  extra: Record<string, unknown> = {},
) {
  const res = await agent
    .post('/api/simulator/messages')
    .send({ from, name: 'Test Customer', text, ...extra });
  if (res.status >= 300) throw new Error(`simulator failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as {
    outcome: { duplicate: boolean; handledBy?: string; handedOff?: boolean; conversationId?: string };
    conversation: { id: string; status: string } | null;
    messages: {
      direction: string;
      senderType: string;
      body: string;
      menuOptionId: string | null;
      kind: string;
    }[];
  };
}
