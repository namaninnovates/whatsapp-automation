# Contributing

## Setup

Follow the Quick start in [README.md](README.md). Before opening a pull request, run:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

API tests need PostgreSQL and use `DATABASE_URL_TEST`, which they wipe.

## Where things go

| Change                                                         | Location                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Request/response schemas, limits, labels shared by web and API | `packages/shared/src`                                                |
| Workflow trigger matching, validation, step execution          | `packages/workflow-engine/src` (keep it free of I/O)                 |
| HTTP routes (thin: parse → authorize → service → audit)        | `apps/api/src/routes`                                                |
| Business logic                                                 | `apps/api/src/services`                                              |
| WhatsApp transport / Cloud API payloads                        | `apps/api/src/services/whatsapp`                                     |
| AI providers and the assistant's tools                         | `apps/api/src/services/ai`                                           |
| Database schema                                                | `prisma/schema.prisma` + `npm run db:migrate:dev -- --name <change>` |
| Demo data                                                      | `prisma/seed.ts` (keep it deterministic and idempotent)              |
| Pages / UI components                                          | `apps/web/src/pages`, `apps/web/src/components`                      |

## Conventions

- TypeScript `strict` everywhere. Validate every external input with Zod (`parse()` in routes returns 422 with
  field paths the web forms can display).
- Every database query filters by the organization from the session (`orgId(req)`); never trust an id from the
  body without checking it belongs to the organization. Add an isolation test for new resources.
- Mutating routes declare a minimum role with `requireRole()`. Mirror it in the UI with `useAuth().can()`.
- Record configuration changes and customer-impacting events with `audit()`.
- Anything that sends a message goes through `outbound.deliver()` so status, window and retry rules apply.
- Secrets are server-only. The web app reads only `apps/web/.env`; never add secrets to `VITE_` variables.
- UI copy is short and specific; labels say what happens ("Save version", "Publish"), errors say how to fix it.
- Formatting is Prettier's (`npm run format`); lint must pass with zero warnings.

## Tests

- Engine behaviour: `packages/workflow-engine/test` (pure, fast).
- API behaviour with a real database: `apps/api/test` using Supertest. Helpers in `test/helpers.ts` create
  isolated organizations, sign webhook payloads and send simulator messages.
- UI: `apps/web/src/test` with React Testing Library and a mocked `fetch` (`mockApi`).

[tests/README.md](tests/README.md) maps the acceptance criteria to tests; keep it current when you add coverage.
