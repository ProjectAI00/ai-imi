import { spawn } from "child_process"
import { observable } from "@trpc/server/observable"
import type { CliAdapter, ChatInput, UIMessageChunk } from "../types"
import { PLAN_MODE_TOOLS, setAskUserEmitter } from "../tools"

// Lazy-loaded Copilot SDK types and client
let CopilotClientClass: typeof import("@github/copilot-sdk").CopilotClient | null = null
let copilotClient: InstanceType<typeof import("@github/copilot-sdk").CopilotClient> | null = null
let clientStartPromise: Promise<any> | null = null

// Active sessions for cancellation (SDK-based)
const activeSessions = new Map<string, { session: any; abort: () => Promise<void> }>()

/**
 * Preload the Copilot SDK client during app startup.
 * This avoids blocking the first message with SDK import and client initialization.
 */
export async function preloadCopilotSDK(): Promise<void> {
  if (clientStartPromise) return clientStartPromise
  
  console.log("[Copilot SDK] Preloading SDK...")
  const start = Date.now()
  
  clientStartPromise = (async () => {
    try {
      if (!CopilotClientClass) {
        const sdk = await import("@github/copilot-sdk")
        CopilotClientClass = sdk.CopilotClient
        console.log(`[Copilot SDK] SDK imported in ${Date.now() - start}ms`)
      }
      
      if (!copilotClient) {
        copilotClient = new CopilotClientClass!({
          autoStart: true,
          autoRestart: true,
        })
        await copilotClient.start()
        console.log(`[Copilot SDK] Client started in ${Date.now() - start}ms total`)
      }
    } catch (err) {
      console.warn("[Copilot SDK] Preload failed:", err)
      clientStartPromise = null
      throw err
    }
  })()
  
  return clientStartPromise
}

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
 * If preloadCopilotSDK() was called, this will reuse the preloaded client.
 */
async function getCopilotClient() {
  // If preload is in progress, wait for it
  if (clientStartPromise) {
    await clientStartPromise
    return copilotClient!
  }
  
  // Otherwise do lazy init (first message before preload completed)
  const start = Date.now()
  if (!CopilotClientClass) {
    console.log(`[Copilot SDK] Importing SDK (lazy)...`)
    const sdk = await import("@github/copilot-sdk")
    CopilotClientClass = sdk.CopilotClient
    console.log(`[Copilot SDK] SDK imported in ${Date.now() - start}ms`)
  }
  
  if (!copilotClient) {
    console.log(`[Copilot SDK] Creating client...`)
    copilotClient = new CopilotClientClass!({
      autoStart: true,
      autoRestart: true,
    })
    await copilotClient.start()
    console.log(`[Copilot SDK] Client started in ${Date.now() - start}ms total`)
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
    const chatStartTime = Date.now()
    console.log(`[Copilot SDK] chat() called`)
    
    return observable<UIMessageChunk>((emit: { next: (chunk: UIMessageChunk) => void; complete: () => void; error: (err: Error) => void }) => {
      console.log(`[Copilot SDK] Observable callback at ${Date.now() - chatStartTime}ms`)
      const model = resolveModel(input.model)
      const textId = `copilot-text-${Date.now()}`
      let textStarted = false
      let isSubscriptionActive = true
      let accumulatedText = ""
      let hasReceivedDeltas = false // Track if message_delta events delivered content
      const emittedNonDeltaMessages = new Set<string>()

      // Safe emit that won't crash if subscription was cleaned up
      const safeEmit = (chunk: UIMessageChunk) => {
        if (!isSubscriptionActive) {
          console.log("[Copilot SDK] Skipping emit - subscription inactive")
          return
        }
        try {
          // Log text deltas (but not every single one to avoid spam)
          if (chunk.type !== "text-delta" || Math.random() < 0.1) {
            console.log(`[Copilot SDK] Emitting: ${chunk.type}`)
          }
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
        const runStart = Date.now()
        console.log(`[Copilot SDK] runSession() started at ${runStart - chatStartTime}ms`)
        try {
          console.log(`[Copilot SDK] Getting client...`)
          const client = await getCopilotClient()
          console.log(`[Copilot SDK] Got client at ${Date.now() - chatStartTime}ms`)

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

            const sessionCreateStart = Date.now()
            session = await client.createSession(sessionConfig)
            console.log(`[Copilot SDK] Session created in ${Date.now() - sessionCreateStart}ms`)
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

          // Promise that resolves when session becomes idle
          // Uses an activity-aware timeout: resets on every SDK event so long-running
          // agent sessions (tool calls, code generation, etc.) never time out mid-work.
          let resolveIdle: () => void
          const idlePromise = new Promise<void>((resolve) => {
            resolveIdle = resolve
          })
          const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000 // 10 min of silence = something is wrong
          let inactivityTimer: ReturnType<typeof setTimeout> | null = null
          let rejectTimeout: ((err: Error) => void) | null = null
          const timeoutPromise = new Promise<void>((_, reject) => {
            rejectTimeout = reject
            inactivityTimer = setTimeout(
              () => reject(new Error(`Copilot session timed out after ${INACTIVITY_TIMEOUT_MS / 1000}s of inactivity`)),
              INACTIVITY_TIMEOUT_MS,
            )
          })
          const resetInactivityTimer = () => {
            if (inactivityTimer) clearTimeout(inactivityTimer)
            inactivityTimer = setTimeout(
              () => rejectTimeout?.(new Error(`Copilot session timed out after ${INACTIVITY_TIMEOUT_MS / 1000}s of inactivity`)),
              INACTIVITY_TIMEOUT_MS,
            )
          }

          // Subscribe to events for streaming - events fire in real-time
          const eventStart = Date.now()
          const unsubscribe = session.on((event: any) => {
            const elapsed = Date.now() - eventStart
            console.log(`[Copilot SDK] [${elapsed}ms] Event: ${event.type}`)
            if (!isSubscriptionActive) return

            // Reset inactivity timer on every event — agent is still working
            resetInactivityTimer()

            switch (event.type) {
              case "assistant.message_delta":
                // Streaming text chunk - emit immediately
                if (!textStarted) {
                  safeEmit({ type: "text-start", id: textId })
                  textStarted = true
                }
                hasReceivedDeltas = true
                accumulatedText += event.data.deltaContent || ""
                safeEmit({
                  type: "text-delta",
                  id: textId,
                  delta: event.data.deltaContent,
                })
                break

              case "assistant.message":
                // Final message event contains the full text for this turn.
                // Only emit if we didn't already stream it via message_delta.
                if (!hasReceivedDeltas) {
                  if (!textStarted) {
                    safeEmit({ type: "text-start", id: textId })
                    textStarted = true
                  }
                  // Extract content - handle both string and structured formats
                  let content = ""
                  const rawContent = event.data?.content
                  if (typeof rawContent === "string") {
                    content = rawContent
                  } else if (Array.isArray(rawContent)) {
                    // Structured content: [{ type: "text", text: "..." }, ...]
                    content = rawContent
                      .filter((c: any) => c.type === "text" && c.text)
                      .map((c: any) => c.text)
                      .join("")
                  } else if (rawContent?.text) {
                    content = rawContent.text
                  }
                  // Also check event.data.message for nested content
                  if (!content && event.data?.message) {
                    const msg = event.data.message
                    if (typeof msg === "string") content = msg
                    else if (typeof msg?.content === "string") content = msg.content
                  }
                  if (content) {
                    const dedupeKey = content.trim()
                    if (dedupeKey && emittedNonDeltaMessages.has(dedupeKey)) {
                      console.log("[Copilot SDK] Skipping duplicate assistant.message payload")
                      break
                    }
                    if (dedupeKey) {
                      emittedNonDeltaMessages.add(dedupeKey)
                    }
                    accumulatedText += content
                    safeEmit({
                      type: "text-delta",
                      id: textId,
                      delta: content,
                    })
                  }
                }
                // Reset for next turn (after tool calls, a new turn may stream or not)
                hasReceivedDeltas = false
                break

              case "tool.execution_start":
                // Tool started - emit to UI for real-time display
                const startToolName = normalizeToolName(event.data?.toolName || "unknown")
                const startToolCallId = event.data?.toolCallId || `tool-${Date.now()}`
                console.log(`[Copilot SDK] Tool started:`, event.data?.toolName, "→", startToolName)
                
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
                console.log(`[Copilot SDK] Tool partial result:`, event.data?.toolCallId)
                break

              case "tool.execution_progress":
                console.log(`[Copilot SDK] Tool progress:`, event.data?.progressMessage)
                break

              case "tool.execution_complete":
                console.log(`[Copilot SDK] Tool ended:`, event.data?.toolCallId, event.data?.success)
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
                    cli: "copilot",
                  },
                } as UIMessageChunk)
                resolveIdle!()
                break

              case "session.idle":
                // Session finished - resolve promise to continue cleanup
                console.log(`[Copilot SDK] Session idle - completing`)
                resolveIdle!()
                break
            }
          })

          // Send message (non-blocking) - events will stream to UI
          console.log(`[Copilot SDK] Sending message...`)
          const sendStart = Date.now()
          await session.send({ prompt: userPrompt })
          console.log(`[Copilot SDK] [${Date.now() - sendStart}ms] send() returned, waiting for idle...`)
          
          // Wait for session to become idle (events continue streaming)
          // Race with inactivity timeout to prevent infinite hanging
          await Promise.race([idlePromise, timeoutPromise])
          console.log(`[Copilot SDK] Session completed`)

          // Cleanup
          if (inactivityTimer) clearTimeout(inactivityTimer)
          unsubscribe()

          if (textStarted) {
            safeEmit({ type: "text-end", id: textId })
          }
          safeEmit({ type: "finish" })
          safeComplete()
          isSubscriptionActive = false

          activeSessions.delete(input.subChatId)
          // Don't destroy the session - it may be resumed by the next message

        } catch (error: any) {
          console.error("[Copilot SDK] Error:", error)

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
                cli: "copilot",
              },
            } as UIMessageChunk)
          } else if (isAuthError) {
            // Emit auth-error type which triggers the login modal in the UI
            safeEmit({
              type: "auth-error",
              cli: "copilot",
            } as UIMessageChunk)
          } else {
            safeEmit({
              type: "error",
              errorText: `Copilot SDK error: ${errorMessage}`,
              debugInfo: {
                category: "COPILOT_SDK_ERROR",
                cli: "copilot",
              },
            } as UIMessageChunk)
          }

          safeEmit({ type: "finish" })
          // CRITICAL: Call safeComplete() BEFORE setting inactive
          safeComplete()
          isSubscriptionActive = false
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
