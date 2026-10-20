import { WorkflowDefinitionSchema, type Step, type WorkflowDefinition } from '@wa/shared';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  definition?: WorkflowDefinition;
}

/** Returns the step ids a step can continue to (null = end of workflow). */
export function successors(steps: Step[], index: number): (string | null)[] {
  const step = steps[index];
  if (step.type === 'end') return [];
  if (step.type === 'condition') return [step.onTrue, step.onFalse];
  if (step.next !== undefined) return [step.next];
  return [steps[index + 1]?.id ?? null];
}

/**
 * Structural validation run before a workflow can be activated:
 * schema, unique ids, valid references, no cycles (infinite loop protection),
 * and every step reachable from the first one.
 */
export function validateDefinition(input: unknown): ValidationResult {
  const parsed = WorkflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'definition'}: ${i.message}`),
      warnings: [],
    };
  }
  const def = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map<string, number>();
  def.steps.forEach((s, i) => {
    if (ids.has(s.id)) errors.push(`Step id "${s.id}" is used more than once`);
    ids.set(s.id, i);
  });
  def.steps.forEach((s, i) => {
    for (const target of successors(def.steps, i)) {
      if (target !== null && !ids.has(target))
        errors.push(`Step "${s.id}" points to missing step "${target}"`);
    }
  });
  if (errors.length) return { ok: false, errors, warnings };

  // Cycle detection (DFS). Cycles are rejected: they are the main source of runaway executions.
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    const st = state.get(id) ?? 0;
    if (st === 1) {
      errors.push(`Loop detected: ${[...path, id].join(' → ')}`);
      return;
    }
    if (st === 2) return;
    state.set(id, 1);
    const idx = ids.get(id)!;
    for (const t of successors(def.steps, idx)) if (t) visit(t, [...path, id]);
    state.set(id, 2);
  };
  visit(def.steps[0].id, []);
  for (const s of def.steps)
    if (!state.has(s.id)) warnings.push(`Step "${s.label || s.id}" is never reached`);

  if (def.trigger.type === 'keyword' && def.trigger.keywords.some((k) => k.trim().length < 2))
    warnings.push('Very short keywords may match unrelated messages');

  return { ok: errors.length === 0, errors, warnings, definition: def };
}
