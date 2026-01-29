/**
 * Goal Types
 *
 * TypeScript definitions for goal building and management.
 * Goals represent high-level objectives that can be broken down into plans.
 */

import { PriorityValue, PRIORITY_OPTIONS } from "../tasks/types"

// Re-export priority for convenience
export { PRIORITY_OPTIONS }
export type { PriorityValue as Priority }

// Base skeleton interface (shared across goals, plans, tasks)
export interface BaseSkeleton {
  id?: string
  name: string
  description: string
  createdAt?: Date
  updatedAt?: Date
}

// Goal status options
export const GOAL_STATUS_OPTIONS = [
  { value: "draft", label: "Draft", description: "Still being defined" },
  { value: "active", label: "Active", description: "Currently being worked on" },
  { value: "paused", label: "Paused", description: "Temporarily on hold" },
  { value: "completed", label: "Completed", description: "Goal achieved" },
  { value: "cancelled", label: "Cancelled", description: "Goal abandoned" },
] as const

export type GoalStatusValue = (typeof GOAL_STATUS_OPTIONS)[number]["value"]

// Goal skeleton - what gets filled during Q&A
export interface GoalSkeleton extends BaseSkeleton {
  type: "goal"
  workspaceId: string
  priority: PriorityValue
  plans: string[] // plan IDs
  context?: string
  tags?: string[]
  status?: GoalStatusValue
  dueDate?: Date
  // Execution context (for AI agents)
  workspacePath?: string // Absolute path to the workspace folder
  relevantFiles?: string[] // Files relevant to this goal
}

// Full goal (after creation)
export interface Goal extends GoalSkeleton {
  id: string
  createdAt: Date
  updatedAt: Date
  createdBy: "user" | "ai"
  completedAt?: Date
  summary?: string // AI summary when done
}

// Builder wizard state
export interface GoalBuilderState {
  step: number
  skeleton: Partial<GoalSkeleton>
  isGenerating: boolean
}

// Builder step config
export interface GoalBuilderStep {
  id: number
  title: string
  description: string
  question: string
  isComplete: (skeleton: Partial<GoalSkeleton>) => boolean
}

export const GOAL_BUILDER_STEPS: GoalBuilderStep[] = [
  {
    id: 1,
    title: "What",
    description: "Name and describe your goal",
    question: "What do you want to achieve? Give your goal a name and describe it.",
    isComplete: (s) => Boolean(s.name && s.description),
  },
  {
    id: 2,
    title: "Context",
    description: "Workspace and background",
    question: "What's the context? Which workspace, related files, or background info?",
    isComplete: (s) => Boolean(s.workspaceId),
  },
  {
    id: 3,
    title: "Priority & Timeline",
    description: "Set urgency and deadline",
    question: "How urgent is this? When should it be completed?",
    isComplete: (s) => Boolean(s.priority),
  },
  {
    id: 4,
    title: "Review",
    description: "Review and confirm",
    question: "Review your goal. Make any edits needed before creating.",
    isComplete: (s) => Boolean(s.name && s.description && s.workspaceId && s.priority),
  },
]
