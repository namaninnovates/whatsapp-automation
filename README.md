# Threadline — WhatsApp automation platform

A full-stack platform for automating customer conversations on WhatsApp: a shared inbox, a step-based
workflow builder, interactive menus, a rules-bound AI assistant, a knowledge base, customer and lead
management, and analytics. It runs completely offline in **local demo mode** (simulated WhatsApp channel and
a deterministic mock AI) and switches to the real **WhatsApp Cloud API** and a real LLM through environment
variables.

| Layer           | Stack                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Web             | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query, RHF + Zod, Recharts, Lucide |
| API             | Node 20+, Express 4, TypeScript, Zod, pino, helmet, express-rate-limit                                    |
| Data            | PostgreSQL 16, Prisma 7 (migrations + seed)                                                               |
| Shared packages | `@wa/shared` (schemas, types, limits) and `@wa/workflow-engine` (pure execution engine)                   |
| Tests           | Vitest, React Testing Library, Supertest                                                                  |
| Tooling         | ESLint 9 (flat config), Prettier 3, Docker Compose                                                        |

```
apps/
  api/                 Express API, WhatsApp adapter, AI providers, services, integration tests
  web/                 React app (landing, auth, dashboard, inbox, builder, …) and UI tests
packages/
  shared/              Zod schemas and types shared by web and API
  workflow-engine/     Trigger matching, validation and execution (no I/O), unit tests
prisma/                schema.prisma, migrations/, seed.ts
docs/                  architecture, API, WhatsApp setup, workflow engine
tests/                 map of the acceptance criteria to the automated tests
```

## Quick start

Prerequisites: **Node.js 20.19+** (22 LTS recommended), **npm 10+**, and **Docker** (for PostgreSQL). If you
already run PostgreSQL 14+ locally you can skip Docker and point `DATABASE_URL` at it.

```bash
cp .env.example .env                       # server configuration (defaults work for local demo mode)
cp apps/web/.env.example apps/web/.env     # browser configuration (optional; defaults to /api)

npm install                                # installs all workspaces and generates the Prisma client
npm run db:up                              # starts PostgreSQL 16 on localhost:5432 (docker compose)
npm run db:migrate                         # applies prisma/migrations
npm run db:seed                            # creates the demo workspace (safe to re-run; it resets the demo org)
npm run dev                                # API on http://localhost:4000, web on http://localhost:5173
```

`npm run setup` runs install, db:up, db:migrate and db:seed in one go.

Open http://localhost:5173 and sign in with a demo account (password for all: `Demo@12345`):

| Email                    | Role   | Can                                                 |
| ------------------------ | ------ | --------------------------------------------------- |
| `owner@brightlane.test`  | Owner  | Everything, including team management               |
| `agent@brightlane.test`  | Agent  | Reply in the inbox, use the simulator, manage leads |
| `viewer@brightlane.test` | Viewer | Read-only                                           |

The demo workspace, **Brightlane Home**, is a fictional home-décor store with 12 products, 10 knowledge
entries, 9 workflows, 2 menus and ~28 customer conversations. The seed replays scripted conversations through
the real inbound pipeline, so every message, workflow execution, lead and order in the demo was produced by the
same code that handles live traffic.

### Try the core flow (about two minutes)

1. **Automations → New workflow** → _Keyword reply_. Set the keyword to `pune`, edit the reply, **Save version**.
2. Use **Test run** on the right to run the draft through the engine without writing anything.
3. Toggle **Active**.
4. **WhatsApp simulator** → send `Do you deliver to Pune?` from any number. The processing log shows
   `Workflow · <your workflow>` and the reply appears in the phone and in the **Inbox**.
5. Send `Hi` from a new number to see the welcome workflow and the interactive main menu; tap options.
6. Send `I want a refund` to see an escalation rule hand the conversation to a person.

## Scripts

| Command                                         | What it does                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `npm install`                                   | Install all workspaces; `postinstall` runs `prisma generate`      |
| `npm run dev`                                   | API (tsx watch) and web (Vite) together                           |
| `npm run build`                                 | Production bundles: `apps/api/dist` (tsup) and `apps/web/dist`    |
| `npm start`                                     | Run the built API (set `SERVE_WEB=true` to serve the web app too) |
| `npm test`                                      | Engine, API and web tests                                         |
| `npm run test:engine` / `test:api` / `test:web` | One suite                                                         |
| `npm run typecheck`                             | `tsc` in every workspace                                          |
| `npm run lint` / `npm run format:check`         | ESLint / Prettier                                                 |
| `npm run db:up` / `db:down`                     | Start / stop PostgreSQL via Docker Compose                        |
| `npm run db:migrate`                            | `prisma migrate deploy`                                           |
| `npm run db:migrate:dev`                        | Create a new migration after editing `schema.prisma`              |
| `npm run db:seed`                               | Seed (or re-seed) the demo workspace                              |
| `npm run db:reset`                              | Drop, re-migrate and re-seed the development database             |

**API tests need PostgreSQL.** They use `DATABASE_URL_TEST` (default `wa_automation_test`, created
automatically by the Docker Compose init script), drop its `public` schema and apply the migration SQL before
running. Never point `DATABASE_URL_TEST` at a database you care about.

### Production-style single process

```bash
npm run build
SERVE_WEB=true NODE_ENV=production npm start   # API + built web app on http://localhost:4000
```

Set strong `JWT_SECRET` and `ENCRYPTION_KEY` values and `CORS_ORIGINS` to your real origin first. Session cookies
are `Secure` when `NODE_ENV=production`, so serve over HTTPS.

## Environment variables

Server variables live in the root `.env` (template: `.env.example`). The API validates them at start-up and
exits with a clear message if something is wrong.

| Variable                       | Required    | Default / example                                             | Purpose                                                  |
| ------------------------------ | ----------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                 | yes         | `postgresql://postgres:postgres@localhost:5432/wa_automation` | Main database                                            |
| `DATABASE_URL_TEST`            | tests       | `…/wa_automation_test`                                        | Wiped by the API test suite                              |
| `PORT`                         | no          | `4000`                                                        | API port                                                 |
| `NODE_ENV`                     | no          | `development`                                                 | `production` enables secure cookies                      |
| `CORS_ORIGINS`                 | no          | `http://localhost:5173`                                       | Comma-separated allowed browser origins                  |
| `JWT_SECRET`                   | yes         | 32+ random characters (16 minimum)                            | Signs session cookies                                    |
| `ENCRYPTION_KEY`               | recommended | `openssl rand -base64 32`                                     | AES-256-GCM key (helper in `apps/api/src/lib/crypto.ts`) |
| `LOG_LEVEL`                    | no          | `info`                                                        | pino log level                                           |
| `SERVE_WEB`                    | no          | `false`                                                       | Serve `apps/web/dist` from the API                       |
| `WHATSAPP_MODE`                | no          | `simulated`                                                   | `simulated` or `cloud`                                   |
| `WHATSAPP_PHONE_NUMBER_ID`     | cloud       |                                                               | Cloud API phone number id                                |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | no          |                                                               | Shown in settings only                                   |
| `WHATSAPP_ACCESS_TOKEN`        | cloud       |                                                               | System-user access token                                 |
| `WHATSAPP_APP_SECRET`          | cloud       |                                                               | Verifies `X-Hub-Signature-256`                           |
| `WHATSAPP_VERIFY_TOKEN`        | cloud       |                                                               | Webhook verification handshake                           |
| `WHATSAPP_API_VERSION`         | no          | `v21.0`                                                       | Graph API version                                        |
| `WHATSAPP_ORG_SLUG`            | cloud       | `brightlane-home`                                             | Workspace that receives Cloud API traffic                |
| `AI_PROVIDER`                  | no          | `mock`                                                        | `mock`, `anthropic` or `openai` (OpenAI-compatible)      |
| `AI_API_KEY`                   | real AI     |                                                               | Provider key (server only)                               |
| `AI_MODEL`                     | real AI     |                                                               | Model id for the provider                                |
| `AI_BASE_URL`                  | no          |                                                               | Custom base URL for OpenAI-compatible endpoints          |

Browser variables live in `apps/web/.env` (template: `apps/web/.env.example`):

| Variable            | Default | Purpose                                                           |
| ------------------- | ------- | ----------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `/api`  | API base URL. Keep `/api` with the Vite proxy or `SERVE_WEB=true` |

Vite only reads `apps/web/.env*`, never the root `.env`, so server secrets cannot reach the browser bundle.
**Never put secrets in `VITE_` variables.**

## What is simulated and what is real

| Capability                                            | Local demo mode                                                                  | With configuration                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Inbound messages                                      | Simulator page and seeded conversations, processed by the real pipeline          | Cloud API webhooks (`/api/webhooks/whatsapp`)                                 |
| Outbound delivery                                     | Stored and shown in the simulator/inbox; never leaves the server                 | Sent through the Cloud API with delivery statuses from webhooks               |
| AI assistant                                          | Deterministic mock: keyword ranking over the knowledge base, rule-based tool use | Anthropic or OpenAI-compatible model with the same tools, rules and threshold |
| Business actions (leads, order status, stock, orders) | Real, against the demo database                                                  | Same; no external commerce system is connected                                |
| Email notifications                                   | Preferences are stored; **no email is sent**                                     | Needs an email provider (not included)                                        |
| Team invites                                          | Owner sees a one-time temporary password; no email                               | —                                                                             |

The real WhatsApp integration is implemented (webhook verification, signature checks, idempotency, status
updates, button/list payloads, 24-hour window check, retries, rate limiting) and covered by tests that use signed
sample payloads. **It has not been verified against a live WhatsApp Business account** in this repository's
test runs. Follow [docs/whatsapp-setup.md](docs/whatsapp-setup.md) and confirm with a real number before relying on it.

## Status of checks

All of the following were run on the packaged code (Node 22, PostgreSQL 16, Linux):

| Check                                             | Result                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run typecheck` (shared, engine, api, web)    | Pass                                                                                       |
| `npm run lint`                                    | Pass (0 errors, 0 warnings)                                                                |
| `npm run format:check`                            | Pass                                                                                       |
| `npm run test:engine`                             | 13/13 pass                                                                                 |
| `npm run test:api` (integration, real PostgreSQL) | 20/20 pass                                                                                 |
| `npm run test:web`                                | 11/11 pass                                                                                 |
| `npm run build`                                   | Pass (the web bundle is ~950 kB minified / ~270 kB gzip; Vite prints a chunk-size warning) |
| `npm run db:seed`                                 | Pass; re-running is idempotent (covered by a test)                                         |

`prisma migrate deploy` itself could not be executed in the environment where this was packaged (the Prisma
engine download was blocked by the network). The committed migration SQL was applied directly to PostgreSQL
and is what the API test suite applies on every run; it was generated by Prisma's schema engine from
`schema.prisma`. Run `npm run db:migrate` on your machine as the first step and report any drift.

See [tests/README.md](tests/README.md) for how each acceptance criterion maps to a test. A GitHub Actions
workflow (`.github/workflows/ci.yml`) runs the same checks plus `prisma migrate deploy`; it is included but has
not been run in GitHub.

## Known limitations and ideas to explore

- **WhatsApp templates** are not implemented. Outside the 24-hour customer service window, free-form replies are
  blocked with a clear error; add template sending (and template management) for re-engagement.
- **Single WhatsApp number per deployment.** Cloud API traffic goes to `WHATSAPP_ORG_SLUG`. The webhook can
  already route by `phone_number_id` through the `Integration` table; building a UI to store per-workspace,
  encrypted credentials there is the natural next step.
- **Media messages** (images, documents, audio, location) are stored as unsupported placeholders.
- **Processing is synchronous** inside the webhook request. For production volume, move `handleInbound` to a
  queue (BullMQ, SQS…) and keep the webhook a fast acknowledger; idempotency is already in place.
- **Waiting workflows have no expiry job.** A workflow waiting for an answer resumes when the customer replies;
  add a scheduled sweep to time out stale waits.
- **No real-time push.** The inbox polls every few seconds; Server-Sent Events or WebSockets would be smoother.
- **The mock AI is intentionally simple** (keyword ranking, rule-based intent). Plug in a real model via
  `AI_PROVIDER` and compare behaviour in **Assistant → Try it**.
- **Code splitting**: the web app ships as one bundle; lazy-load routes to shrink the first load.
- **Email/notification delivery**, password reset and SSO are not included.

## Documentation

- [docs/architecture.md](docs/architecture.md) — components, data model, request flow, security model
- [docs/api.md](docs/api.md) — REST endpoints, auth, errors
- [docs/workflow-engine.md](docs/workflow-engine.md) — triggers, steps, limits, versioning, testing
- [docs/whatsapp-setup.md](docs/whatsapp-setup.md) — connecting a real WhatsApp Business number
- [CONTRIBUTING.md](CONTRIBUTING.md) — conventions and how to add features
