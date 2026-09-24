/**
 * route.ts — model ROUTING policy (intelligence × cost).
 *
 * "Fast when it is mechanical, full intelligence when it is hard." Every LLM call declares a TASK CLASS;
 * the operator maps each class to a model in `.env` and moves the cost/quality slider without touching code.
 *
 *   LLM_MODEL_MECHANICAL  sort / format / assisted regex   → the cheapest model is enough
 *   LLM_MODEL_EXTRACT     read a site → structured sheet    → good quality/price
 *   LLM_MODEL_DESIGN      creative generation (copy, compose) → full intelligence
 *   LLM_MODEL_STRATEGY    planning, arbitration              → full intelligence
 *
 * Any class left empty falls back to LLM_MODEL.
 */

export const TASK_CLASSES = ["mechanical", "extract", "design", "strategy"] as const
export type TaskClass = (typeof TASK_CLASSES)[number]

export function isTaskClass(s: string): s is TaskClass {
  return (TASK_CLASSES as readonly string[]).includes(s)
}

/** Model id for a task class. Priority: `LLM_MODEL_<CLASS>` > `LLM_MODEL`. */
export function pickModel(taskClass: TaskClass): string {
  const model = process.env[`LLM_MODEL_${taskClass.toUpperCase()}`] || process.env.LLM_MODEL
  if (!model) throw new Error(`No model configured for "${taskClass}": set LLM_MODEL (or LLM_MODEL_${taskClass.toUpperCase()}) in .env`)
  return model
}

/** The current class → model map, for digests and debugging. */
export function routingTable(): Record<TaskClass, string> {
  const table = {} as Record<TaskClass, string>
  for (const c of TASK_CLASSES) table[c] = process.env[`LLM_MODEL_${c.toUpperCase()}`] || process.env.LLM_MODEL || "(unset)"
  return table
}
