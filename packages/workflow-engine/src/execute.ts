import type { ConditionRule, Step } from '@wa/shared';
import { successors } from './validate';
import {
  DEFAULT_LIMITS,
  type EngineContext,
  type ExecutionResult,
  type OutboundMessage,
  type RunInput,
  type StepLogEntry,
} from './types';

class EngineError extends Error {}

/** Replaces {{customer.name}}, {{customer.firstName}}, {{vars.x}} and {{message.text}} placeholders. */
export function interpolate(template: string, ctx: EngineContext, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    if (path === 'customer.name') return ctx.customer.name?.trim() || 'there';
    if (path === 'customer.firstName') return ctx.customer.name?.trim().split(/\s+/)[0] || 'there';
    if (path === 'message.text') return ctx.message.text;
    if (path.startsWith('vars.')) return vars[path.slice(5)] ?? '';
    return '';
  });
}

const VALIDATORS: Record<string, (v: string) => boolean> = {
  text: (v) => v.trim().length > 0,
  number: (v) => /^-?\d+(\.\d+)?$/.test(v.trim()),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  phone: (v) => /^\+?[0-9 ()-]{7,18}$/.test(v.trim()),
};
const VALIDATION_HINT: Record<string, string> = {
  text: 'Please type a reply.',
  number: 'Please reply with a number.',
  email: 'Please reply with a valid email address.',
  phone: 'Please reply with a valid phone number.',
};

export function evaluateRule(rule: ConditionRule, ctx: EngineContext, vars: Record<string, string>): boolean {
  const value = (rule.value ?? '').toLowerCase().trim();
  let subject: string | boolean;
  switch (rule.field) {
    case 'message.text':
      subject = ctx.message.text.toLowerCase().trim();
      break;
    case 'customer.isNew':
      subject = ctx.customer.isNew;
      break;
    case 'businessHours.open':
      subject = ctx.businessHoursOpen;
      break;
    case 'customer.hasTag':
      return ctx.customer.tags.some((t) => t.toLowerCase() === value) === (rule.op !== 'not_equals');
    case 'variable':
      subject = (vars[rule.variable ?? ''] ?? '').toLowerCase().trim();
      break;
  }
  switch (rule.op) {
    case 'is_true':
      return subject === true || subject === 'true' || subject === 'yes';
    case 'is_false':
      return subject === false || subject === 'false' || subject === 'no' || subject === '';
    case 'contains':
      return typeof subject === 'string' && value.length > 0 && subject.includes(value);
    case 'equals':
      return String(subject) === value;
    case 'not_equals':
      return String(subject) !== value;
    case 'gt':
      return Number(subject) > Number(value);
    case 'lt':
      return Number(subject) < Number(value);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new EngineError(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Executes (or resumes) one workflow run. Pure orchestration: every side effect
 * goes through `services`, so the run is deterministic for given inputs.
 */
export async function runWorkflow(input: RunInput): Promise<ExecutionResult> {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const now = input.now ?? Date.now;
  const started = now();
  const { definition, context: ctx, services } = input;
  const steps = definition.steps;
  const indexOf = new Map(steps.map((s, i) => [s.id, i] as const));
  const vars: Record<string, string> = { ...ctx.variables };
  const messages: OutboundMessage[] = [];
  const log: StepLogEntry[] = [];
  const visits = new Map<string, number>();
  let handedOff = false;
  let executed = 0;

  const record = (step: Step, status: StepLogEntry['status'], t0: number, detail?: string) =>
    log.push({
      stepId: step.id,
      type: step.type,
      status,
      detail,
      at: new Date(t0).toISOString(),
      durationMs: now() - t0,
    });
  const call = <T>(p: Promise<T>, label: string) => withTimeout(p, limits.stepTimeoutMs, label);
  const nextOf = (i: number): number | null => {
    const target = successors(steps, i)[0];
    return target == null ? null : (indexOf.get(target) ?? null);
  };
  const result = (
    status: ExecutionResult['status'],
    extra: Partial<ExecutionResult> = {},
  ): ExecutionResult => ({
    status,
    messages,
    log,
    variables: vars,
    handedOff,
    ...extra,
  });

  let cursor: number | null = 0;

  // ---- Resume a run that was waiting for the customer's answer ----
  if (input.resume) {
    const idx = indexOf.get(input.resume.stepId);
    if (idx === undefined)
      return result('FAILED', { error: `Cannot resume: step "${input.resume.stepId}" no longer exists` });
    const step = steps[idx];
    const answer = ctx.message.text;
    const t0 = now();
    if (step.type === 'ask_question' || step.type === 'collect_details') {
      const fieldIndex = input.resume.fieldIndex ?? 0;
      const field =
        step.type === 'ask_question'
          ? { variable: step.variable, prompt: step.question, validation: step.validation }
          : step.fields[fieldIndex];
      if (!field) return result('FAILED', { error: 'Cannot resume: field missing' });
      if (!VALIDATORS[field.validation](answer)) {
        const retries = (input.resume.retries ?? 0) + 1;
        if (retries > limits.maxAnswerRetries) {
          record(step, 'error', t0, `Invalid answer after ${retries} attempts`);
          messages.push({
            kind: 'text',
            text: 'Sorry, I could not understand that. A team member will help you shortly.',
          });
          await services.assignHuman('Customer could not answer an automated question');
          handedOff = true;
          return result('HANDED_OFF', { error: 'Too many invalid answers' });
        }
        messages.push({
          kind: 'text',
          text: `${VALIDATION_HINT[field.validation]} ${interpolate(field.prompt, ctx, vars)}`,
        });
        record(step, 'waiting', t0, `Invalid answer, asked again (attempt ${retries})`);
        return result('WAITING', { waiting: { stepId: step.id, fieldIndex, retries } });
      }
      vars[field.variable] = answer.trim();
      const save = step.type === 'ask_question' ? step.saveToCustomerField : step.saveToCustomerFields;
      if (save && services.saveCustomerField)
        await call(services.saveCustomerField(field.variable, answer.trim()), 'saveCustomerField');
      if (step.type === 'collect_details' && fieldIndex + 1 < step.fields.length) {
        const nextField = step.fields[fieldIndex + 1];
        messages.push({ kind: 'text', text: interpolate(nextField.prompt, ctx, vars) });
        record(step, 'waiting', t0, `Saved ${field.variable}; asking ${nextField.variable}`);
        return result('WAITING', { waiting: { stepId: step.id, fieldIndex: fieldIndex + 1 } });
      }
      record(step, 'ok', t0, `Saved ${field.variable}`);
      cursor = nextOf(idx);
    } else {
      return result('FAILED', { error: `Step "${step.id}" cannot be resumed` });
    }
  }

  // ---- Main loop ----
  try {
    while (cursor !== null) {
      if (now() - started > limits.timeoutMs)
        throw new EngineError(`Execution exceeded ${limits.timeoutMs} ms`);
      if (++executed > limits.maxSteps) throw new EngineError(`Execution exceeded ${limits.maxSteps} steps`);
      const step: Step = steps[cursor];
      const v = (visits.get(step.id) ?? 0) + 1;
      visits.set(step.id, v);
      if (v > limits.maxVisitsPerStep) throw new EngineError(`Loop detected at step "${step.id}"`);
      const t0 = now();
      const here: number = cursor;

      switch (step.type) {
        case 'send_text':
          messages.push({ kind: 'text', text: interpolate(step.text, ctx, vars) });
          record(step, 'ok', t0);
          break;
        case 'send_menu': {
          const menu = await call(services.renderMenu(step.menuId), 'renderMenu');
          if (!menu) throw new EngineError(`Menu ${step.menuId} not found or not published`);
          messages.push(menu);
          record(step, 'ok', t0, menu.kind === 'menu' ? `Menu "${menu.body.slice(0, 40)}"` : undefined);
          // A menu hands control to the customer's selection; the run ends here.
          return result('SUCCEEDED');
        }
        case 'send_product_list': {
          const list = await call(
            services.listProducts({ category: step.category, limit: step.limit, intro: step.intro }),
            'listProducts',
          );
          messages.push(list);
          record(step, 'ok', t0, list.kind === 'products' ? `${list.items.length} products` : undefined);
          break;
        }
        case 'ask_question':
          messages.push({ kind: 'text', text: interpolate(step.question, ctx, vars) });
          record(step, 'waiting', t0, `Waiting for ${step.variable}`);
          return result('WAITING', { waiting: { stepId: step.id } });
        case 'collect_details':
          messages.push({ kind: 'text', text: interpolate(step.fields[0].prompt, ctx, vars) });
          record(step, 'waiting', t0, `Waiting for ${step.fields[0].variable}`);
          return result('WAITING', { waiting: { stepId: step.id, fieldIndex: 0 } });
        case 'condition': {
          const outcomes = step.rules.map((r) => evaluateRule(r, ctx, vars));
          const pass = step.mode === 'all' ? outcomes.every(Boolean) : outcomes.some(Boolean);
          record(step, 'ok', t0, pass ? 'true' : 'false');
          const target = pass ? step.onTrue : step.onFalse;
          cursor = target === null ? null : (indexOf.get(target) ?? null);
          continue;
        }
        case 'assign_human':
          await call(services.assignHuman(step.note), 'assignHuman');
          handedOff = true;
          record(step, 'ok', t0, step.note);
          break;
        case 'add_tag':
          await call(services.addTag(step.tag), 'addTag');
          ctx.customer.tags = [...new Set([...ctx.customer.tags, step.tag])];
          record(step, 'ok', t0, step.tag);
          break;
        case 'ai_response': {
          const r = await call(
            services.aiRespond({ instructions: step.instructions, text: ctx.message.text }),
            'aiRespond',
          );
          messages.push({ kind: 'text', text: r.text });
          if (r.handoff) {
            await call(services.assignHuman('Assistant requested a human'), 'assignHuman');
            handedOff = true;
          }
          record(step, 'ok', t0, r.handoff ? 'Escalated to a human' : undefined);
          break;
        }
        case 'business_action': {
          const params = Object.fromEntries(
            Object.entries(step.params).map(([k, val]) => [k, interpolate(val, ctx, vars)]),
          );
          const r = await call(services.runAction(step.action, params), `action ${step.action}`);
          if (r.message) messages.push({ kind: 'text', text: r.message });
          if (step.resultVariable && r.data) vars[step.resultVariable] = JSON.stringify(r.data);
          if (!r.ok) throw new EngineError(r.error || `Action ${step.action} failed`);
          record(
            step,
            'ok',
            t0,
            r.requiresConfirmation
              ? 'Awaiting customer confirmation'
              : JSON.stringify(r.data ?? {}).slice(0, 200),
          );
          if (r.requiresConfirmation) return result('SUCCEEDED', { pendingConfirmation: true });
          break;
        }
        case 'end':
          record(step, 'ok', t0);
          cursor = null;
          continue;
      }
      cursor = nextOf(here);
    }
    return result(handedOff ? 'HANDED_OFF' : 'SUCCEEDED');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const failing = log.length && log[log.length - 1].status === 'error' ? null : cursor;
    if (failing !== null && steps[failing])
      log.push({
        stepId: steps[failing].id,
        type: steps[failing].type,
        status: 'error',
        detail: message,
        at: new Date(now()).toISOString(),
        durationMs: 0,
      });
    return result('FAILED', { error: message });
  }
}
