# API reference

Base URL: `/api`. All bodies are JSON. Authenticated endpoints read the `wa_session` httpOnly cookie set by
`/auth/login` or `/auth/signup`; browsers must send credentials (`fetch(..., { credentials: 'include' })`).

Minimum role is shown per endpoint: **V** viewer, **A** agent, **AD** admin, **O** owner. Endpoints without a
role marker only need a signed-in member. Every query is scoped to the caller's organization.

## Conventions

- **Errors** always look like `{ "error": { "code": "…", "message": "…", "details"?: … } }`.
  - `401 unauthorized` — no or invalid session · `403 forbidden` — role too low
  - `404 not_found` · `409` conflicts (e.g. `already_member`, `email_taken`)
  - `415 unsupported_media_type` — a mutating request that is not `application/json` (CSRF defence)
  - `422 validation_error` — `details` is `[{ path, message }]` (paths like `options.0.title`)
  - `429` — rate limited
- **Pagination**: `?page=1&pageSize=25` → `{ data, page, pageSize, total }`.
- **Date ranges**: `?range=7d|30d|90d`.

## Health

| Method | Path      | Notes          |
| ------ | --------- | -------------- |
| GET    | `/health` | `{ ok: true }` |

## Auth

| Method | Path           | Body / notes                                                                                    |
| ------ | -------------- | ----------------------------------------------------------------------------------------------- |
| POST   | `/auth/signup` | `{ name, email, password, businessName }` → creates user, workspace (owner) and default profile |
| POST   | `/auth/login`  | `{ email, password }` → session                                                                 |
| POST   | `/auth/logout` | Clears the cookie                                                                               |
| GET    | `/auth/me`     | `{ user, organization, role }` or 401                                                           |

## Dashboard and analytics

| Method | Path                | Notes                                                                                                                                |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/dashboard?range=` | Totals, daily volume, recent conversations, active workflows, failed runs, activity                                                  |
| GET    | `/analytics?range=` | Totals (incl. escalation rate, success rate, average first/human response), volume, per-workflow results, menu option usage, intents |

## Conversations (inbox)

| Method | Path                                           | Role | Notes                                                               |
| ------ | ---------------------------------------------- | ---- | ------------------------------------------------------------------- |
| GET    | `/conversations?status=&search=&unread=&page=` |      | List with customer and last message                                 |
| GET    | `/conversations/:id`                           |      | Messages, executions, customer profile, leads, orders, history      |
| POST   | `/conversations/:id/messages`                  | A    | `{ body }` — manual reply; moves the conversation to human handling |
| PATCH  | `/conversations/:id`                           | A    | `{ status?, assignToMe?, markRead? }`                               |

## Workflows

| Method | Path                                       | Role | Notes                                                                                                                                  |
| ------ | ------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/workflows`                               |      | Summary with trigger type, versions, 30-day stats                                                                                      |
| POST   | `/workflows/validate`                      |      | `{ definition }` → `{ ok, errors, warnings }`                                                                                          |
| POST   | `/workflows`                               | AD   | `{ name, description?, priority?, definition }` (created inactive, version 1)                                                          |
| GET    | `/workflows/:id`                           |      | Latest definition, versions, validation                                                                                                |
| PUT    | `/workflows/:id`                           | AD   | Saves a **new version**; if the workflow is active and valid, the live version moves to it                                             |
| POST   | `/workflows/:id/activate`                  | AD   | 422 with the validation errors if the latest version is invalid                                                                        |
| POST   | `/workflows/:id/deactivate`                | AD   |                                                                                                                                        |
| POST   | `/workflows/:id/duplicate`                 | AD   | Inactive copy                                                                                                                          |
| DELETE | `/workflows/:id`                           | AD   |                                                                                                                                        |
| POST   | `/workflows/:id/test`                      |      | `{ message, isNewCustomer?, customerName?, answers?[], event?, definition? }` — dry run through the engine; nothing is written or sent |
| GET    | `/workflows/:id/executions`                |      | Last 50 runs with step logs                                                                                                            |
| POST   | `/workflows/executions/:executionId/retry` | AD   | Re-runs a failed execution as a new attempt with the live version (the workflow must be active)                                        |

The definition format is documented in [workflow-engine.md](workflow-engine.md).

## Menus

| Method | Path                                | Role | Notes                                                                                            |
| ------ | ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| GET    | `/menus`                            |      | With ordered options                                                                             |
| GET    | `/menus/:id`                        |      |                                                                                                  |
| POST   | `/menus`                            | AD   | `{ name, header?, body, buttonLabel?, isDefault?, options[] }`                                   |
| PUT    | `/menus/:id`                        | AD   | Replaces content; option order = array order; existing option ids are kept                       |
| POST   | `/menus/:id/publish` · `/unpublish` | AD   | Only published menus are sent to customers                                                       |
| DELETE | `/menus/:id`                        | AD   |                                                                                                  |
| GET    | `/menus/:id/preview`                |      | `{ message, cloudPayload }` — the exact Cloud API JSON (buttons for ≤ 3 options, list otherwise) |

Option `actionType`: `REPLY` (`actionConfig.text`), `SUBMENU` (`menuId`), `PRODUCT_LIST` (`category?`), `HANDOFF`
(`note?`), `RUN_WORKFLOW` (`workflowId`), `AI_ANSWER` (`prompt?`). WhatsApp limits (title 24 chars, description
72, body 1024, header 60, button 20, max 10 options) are enforced by the schema.

## Knowledge base

| Method | Path                           | Role | Notes                                                |
| ------ | ------------------------------ | ---- | ---------------------------------------------------- |
| GET    | `/knowledge?search=&category=` |      |                                                      |
| POST   | `/knowledge`                   | AD   | `{ category, title, content, keywords[], isActive }` |
| PUT    | `/knowledge/:id`               | AD   |                                                      |
| DELETE | `/knowledge/:id`               | AD   |                                                      |

## Customers, leads, catalog

| Method | Path                                             | Role | Notes                                                                                             |
| ------ | ------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------- |
| GET    | `/customers?search=&tag=&leadStatus=&page=`      |      | Includes tags, latest lead, counts and the org's tag list                                         |
| GET    | `/customers/export.csv?search=&tag=&leadStatus=` | A    | CSV download (formula-safe)                                                                       |
| GET    | `/customers/:id`                                 |      | Tags, leads, orders, conversations                                                                |
| PATCH  | `/customers/:id`                                 | A    | `{ name?, notes?, tags?[], customFields? }`                                                       |
| GET    | `/leads?status=`                                 |      |                                                                                                   |
| POST   | `/leads`                                         | A    | `{ customerId, conversationId?, status?, interest?, valueMinor?, notes? }` — emits `lead.created` |
| PATCH  | `/leads/:id`                                     | A    |                                                                                                   |
| GET    | `/products`                                      |      |                                                                                                   |
| PATCH  | `/orders/:id/status`                             | A    | `{ status }` — emits `order.status_changed` (drives the "Order shipped" workflow)                 |

## Assistant

| Method | Path              | Role | Notes                                                                                                                 |
| ------ | ----------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/assistant`      |      | Config, provider info (`effective` is `mock` without key + model), active knowledge count                             |
| PUT    | `/assistant`      | AD   | `{ aiEnabled, description, instructions, tone, topics[], escalationRules[], approvedActions[], confidenceThreshold }` |
| POST   | `/assistant/test` |      | `{ message }` → `{ text, intent, confidence, handoff, reason?, toolCalls[] }`; write actions are dry-run              |

## Settings

| Method | Path                     | Role | Notes                                                                                                                                               |
| ------ | ------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/settings/profile`      |      |                                                                                                                                                     |
| PUT    | `/settings/profile`      | AD   | Business details, `timezone`, `businessHours`, `notificationPrefs`                                                                                  |
| GET    | `/settings/team`         |      | Members with roles                                                                                                                                  |
| POST   | `/settings/team`         | O    | `{ name, email, role }` → `{ member, temporaryPassword? }` (shown once)                                                                             |
| PATCH  | `/settings/team/:id`     | O    | `{ role }` — the last owner cannot be demoted                                                                                                       |
| DELETE | `/settings/team/:id`     | O    | Cannot remove yourself or the last owner                                                                                                            |
| GET    | `/settings/integrations` |      | WhatsApp status (`simulated`, `incomplete`, `configured_unverified`, `connected`), AI provider, diagnostics. Secrets are reported as set/unset only |
| GET    | `/settings/audit?page=`  | AD   | Audit log                                                                                                                                           |

## Simulator

| Method | Path                      | Role | Notes                                                                                                                                                               |
| ------ | ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/simulator/info`         |      | Sample customers and mode                                                                                                                                           |
| GET    | `/simulator/thread?waId=` |      | Latest conversation for a number                                                                                                                                    |
| POST   | `/simulator/messages`     | A    | `{ from, name?, text, interactiveReplyId?, externalId? }` → `{ outcome, customer, conversation, messages }`. Reusing `externalId` demonstrates duplicate protection |
| POST   | `/simulator/random`       | A    | Sends one random sample inbound message                                                                                                                             |

## WhatsApp webhook (public)

| Method | Path                 | Notes                                                                                                                                                                                                                     |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/webhooks/whatsapp` | Meta verification: echoes `hub.challenge` when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`                                                                                                                         |
| POST   | `/webhooks/whatsapp` | Requires a valid `X-Hub-Signature-256`. Handles `messages` (text, button and list replies) and `statuses` (sent, delivered, read, failed). Duplicates are ignored. Always answers 200 quickly once the signature is valid |

See [whatsapp-setup.md](whatsapp-setup.md).
