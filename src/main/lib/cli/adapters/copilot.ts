import { spawn } from "child_process"
import crypto from "node:crypto"
import { observable } from "@trpc/server/observable"
import type { CliAdapter, ChatInput, UIMessageChunk } from "../types"
import { PLAN_MODE_TOOLS, setAskUserEmitter, resolveAskUserResponse } from "../tools"

// Lazy-loaded Copilot SDK types and client
let CopilotClientClass: typeof import("@github/copilot-sdk").CopilotClient | null = null
let copilotClient: InstanceType<typeof import("@github/copilot-sdk").CopilotClient> | null = null

// Active sessions for cancellation (SDK-based)
const activeSessions = new Map<string, { session: any; abort: () => Promise<void> }>()

/**
 * Map Copilot tool names to UI registry names (PascalCase)
 * The UI expects tool types like "tool-Bash", "tool-Read", etc.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  // Core tools
  bash: "Bash",
  view: "Read",
  grep: "Grep",
  glob: "Glob",
  edit: "Edit",
  create: "Write",
  write_bash: "Bash",
  read_bash: "Bash",
  stop_bash: "Bash",
  list_bash: "Bash",
  // Web tools
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  // Task/Agent tools
  task: "Task",
  report_intent: "ReportIntent",
  update_todo: "TodoWrite",
  ask_user: "AskUserQuestion",
  store_memory: "StoreMemory",
  // IMI custom tools (Plan Mode)
  imi_create_goal: "ImiCreateGoal",
  imi_create_task: "ImiCreateTask",
  // GitHub tools
  "github-mcp-server-get_file_contents": "Read",
  "github-mcp-server-search_code": "Grep",
  "github-mcp-server-list_commits": "GitHistory",
  "github-mcp-server-get_commit": "GitCommit",
  "github-mcp-server-list_branches": "GitBranches",
  "github-mcp-server-list_pull_requests": "GitPRList",
  "github-mcp-server-pull_request_read": "GitPR",
  "github-mcp-server-search_issues": "GitIssues",
  "github-mcp-server-issue_read": "GitIssue",
  "github-mcp-server-actions_list": "GitActions",
  "github-mcp-server-actions_get": "GitAction",
  "github-mcp-server-get_job_logs": "GitLogs",
}

/**
 * Convert Copilot tool name to UI-compatible PascalCase name
 */
function normalizeToolName(toolName: string): string {
  // Check mapping first
  const mapped = TOOL_NAME_MAP[toolName.toLowerCase()]
  if (mapped) return mapped
  
  // Fallback: capitalize first letter
  return toolName.charAt(0).toUpperCase() + toolName.slice(1)
}

/**
 * Get or create the singleton Copilot client
 */
async function getCopilotClient() {
  if (!CopilotClientClass) {
    const sdk = await import("@github/copilot-sdk")
    CopilotClientClass = sdk.CopilotClient
  }
  
  if (!copilotClient) {
    copilotClient = new CopilotClientClass!({
      autoStart: true,
      autoRestart: true,
    })
    await copilotClient.start()
  }
  
  return copilotClient
}

/**
 * Resolve model string for GitHub Copilot CLI
 * Available models: Claude 4.5, GPT-5.x Codex, GPT-5.x, GPT-4.1, Gemini 3 Pro (Preview)
 * @see https://docs.github.com/copilot/concepts/agents/about-copilot-cli
 */
function resolveModel(model?: string): string | undefined {
  if (!model || !model.trim()) return undefined // Use Copilot default (Claude Sonnet 4.5)

  // Map UI model IDs to Copilot CLI model names
  const modelMap: Record<string, string> = {
    // Claude models (Copilot uses these)
    "claude-sonnet-4.5": "claude-sonnet-4.5",
    "claude-haiku-4.5": "claude-haiku-4.5",
    "claude-opus-4.5": "claude-opus-4.5",
    "claude-sonnet-4": "claude-sonnet-4",
    "claude-4.5-sonnet": "claude-sonnet-4.5",
    "claude-4-sonnet": "claude-sonnet-4",
    sonnet: "claude-sonnet-4",
    "sonnet-4.5": "claude-sonnet-4.5",
    "sonnet-4": "claude-sonnet-4",
    // GPT models
    "gpt-5": "gpt-5",
    "gpt-5.2": "gpt-5.2",
    "gpt-5.1": "gpt-5.1",
    "gpt-5.2-codex": "gpt-5.2-codex",
    "gpt-5.1-codex-max": "gpt-5.1-codex-max",
    "gpt-5.1-codex": "gpt-5.1-codex",
    "gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
    "gpt-5-mini": "gpt-5-mini",
    // GPT-4.1
    "gpt-4.1": "gpt-4.1",
    // Gemini
    "gemini-3-pro-preview": "gemini-3-pro-preview",
  }

  const normalized = model.toLowerCase().trim()
  return modelMap[normalized] || model
}

/**
 * GitHub Copilot CLI Adapter
 *
 * Uses the official GitHub Copilot CLI (copilot command).
 * Requires Copilot Pro, Pro+, Business, or Enterprise subscription.
 *
 * AUTH: Uses GitHub authentication. Run `copilot /login` to authenticate.
 *
 * @see https://github.com/github/copilot-cli
 * @see https://docs.github.com/copilot/concepts/agents/about-copilot-cli
 */
export const copilotAdapter: CliAdapter = {
  id: "copilot",
  name: "GitHub Copilot",

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("which", ["copilot"])
      proc.on("close", (code) => resolve(code === 0))
      proc.on("error", () => resolve(false))
    })
  },

  chat(input: ChatInput) {
    return observable<UIMessageChunk>((emit: { next: (chunk: UIMessageChunk) => void; complete: () => void; error: (err: Error) => void }) => {
      const model = resolveModel(input.model)
      const textId = `copilot-text-${Date.now()}`
      let textStarted = false
      let isSubscriptionActive = true
      let accumulatedText = ""

      // Safe emit that won't crash if subscription was cleaned up
      const safeEmit = (chunk: UIMessageChunk) => {
        if (!isSubscriptionActive) {
          console.log("[Copilot SDK] Skipping emit - subscription inactive")
          return
        }
        try {
          emit.next(chunk)
        } catch (err) {
          console.error("[Copilot SDK] Error:", err)
          isSubscriptionActive = false
        }
      }
      const safeComplete = () => {
        if (!isSubscriptionActive) return
        try {
          emit.complete()
        } catch {
          // Already closed
        }
      }

      // Build the user prompt (context history + current message)
      const userPromptParts: string[] = []
      if (input.contextHistory) {
        userPromptParts.push(input.contextHistory)
      }
      userPromptParts.push(input.prompt)
      const userPrompt = userPromptParts.join("\n\n")

      // Run the SDK session asynchronously
      const runSession = async () => {
        try {
          const client = await getCopilotClient()

          let session: any

          // Try to resume existing session if we have a sessionId
          if (input.sessionId) {
            try {
              console.log("[Copilot SDK] Resuming session:", input.sessionId)
              session = await client.resumeSession(input.sessionId, {
                tools: input.mode === "plan" ? PLAN_MODE_TOOLS : undefined,
              })
              console.log("[Copilot SDK] Session resumed successfully")
            } catch (resumeErr) {
              console.log("[Copilot SDK] Could not resume session, creating new one:", resumeErr)
              session = null
            }
          }

          // Create new session if we don't have one
          if (!session) {
            console.log("[Copilot SDK] Creating session:", {
              cwd: input.cwd,
              model: model || "default (claude-sonnet-4.5)",
              hasSystemPrompt: !!input.rootSystemPrompt,
              systemPromptLength: input.rootSystemPrompt?.length || 0,
              mode: input.mode,
            })

            // Create session with REAL system message (not concatenated into user prompt)
            const sessionConfig: any = {
              model: model,
              streaming: true,
            }

            // Use mode: "replace" to fully control the system prompt
            // This replaces the default Copilot persona with our ROOT_SYSTEM_PROMPT
            if (input.rootSystemPrompt) {
              sessionConfig.systemMessage = {
                mode: "replace",
                content: input.rootSystemPrompt,
              }
            }

            // Add IMI custom tools for Plan Mode
            // These tools let the AI create goals/tasks directly
            if (input.mode === "plan") {
              sessionConfig.tools = PLAN_MODE_TOOLS
              console.log("[Copilot SDK] Plan mode - registered IMI tools:", PLAN_MODE_TOOLS.map(t => t.name))
              
              // Wire up the ask_user tool emitter so it can communicate with the UI
              setAskUserEmitter(safeEmit)
            }

            session = await client.createSession(sessionConfig)
          }
          // Ensure ask_user tool emitter is wired for this session
          if (input.mode === "plan") {
            setAskUserEmitter(safeEmit)
          }

          // Emit the session ID so it can be saved for future resume
          const currentSessionId = session.id || session.sessionId
          if (currentSessionId) {
            safeEmit({ type: "session-id", sessionId: currentSessionId })
          }

          // Store session for cancellation
          activeSessions.set(input.subChatId, {
            session,
            abort: () => session.abort(),
          })

          safeEmit({ type: "start" })

          // Subscribe to events for streaming
          const unsubscribe = session.on((event: any) => {
            if (!isSubscriptionActive) return

            switch (event.type) {
              case "assistant.message_delta":
                // Streaming text chunk
                if (!textStarted) {
                  safeEmit({ type: "text-start", id: textId })
                  textStarted = true
                }
                accumulatedText += event.data.deltaContent || ""
                safeEmit({
                  type: "text-delta",
                  id: textId,
                  delta: event.data.deltaContent,
                })
                break

              case "assistant.message":
                if (!textStarted) {
                  safeEmit({ type: "text-start", id: textId })
                  textStarted = true
                }
                {
                  const content = event.data?.content || ""
                  accumulatedText += content
                  if (content) {
                    safeEmit({
                      type: "text-delta",
                      id: textId,
                      delta: content,
                    })
                  }
                }
                break

              case "tool.execution_start":
                // Tool started - emit to UI for real-time display
                const startToolName = normalizeToolName(event.data?.toolName || "unknown")
                const startToolCallId = event.data?.toolCallId || `tool-${Date.now()}`
                const startTs = Date.now()
                console.log(`[Copilot SDK] [${startTs}] Tool started:`, event.data?.toolName, "→", startToolName)
                
                // Always emit both start AND available - UI needs tool-input-available to show the tool
                safeEmit({
                  type: "tool-input-start",
                  toolCallId: startToolCallId,
                  toolName: startToolName,
                })
                safeEmit({
                  type: "tool-input-available",
                  toolCallId: startToolCallId,
                  toolName: startToolName,
                  input: event.data?.arguments || {},
                })
                break

              case "tool.execution_partial_result":
                // Streaming tool output - could emit as tool-output-delta if UI supports it
                console.log(`[Copilot SDK] [${Date.now()}] Tool partial result:`, event.data?.toolCallId)
                break

              case "tool.execution_progress":
                // Progress message from tool (e.g., "Installing dependencies...")
                console.log(`[Copilot SDK] [${Date.now()}] Tool progress:`, event.data?.progressMessage)
                break

              case "tool.execution_complete":
                // Tool finished - emit result
                const endTs = Date.now()
                console.log(`[Copilot SDK] [${endTs}] Tool ended:`, event.data?.toolCallId, event.data?.success)
                if (event.data?.success && event.data?.result) {
                  safeEmit({
                    type: "tool-output-available",
                    toolCallId: event.data.toolCallId,
                    output: event.data.result.content,
                  })
                } else if (!event.data?.success && event.data?.error) {
                  safeEmit({
                    type: "tool-output-error",
                    toolCallId: event.data.toolCallId,
                    errorText: event.data.error.message || "Tool execution failed",
                  })
                } else {
                  // Tool completed without result - still emit completion so UI doesn't hang
                  safeEmit({
                    type: "tool-output-available",
                    toolCallId: event.data.toolCallId,
                    output: event.data?.result?.content || null,
                  })
                }
                break

              case "session.error":
                console.error("[Copilot SDK] Session error:", event.data)
                if (textStarted) {
                  safeEmit({ type: "text-end", id: textId })
                }
                safeEmit({
                  type: "error",
                  errorText: event.data?.message || "Unknown Copilot SDK error",
                  debugInfo: {
                    category: "COPILOT_SDK_ERROR",
                    cli: "copilot-sdk",
                  },
                } as UIMessageChunk)
                break

              case "session.idle":
                // Session finished processing
                console.log(`[Copilot SDK] [${Date.now()}] Session idle - complete`)
                break
            }
          })

          // Send the user message and wait for completion
          // Use 10 minute timeout for complex agent operations
          console.log(`[Copilot SDK] [${Date.now()}] Sending message, waiting for response...`)
          await session.sendAndWait({ prompt: userPrompt }, 600000)
          console.log(`[Copilot SDK] [${Date.now()}] sendAndWait completed`)

          // Cleanup event subscription
          unsubscribe()
          console.log(`[Copilot SDK] [${Date.now()}] Emitting finish`)

          // Emit final chunks BEFORE marking inactive
          if (textStarted) {
            safeEmit({ type: "text-end", id: textId })
          }
                // Plan-mode post-processing: create goals/tasks like Claude path
          if (input.mode === "plan") {
            try {
              const db = (await import("../../db")).getDatabase()
              const { chats, goals, tasks, subChats } = await import("../../db/schema/index.js")
              const { hasTaskDefinitions, extractTasksFromText } = await import("../task-extraction.js")
              const { parsePlanBuilderResponse, isPlanBuilderComplete } = await import("../plan-agent.js")
              const { eq } = await import("drizzle-orm")
              const { calculateDueDate } = await import("../../tasks/index.js")
              const assistantText = accumulatedText

              if (assistantText) {
                const existingSub = db.select().from(subChats).where(eq(subChats.id, input.subChatId)).get()
                const existingMessages = existingSub?.messages ? JSON.parse(existingSub.messages) : []
                const assistantMessage = {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  parts: [{ type: "text", text: assistantText }],
                  metadata: currentSessionId ? { sessionId: currentSessionId } : undefined,
                }
                const finalMessages = [...existingMessages, assistantMessage]
                db.update(subChats)
                  .set({ messages: JSON.stringify(finalMessages), updatedAt: new Date() })
                  .where(eq(subChats.id, input.subChatId))
                  .run()
              }

              // Task extraction from ```tasks blocks
              try {
                if (hasTaskDefinitions(assistantText)) {
                  const extraction = extractTasksFromText(assistantText)
                  if (extraction.tasks && extraction.tasks.length > 0) {
                    const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
                    const projectId = chat?.projectId
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
                    if (createdTasks.length > 0) {
                      safeEmit({ type: "tasks-created", tasks: createdTasks })
                    }
                  }
                }
              } catch (taskErr) {
                console.error("[Copilot plan mode] Failed task extraction", taskErr)
              }

              // Plan builder goal + tasks
              try {
                const planResult = parsePlanBuilderResponse(assistantText)
                if (isPlanBuilderComplete(planResult)) {
                  const chat = db.select().from(chats).where(eq(chats.id, input.chatId)).get()
                  const workspaceId = chat?.projectId
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
                      workspacePath: planResult.goal!.workspacePath,
                      relevantFiles: JSON.stringify(planResult.goal!.relevantFiles || []),
                    })
                    .returning()
                    .get()
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
                        workspacePath: taskSkeleton.workspacePath || planResult.goal!.workspacePath,
                        relevantFiles: JSON.stringify(taskSkeleton.relevantFiles || []),
                        tools: JSON.stringify(taskSkeleton.tools || []),
                        acceptanceCriteria: taskSkeleton.acceptanceCriteria,
                      })
                      .returning()
                      .get()
                    createdTaskIds.push(created.id)
                  }
                  safeEmit({
                    type: "goal-created",
                    goalId: createdGoal.id,
                    goalName: createdGoal.name,
                    taskCount: createdTaskIds.length,
                  })
                }
              } catch (planErr) {
                console.error("[Copilot plan mode] Failed plan builder persistence", planErr)
              }
            } catch (error) {
              console.error("[Copilot plan mode] Failed to persist goal/tasks", error)
            }
          }
          safeEmit({ type: "finish" })

          // NOW mark as inactive after emitting
          isSubscriptionActive = false
          safeComplete()
          console.log(`[Copilot SDK] [${Date.now()}] Stream complete`)

          // Remove from active sessions BEFORE destroying to prevent double cleanup
          activeSessions.delete(input.subChatId)

          // Destroy session after completion (catch errors silently)
          try {
            await session.destroy()
          } catch (destroyErr) {
            // Session might already be destroyed, ignore
            console.log("[Copilot SDK] Session destroy (expected):", destroyErr)
          }

        } catch (error: any) {
          console.error("[Copilot SDK] Error:", error)

          // Mark subscription as inactive
          isSubscriptionActive = false

          if (textStarted) {
            safeEmit({ type: "text-end", id: textId })
          }

          // Detect specific error types
          const errorMessage = error.message || String(error)
          const isNotInstalled = errorMessage.includes("ENOENT") || errorMessage.includes("not found")
          const isAuthError = errorMessage.includes("unauthorized") ||
            errorMessage.includes("authentication") ||
            errorMessage.includes("not logged in")

          if (isNotInstalled) {
            safeEmit({
              type: "error",
              errorText: "GitHub Copilot CLI not found. Install it from: https://github.com/github/copilot-cli",
              debugInfo: {
                category: "COPILOT_NOT_INSTALLED",
                cli: "copilot-sdk",
              },
            } as UIMessageChunk)
          } else if (isAuthError) {
            safeEmit({
              type: "error",
              errorText: "GitHub authentication required. Run `copilot /login` in your terminal to authenticate.",
              debugInfo: {
                category: "COPILOT_AUTH_REQUIRED",
                cli: "copilot-sdk",
              },
            } as UIMessageChunk)
          } else {
            safeEmit({
              type: "error",
              errorText: `Copilot SDK error: ${errorMessage}`,
              debugInfo: {
                category: "COPILOT_SDK_ERROR",
                cli: "copilot-sdk",
              },
            } as UIMessageChunk)
          }

          safeEmit({ type: "finish" })
          safeComplete()
          activeSessions.delete(input.subChatId)
        }
      }

      // Start the async session
      runSession()

      // Return cleanup function
      return () => {
        console.log("[Copilot SDK] Cleanup called for subChatId:", input.subChatId)
        // Only abort if subscription was still active (not already completed)
        const wasActive = isSubscriptionActive
        isSubscriptionActive = false
        
        if (wasActive) {
          const activeSession = activeSessions.get(input.subChatId)
          if (activeSession) {
            activeSession.abort().catch((err) => {
              // Ignore abort errors - session might already be done
              console.log("[Copilot SDK] Abort during cleanup (expected):", err?.message || err)
            })
            activeSessions.delete(input.subChatId)
          }
        }
      }
    })
  },

  cancel(subChatId: string): void {
    const activeSession = activeSessions.get(subChatId)
    if (activeSession) {
      console.log(`[Copilot SDK] [${Date.now()}] Cancelling session for subChatId:`, subChatId)
      activeSession.abort().catch((err) => {
        // Ignore abort errors
        console.log("[Copilot SDK] Abort during cancel (expected):", err?.message || err)
      })
      activeSessions.delete(subChatId)
    } else {
      console.log(`[Copilot SDK] [${Date.now()}] Cancel called but session already removed:`, subChatId)
    }
  },
}
