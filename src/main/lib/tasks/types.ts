/**
 * Task Types
 *
 * TypeScript definitions for task building and management.
 * Used by the Task Builder to create and manage work items.
 */

// Priority options
export const PRIORITY_OPTIONS = [
  { value: "low", label: "Low", description: "Nice to have, no rush" },
  { value: "medium", label: "Medium", description: "Should be done soon" },
  { value: "high", label: "High", description: "Urgent, needs attention" },
] as const

// Status options
export const STATUS_OPTIONS = [
  { value: "todo", label: "To Do", description: "Not started yet" },
  { value: "in_progress", label: "Going On", description: "Currently being worked on" },
  { value: "review", label: "Review", description: "Done, needs review" },
  { value: "done", label: "Done", description: "Completed" },
] as const

// Time frame options for due dates
export const TIME_FRAME_OPTIONS = [
  { value: "today", label: "Today", description: "Must be done today" },
  { value: "tomorrow", label: "Tomorrow", description: "Due tomorrow" },
  { value: "this_week", label: "This Week", description: "Due by end of week" },
  { value: "next_week", label: "Next Week", description: "Due next week" },
  { value: "no_rush", label: "No Rush", description: "No specific deadline" },
] as const

export type PriorityValue = (typeof PRIORITY_OPTIONS)[number]["value"]
export type StatusValue = (typeof STATUS_OPTIONS)[number]["value"]
export type TimeFrameValue = (typeof TIME_FRAME_OPTIONS)[number]["value"]

// Task skeleton - what gets filled during Q&A
export interface TaskSkeleton {
  // Step 1: What (required)
  title: string
  description: string

  // Step 2: Context (optional)
  context?: string
  linkedFiles?: string[]
  projectId?: string

  // Step 3: Assignment (AI only for now)
  assigneeType: "ai"
  agentId?: string // Which agent handles it (for later)

  // Step 4: Organization (optional)
  teamId?: string
  tags?: string[]

  // Step 5: Timing
  timeFrame: TimeFrameValue
  dueDate?: Date
  priority: PriorityValue

  // Execution context (for AI agents)
  workspacePath?: string // Absolute path to work in
  relevantFiles?: string[] // Files to read/edit for this task
  tools?: string[] // Tools needed: "bash", "edit", "grep", "web_search", etc.
  acceptanceCriteria?: string // How do we know the task is complete?
}

// Full task (after creation)
export interface Task extends TaskSkeleton {
  id: string
  status: StatusValue
  createdAt: Date
  updatedAt: Date
  createdBy: "user" | "ai"
  chatId?: string // Linked chat thread for this task
  completedAt?: Date
  summary?: string // AI summary when done
}

// Builder wizard state
export interface TaskBuilderState {
  step: number
  skeleton: Partial<TaskSkeleton>
  isGenerating: boolean
}

// Builder step config
export interface TaskBuilderStep {
  id: number
  title: string
  description: string
  question: string
  isComplete: (skeleton: Partial<TaskSkeleton>) => boolean
}

export const TASK_BUILDER_STEPS: TaskBuilderStep[] = [
  {
    id: 1,
    title: "What",
    description: "Describe the task",
    question: "What needs to be done? Describe the task.",
    isComplete: (s) => Boolean(s.title && s.description),
  },
  {
    id: 2,
    title: "Context",
    description: "Any context needed",
    question: "Any context I should know? Related files, previous work, dependencies?",
    isComplete: () => true, // Context is optional
  },
  {
    id: 3,
    title: "Timing",
    description: "When is it due",
    question: "When does this need to be done? Today, this week, no rush?",
    isComplete: (s) => Boolean(s.timeFrame),
  },
]

// Quick task (minimal info, created fast)
export interface QuickTask {
  title: string
  priority?: PriorityValue
  timeFrame?: TimeFrameValue
  projectId?: string
}
