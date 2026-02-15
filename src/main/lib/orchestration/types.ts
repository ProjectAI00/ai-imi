/**
 * Orchestration Base Types
 *
 * Shared types for all builders and orchestration components.
 */

// Status types for tasks and skeletons — aligned with DB schema
export type Status = "todo" | "in_progress" | "review" | "done"

// Priority levels
export type Priority = "low" | "medium" | "high" | "urgent"

// Execution mode
export type ExecutionMode = "plan" | "agent" | "ask"

// Base metadata shared by all skeletons
export interface BaseMetadata {
  id: string
  createdAt: Date
  updatedAt: Date
  status: Status
  priority: Priority
  tags?: string[]
}

// Base skeleton interface - shared by all builders
export interface BaseSkeleton {
  metadata: BaseMetadata
  name: string
  description: string
}

// Task skeleton extends base
export interface TaskSkeleton extends BaseSkeleton {
  type: "task"
  executionMode: ExecutionMode
  assignedAgent?: string
  dependencies?: string[]
  estimatedDuration?: number // in minutes
  actualDuration?: number
  blockedBy?: string[]
  blockedReason?: string
}

// Project skeleton extends base
export interface ProjectSkeleton extends BaseSkeleton {
  type: "project"
  tasks: string[] // task IDs
  milestones?: MilestoneSkeleton[]
  deadline?: Date
}

// Milestone skeleton
export interface MilestoneSkeleton {
  id: string
  name: string
  description: string
  targetDate?: Date
  completedDate?: Date
  taskIds: string[]
  status: Status
}

// Execution context for running tasks
export interface ExecutionContext {
  mode: ExecutionMode
  workingDirectory: string
  environment?: Record<string, string>
  timeout?: number
  maxIterations?: number
  allowedTools?: string[]
  blockedTools?: string[]
}

// Result of an execution
export interface ExecutionResult {
  success: boolean
  output?: string
  error?: string
  duration: number
  toolsUsed: string[]
  tokensUsed?: number
}

// Progress tracking
export interface ProgressInfo {
  currentStep: number
  totalSteps: number
  currentStepName: string
  percentage: number
  startedAt: Date
  estimatedCompletion?: Date
}
