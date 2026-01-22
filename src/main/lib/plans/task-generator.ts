/**
 * Task Generator
 *
 * Converts plan steps into executable tasks.
 */

import { TaskSkeleton, PriorityValue } from "../tasks/types"
import { PlanSkeleton, PlanStep, ComplexityValue } from "./types"

/**
 * Map step complexity to task priority
 */
function complexityToPriority(complexity: ComplexityValue): PriorityValue {
  switch (complexity) {
    case "simple":
      return "low"
    case "medium":
      return "medium"
    case "complex":
      return "high"
    default:
      return "medium"
  }
}

/**
 * Map complexity to time frame
 */
function complexityToTimeFrame(complexity: ComplexityValue): TaskSkeleton["timeFrame"] {
  switch (complexity) {
    case "simple":
      return "today"
    case "medium":
      return "this_week"
    case "complex":
      return "next_week"
    default:
      return "this_week"
  }
}

/**
 * Generate tasks from a single plan step
 * Complex steps may generate multiple tasks
 */
function generateTasksFromStep(
  step: PlanStep,
  plan: PlanSkeleton,
  stepIndex: number
): Partial<TaskSkeleton>[] {
  const baseTask: Partial<TaskSkeleton> = {
    title: step.title,
    description: buildStepDescription(step, plan),
    context: buildTaskContext(step, plan, stepIndex),
    linkedFiles: step.files,
    assigneeType: "ai",
    priority: complexityToPriority(step.complexity),
    timeFrame: complexityToTimeFrame(step.complexity),
    tags: [...(plan.tags || []), `plan:${plan.name}`, `step:${stepIndex + 1}`],
  }

  // For complex steps, consider breaking into sub-tasks
  if (step.complexity === "complex" && step.files && step.files.length > 3) {
    // Split by files for complex steps with many files
    return splitTaskByFiles(baseTask, step.files)
  }

  return [baseTask]
}

/**
 * Build description including step details
 */
function buildStepDescription(step: PlanStep, plan: PlanSkeleton): string {
  const parts = [step.description]

  if (step.estimatedDuration) {
    parts.push(`\n\n**Estimated Duration:** ${step.estimatedDuration}`)
  }

  if (plan.goalId) {
    parts.push(`\n\n**Part of Goal:** ${plan.goalId}`)
  }

  return parts.join("")
}

/**
 * Build context for the task
 */
function buildTaskContext(step: PlanStep, plan: PlanSkeleton, stepIndex: number): string {
  const contextParts: string[] = []

  contextParts.push(`This task is step ${stepIndex + 1} of plan "${plan.name}".`)

  if (plan.description) {
    contextParts.push(`\n\nPlan description: ${plan.description}`)
  }

  if (plan.context) {
    contextParts.push(`\n\nAdditional context: ${plan.context}`)
  }

  if (step.dependencies && step.dependencies.length > 0) {
    const depSteps = plan.steps?.filter((s) => step.dependencies?.includes(s.id))
    if (depSteps && depSteps.length > 0) {
      const depNames = depSteps.map((s) => `"${s.title}"`).join(", ")
      contextParts.push(`\n\n**Dependencies:** This step depends on: ${depNames}`)
    }
  }

  return contextParts.join("")
}

/**
 * Split a complex task by files
 */
function splitTaskByFiles(
  baseTask: Partial<TaskSkeleton>,
  files: string[]
): Partial<TaskSkeleton>[] {
  // Group files by directory or extension
  const fileGroups = groupFilesByDirectory(files)

  return Object.entries(fileGroups).map(([group, groupFiles], index) => ({
    ...baseTask,
    title: `${baseTask.title} (Part ${index + 1}: ${group})`,
    linkedFiles: groupFiles,
    tags: [...(baseTask.tags || []), `part:${index + 1}`],
  }))
}

/**
 * Group files by their parent directory
 */
function groupFilesByDirectory(files: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {}

  for (const file of files) {
    const parts = file.split("/")
    const dir = parts.length > 1 ? parts[parts.length - 2] : "root"

    if (!groups[dir]) {
      groups[dir] = []
    }
    groups[dir].push(file)
  }

  return groups
}

/**
 * Sort steps by dependencies (topological sort)
 */
function sortStepsByDependencies(steps: PlanStep[]): PlanStep[] {
  const sorted: PlanStep[] = []
  const visited = new Set<string>()
  const stepMap = new Map(steps.map((s) => [s.id, s]))

  function visit(step: PlanStep) {
    if (visited.has(step.id)) return
    visited.add(step.id)

    // Visit dependencies first
    if (step.dependencies) {
      for (const depId of step.dependencies) {
        const depStep = stepMap.get(depId)
        if (depStep) {
          visit(depStep)
        }
      }
    }

    sorted.push(step)
  }

  for (const step of steps) {
    visit(step)
  }

  return sorted
}

/**
 * Generate tasks from a plan
 * Each step becomes one or more tasks
 */
export function generateTasksFromPlan(plan: PlanSkeleton): Partial<TaskSkeleton>[] {
  if (!plan.steps || plan.steps.length === 0) {
    return []
  }

  // Sort steps by dependencies
  const sortedSteps = sortStepsByDependencies(plan.steps)

  // Generate tasks for each step
  const tasks: Partial<TaskSkeleton>[] = []

  sortedSteps.forEach((step, index) => {
    const stepTasks = generateTasksFromStep(step, plan, index)
    tasks.push(...stepTasks)
  })

  return tasks
}

/**
 * Estimate total duration from plan steps
 */
export function estimatePlanDuration(plan: PlanSkeleton): string | null {
  if (!plan.steps || plan.steps.length === 0) {
    return null
  }

  // If any step has explicit duration, use those
  const explicitDurations = plan.steps
    .map((s) => s.estimatedDuration)
    .filter(Boolean)

  if (explicitDurations.length > 0) {
    return `${explicitDurations.length} steps with estimates: ${explicitDurations.join(", ")}`
  }

  // Otherwise estimate based on complexity
  const complexityHours: Record<ComplexityValue, number> = {
    simple: 1,
    medium: 4,
    complex: 8,
  }

  const totalHours = plan.steps.reduce((sum, step) => {
    return sum + complexityHours[step.complexity]
  }, 0)

  if (totalHours < 8) {
    return `~${totalHours} hours`
  } else {
    const days = Math.ceil(totalHours / 8)
    return `~${days} day${days > 1 ? "s" : ""}`
  }
}
