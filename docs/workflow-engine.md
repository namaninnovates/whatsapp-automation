# Workflow engine

`packages/workflow-engine` is a pure library: it never touches the database or the network. The API passes it a
definition, a context (message, customer, business-hours flag, variables) and an `EngineServices` object for side
effects (render a menu, list products, run an action, tag, hand off, ask the assistant). The same code powers
live traffic, the builder's **Test run** (with sandboxed services) and the unit tests.

## Definition format

Workflows are stored as JSON, validated by `WorkflowDefinitionSchema` in `@wa/shared`:

```json
{
  "trigger": { "type": "keyword", "keywords": ["track", "order status"], "match": "contains" },
  "steps": [
    {
      "id": "ask",
      "type": "ask_question",
      "question": "What is your order number?",
      "variable": "order",
      "validation": "text"
    },
    {
      "id": "lookup",
      "type": "business_action",
      "action": "check_order_status",
      "params": { "orderNumber": "{{vars.order}}" }
    },
    { "id": "done", "type": "end" }
  ]
}
```

Steps run in array order unless a step sets `next` (a step id, or `null` to end). Conditions branch with
`onTrue` / `onFalse`.

### Triggers

| Type                  | Matches                                                                      | Specificity       |
| --------------------- | ---------------------------------------------------------------------------- | ----------------- |
| `menu_selection`      | A customer picks an option (`menuId`, optional `optionId`)                   | 1 (most specific) |
| `keyword`             | `contains` (whole words/phrases), `exact` or `starts_with`; case-insensitive | 2                 |
| `first_time_customer` | The first message from a new customer                                        | 3                 |
| `business_hours`      | `inside` or `outside` the business hours in Settings (organization timezone) | 4                 |
| `incoming_message`    | Any message                                                                  | 5                 |
| `event`               | `order.created`, `order.status_changed`, `lead.created`                      | separate path     |

When several active workflows match one message, `selectWorkflow` picks the lowest specificity number, then the
lowest `priority`, then the oldest workflow. Exactly one workflow handles a message. Event workflows run when
the API emits the event; order events expose `{{vars.orderNumber}}` and `{{vars.orderStatus}}`.

### Steps

| Type                | Behaviour                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send_text`         | Sends text with variables interpolated                                                                                                                                                                                                                                       |
| `send_menu`         | Sends a published menu; the run ends and the customer's selection drives what happens next                                                                                                                                                                                   |
| `ask_question`      | Sends a question and **waits**; the next inbound message is validated (`text`, `number`, `email`, `phone`), stored in `vars.<variable>` and optionally on the customer profile. After `maxAnswerRetries` invalid answers the conversation is handed to a human               |
| `collect_details`   | Like `ask_question` for up to 8 fields in sequence                                                                                                                                                                                                                           |
| `send_product_list` | Sends products (optional category, max 10)                                                                                                                                                                                                                                   |
| `condition`         | Rules on `message.text`, `customer.isNew`, `customer.hasTag`, `businessHours.open` or a variable, with `contains`, `equals`, `not_equals`, `is_true`, `is_false`, `gt`, `lt`; `mode` `all` or `any`                                                                          |
| `assign_human`      | Marks the conversation `NEEDS_HUMAN` (automation goes quiet) with an optional note                                                                                                                                                                                           |
| `add_tag`           | Tags the customer                                                                                                                                                                                                                                                            |
| `ai_response`       | Asks the assistant (knowledge, approved tools, escalation rules apply) with extra instructions                                                                                                                                                                               |
| `business_action`   | `create_lead`, `check_order_status`, `check_product_availability`, `place_order`. Params are interpolated, then validated on the server. `place_order` asks the customer to reply YES first. A failed action fails the run. Optional `resultVariable` stores the result JSON |
| `end`               | Stops                                                                                                                                                                                                                                                                        |

Variables: `{{customer.name}}`, `{{customer.firstName}}` (both fall back to "there"), `{{message.text}}`,
`{{vars.<name>}}`.

## Validation (`validateDefinition`)

Run in the builder on every edit, on save and before activation:

- schema errors (missing fields, WhatsApp text limits, unknown step types);
- duplicate step ids and references to missing steps;
- **loops** — any cycle in the step graph is rejected (DFS), because cycles are the main source of runaway runs;
- unreachable steps are reported as warnings.

Schema errors are rejected on save (422). A definition with structural errors (missing references, loops) can be
saved as a draft version but cannot be activated.

## Runtime limits (`DEFAULT_LIMITS`)

| Limit              | Value                | On breach                                                                |
| ------------------ | -------------------- | ------------------------------------------------------------------------ |
| `maxSteps`         | 30 per run           | run fails                                                                |
| `maxVisitsPerStep` | 3                    | run fails ("Loop detected") — a second line of defence behind validation |
| `timeoutMs`        | 8 s per run          | run fails                                                                |
| `stepTimeoutMs`    | 5 s per service call | run fails                                                                |
| `maxAnswerRetries` | 2                    | handed to a human                                                        |

## Execution lifecycle

1. The API creates a `WorkflowExecution` row keyed by `(workflowId, triggerEventId)`. A redelivered message
   cannot start a second run (unique constraint).
2. `runWorkflow` returns `SUCCEEDED`, `WAITING` (with the step and field it is waiting on), `HANDED_OFF` or
   `FAILED`, plus the outbound messages and a step log (`stepId`, `type`, `status`, `detail`, `durationMs`).
3. The API stores the log on the execution, delivers the messages and updates the conversation state
   (`workflow_wait` for waiting runs).
4. **Failures** are recorded with the error and the failing step, the customer gets a short apology, the
   conversation is handed to a human and an audit entry is written. Admins can retry a failed run from the
   builder or the API; retries are new attempts with their own trigger id.

## Versioning

Every save creates an immutable `WorkflowVersion`. Activation pins `activeVersionId`; saving a valid new version
of an active workflow moves the live pointer to it, and executions record which version they ran.

## Extending

- **New step type**: add it to `StepSchema` and `STEP_LABELS` in `packages/shared/src/workflow.ts`, handle it in
  `execute.ts` (and `successors()` in `validate.ts` if it branches), add a form in
  `apps/web/src/pages/AutomationEditor.tsx`, and write an engine test.
- **New business action**: add it to `BUSINESS_ACTIONS`, implement it with input validation in
  `apps/api/src/services/actions.ts`, and (for the assistant) add a tool spec in `services/ai/assistant.ts`.
- **New trigger**: extend `TriggerSchema`, `matchTrigger` and `TRIGGER_SPECIFICITY`, then pass the needed data in
  the `TriggerEvent` built by `services/inbound.ts`.
