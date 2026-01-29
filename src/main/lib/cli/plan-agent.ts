/**
 * Plan Agent Helpers
 *
 * Utilities for parsing AI responses in Plan Mode.
 * Extracts goal and task JSON blocks from conversational AI output.
 */

import type { GoalSkeleton } from "../goals/types"
import type { TaskSkeleton } from "../tasks/types"

/** Parsed result from plan mode AI response */
export interface PlanBuilderResult {
  goal: Partial<GoalSkeleton> | null
  tasks: Partial<TaskSkeleton>[]
  isComplete: boolean
}

/**
 * Parse AI response for goal JSON block
 * Looks for ```goal ... ``` code fence
 */
export function parseGoalBlock(text: string): Partial<GoalSkeleton> | null {
  const goalMatch = text.match(/```goal\s*([\s\S]*?)```/)
  if (!goalMatch) return null

  try {
    const parsed = JSON.parse(goalMatch[1].trim())
    return {
      name: parsed.name,
      description: parsed.description,
      priority: parsed.priority || "medium",
      context: parsed.context,
      workspacePath: parsed.workspacePath,
      relevantFiles: parsed.relevantFiles || [],
    }
  } catch {
    return null
  }
}

/**
 * Parse AI response for tasks JSON block
 * Looks for ```tasks ... ``` code fence
 */
export function parseTasksBlock(text: string): Partial<TaskSkeleton>[] {
  const tasksMatch = text.match(/```tasks\s*([\s\S]*?)```/)
  if (!tasksMatch) return []

  try {
    const parsed = JSON.parse(tasksMatch[1].trim())
    if (!Array.isArray(parsed)) return []

    return parsed.map((t: Record<string, unknown>) => ({
      title: t.title as string,
      description: t.description as string,
      priority: (t.priority as TaskSkeleton["priority"]) || "medium",
      timeFrame: (t.timeFrame as TaskSkeleton["timeFrame"]) || "this_week",
      context: t.context as string | undefined,
      tags: t.tags as string[] | undefined,
      workspacePath: t.workspacePath as string | undefined,
      relevantFiles: (t.relevantFiles as string[]) || [],
      tools: (t.tools as string[]) || [],
      acceptanceCriteria: t.acceptanceCriteria as string | undefined,
    }))
  } catch {
    return []
  }
}

/**
 * Parse full AI response for both goal and tasks
 */
export function parsePlanBuilderResponse(text: string): PlanBuilderResult {
  const goal = parseGoalBlock(text)
  const tasks = parseTasksBlock(text)

  return {
    goal,
    tasks,
    isComplete: goal !== null && tasks.length > 0,
  }
}

/**
 * Check if the builder conversation is complete
 * Complete = has valid goal + at least one task
 */
export function isPlanBuilderComplete(result: PlanBuilderResult): boolean {
  if (!result.goal?.name || !result.goal?.description) return false
  if (result.tasks.length === 0) return false

  // Check all tasks have required fields
  return result.tasks.every((t) => t.title && t.description)
}

/**
 * Validate a goal skeleton has minimum required fields
 */
export function validateGoalSkeleton(
  skeleton: Partial<GoalSkeleton>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!skeleton.name || skeleton.name.trim().length < 2) {
    errors.push("Goal name must be at least 2 characters")
  }

  if (!skeleton.description || skeleton.description.trim().length < 5) {
    errors.push("Goal description must be at least 5 characters")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate task skeletons array
 */
export function validateTaskSkeletons(
  tasks: Partial<TaskSkeleton>[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (tasks.length === 0) {
    errors.push("At least one task is required")
    return { valid: false, errors }
  }

  tasks.forEach((task, index) => {
    if (!task.title || task.title.trim().length < 2) {
      errors.push(`Task ${index + 1}: Title must be at least 2 characters`)
    }
    if (!task.description || task.description.trim().length < 5) {
      errors.push(`Task ${index + 1}: Description must be at least 5 characters`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}
