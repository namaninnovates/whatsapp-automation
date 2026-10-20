# Architecture

## Components

```
┌──────────────┐   cookie session    ┌──────────────────────────────────────────────┐
│  apps/web    │ ─── /api (JSON) ──▶ │ apps/api (Express)                           │
│  React SPA   │                     │  middleware: helmet · CORS · rate limits ·   │
└──────────────┘                     │  JSON-only mutations · requireAuth · roles   │
                                     │                                              │
 Meta Cloud API ── POST /api/webhooks/whatsapp ─┐                                  │
 (signed)                                        ▼                                 │
 Simulator page ── POST /api/simulator/messages ─▶ handleInbound() ──────────────┐ │
                                     │                                         │ │ │
                                     │   ┌─────────────┐  ┌──────────────────┐ │ │ │
                                     │   │ workflow-   │  │ AI assistant     │ │ │ │
                                     │   │ engine      │  │ (mock/Anthropic/ │ │ │ │
                                     │   │ (pure)      │  │  OpenAI-compat.) │ │ │ │
                                     │   └─────┬───────┘  └────────┬─────────┘ │ │ │
                                     │         ▼ EngineServices    ▼ tools     │ │ │
                                     │   menus · actions · outbound.deliver() ─┘ │ │
                                     │                    │                      │ │
                                     │      SimulatedTransport | CloudApiTransport │
                                     └────────────────────┼────────────────────────┘
                                                          ▼
                                                  PostgreSQL (Prisma)
```

- **`packages/shared`** — Zod schemas (workflow definitions, menus, settings, auth…), WhatsApp limits, labels and
  roles. The API validates every request body with these schemas and the web app uses the same ones in forms.
- **`packages/workflow-engine`** — pure TypeScript, no database or network access. It matches triggers, validates
  definitions (references, loops, reachability) and executes steps against an injected `EngineServices`
  interface. This makes it unit-testable and lets the builder's _Test run_ use the exact production code.
- **`apps/api`** — Express routes are thin: they parse input, enforce roles, call services and write audit logs.
  Services own the business logic (`services/inbound.ts`, `executions.ts`, `menus.ts`, `actions.ts`,
  `outbound.ts`, `ai/*`, `whatsapp/*`, `analytics.ts`).
- **`apps/web`** — a single-page app. Server state lives in TanStack Query; forms use React Hook Form + Zod.

## Inbound message pipeline (`services/inbound.ts`)

Webhook and simulator traffic both call `handleInbound(orgId, input)`:

1. **Idempotency.** The provider message id is stored as `Message.externalId` (unique per organization, plus a
   `WebhookEvent` row for webhooks). A duplicate delivery returns `{ duplicate: true }` and does nothing else.
2. **Persist** the customer (created on first contact), conversation and inbound message in one transaction.
3. **Human ownership.** If the conversation is `NEEDS_HUMAN`, automation stays silent until an agent resolves it
   or hands it back.
4. **Pending state** stored on `Conversation.state`:
   - `workflow_wait` — resume the waiting execution with the answer (`ask_question`, `collect_details`);
   - `confirm` — a YES/NO answer for an action that needs confirmation (e.g. `place_order`);
   - `menu` — resolve the selection (interactive reply id, option number, or title) and run the option action.
5. **Workflow selection** — the most specific matching active workflow (see
   [workflow-engine.md](workflow-engine.md)).
6. **Fallback** — the AI assistant if enabled, otherwise the default published menu.

Every outbound message goes through `outbound.deliver()`, which stores it, enforces the 24-hour window for the
WhatsApp channel, sends through the channel's transport (with retries for transient Cloud API errors) and
records the status.

## Data model (Prisma)

| Model                                              | Notes                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User`, `Organization`, `OrganizationMembership`   | Multi-tenant; role per membership (`OWNER`, `ADMIN`, `AGENT`, `VIEWER`)                                                                                            |
| `BusinessProfile`                                  | Business details, hours, timezone, assistant configuration, notification preferences                                                                               |
| `Customer`, `Tag`                                  | WhatsApp id unique per organization; `customFields` holds collected details                                                                                        |
| `Conversation`, `Message`                          | Status (`OPEN`, `AUTOMATED`, `NEEDS_HUMAN`, `RESOLVED`), channel, JSON `state`; messages carry sender type, delivery status, intent, menu option and execution ids |
| `Workflow`, `WorkflowVersion`, `WorkflowExecution` | Immutable versions; executions unique on `(workflowId, triggerEventId)` and keep a step log                                                                        |
| `Menu`, `MenuOption`                               | Ordered options with an action type and config                                                                                                                     |
| `KnowledgeEntry`, `Product`, `Lead`, `Order`       | Assistant knowledge and demo commerce data                                                                                                                         |
| `ToolExecution`                                    | Every action run by a workflow, menu or assistant, including pending confirmations                                                                                 |
| `WebhookEvent`                                     | Provider event ids for idempotency (unique on `provider + externalId`)                                                                                             |
| `Integration`                                      | Per-organization integration config (used for routing webhooks by `phone_number_id`)                                                                               |
| `AuditLog`                                         | Configuration changes, handoffs, leads, orders, sign-ins                                                                                                           |

Every business table has an `organizationId`, and every query in the API filters by the organization taken from
the authenticated session, never from the request body.

## Security model

- **Sessions**: a signed JWT (`{ sub, org }`) in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production).
  `requireAuth` reloads the membership on each request, so removed members lose access immediately.
- **Authorization**: `requireRole(min)` on every mutating route, with role rank VIEWER < AGENT < ADMIN < OWNER.
- **CSRF**: state-changing API requests must be `application/json`, which a cross-site form cannot send.
- **Rate limits**: credential endpoints (20/min), general auth (300/min), simulator (120/min), webhooks (600/min).
- **Webhooks**: `X-Hub-Signature-256` HMAC checked in constant time against the raw body; unsigned requests are
  rejected and the endpoint refuses to run without `WHATSAPP_APP_SECRET`.
- **Secrets** stay on the server: the web app reads only `apps/web/.env` (`VITE_` values), integration status
  endpoints return masked ids and booleans, never tokens.
- **Business actions** validate their inputs on the server; the assistant can only call approved tools, and
  escalation rules are checked before any model call.
- **CSV export** neutralises spreadsheet formulas.

## Web app

Routes: `/` (landing), `/docs`, `/login`, `/signup`, and the authenticated app under `/app`: dashboard, inbox,
automations (list + builder), menus, assistant, knowledge, customers & leads, analytics, simulator, settings.
UI components live in `apps/web/src/components/ui`; role checks use `useAuth().can(role)` and mirror the API.
