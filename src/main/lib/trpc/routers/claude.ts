import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { app, safeStorage } from "electron"
import path from "path"
import fs from "fs"
import { z } from "zod"
import {
  buildClaudeEnv,
  createTransformer,
  getBundledClaudeBinaryPath,
  logClaudeEnv,
  logRawClaudeMessage,
  type UIMessageChunk,
} from "../../claude"
import { getAdapter, registerAdapter, getAvailableClis } from "../../cli/adapter"
import { openCodeAdapter } from "../../cli/adapters/opencode"
import { cursorAdapter } from "../../cli/adapters/cursor"
import { ampAdapter } from "../../cli/adapters/amp"
import { droidAdapter } from "../../cli/adapters/droid"
import { copilotAdapter } from "../../cli/adapters/copilot"
import { codexAdapter } from "../../cli/adapters/codex"
import { resolveAskUserResponse } from "../../cli/tools"
import { ROOT_SYSTEM_PROMPT, getRootSystemPrompt } from "../../prompts"
import { extractTasksFromText, toTaskSkeletons, hasTaskDefinitions } from "../../cli/task-extraction"
import { parsePlanBuilderResponse, isPlanBuilderComplete } from "../../cli/plan-agent"
import type { ChatInput } from "../../cli/types"
import { AuthStore } from "../../../auth-store"
import { buildContext, type Message } from "../../cli/context"
import { chats, claudeCodeCredentials, getDatabase, goals, projects, subChats, tasks } from "../../db"
import { buildContextForTask, buildContextForGoal } from "../../state-engine/context"
import { onTaskComplete } from "../../state-engine/completion"
import { wrapPromptWithInstructions } from "../../state-engine/prompt-template"
import { calculateDueDate } from "../../tasks"
import { publicProcedure, router } from "../index"

// Regex to match file mentions in text: @[file:local:/path/to/file] or @[folder:local:/path/to/folder]
const FILE_MENTION_REGEX = /@\[(file|folder):local:([^\]]+)\]/g

interface FileMention {
  path: string
  type: "file" | "folder"
}

/**
 * Parse file mentions from prompt text and extract absolute file paths
 * Returns array of file paths with their type (file or folder)
 */
function extractFileMentionsFromText(text: string): FileMention[] {
  const mentions: FileMention[] = []
  let match
  
  while ((match = FILE_MENTION_REGEX.exec(text)) !== null) {
    const type = match[1] as "file" | "folder"
    const filePath = match[2]
    if (filePath) {
      mentions.push({ path: filePath, type })
    }
  }
  
  // Reset regex state
  FILE_MENTION_REGEX.lastIndex = 0
  
  return mentions
}

// Register CLI adapters
registerAdapter(openCodeAdapter)
registerAdapter(cursorAdapter)
registerAdapter(ampAdapter)
registerAdapter(droidAdapter)
registerAdapter(copilotAdapter)
registerAdapter(codexAdapter)

/**
 * Decrypt token using Electron's safeStorage
 */
function decryptToken(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(encrypted, "base64").toString("utf-8")
  }
  const buffer = Buffer.from(encrypted, "base64")
  return safeStorage.decryptString(buffer)
}

/**
 * Get Claude Code OAuth token from local SQLite
 * Returns null if not connected
 */
function getClaudeCodeToken(): string | null {
  try {
    const db = getDatabase()
    const cred = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get()

    if (!cred?.oauthToken) {
      console.log("[claude] No Claude Code credentials found")
      return null
    }

    return decryptToken(cred.oauthToken)
  } catch (error) {
    console.error("[claude] Error getting Claude Code token:", error)
    return null
  }
}

// Dynamic import for ESM module
const getClaudeQuery = async () => {
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  return sdk.query
}

// Active sessions for cancellation
const activeSessions = new Map<string, AbortController>()
const pendingToolApprovals = new Map<
  string,
  {
    subChatId: string
    resolve: (decision: {
      approved: boolean
      message?: string
      updatedInput?: unknown
    }) => void
  }
>()

const clearPendingApprovals = (message: string, subChatId?: string) => {
  for (const [toolUseId, pending] of pendingToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue
    pending.resolve({ approved: false, message })
    pendingToolApprovals.delete(toolUseId)
  }
}

// Image attachment schema
const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(), // e.g. "image/png", "image/jpeg"
  filename: z.string().optional(),
})

export type ImageAttachment = z.infer<typeof imageAttachmentSchema>

// File attachment schema (desktop file picker paths)
const fileAttachmentSchema = z.object({
  path: z.string(),
  filename: z.string().optional(),
  size: z.number().optional(),
  mediaType: z.string().optional(),
})

export const claudeRouter = router({
  /**
   * Stream chat with Claude - single subscription handles everything
   */
  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        prompt: z.string(),
        cwd: z.string(),
        cli: z.enum(["claude-code", "opencode", "cursor", "amp", "droid", "copilot"]).default("claude-code"),
        mode: z.enum(["plan", "agent"]).default("agent"),
        sessionId: z.string().optional(),
        model: z.string().optional(),
        maxThinkingTokens: z.number().optional(), // Enable extended thinking
        images: z.array(imageAttachmentSchema).optional(), // Image attachments
        files: z.array(fileAttachmentSchema).optional(), // File attachments
        taskId: z.string().optional(), // Task being executed (for state engine)
        goalId: z.string().optional(), // Goal being executed (orchestrator mode)
      }),
    )
    .subscription(({ input }) => {
      const subscriptionStart = Date.now()
      const subId = input.subChatId.slice(-8)
      console.log(`[SD] M:SUB_START sub=${subId} cli=${input.cli} t=0ms`)
      
      return observable<UIMessageChunk>((emit) => {
        const elapsed = () => `${Date.now() - subscriptionStart}ms`
        console.log(`[SD] M:OBSERVABLE_CREATED sub=${subId} t=${elapsed()}`)
        
        // Helper to emit error as both text (for display) and error chunk (for toast)
        const emitCliError = (errorText: string, category: string, cli: string) => {
          const errorId = `cli-error-${Date.now()}`
          emit.next({ type: "start" })
          emit.next({ type: "text-start", id: errorId })
          emit.next({ type: "text-delta", id: errorId, delta: errorText })
          emit.next({ type: "text-end", id: errorId })
          emit.next({
            type: "error",
            errorText,
            debugInfo: { category, cli },
          } as UIMessageChunk)
          emit.next({ type: "finish" })
          emit.complete()
        }

        // Handle non-Claude CLIs via adapter system
        if (input.cli !== "claude-code") {
          const db = getDatabase()

          // Use CLI adapter
          const adapter = getAdapter(input.cli)
          if (!adapter) {
            emitCliError(`Unknown CLI: ${input.cli}`, "CLI_UNKNOWN", input.cli)
            return
          }

          // Pre-check: Verify CLI is available before spawning
          ; (async () => {
            console.log(`[SD] M:ADAPTER_ASYNC_START sub=${subId} t=${elapsed()}`)
            try {
              const isAvailable = await adapter.isAvailable()
              console.log(`[SD] M:ADAPTER_AVAILABLE sub=${subId} isAvailable=${isAvailable} t=${elapsed()}`)
              if (!isAvailable) {
                const cliName = input.cli === "cursor" ? "Cursor" : input.cli === "opencode" ? "OpenCode" : input.cli === "copilot" ? "GitHub Copilot" : input.cli
                const installGuide = input.cli === "cursor"
                  ? "Install Cursor and enable the CLI: Cursor > Settings > Enable CLI"
                  : input.cli === "opencode"
                    ? "Install OpenCode: npm install -g opencode"
                    : input.cli === "copilot"
                      ? "Install Copilot CLI: https://github.com/github/copilot-cli"
                      : `Install ${cliName} CLI`

                emitCliError(
                  `${cliName} CLI not found. ${installGuide}`,
                  input.cli === "cursor"
                    ? "CURSOR_NOT_INSTALLED"
                    : input.cli === "opencode"
                      ? "OPENCODE_NOT_INSTALLED"
                      : input.cli === "copilot"
                        ? "COPILOT_NOT_INSTALLED"
                        : "CLI_NOT_INSTALLED",
                  input.cli
                )
                return
              }

              // Build context from existing messages
              const existing = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
              const existingMessages = JSON.parse(existing?.messages || "[]") as Message[]
              const existingSessionId = existing?.sessionId || undefined
              const contextHistory = existingMessages.length > 0
                ? buildContext(existingMessages)
                : undefined
              
              // Log session state
              if (existingSessionId) {
                console.log(`[CLI] Found existing session ID: ${existingSessionId}`)
              }

              // Extract file mentions from prompt text (e.g., @[file:local:/path/to/file])
              const mentionedFiles = extractFileMentionsFromText(input.prompt)
              console.log(`[CLI] Found ${mentionedFiles.length} file mentions in prompt`)

              // Read file contents from both explicit attachments and text mentions
              // This ensures CLI tools can access file content even from restricted directories (iCloud, etc.)
              console.log(`[CLI] Processing files for adapter:`, input.files?.length || 0, "explicit files,", mentionedFiles.length, "mentioned files")
              
              // Build set of paths already in explicit files to avoid duplicates
              const explicitFilePaths = new Set(input.files?.map(f => f.path) || [])
              
              // Combine explicit file attachments with mentioned files
              const allFilesToRead: { path: string; filename?: string; type?: "file" | "folder" }[] = [
                ...(input.files || []).map(f => ({ ...f, type: "file" as const })),
                ...mentionedFiles
                  .filter(m => !explicitFilePaths.has(m.path)) // Skip duplicates
                  .map(m => ({ path: m.path, filename: m.path.split("/").pop() || "file", type: m.type }))
              ]
              
              const fileAttachmentText = allFilesToRead.length
                ? (await Promise.all(
                    allFilesToRead.map(async (file) => {
                      console.log(`[CLI] Processing ${file.type || 'file'}:`, file.path)
                      const label = file.filename || file.path.split("/").pop() || "file"
                      let content = ""
                      try {
                        // Check if path is absolute
                        if (!path.isAbsolute(file.path)) {
                          console.warn(`[CLI] Skipping non-absolute file path: ${file.path}`)
                          return null
                        }
                        
                        // Check if it's a directory
                        const stats = await fs.promises.stat(file.path)
                        if (stats.isDirectory()) {
                          // For directories, list the contents instead of reading
                          console.log(`[CLI] Listing directory contents: ${file.path}`)
                          const entries = await fs.promises.readdir(file.path, { withFileTypes: true })
                          const fileList = entries
                            .slice(0, 100) // Limit to 100 entries
                            .map(entry => `${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`)
                            .join('\n')
                          content = `Directory contents (${entries.length} items):\n${fileList}`
                          if (entries.length > 100) {
                            content += `\n... and ${entries.length - 100} more items`
                          }
                          return `--- Attached folder: ${label} ---\nPath: ${file.path}\n\n${content}\n--- End of ${label} ---`
                        }
                        
                        // Read file content directly - Electron has access even to iCloud directories
                        const fileContent = await fs.promises.readFile(file.path, "utf-8")
                        // Limit content to prevent massive prompts (100KB max per file)
                        const maxSize = 100 * 1024
                        content = fileContent.length > maxSize 
                          ? fileContent.slice(0, maxSize) + "\n\n[Content truncated - file exceeds 100KB]"
                          : fileContent
                        console.log(`[CLI] Read file content: ${label} (${fileContent.length} bytes)`)
                      } catch (err) {
                        console.error(`[CLI] Failed to read file: ${file.path}`, err)
                        content = `[Error: Could not read file - ${err instanceof Error ? err.message : "unknown error"}]`
                      }
                      return `--- Attached file: ${label} ---\nPath: ${file.path}\n\n${content}\n--- End of ${label} ---`
                    })
                  ))
                    .filter(Boolean)
                    .join("\n\n")
                : ""

              const promptWithAttachments = fileAttachmentText
                ? `${fileAttachmentText}\n\n${input.prompt}`
                : input.prompt

              // Save user message first
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: [{ type: "text", text: promptWithAttachments }],
              }
              const messagesToSave = [...existingMessages, userMessage]
              db.update(subChats)
                .set({ messages: JSON.stringify(messagesToSave), updatedAt: new Date() })
                .where(eq(subChats.id, input.subChatId))
                .run()

              // Inject API keys for third-party services
              let ampApiKey: string | undefined
              if (input.cli === "amp") {
                const authStore = new AuthStore(app.getPath("userData"))
                const authData = authStore.load()
                if (authData?.ampApiKey) {
                  ampApiKey = authData.ampApiKey
                }
              }

              // Execute via adapter - use mode-aware system prompt with pre-filled context
              // Get the workspace path from the chat's project
              const chatForPath = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
              let workspacePath: string | undefined
              if (chatForPath?.projectId) {
                const project = db.select().from(projects).where(eq(projects.id, chatForPath.projectId)).get()
                workspacePath = project?.path
                console.log(`[CLI] Found workspace path: ${workspacePath}`)
              } else {
                console.log(`[CLI] No projectId on chat, workspacePath will be undefined`)
              }
              
              // Collect all mentioned files for pre-fill
              const allMentionedFiles = [
                ...mentionedFiles.map(m => m.path),
                ...(input.files?.map(f => f.path) || [])
              ]
              console.log(`[CLI] Pre-fill context: mode=${input.mode}, workspacePath=${workspacePath}, files=${allMentionedFiles.length}`)
              
              // Determine if we're executing a goal/task (for execute mode prompt)
              const isExecutingGoal = !!(input.goalId || input.taskId)
              
              const systemPrompt = getRootSystemPrompt({ 
                mode: input.mode,
                workspacePath,
                mentionedFiles: allMentionedFiles.length > 0 ? allMentionedFiles : undefined,
                isExecutingGoal,
              })
              
              // Log if plan mode context is included
              if (input.mode === "plan") {
                console.log(`[CLI] Plan mode prompt includes pre-filled context: ${systemPrompt.includes("Pre-filled Context")}`)
              }
              
              if (isExecutingGoal) {
                console.log(`[CLI] Execute mode prompt included for ${input.goalId ? 'goal' : 'task'}`)
              }

              // If executing a goal or task, inject appropriate context
              let finalPrompt = promptWithAttachments
              if (input.goalId) {
                // Goal mode: orchestrator sees all tasks, decides strategy
                try {
                  const goalContext = buildContextForGoal(input.goalId)
                  finalPrompt = `${goalContext}\n\n---\n\nUser message: ${promptWithAttachments}`
                  console.log(`[CLI] Injected goal context for goalId: ${input.goalId}`)
                } catch (err) {
                  console.warn(`[CLI] Failed to build goal context:`, err)
                }
              } else if (input.taskId) {
                // Task mode: focused on one task but sees its place in goal
                try {
                  const taskContext = buildContextForTask(input.taskId)
                  finalPrompt = `${taskContext}\n\n---\n\n${wrapPromptWithInstructions(promptWithAttachments)}`
                  console.log(`[CLI] Injected task context for taskId: ${input.taskId}`)
                } catch (err) {
                  console.warn(`[CLI] Failed to build task context:`, err)
                }
              }
              
              const chatInput: ChatInput = {
                ...input,
                prompt: finalPrompt,
                contextHistory,
                rootSystemPrompt: systemPrompt,
                ampApiKey,
                // Use existing session ID if we have one (for session resume)
                sessionId: input.sessionId || existingSessionId,
              }

              console.log(`[SD] M:ADAPTER_START sub=${subId} t=${elapsed()}`)
              const subscription = adapter.chat(chatInput)
              console.log(`[SD] M:ADAPTER_RETURNED sub=${subId} t=${elapsed()}`)

              // Track assistant response - both text AND tool calls
              let assistantText = ""
              const assistantParts: Array<{
                type: string
                text?: string
                toolCallId?: string
                toolName?: string
                input?: any
                result?: any
                state?: string
              }> = []
              let textStartEmitted = false
              const textId = `cli-text-${Date.now()}`
              let currentSessionId: string | undefined
              let firstChunkEmitted = false

              subscription.subscribe({
                next: (chunk) => {
                  // Log first chunk to trace latency
                  if (!firstChunkEmitted) {
                    firstChunkEmitted = true
                    console.log(`[SD] M:FIRST_EMIT sub=${subId} type=${chunk.type} t=${elapsed()}`)
                  }
                  
                  // Save session ID for future resume
                  if (chunk.type === "session-id" && chunk.sessionId) {
                    console.log(`[CLI] Saving session ID for resume: ${chunk.sessionId}`)
                    currentSessionId = chunk.sessionId
                    db.update(subChats)
                      .set({ sessionId: chunk.sessionId, updatedAt: new Date() })
                      .where(eq(subChats.id, input.subChatId))
                      .run()
                  }
                  // Accumulate text from text-delta chunks (not "text")
                  if (chunk.type === "text-delta" && chunk.delta) {
                    assistantText += chunk.delta
                  }
                  // Capture tool calls for persistence
                  if (chunk.type === "tool-input-available") {
                    console.log(`[CLI] Tool call: ${chunk.toolName} (${chunk.toolCallId})`)
                    assistantParts.push({
                      type: `tool-${chunk.toolName}`,
                      toolCallId: chunk.toolCallId,
                      toolName: chunk.toolName,
                      input: chunk.input,
                      state: "call",
                    })
                  }
                  // Capture tool outputs
                  if (chunk.type === "tool-output-available") {
                    console.log(`[CLI] Tool output: ${chunk.toolCallId}`)
                    const toolPart = assistantParts.find(
                      (p) => p.type?.startsWith("tool-") && p.toolCallId === chunk.toolCallId
                    )
                    if (toolPart) {
                      toolPart.result = chunk.output
                      toolPart.state = "result"
                    }
                  }
                  // If we get an error chunk, ALSO emit it as a text-delta so it shows in the UI
                    if (chunk.type === "error" && chunk.errorText) {
                      const errorMsg = chunk.errorText
                      assistantText += errorMsg // Add to accumulated text for saving
                      // Emit text-start if not already emitted
                      if (!textStartEmitted) {
                        emit.next({ type: "text-start", id: textId })
                        textStartEmitted = true
                      }
                      emit.next({
                        type: "text-delta",
                        id: textId,
                        delta: errorMsg
                      })
                    }
                    // Log chunk forwarding (not every text-delta to avoid spam)
                    if (chunk.type !== "text-delta" || Math.random() < 0.1) {
                      console.log(`[SD] M:FWD_CHUNK sub=${subId} type=${chunk.type} t=${elapsed()}`)
                    }
                    emit.next(chunk)
                },
                error: (err) => {
                  emit.next({ type: "error", errorText: String(err) })
                  // Don't emit finish/complete here - adapter already did
                },
                complete: () => {
                  console.log(`[SD] M:ADAPTER_COMPLETE sub=${subId} t=${elapsed()}`)
                  // Adapter already emitted finish/complete, just do DB saving
                  // Save assistant message (include both text and tool calls)
                  const hasContent = assistantText || assistantParts.length > 0
                  if (hasContent) {
                    console.log(`[CLI] Stream complete. Mode: ${input.mode}, Text length: ${assistantText.length}, Tool calls: ${assistantParts.length}`)
                    console.log(`[CLI] Checking for goal/tasks blocks...`)
                    console.log(`[CLI] Has goal block: ${assistantText.includes('\`\`\`goal')}`)
                    console.log(`[CLI] Has tasks block: ${assistantText.includes('\`\`\`tasks')}`)
                    
                    // Build parts array: text first, then tool calls
                    const finalParts: Array<any> = []
                    if (assistantText) {
                      finalParts.push({ type: "text", text: assistantText })
                    }
                    finalParts.push(...assistantParts)
                    
                    const assistantMessage = {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      parts: finalParts,
                      metadata: currentSessionId ? { sessionId: currentSessionId } : undefined,
                    }
                    const finalMessages = [...messagesToSave, assistantMessage]
                    db.update(subChats)
                      .set({ messages: JSON.stringify(finalMessages), updatedAt: new Date() })
                      .where(eq(subChats.id, input.subChatId))
                      .run()

                    // Extract and create tasks if in plan mode
                    if (input.mode === "plan" && hasTaskDefinitions(assistantText)) {
                      try {
                        const extraction = extractTasksFromText(assistantText)
                        
                        if (extraction.tasks.length > 0) {
                          console.log(`[CLI] Extracted ${extraction.tasks.length} tasks from plan mode response`)
                          
                          // Get project ID from chat
                          const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
                          const projectId = chat?.projectId
                          
                          // Create tasks in database
                          const createdTasks: Array<{ id: string; title: string }> = []
                          for (const task of extraction.tasks) {
                            const timeFrame = task.timeFrame || "this_week"
                            const dueDate = calculateDueDate(timeFrame)
                            
                            const created = db
                              .insert(tasks)
                              .values({
                                title: task.title,
                                description: task.description,
                                context: task.context,
                                tags: JSON.stringify(task.tags || []),
                                priority: task.priority || "medium",
                                timeFrame,
                                dueDate,
                                projectId,
                                chatId: input.chatId,
                                assigneeType: "ai",
                                status: "todo",
                                createdBy: "ai",
                              })
                              .returning()
                              .get()
                            
                            createdTasks.push({ id: created.id, title: created.title })
                          }
                          
                          // Emit task-created event for UI
                          emit.next({
                            type: "tasks-created",
                            tasks: createdTasks,
                          } as UIMessageChunk)
                          
                          console.log(`[CLI] Created ${createdTasks.length} tasks:`, createdTasks.map(t => t.title))
                        }
                        
                        if (extraction.error) {
                          console.warn(`[CLI] Task extraction warning: ${extraction.error}`)
                        }
                      } catch (taskError) {
                        console.error(`[CLI] Failed to create tasks:`, taskError)
                      }
                    }

                    // Extract and create goal/tasks from plan builder blocks (```goal and ```tasks)
                    if (input.mode === "plan") {
                      try {
                        console.log(`[Plan Mode] Attempting to parse goal/tasks from response...`)
                        const planResult = parsePlanBuilderResponse(assistantText)
                        console.log(`[Plan Mode] Parse result:`, {
                          hasGoal: !!planResult.goal,
                          goalName: planResult.goal?.name,
                          taskCount: planResult.tasks.length,
                          isComplete: planResult.isComplete
                        })
                        
                        if (isPlanBuilderComplete(planResult)) {
                          console.log(`[Plan Mode] Found complete plan with goal and ${planResult.tasks.length} tasks`)
                          
                          // Get project ID from chat for workspaceId
                          const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
                          const workspaceId = chat?.projectId
                          
                          // Create goal in database
                          const createdGoal = db
                            .insert(goals)
                            .values({
                              name: planResult.goal!.name!,
                              description: planResult.goal!.description!,
                              workspaceId,
                              priority: planResult.goal!.priority || "medium",
                              context: planResult.goal!.context,
                              tags: "[]",
                              status: "todo",
                              // Execution context
                              workspacePath: planResult.goal!.workspacePath,
                              relevantFiles: JSON.stringify(planResult.goal!.relevantFiles || []),
                            })
                            .returning()
                            .get()
                          
                          // Create tasks linked to the goal
                          const createdTaskIds: string[] = []
                          for (const taskSkeleton of planResult.tasks) {
                            const timeFrame = taskSkeleton.timeFrame || "this_week"
                            const dueDate = calculateDueDate(timeFrame)
                            
                            const created = db
                              .insert(tasks)
                              .values({
                                title: taskSkeleton.title!,
                                description: taskSkeleton.description!,
                                context: taskSkeleton.context,
                                tags: JSON.stringify(taskSkeleton.tags || []),
                                priority: taskSkeleton.priority || "medium",
                                timeFrame,
                                dueDate,
                                projectId: workspaceId,
                                goalId: createdGoal.id,
                                chatId: input.chatId,
                                assigneeType: "ai",
                                status: "todo",
                                createdBy: "ai",
                                // Execution context
                                workspacePath: taskSkeleton.workspacePath || planResult.goal!.workspacePath,
                                relevantFiles: JSON.stringify(taskSkeleton.relevantFiles || []),
                                tools: JSON.stringify(taskSkeleton.tools || []),
                                acceptanceCriteria: taskSkeleton.acceptanceCriteria,
                              })
                              .returning()
                              .get()
                            
                            createdTaskIds.push(created.id)
                          }
                          
                          console.log(`[Plan Mode] Created goal: ${createdGoal.id}, tasks: ${createdTaskIds.length}`)
                          
                          // Emit goal-created event for UI
                          emit.next({
                            type: "goal-created",
                            goalId: createdGoal.id,
                            goalName: createdGoal.name,
                            taskCount: createdTaskIds.length,
                          } as UIMessageChunk)
                        }
                      } catch (planError) {
                        console.error(`[Plan Mode] Failed to create goal/tasks:`, planError)
                      }
                    }

                    // Handle task completion for state engine
                    if (input.taskId) {
                      onTaskComplete(input.taskId, assistantText)
                        .then(() => console.log(`[CLI] Task completed: ${input.taskId}`))
                        .catch((err) => console.error(`[CLI] Failed to handle task completion:`, err))
                    }
                  }
                  console.log(`[SD] M:ADAPTER_COMPLETE_DONE sub=${subId} t=${elapsed()}`)
                  // Don't emit finish/complete - adapter already did that
                  // This just saves to DB after the stream completed
                },
              })
            } catch (error) {
              const errorText = error instanceof Error ? error.message : String(error)
              emitCliError(`Failed to start ${input.cli}: ${errorText}`, "CLI_SETUP_ERROR", input.cli)
            }
          })()

          return () => {
            console.log(`[CLI] Cleanup called for CLI adapter: ${input.cli}, subChatId: ${input.subChatId}`)
            adapter.cancel(input.subChatId)
          }
        }

        // Claude Code SDK logic below
        const abortController = new AbortController()
        const streamId = crypto.randomUUID()
        activeSessions.set(input.subChatId, abortController)

        // Stream debug logging
        const streamStart = Date.now()
        let chunkCount = 0
        let lastChunkType = ""
        // Shared sessionId for cleanup to save on abort
        let currentSessionId: string | null = null
        console.log(`[SD] M:START sub=${subId} stream=${streamId.slice(-8)} mode=${input.mode}`)

        // Track if observable is still active (not unsubscribed)
        let isObservableActive = true

        // Helper to safely emit (no-op if already unsubscribed)
        // Emit immediately without batching for lowest latency
        const safeEmit = (chunk: UIMessageChunk) => {
          if (!isObservableActive) return false
          try {
            emit.next(chunk)
            return true
          } catch {
            isObservableActive = false
            return false
          }
        }

        // Helper to safely complete (no-op if already closed)
        const safeComplete = () => {
          if (textDeltaFlushTimeout) {
            clearTimeout(textDeltaFlushTimeout)
            textDeltaFlushTimeout = null
          }
          flushTextDeltas()
          try {
            emit.complete()
          } catch {
            // Already completed or closed
          }
        }

        // Helper to emit error to frontend
        const emitError = (error: unknown, context: string) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          const errorStack = error instanceof Error ? error.stack : undefined

          console.error(`[claude] ${context}:`, errorMessage)
          if (errorStack) console.error("[claude] Stack:", errorStack)

          // Send detailed error to frontend (safely)
          safeEmit({
            type: "error",
            errorText: `${context}: ${errorMessage}`,
            // Include extra debug info
            ...(process.env.NODE_ENV !== "production" && {
              debugInfo: {
                context,
                cwd: input.cwd,
                mode: input.mode,
                PATH: process.env.PATH?.slice(0, 200),
              },
            }),
          } as UIMessageChunk)
        }

          ; (async () => {
            try {
              const db = getDatabase()

              // 1. Get existing messages from DB
              const existing = db
                .select()
                .from(subChats)
                .where(eq(subChats.id, input.subChatId))
                .get()
              const existingMessages = JSON.parse(existing?.messages || "[]")
              const existingSessionId = existing?.sessionId || null

              // Check if last message is already this user message (avoid duplicate)
              const lastMsg = existingMessages[existingMessages.length - 1]
              const isDuplicate =
                lastMsg?.role === "user" &&
                lastMsg?.parts?.[0]?.text === input.prompt

              // 2. Create user message and save BEFORE streaming (skip if duplicate)
              let userMessage: any
              let messagesToSave: any[]

              if (isDuplicate) {
                userMessage = lastMsg
                messagesToSave = existingMessages
              } else {
                userMessage = {
                  id: crypto.randomUUID(),
                  role: "user",
                  parts: [{ type: "text", text: input.prompt }],
                }
                messagesToSave = [...existingMessages, userMessage]

                db.update(subChats)
                  .set({
                    messages: JSON.stringify(messagesToSave),
                    streamId,
                    updatedAt: new Date(),
                  })
                  .where(eq(subChats.id, input.subChatId))
                  .run()
              }

              // 3. Get Claude SDK
              let claudeQuery
              try {
                claudeQuery = await getClaudeQuery()
              } catch (sdkError) {
                emitError(sdkError, "Failed to load Claude SDK")
                console.log(`[SD] M:END sub=${subId} reason=sdk_load_error n=${chunkCount}`)
                safeEmit({ type: "finish" } as UIMessageChunk)
                safeComplete()
                return
              }

              const transform = createTransformer()

              // 4. Setup accumulation state
              const parts: any[] = []
              let currentText = ""
              let metadata: any = {}

              // Capture stderr from Claude process for debugging
              const stderrLines: string[] = []

              // Build prompt: if there are images/files, create an AsyncIterable<SDKUserMessage>
              // Otherwise use simple string prompt
              let prompt: string | AsyncIterable<any> = input.prompt

              // If executing a goal or task, inject appropriate context
              if (input.goalId) {
                // Goal mode: orchestrator sees all tasks, decides strategy
                try {
                  const goalContext = buildContextForGoal(input.goalId)
                  prompt = `${goalContext}\n\n---\n\nUser message: ${input.prompt}`
                  console.log(`[Claude SDK] Injected goal context for goalId: ${input.goalId}`)
                } catch (err) {
                  console.warn(`[Claude SDK] Failed to build goal context:`, err)
                }
              } else if (input.taskId) {
                // Task mode: focused on one task but sees its place in goal
                try {
                  const taskContext = buildContextForTask(input.taskId)
                  prompt = `${taskContext}\n\n---\n\n${wrapPromptWithInstructions(input.prompt)}`
                  console.log(`[Claude SDK] Injected task context for taskId: ${input.taskId}`)
                } catch (err) {
                  console.warn(`[Claude SDK] Failed to build task context:`, err)
                }
              }

              const hasImages = input.images && input.images.length > 0
              const hasFiles = input.files && input.files.length > 0

              if (hasImages || hasFiles) {
                const messageContent: any[] = []

                if (hasFiles) {
                  // Read file contents, handling directories specially
                  const fileContents = (await Promise.all(
                    input.files.map(async (file) => {
                      const label = file.filename || file.path.split("/").pop() || "file"
                      try {
                        const stats = await fs.promises.stat(file.path)
                        if (stats.isDirectory()) {
                          // For directories, list contents
                          const entries = await fs.promises.readdir(file.path, { withFileTypes: true })
                          const fileList = entries
                            .slice(0, 100)
                            .map(entry => `${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`)
                            .join('\n')
                          let content = `Directory contents (${entries.length} items):\n${fileList}`
                          if (entries.length > 100) {
                            content += `\n... and ${entries.length - 100} more items`
                          }
                          return `--- Attached folder: ${label} ---\nPath: ${file.path}\n\n${content}\n--- End of ${label} ---`
                        } else {
                          // Read file content
                          const content = await fs.promises.readFile(file.path, "utf-8")
                          const maxSize = 100 * 1024
                          const truncatedContent = content.length > maxSize
                            ? content.slice(0, maxSize) + "\n\n[Content truncated - file exceeds 100KB]"
                            : content
                          return `--- Attached file: ${label} ---\nPath: ${file.path}\n\n${truncatedContent}\n--- End of ${label} ---`
                        }
                      } catch (err) {
                        return `Attached file: ${label}\nPath: ${file.path}\n[Error reading: ${err instanceof Error ? err.message : 'unknown error'}]`
                      }
                    })
                  ))
                    .join("\n\n")
                  
                  messageContent.push({
                    type: "text" as const,
                    text: fileContents,
                  })
                }

                if (hasImages) {
                  messageContent.push(
                    ...input.images.map((img) => ({
                      type: "image" as const,
                      source: {
                        type: "base64" as const,
                        media_type: img.mediaType,
                        data: img.base64Data,
                      },
                    })),
                  )
                }

                if (input.prompt.trim()) {
                  messageContent.push({
                    type: "text" as const,
                    text: input.prompt,
                  })
                }

                async function* createPromptWithAttachments() {
                  yield {
                    type: "user" as const,
                    message: {
                      role: "user" as const,
                      content: messageContent,
                    },
                    parent_tool_use_id: null,
                  }
                }

                prompt = createPromptWithAttachments()
              }

              // Build full environment for Claude SDK (includes HOME, PATH, etc.)
              const claudeEnv = await buildClaudeEnv()

              // Debug logging in dev
              if (process.env.NODE_ENV !== "production") {
                logClaudeEnv(claudeEnv, `[${input.subChatId}] `)
              }

              // Get Claude Code OAuth token from local storage (optional)
              const claudeCodeToken = getClaudeCodeToken()

              // Create isolated config directory per subChat to prevent session contamination
              // The Claude binary stores sessions in ~/.claude/ based on cwd, which causes
              // cross-chat contamination when multiple chats use the same project folder
              const isolatedConfigDir = path.join(
                app.getPath("userData"),
                "claude-sessions",
                input.subChatId
              )

              // Build final env - only add OAuth token if we have one
              const finalEnv = {
                ...claudeEnv,
                ...(claudeCodeToken && {
                  CLAUDE_CODE_OAUTH_TOKEN: claudeCodeToken,
                }),
                // Isolate Claude's config/session storage per subChat
                CLAUDE_CONFIG_DIR: isolatedConfigDir,
              }

              // Get bundled Claude binary path
              const claudeBinaryPath = getBundledClaudeBinaryPath()

              const resumeSessionId = input.sessionId || existingSessionId || undefined
              const queryOptions = {
                prompt,
                options: {
                  abortController, // Must be inside options!
                  cwd: input.cwd,
                  systemPrompt: {
                    type: "preset" as const,
                    preset: "claude_code" as const,
                    // Use mode-aware prompt - includes PLAN_MODE_PROMPT when in plan mode
                    append: `\n\n${getRootSystemPrompt({ mode: input.mode })}`,
                  },
                  env: finalEnv,
                  permissionMode:
                    input.mode === "plan"
                      ? ("plan" as const)
                      : ("bypassPermissions" as const),
                  ...(input.mode !== "plan" && {
                    allowDangerouslySkipPermissions: true,
                  }),
                  includePartialMessages: true,
                  // Load skills from project and user directories (native Claude Code skills)
                  settingSources: ["project" as const, "user" as const],
                  canUseTool: async (
                    toolName: string,
                    toolInput: Record<string, unknown>,
                    options: { toolUseID: string },
                  ) => {
                    if (toolName === "AskUserQuestion") {
                      const { toolUseID } = options
                      // Emit to UI (safely in case observer is closed)
                      safeEmit({
                        type: "ask-user-question",
                        toolUseId: toolUseID,
                        questions: (toolInput as any).questions,
                      } as UIMessageChunk)

                      // Wait for response (60s timeout)
                      const response = await new Promise<{
                        approved: boolean
                        message?: string
                        updatedInput?: unknown
                      }>((resolve) => {
                        const timeoutId = setTimeout(() => {
                          pendingToolApprovals.delete(toolUseID)
                          // Emit chunk to notify UI that the question has timed out
                          // This ensures the pending question dialog is cleared
                          safeEmit({
                            type: "ask-user-question-timeout",
                            toolUseId: toolUseID,
                          } as UIMessageChunk)
                          resolve({ approved: false, message: "Timed out" })
                        }, 60000)

                        pendingToolApprovals.set(toolUseID, {
                          subChatId: input.subChatId,
                          resolve: (d) => {
                            clearTimeout(timeoutId)
                            resolve(d)
                          },
                        })
                      })

                      if (!response.approved) {
                        return {
                          behavior: "deny",
                          message: response.message || "Skipped",
                        }
                      }
                      return {
                        behavior: "allow",
                        updatedInput: response.updatedInput,
                      }
                    }

                    // Intercept TodoWrite in Plan Mode to create goals/tasks in our database
                    if (input.mode === "plan" && toolName === "TodoWrite") {
                      try {
                        const todosMarkdown = (toolInput as any).todos as string
                        console.log(`[Claude SDK] TodoWrite intercepted in plan mode, parsing todos...`)
                        
                        // Parse markdown checklist to extract goal name and tasks
                        // Format: "# Goal Name\n- [ ] Task 1\n- [ ] Task 2" or just "- [ ] Task 1\n- [ ] Task 2"
                        const lines = todosMarkdown.split("\n").filter((l: string) => l.trim())
                        
                        // Extract goal name from heading or first line
                        let goalName = "Plan"
                        const headingMatch = todosMarkdown.match(/^#\s+(.+)$/m)
                        if (headingMatch) {
                          goalName = headingMatch[1].trim()
                        }
                        
                        // Extract tasks from checklist items
                        const taskTitles: string[] = []
                        for (const line of lines) {
                          // Match: "- [ ] Task title" or "- [x] Task title" or just "- Task title"
                          const taskMatch = line.match(/^[-*]\s*(?:\[[ x]\]\s*)?(.+)$/i)
                          if (taskMatch && !line.startsWith("#")) {
                            taskTitles.push(taskMatch[1].trim())
                          }
                        }
                        
                        if (taskTitles.length > 0) {
                          const db = getDatabase()
                          
                          // Get project info for the goal
                          const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
                          const project = chat?.projectId 
                            ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
                            : null
                          
                          // Create goal
                          const goal = db
                            .insert(goals)
                            .values({
                              name: goalName,
                              description: `Plan created from chat: ${taskTitles.length} tasks`,
                              priority: "medium",
                              status: "todo",
                              workspacePath: project?.path || input.cwd,
                            })
                            .returning()
                            .get()
                          
                          console.log(`[Claude SDK] Created goal: ${goal.id} - ${goal.name}`)
                          
                          // Create tasks
                          const createdTaskIds: string[] = []
                          for (const title of taskTitles) {
                            const task = db
                              .insert(tasks)
                              .values({
                                title,
                                description: title,
                                priority: "medium",
                                goalId: goal.id,
                                status: "todo",
                                createdBy: "ai",
                              })
                              .returning()
                              .get()
                            createdTaskIds.push(task.id)
                            console.log(`[Claude SDK] Created task: ${task.id} - ${title}`)
                          }
                          
                          // Update subChat to link to this goal
                          db.update(subChats)
                            .set({ goalId: goal.id, updatedAt: new Date() })
                            .where(eq(subChats.id, input.subChatId))
                            .run()
                          
                          console.log(`[Claude SDK] Plan mode: created goal ${goal.id} with ${createdTaskIds.length} tasks`)
                          
                          // Emit goal-created event so UI can show it
                          safeEmit({
                            type: "goal-created",
                            goalId: goal.id,
                            goalName: goal.name,
                            taskCount: createdTaskIds.length,
                          } as UIMessageChunk)
                        }
                      } catch (todoErr) {
                        console.error(`[Claude SDK] Failed to create goal/tasks from TodoWrite:`, todoErr)
                      }
                      
                      // Still allow the tool to run normally (shows in UI)
                      return { behavior: "allow", updatedInput: toolInput }
                    }

                    return {
                      behavior: "allow",
                      updatedInput: toolInput,
                    }
                  },
                  stderr: (data: string) => {
                    stderrLines.push(data)
                    console.error("[claude stderr]", data)
                  },
                  // Use bundled binary
                  pathToClaudeCodeExecutable: claudeBinaryPath,
                  ...(resumeSessionId && {
                    resume: resumeSessionId,
                    continue: true,
                  }),
                  ...(input.model && { model: input.model }),
                  // fallbackModel: "claude-opus-4-5-20251101",
                  ...(input.maxThinkingTokens && {
                    maxThinkingTokens: input.maxThinkingTokens,
                  }),
                },
              }

              // 5. Run Claude SDK
              let stream
              try {
                stream = claudeQuery(queryOptions)
              } catch (queryError) {
                console.error(
                  "[CLAUDE] ✗ Failed to create SDK query:",
                  queryError,
                )
                emitError(queryError, "Failed to start Claude query")
                console.log(`[SD] M:END sub=${subId} reason=query_error n=${chunkCount}`)
                safeEmit({ type: "finish" } as UIMessageChunk)
                safeComplete()
                return
              }

              let messageCount = 0
              let lastError: Error | null = null
              let planCompleted = false // Flag to stop after ExitPlanMode in plan mode
              let exitPlanModeToolCallId: string | null = null // Track ExitPlanMode's toolCallId

              try {
                for await (const msg of stream) {
                  if (abortController.signal.aborted) break

                  messageCount++

                  // Log raw message for debugging
                  logRawClaudeMessage(input.chatId, msg)

                  // Check for error messages from SDK (error can be embedded in message payload!)
                  const msgAny = msg as any
                  if (msgAny.type === "error" || msgAny.error) {
                    const sdkError =
                      msgAny.error || msgAny.message || "Unknown SDK error"
                    lastError = new Error(sdkError)

                    // Categorize SDK-level errors
                    let errorCategory = "SDK_ERROR"
                    let errorContext = "Claude SDK error"

                    if (
                      sdkError === "authentication_failed" ||
                      sdkError.includes("authentication")
                    ) {
                      errorCategory = "AUTH_FAILED_SDK"
                      errorContext =
                        "Authentication failed - not logged into Claude Code CLI"
                    } else if (
                      sdkError === "invalid_api_key" ||
                      sdkError.includes("api_key")
                    ) {
                      errorCategory = "INVALID_API_KEY_SDK"
                      errorContext = "Invalid API key in Claude Code CLI"
                    } else if (
                      sdkError === "rate_limit_exceeded" ||
                      sdkError.includes("rate")
                    ) {
                      errorCategory = "RATE_LIMIT_SDK"
                      errorContext = "Rate limit exceeded"
                    } else if (
                      sdkError === "overloaded" ||
                      sdkError.includes("overload")
                    ) {
                      errorCategory = "OVERLOADED_SDK"
                      errorContext = "Claude is overloaded, try again later"
                    }

                    // Emit auth-error for authentication failures, regular error otherwise
                    if (errorCategory === "AUTH_FAILED_SDK") {
                      safeEmit({
                        type: "auth-error",
                        errorText: errorContext,
                      } as UIMessageChunk)
                    } else {
                      safeEmit({
                        type: "error",
                        errorText: errorContext,
                        debugInfo: {
                          category: errorCategory,
                          sdkError: sdkError,
                          sessionId: msgAny.session_id,
                          messageId: msgAny.message?.id,
                        },
                      } as UIMessageChunk)
                    }

                    console.log(`[SD] M:END sub=${subId} reason=sdk_error cat=${errorCategory} n=${chunkCount}`)
                    safeEmit({ type: "finish" } as UIMessageChunk)
                    safeComplete()
                    return
                  }

                  // Track sessionId
                  if (msgAny.session_id) {
                    metadata.sessionId = msgAny.session_id
                    currentSessionId = msgAny.session_id // Share with cleanup
                  }

                  // Transform and emit + accumulate
                  for (const chunk of transform(msg)) {
                    chunkCount++
                    lastChunkType = chunk.type

                    // Use safeEmit to prevent throws when observer is closed
                    if (!safeEmit(chunk)) {
                      // Observer closed (user clicked Stop), break out of loop
                      console.log(`[SD] M:EMIT_CLOSED sub=${subId} type=${chunk.type} n=${chunkCount}`)
                      break
                    }

                    // Accumulate based on chunk type
                    switch (chunk.type) {
                      case "text-delta":
                        currentText += chunk.delta
                        break
                      case "text-end":
                        if (currentText.trim()) {
                          parts.push({ type: "text", text: currentText })
                          currentText = ""
                        }
                        break
                      case "tool-input-available":
                        // DEBUG: Log tool calls
                        console.log(`[SD] M:TOOL_CALL sub=${subId} toolName="${chunk.toolName}" mode=${input.mode} callId=${chunk.toolCallId}`)

                        // Track ExitPlanMode toolCallId so we can stop when it completes
                        if (input.mode === "plan" && chunk.toolName === "ExitPlanMode") {
                          console.log(`[SD] M:PLAN_TOOL_DETECTED sub=${subId} callId=${chunk.toolCallId}`)
                          exitPlanModeToolCallId = chunk.toolCallId
                        }

                        parts.push({
                          type: `tool-${chunk.toolName}`,
                          toolCallId: chunk.toolCallId,
                          toolName: chunk.toolName,
                          input: chunk.input,
                          state: "call",
                        })
                        break
                      case "tool-output-available":
                        // DEBUG: Log all tool outputs
                        console.log(`[SD] M:TOOL_OUTPUT sub=${subId} callId=${chunk.toolCallId} mode=${input.mode}`)

                        const toolPart = parts.find(
                          (p) =>
                            p.type?.startsWith("tool-") &&
                            p.toolCallId === chunk.toolCallId,
                        )
                        if (toolPart) {
                          toolPart.result = chunk.output
                          toolPart.state = "result"
                        }
                        // Stop streaming after ExitPlanMode completes in plan mode
                        // Match by toolCallId since toolName is undefined in output chunks
                        if (input.mode === "plan" && exitPlanModeToolCallId && chunk.toolCallId === exitPlanModeToolCallId) {
                          console.log(`[SD] M:PLAN_STOP sub=${subId} callId=${chunk.toolCallId} n=${chunkCount} parts=${parts.length}`)
                          planCompleted = true
                          // Emit finish chunk so Chat hook properly resets its state
                          console.log(`[SD] M:PLAN_FINISH sub=${subId} - emitting finish chunk`)
                          safeEmit({ type: "finish" } as UIMessageChunk)
                          // Abort the Claude process so it doesn't keep running
                          console.log(`[SD] M:PLAN_ABORT sub=${subId} - aborting claude process`)
                          abortController.abort()
                        }
                        break
                      case "message-metadata":
                        metadata = { ...metadata, ...chunk.messageMetadata }
                        break
                    }
                    // Break from chunk loop if plan is done
                    if (planCompleted) {
                      console.log(`[SD] M:PLAN_BREAK_CHUNK sub=${subId}`)
                      break
                    }
                  }
                  // Break from stream loop if plan is done
                  if (planCompleted) {
                    console.log(`[SD] M:PLAN_BREAK_STREAM sub=${subId}`)
                    break
                  }
                  // Break from stream loop if observer closed (user clicked Stop)
                  if (!isObservableActive) {
                    console.log(`[SD] M:OBSERVER_CLOSED_STREAM sub=${subId}`)
                    break
                  }
                }
              } catch (streamError) {
                // This catches errors during streaming (like process exit)
                const err = streamError as Error
                const stderrOutput = stderrLines.join("\n")

                // Build detailed error message with category
                let errorContext = "Claude streaming error"
                let errorCategory = "UNKNOWN"

                if (err.message?.includes("exited with code")) {
                  errorContext = "Claude Code process crashed"
                  errorCategory = "PROCESS_CRASH"
                } else if (err.message?.includes("ENOENT")) {
                  errorContext = "Required executable not found in PATH"
                  errorCategory = "EXECUTABLE_NOT_FOUND"
                } else if (
                  err.message?.includes("authentication") ||
                  err.message?.includes("401")
                ) {
                  errorContext = "Authentication failed - check your API key"
                  errorCategory = "AUTH_FAILURE"
                } else if (
                  err.message?.includes("invalid_api_key") ||
                  err.message?.includes("Invalid API Key") ||
                  stderrOutput?.includes("invalid_api_key")
                ) {
                  errorContext = "Invalid API key"
                  errorCategory = "INVALID_API_KEY"
                } else if (
                  err.message?.includes("rate_limit") ||
                  err.message?.includes("429")
                ) {
                  errorContext = "Rate limit exceeded"
                  errorCategory = "RATE_LIMIT"
                } else if (
                  err.message?.includes("network") ||
                  err.message?.includes("ECONNREFUSED") ||
                  err.message?.includes("fetch failed")
                ) {
                  errorContext = "Network error - check your connection"
                  errorCategory = "NETWORK_ERROR"
                }

                // Track error in Sentry (only if app is ready and Sentry is available)
                if (app.isReady() && app.isPackaged) {
                  try {
                    const Sentry = await import("@sentry/electron/main")
                    Sentry.captureException(err, {
                      tags: {
                        errorCategory,
                        mode: input.mode,
                      },
                      extra: {
                        context: errorContext,
                        cwd: input.cwd,
                        stderr: stderrOutput || "(no stderr captured)",
                        chatId: input.chatId,
                        subChatId: input.subChatId,
                      },
                    })
                  } catch {
                    // Sentry not available or failed to import - ignore
                  }
                }

                // Send error with stderr output to frontend (only if not aborted by user)
                if (!abortController.signal.aborted) {
                  safeEmit({
                    type: "error",
                    errorText: stderrOutput
                      ? `${errorContext}: ${err.message}\n\nProcess output:\n${stderrOutput}`
                      : `${errorContext}: ${err.message}`,
                    debugInfo: {
                      context: errorContext,
                      category: errorCategory,
                      cwd: input.cwd,
                      mode: input.mode,
                      stderr: stderrOutput || "(no stderr captured)",
                    },
                  } as UIMessageChunk)
                }

                // ALWAYS save accumulated parts before returning (even on abort/error)
                console.log(`[SD] M:CATCH_SAVE sub=${subId} aborted=${abortController.signal.aborted} parts=${parts.length}`)
                if (currentText.trim()) {
                  parts.push({ type: "text", text: currentText })
                }
                if (parts.length > 0) {
                  const assistantMessage = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    parts,
                    metadata,
                  }
                  const finalMessages = [...messagesToSave, assistantMessage]
                  db.update(subChats)
                    .set({
                      messages: JSON.stringify(finalMessages),
                      sessionId: metadata.sessionId,
                      streamId: null,
                      updatedAt: new Date(),
                    })
                    .where(eq(subChats.id, input.subChatId))
                    .run()
                  db.update(chats)
                    .set({ updatedAt: new Date() })
                    .where(eq(chats.id, input.chatId))
                    .run()
                }

                console.log(`[SD] M:END sub=${subId} reason=stream_error cat=${errorCategory} n=${chunkCount} last=${lastChunkType}`)
                safeEmit({ type: "finish" } as UIMessageChunk)
                safeComplete()
                return
              }

              // 6. Check if we got any response
              if (messageCount === 0 && !abortController.signal.aborted) {
                emitError(
                  new Error("No response received from Claude"),
                  "Empty response",
                )
                console.log(`[SD] M:END sub=${subId} reason=no_response n=${chunkCount}`)
                safeEmit({ type: "finish" } as UIMessageChunk)
                safeComplete()
                return
              }

              // 7. Save final messages to DB
              // ALWAYS save accumulated parts, even on abort (so user sees partial responses after reload)
              console.log(`[SD] M:SAVE sub=${subId} planCompleted=${planCompleted} aborted=${abortController.signal.aborted} parts=${parts.length}`)

              // Flush any remaining text
              if (currentText.trim()) {
                parts.push({ type: "text", text: currentText })
              }

              if (parts.length > 0) {
                const assistantMessage = {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  parts,
                  metadata,
                }

                const finalMessages = [...messagesToSave, assistantMessage]

                db.update(subChats)
                  .set({
                    messages: JSON.stringify(finalMessages),
                    sessionId: metadata.sessionId,
                    streamId: null,
                    updatedAt: new Date(),
                  })
                  .where(eq(subChats.id, input.subChatId))
                  .run()

                // Extract and create goal/tasks from plan builder blocks (```goal and ```tasks)
                if (input.mode === "plan") {
                  try {
                    // Extract text content from parts
                    const fullText = parts
                      .filter((p): p is { type: "text"; text: string } => p.type === "text")
                      .map((p) => p.text)
                      .join("\n")

                    const planResult = parsePlanBuilderResponse(fullText)
                    if (isPlanBuilderComplete(planResult)) {
                      console.log(`[Plan Mode] Found complete plan with goal and ${planResult.tasks.length} tasks`)

                      // Get project ID from chat for workspaceId
                      const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
                      const workspaceId = chat?.projectId

                      // Create goal in database
                      const createdGoal = db
                        .insert(goals)
                        .values({
                          name: planResult.goal!.name!,
                          description: planResult.goal!.description!,
                          workspaceId,
                          priority: planResult.goal!.priority || "medium",
                          context: planResult.goal!.context,
                          tags: "[]",
                          status: "todo",
                        })
                        .returning()
                        .get()

                      // Create tasks linked to the goal
                      const createdTaskIds: string[] = []
                      for (const taskSkeleton of planResult.tasks) {
                        const timeFrame = taskSkeleton.timeFrame || "this_week"
                        const dueDate = calculateDueDate(timeFrame)

                        const created = db
                          .insert(tasks)
                          .values({
                            title: taskSkeleton.title!,
                            description: taskSkeleton.description!,
                            context: taskSkeleton.context,
                            tags: JSON.stringify(taskSkeleton.tags || []),
                            priority: taskSkeleton.priority || "medium",
                            timeFrame,
                            dueDate,
                            projectId: workspaceId,
                            goalId: createdGoal.id,
                            chatId: input.chatId,
                            assigneeType: "ai",
                            status: "todo",
                            createdBy: "ai",
                          })
                          .returning()
                          .get()

                        createdTaskIds.push(created.id)
                      }

                      console.log(`[Plan Mode] Created goal: ${createdGoal.id}, tasks: ${createdTaskIds.length}`)

                      // Emit goal-created event for UI
                      safeEmit({
                        type: "goal-created",
                        goalId: createdGoal.id,
                        goalName: createdGoal.name,
                        taskCount: createdTaskIds.length,
                      } as UIMessageChunk)
                    }
                  } catch (planError) {
                    console.error(`[Plan Mode] Failed to create goal/tasks:`, planError)
                  }
                }

                // Handle task completion for state engine
                if (input.taskId) {
                  try {
                    // Collect all text output from the session
                    const collectedOutput = parts
                      .filter((p): p is { type: "text"; text: string } => p.type === "text")
                      .map((p) => p.text)
                      .join("\n")
                    await onTaskComplete(input.taskId, collectedOutput)
                    console.log(`[Claude SDK] Task completed: ${input.taskId}`)
                  } catch (err) {
                    console.error(`[Claude SDK] Failed to handle task completion:`, err)
                  }
                }
              } else {
                // No assistant response - just clear streamId
                db.update(subChats)
                  .set({
                    sessionId: metadata.sessionId,
                    streamId: null,
                    updatedAt: new Date(),
                  })
                  .where(eq(subChats.id, input.subChatId))
                  .run()
              }

              // Update parent chat timestamp
              db.update(chats)
                .set({ updatedAt: new Date() })
                .where(eq(chats.id, input.chatId))
                .run()

              const duration = ((Date.now() - streamStart) / 1000).toFixed(1)
              const reason = planCompleted ? "plan_complete" : "ok"
              console.log(`[SD] M:END sub=${subId} reason=${reason} n=${chunkCount} last=${lastChunkType} t=${duration}s`)
              safeComplete()
            } catch (error) {
              const duration = ((Date.now() - streamStart) / 1000).toFixed(1)
              console.log(`[SD] M:END sub=${subId} reason=unexpected_error n=${chunkCount} t=${duration}s`)
              emitError(error, "Unexpected error")
              safeEmit({ type: "finish" } as UIMessageChunk)
              safeComplete()
            } finally {
              activeSessions.delete(input.subChatId)
            }
          })()

        // Cleanup on unsubscribe
        return () => {
          console.log(`[SD] M:CLEANUP sub=${subId} sessionId=${currentSessionId || 'none'}`)
          isObservableActive = false // Prevent emit after unsubscribe
          if (textDeltaFlushTimeout) {
            clearTimeout(textDeltaFlushTimeout)
            textDeltaFlushTimeout = null
          }
          pendingTextDeltas = []
          abortController.abort()
          activeSessions.delete(input.subChatId)
          clearPendingApprovals("Session ended.", input.subChatId)

          // Save sessionId on abort so conversation can be resumed
          // Clear streamId since we're no longer streaming
          const db = getDatabase()
          db.update(subChats)
            .set({
              streamId: null,
              ...(currentSessionId && { sessionId: currentSessionId })
            })
            .where(eq(subChats.id, input.subChatId))
            .run()
        }
      })
    }),

  /**
   * Cancel active session
   */
  cancel: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
      const controller = activeSessions.get(input.subChatId)
      if (controller) {
        controller.abort()
        activeSessions.delete(input.subChatId)
        clearPendingApprovals("Session cancelled.", input.subChatId)
        return { cancelled: true }
      }
      return { cancelled: false }
    }),

  /**
   * Check if session is active
   */
  isActive: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(({ input }) => activeSessions.has(input.subChatId)),
  respondToolApproval: publicProcedure
    .input(
      z.object({
        toolUseId: z.string(),
        approved: z.boolean(),
        message: z.string().optional(),
        updatedInput: z.unknown().optional(),
      }),
    )
    .mutation(({ input }) => {
      // Try Claude Code pending approvals first
      const pending = pendingToolApprovals.get(input.toolUseId)
      if (pending) {
        pending.resolve({
          approved: input.approved,
          message: input.message,
          updatedInput: input.updatedInput,
        })
        pendingToolApprovals.delete(input.toolUseId)
        return { ok: true }
      }
      
      // Try Copilot SDK ask_user responses
      // For Copilot, the "approved" flow means answers were provided
      if (input.approved && input.updatedInput) {
        const answers = input.updatedInput as Record<string, string>
        resolveAskUserResponse(input.toolUseId, { answers })
        return { ok: true }
      } else if (!input.approved) {
        resolveAskUserResponse(input.toolUseId, { error: input.message || "User skipped question" })
        return { ok: true }
      }
      
      return { ok: false }
    }),

  /**
   * Check which CLIs are available on the system
   */
  getAvailableClis: publicProcedure.query(async () => {
    const available = await getAvailableClis()
    return {
      available,
      details: {
        "claude-code": true, // Always available (bundled)
        cursor: available.includes("cursor"),
        opencode: available.includes("opencode"),
      },
    }
  }),

  /**
   * Check if a specific CLI is available
   */
  checkCliAvailable: publicProcedure
    .input(z.object({ cli: z.enum(["claude-code", "opencode", "cursor"]) }))
    .query(async ({ input }) => {
      if (input.cli === "claude-code") {
        return { available: true }
      }
      const adapter = getAdapter(input.cli)
      if (!adapter) {
        return { available: false }
      }
      const isAvailable = await adapter.isAvailable()
      return { available: isAvailable }
    }),
})
