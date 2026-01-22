/**
 * Plan Builder
 *
 * Utilities for creating and validating plan skeletons.
 */

import { PlanSkeleton, PlanStep } from "./types"

/**
 * Generate a unique ID for steps
 */
function generateStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Validate that skeleton has minimum required fields
 */
export function validatePlanSkeleton(
  skeleton: Partial<PlanSkeleton>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!skeleton.name || skeleton.name.trim().length < 2) {
    errors.push("Name must be at least 2 characters")
  }

  if (!skeleton.description || skeleton.description.trim().length < 10) {
    errors.push("Description must be at least 10 characters")
  }

  if (!skeleton.steps || skeleton.steps.length === 0) {
    errors.push("At least one step is required")
  }

  // Validate steps
  if (skeleton.steps) {
    skeleton.steps.forEach((step, index) => {
      if (!step.title || step.title.trim().length < 2) {
        errors.push(`Step ${index + 1}: Title must be at least 2 characters`)
      }
      if (!step.description || step.description.trim().length < 5) {
        errors.push(`Step ${index + 1}: Description must be at least 5 characters`)
      }
      if (!step.complexity) {
        errors.push(`Step ${index + 1}: Complexity is required`)
      }

      // Validate dependencies exist
      if (step.dependencies) {
        step.dependencies.forEach((depId) => {
          const depExists = skeleton.steps?.some((s) => s.id === depId)
          if (!depExists) {
            errors.push(`Step ${index + 1}: Invalid dependency "${depId}"`)
          }
        })
      }
    })

    // Check for circular dependencies
    const circularError = checkCircularDependencies(skeleton.steps)
    if (circularError) {
      errors.push(circularError)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Check for circular dependencies in steps
 */
function checkCircularDependencies(steps: PlanStep[]): string | null {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function hasCycle(stepId: string): boolean {
    if (recursionStack.has(stepId)) return true
    if (visited.has(stepId)) return false

    visited.add(stepId)
    recursionStack.add(stepId)

    const step = steps.find((s) => s.id === stepId)
    if (step?.dependencies) {
      for (const depId of step.dependencies) {
        if (hasCycle(depId)) return true
      }
    }

    recursionStack.delete(stepId)
    return false
  }

  for (const step of steps) {
    if (hasCycle(step.id)) {
      return "Circular dependency detected in plan steps"
    }
  }

  return null
}

/**
 * Create a default skeleton with empty values
 */
export function createEmptyPlanSkeleton(): Partial<PlanSkeleton> {
  return {
    type: "plan",
    name: "",
    description: "",
    goalId: undefined,
    steps: [],
    tasks: [],
    approvalStatus: "draft",
    context: "",
    tags: [],
  }
}

/**
 * Create a new plan step with default values
 */
export function createPlanStep(overrides?: Partial<PlanStep>): PlanStep {
  return {
    id: generateStepId(),
    title: "",
    description: "",
    complexity: "medium",
    estimatedDuration: undefined,
    dependencies: [],
    files: [],
    status: "pending",
    order: 0,
    ...overrides,
  }
}

/**
 * Reorder steps and update their order property
 */
export function reorderSteps(steps: PlanStep[], fromIndex: number, toIndex: number): PlanStep[] {
  const result = [...steps]
  const [removed] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, removed)
  
  // Update order property
  return result.map((step, index) => ({
    ...step,
    order: index,
  }))
}
