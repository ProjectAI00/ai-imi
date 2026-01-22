/**
 * Plan Types
 *
 * TypeScript definitions for plan building and management.
 * Plans break down goals into executable steps that generate tasks.
 */

import { BaseSkeleton } from "../goals/types"

// Complexity options for plan steps
export const COMPLEXITY_OPTIONS = [
  { value: "simple", label: "Simple", description: "Quick, straightforward work" },
  { value: "medium", label: "Medium", description: "Moderate effort required" },
  { value: "complex", label: "Complex", description: "Significant effort, may need breakdown" },
] as const

export type ComplexityValue = (typeof COMPLEXITY_OPTIONS)[number]["value"]

// Step status options
export const STEP_STATUS_OPTIONS = [
  { value: "pending", label: "Pending", description: "Not started" },
  { value: "in_progress", label: "In Progress", description: "Currently being worked on" },
  { value: "completed", label: "Completed", description: "Done" },
  { value: "skipped", label: "Skipped", description: "Intentionally skipped" },
] as const

export type StepStatusValue = (typeof STEP_STATUS_OPTIONS)[number]["value"]

// Approval status options
export const APPROVAL_STATUS_OPTIONS = [
  { value: "draft", label: "Draft", description: "Still being created" },
  { value: "awaiting_approval", label: "Awaiting Approval", description: "Ready for review" },
  { value: "approved", label: "Approved", description: "Ready to execute" },
  { value: "rejected", label: "Rejected", description: "Needs revision" },
] as const

export type ApprovalStatusValue = (typeof APPROVAL_STATUS_OPTIONS)[number]["value"]

// Individual plan step
export interface PlanStep {
  id: string
  title: string
  description: string
  complexity: ComplexityValue
  estimatedDuration?: string // e.g., "2 hours", "1 day"
  dependencies?: string[] // other step IDs
  files?: string[] // files to work on
  status: StepStatusValue
  order: number
}

// Plan skeleton - what gets filled during Q&A
export interface PlanSkeleton extends BaseSkeleton {
  type: "plan"
  goalId?: string // optional link to parent goal
  steps: PlanStep[]
  tasks: string[] // generated task IDs
  approvalStatus: ApprovalStatusValue
  context?: string
  tags?: string[]
}

// Full plan (after creation)
export interface Plan extends PlanSkeleton {
  id: string
  createdAt: Date
  updatedAt: Date
  createdBy: "user" | "ai"
  completedAt?: Date
  summary?: string // AI summary when done
}

// Builder wizard state
export interface PlanBuilderState {
  step: number
  skeleton: Partial<PlanSkeleton>
  isGenerating: boolean
}

// Builder step config
export interface PlanBuilderStep {
  id: number
  title: string
  description: string
  question: string
  isComplete: (skeleton: Partial<PlanSkeleton>) => boolean
}

export const PLAN_BUILDER_STEPS: PlanBuilderStep[] = [
  {
    id: 1,
    title: "What",
    description: "Name, description, goal link",
    question: "What is this plan for? Give it a name, describe it, and optionally link to a goal.",
    isComplete: (s) => Boolean(s.name && s.description),
  },
  {
    id: 2,
    title: "Steps",
    description: "Define plan steps",
    question: "What steps are needed? Define each step with its complexity and dependencies.",
    isComplete: (s) => Boolean(s.steps && s.steps.length > 0),
  },
  {
    id: 3,
    title: "Review & Approve",
    description: "Review and submit for approval",
    question: "Review the plan. Submit for approval when ready.",
    isComplete: (s) =>
      Boolean(s.name && s.description && s.steps && s.steps.length > 0),
  },
]
