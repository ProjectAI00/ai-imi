/**
 * Plan Mode Tools
 *
 * Custom tools for goal and task creation in Plan Mode.
 * These tools use the existing skeleton/builder architecture for validation.
 */

import { z } from "zod"
import { getDatabase, goals, tasks, workspaces } from "../../db"
import { validateGoalSkeleton, createEmptyGoalSkeleton } from "../../goals/builder"
import { calculateDueDate } from "../../tasks"
import type { GoalSkeleton, PriorityValue } from "../../goals/types"
import type { TaskSkeleton, TimeFrameValue } from "../../tasks/types"
import type { Tool, ToolHandler, ToolInvocation } from "@github/copilot-sdk"
import type { UIMessageChunk } from "../../claude/types"

// Event emitter for tool -> transport communication
// This gets set by the copilot adapter when creating sessions
let askUserEmitter: ((chunk: UIMessageChunk) => void) | null = null
let askUserResponseResolver: Map<string, (response: { answers: Record<string, string> } | { error: string }) => void> = new Map()

export function setAskUserEmitter(emitter: ((chunk: UIMessageChunk) => void) | null) {
  askUserEmitter = emitter
}

export function resolveAskUserResponse(toolCallId: string, response: { answers: Record<string, string> } | { error: string }) {
  const resolver = askUserResponseResolver.get(toolCallId)
  if (resolver) {
    resolver(response)
    askUserResponseResolver.delete(toolCallId)
  }
}

// Tool input schemas - aligned with DB schema (goals/tasks tables)
const createGoalSchema = z.object({
  name: z.string().min(2).max(100).describe("Goal name (2-100 chars)"),
  description: z.string().min(10).describe("What success looks like (min 10 chars)"),
  priority: z.enum(["low", "medium", "high"]).describe("Goal priority"),
  workspacePath: z.string().optional().describe("Absolute path to project folder"),
  workspaceId: z.string().optional().describe("Workspace/project ID"),
  context: z.string().optional().describe("Background info, constraints"),
  tags: z.array(z.string()).optional().describe("Optional tags for organization"),
  relevantFiles: z.array(z.string()).optional().describe("Files relevant to this goal"),
})

// Raw JSON schema for SDK (Zod 3 doesn't have toJSONSchema)
const createGoalJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Goal name (2-100 chars)" },
    description: { type: "string", description: "What success looks like (min 10 chars)" },
    priority: { type: "string", enum: ["low", "medium", "high"], description: "Goal priority" },
    workspacePath: { type: "string", description: "Absolute path to project folder" },
    workspaceId: { type: "string", description: "Workspace/project ID" },
    context: { type: "string", description: "Background info, constraints" },
    tags: { type: "array", items: { type: "string" }, description: "Optional tags for organization" },
    relevantFiles: { type: "array", items: { type: "string" }, description: "Files relevant to this goal" },
  },
  required: ["name", "description", "priority"],
}

const createTaskSchema = z.object({
  goalId: z.string().describe("ID of the parent goal (from imi_create_goal result)"),
  title: z.string().min(2).describe("Task title"),
  description: z.string().min(5).describe("What needs to be done"),
  priority: z.enum(["low", "medium", "high"]).describe("Task priority"),
  timeFrame: z.enum(["today", "tomorrow", "this_week", "next_week", "no_rush"]).describe("When it should be done"),
  context: z.string().optional().describe("Additional context for the task"),
  acceptanceCriteria: z.string().optional().describe("How we know the task is complete"),
  relevantFiles: z.array(z.string()).optional().describe("Files relevant to this task"),
  workspacePath: z.string().optional().describe("Absolute path to work in"),
  tools: z.array(z.string()).optional().describe("Tools needed: bash, edit, grep, web_search, etc."),
})

// Raw JSON schema for SDK
const createTaskJsonSchema = {
  type: "object",
  properties: {
    goalId: { type: "string", description: "ID of the parent goal (from imi_create_goal result)" },
    title: { type: "string", description: "Task title" },
    description: { type: "string", description: "What needs to be done" },
    priority: { type: "string", enum: ["low", "medium", "high"], description: "Task priority" },
    timeFrame: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week", "no_rush"], description: "When it should be done" },
    context: { type: "string", description: "Additional context for the task" },
    acceptanceCriteria: { type: "string", description: "How we know the task is complete" },
    relevantFiles: { type: "array", items: { type: "string" }, description: "Files relevant to this task" },
    workspacePath: { type: "string", description: "Absolute path to work in" },
    tools: { type: "array", items: { type: "string" }, description: "Tools needed: bash, edit, grep, web_search, etc." },
  },
  required: ["goalId", "title", "description", "priority", "timeFrame"],
}

export type CreateGoalInput = z.infer<typeof createGoalSchema>
export type CreateTaskInput = z.infer<typeof createTaskSchema>

/**
 * Create goal handler - validates skeleton, then inserts to database
 */
const createGoalHandler: ToolHandler<CreateGoalInput> = async (args) => {
  try {
    const input = createGoalSchema.parse(args)
    const db = getDatabase()

    const fallbackWorkspace = db.select().from(workspaces).limit(1).get()
    const resolvedWorkspaceId = input.workspaceId || fallbackWorkspace?.id || ""

    // Build a GoalSkeleton from input
    const skeleton: Partial<GoalSkeleton> = {
      ...createEmptyGoalSkeleton(),
      name: input.name,
      description: input.description,
      priority: input.priority as PriorityValue,
      workspaceId: resolvedWorkspaceId,
      workspacePath: input.workspacePath,
      context: input.context,
      tags: input.tags || [],
      relevantFiles: input.relevantFiles || [],
      status: "draft",
    }

    // Validate using the builder's validator
    const validation = validateGoalSkeleton(skeleton)
    if (!validation.valid) {
      console.error(`[IMI Tools] Goal validation failed:`, validation.errors)
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(", ")}`,
      }
    }

    // Insert to database — status starts as "todo" (DB lifecycle status, not skeleton draft status)
    const goal = db
      .insert(goals)
      .values({
        name: skeleton.name!,
        description: skeleton.description!,
        priority: skeleton.priority!,
        workspaceId: skeleton.workspaceId,
        workspacePath: skeleton.workspacePath,
        context: skeleton.context,
        tags: JSON.stringify(skeleton.tags || []),
        relevantFiles: JSON.stringify(skeleton.relevantFiles || []),
        status: "todo",
      })
      .returning()
      .get()

    console.log(`[IMI Tools] Created goal: ${goal.id} - ${goal.name}`)

    return {
      success: true,
      goalId: goal.id,
      message: `Created goal "${goal.name}" on the task board. Use this goalId to create tasks.`,
    }
  } catch (error) {
    console.error(`[IMI Tools] Failed to create goal:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create goal",
    }
  }
}

/**
 * Create task handler - builds TaskSkeleton, then inserts to database
 */
const createTaskHandler: ToolHandler<CreateTaskInput> = async (args) => {
  try {
    const input = createTaskSchema.parse(args)

    // Build a TaskSkeleton from input
    const skeleton: Partial<TaskSkeleton> = {
      title: input.title,
      description: input.description,
      priority: input.priority as PriorityValue,
      timeFrame: input.timeFrame as TimeFrameValue,
      context: input.context,
      acceptanceCriteria: input.acceptanceCriteria,
      relevantFiles: input.relevantFiles,
      workspacePath: input.workspacePath,
      tools: input.tools,
      assigneeType: "ai",
    }

    // Basic validation (TaskSkeleton doesn't have a formal validator yet)
    if (!skeleton.title || skeleton.title.length < 2) {
      return { success: false, error: "Title must be at least 2 characters" }
    }
    if (!skeleton.description || skeleton.description.length < 5) {
      return { success: false, error: "Description must be at least 5 characters" }
    }

    // Calculate due date from timeFrame
    const dueDate = calculateDueDate(skeleton.timeFrame!)

    // Insert to database — all fields aligned with DB schema
    const db = getDatabase()
    const task = db
      .insert(tasks)
      .values({
        title: skeleton.title!,
        description: skeleton.description!,
        priority: skeleton.priority!,
        timeFrame: skeleton.timeFrame!,
        goalId: input.goalId,
        status: "todo",
        dueDate: dueDate instanceof Date ? dueDate.getTime() : undefined,
        context: skeleton.context,
        acceptanceCriteria: skeleton.acceptanceCriteria,
        relevantFiles: skeleton.relevantFiles ? JSON.stringify(skeleton.relevantFiles) : undefined,
        workspacePath: skeleton.workspacePath,
        tools: skeleton.tools ? JSON.stringify(skeleton.tools) : undefined,
        assigneeType: "ai",
        createdBy: "ai",
      })
      .returning()
      .get()

    console.log(`[IMI Tools] Created task: ${task.id} - ${task.title} (goal: ${input.goalId})`)

    return {
      success: true,
      taskId: task.id,
      message: `Created task "${task.title}"`,
    }
  } catch (error) {
    console.error(`[IMI Tools] Failed to create task:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create task",
    }
  }
}

/**
 * IMI Create Goal Tool
 * Creates a new goal on the task board
 */
export const imiCreateGoalTool: Tool<CreateGoalInput> = {
  name: "imi_create_goal",
  description:
    "Create a new goal on the IMI task board. Call this after gathering all required info through Q&A. Returns a goalId that you MUST use when creating tasks.",
  parameters: createGoalJsonSchema,
  handler: createGoalHandler,
}

/**
 * IMI Create Task Tool
 * Creates a task linked to a goal
 */
export const imiCreateTaskTool: Tool<CreateTaskInput> = {
  name: "imi_create_task",
  description:
    "Create a task linked to a goal. You MUST call imi_create_goal first and use the returned goalId. Call this once for each task.",
  parameters: createTaskJsonSchema,
  handler: createTaskHandler,
}

// ============ Ask User Tool ============

// Raw JSON schema for ask_user (SDK needs JSON schema, not Zod 3)
const askUserJsonSchema = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "The question to ask the user",
    },
    choices: {
      type: "array",
      items: { type: "string" },
      description: "Optional list of choices for the user to select from",
    },
  },
  required: ["question"],
}

// Zod schema for validation in handler
const askUserSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  choices: z.array(z.string()).optional().describe("Optional list of choices for the user to select from"),
})

export type AskUserInput = z.infer<typeof askUserSchema>

/**
 * Ask User Tool Handler
 * Emits a question to the UI and waits for user response
 */
const askUserHandler: ToolHandler<AskUserInput> = async (args, invocation: ToolInvocation) => {
  try {
    const input = askUserSchema.parse(args)
    const toolCallId = invocation.toolCallId

    if (!askUserEmitter) {
      console.error("[ask_user] No emitter set - cannot ask questions")
      return { error: "Question system not available" }
    }

    // Format question for UI
    const questions = [{
      question: input.question,
      header: input.question,
      options: (input.choices || []).map((choice, idx) => ({
        label: choice,
        description: "",
      })),
      multiSelect: false,
    }]

    // Emit question to UI
    askUserEmitter({
      type: "ask-user-question",
      toolUseId: toolCallId,
      questions,
    } as UIMessageChunk)

    // Wait for user response (60s timeout)
    const response = await new Promise<{ answers: Record<string, string> } | { error: string }>((resolve) => {
      const timeoutId = setTimeout(() => {
        askUserResponseResolver.delete(toolCallId)
        askUserEmitter?.({
          type: "ask-user-question-timeout",
          toolUseId: toolCallId,
        } as UIMessageChunk)
        resolve({ error: "Question timed out after 10 minutes" })
      }, 600000)

      askUserResponseResolver.set(toolCallId, (result) => {
        clearTimeout(timeoutId)
        resolve(result)
      })
    })

    if ("error" in response) {
      return { error: response.error }
    }

    console.log(`[ask_user] Got response:`, response.answers)
    return {
      success: true,
      answers: response.answers,
    }
  } catch (error) {
    console.error(`[ask_user] Error:`, error)
    return {
      error: error instanceof Error ? error.message : "Failed to ask user",
    }
  }
}

/**
 * Ask User Tool
 * Asks the user a question and waits for their response
 */
export const askUserTool: Tool<AskUserInput> = {
  name: "ask_user",
  description:
    "Ask the user a clarifying question. Use this instead of asking in plain text. Provide choices when possible for better UX. Returns the user's answer.",
  parameters: askUserJsonSchema,
  handler: askUserHandler,
}

/**
 * All plan mode tools
 */
export const PLAN_MODE_TOOLS: Tool<any>[] = [imiCreateGoalTool, imiCreateTaskTool, askUserTool]
