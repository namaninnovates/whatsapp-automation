# Tests

Tests live next to the code they cover:

| Suite                  | Location                        | Runner                | Needs                                              |
| ---------------------- | ------------------------------- | --------------------- | -------------------------------------------------- |
| Workflow engine (unit) | `packages/workflow-engine/test` | `npm run test:engine` | nothing                                            |
| API (integration)      | `apps/api/test`                 | `npm run test:api`    | PostgreSQL at `DATABASE_URL_TEST` (wiped each run) |
| Web (component)        | `apps/web/src/test`             | `npm run test:web`    | nothing (fetch is mocked)                          |

`npm test` runs all three. The API suite's global setup drops the test database's `public` schema and applies
`prisma/migrations/*/migration.sql`, so every run starts from the committed migrations.

## Acceptance criteria → tests

| #   | Criterion                                                | Covered by                                                                                                                                                                 |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Frontend renders without critical errors                 | `apps/web/src/test/landing-auth.test.tsx` (landing, login, protected redirect, sign-in to dashboard); `npm run build`                                                      |
| 2   | Users can create and edit menus                          | API `menus › creates, edits, reorders and publishes a menu` and `› validates WhatsApp limits…`; web `menu-editor.test.tsx`                                                 |
| 3   | Users can create and activate workflows                  | API `workflows › creates and activates a workflow…`, `› refuses to activate an invalid (looping) workflow and versions every save`; web `workflow-builder.test.tsx`        |
| 4   | Incoming demo messages trigger the correct workflow      | API `workflows › …incoming messages trigger it`; engine `selects the most specific matching workflow`                                                                      |
| 5   | Menu selections lead to the configured actions           | API `menu selections › runs the configured action for a selected option`                                                                                                   |
| 6   | AI mock responses follow configured rules                | API `assistant (mock provider) › answers from the knowledge base, escalates on rules and respects approved actions`, `› requires confirmation before placing an order`     |
| 7   | Unauthorized users cannot access protected resources     | API `authentication and authorization` (unauthenticated, forged token, viewer role, JSON-only mutations)                                                                   |
| 8   | Organization data remains isolated                       | API `organization isolation › never exposes another organization's data`                                                                                                   |
| 9   | Duplicate webhook events do not create duplicate actions | API `WhatsApp webhook › rejects unsigned payloads and ignores duplicate deliveries`, `› simulator duplicate ids are processed once`                                        |
| 10  | Failed workflow executions are recorded                  | API `workflows › records failed executions and hands the conversation to a human`; engine `records failures instead of throwing`, `enforces step timeouts and step limits` |
| 11  | Database migrations and seeding work                     | API `seed.test.ts` (migrations applied in global setup, seed run twice)                                                                                                    |
| 12  | The project builds successfully                          | `npm run build` (not a unit test; run it in CI)                                                                                                                            |

Also covered: workflow test mode writes nothing (`workflows › test mode runs the engine without writing data`),
webhook verification handshake, CSV export safety and analytics computed from records.
