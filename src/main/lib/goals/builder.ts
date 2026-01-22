/**
 * Goal Builder
 *
 * Utilities for creating and validating goal skeletons.
 */

import { GoalSkeleton } from "./types"

/**
 * Validate that skeleton has minimum required fields
 */
export function validateGoalSkeleton(
  skeleton: Partial<GoalSkeleton>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!skeleton.name || skeleton.name.trim().length < 2) {
    errors.push("Name must be at least 2 characters")
  }

  if (!skeleton.description || skeleton.description.trim().length < 10) {
    errors.push("Description must be at least 10 characters")
  }

  if (!skeleton.workspaceId) {
    errors.push("Workspace is required")
  }

  if (!skeleton.priority) {
    errors.push("Priority is required")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Create a default skeleton with empty values
 */
export function createEmptyGoalSkeleton(): Partial<GoalSkeleton> {
  return {
    type: "goal",
    name: "",
    description: "",
    workspaceId: "",
    priority: "medium",
    plans: [],
    context: "",
    tags: [],
    status: "draft",
  }
}
