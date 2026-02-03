import * as Sentry from "@sentry/electron/renderer"
import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import {
  agentsLoginModalOpenAtom,
  cliLoginModalAtom,
  extendedThinkingEnabledAtom,
} from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import {
  lastSelectedModelIdAtom,
  lastSelectedModelPerAgentAtom,
  MODEL_ID_MAP,
  pendingAuthRetryMessageAtom,
  pendingUserQuestionsAtom,
  setStreamingActivityAtom,
} from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"

// Error categories and their user-friendly messages
const ERROR_TOAST_CONFIG: Record<
  string,
  {
    title: string
    description: string
    action?: { label: string; onClick: () => void }
  }
> = {
  AUTH_FAILED_SDK: {
    title: "Not logged in",
    description: "Run 'claude login' in your terminal to authenticate",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("claude login"),
    },
  },
  INVALID_API_KEY_SDK: {
    title: "Invalid API key",
    description:
      "Your Claude API key is invalid. Check your CLI configuration.",
  },
  INVALID_API_KEY: {
    title: "Invalid API key",
    description:
      "Your Claude API key is invalid. Check your CLI configuration.",
  },
  RATE_LIMIT_SDK: {
    title: "Rate limited",
    description: "Too many requests. Please wait a moment and try again.",
  },
  RATE_LIMIT: {
    title: "Rate limited",
    description: "Too many requests. Please wait a moment and try again.",
  },
  OVERLOADED_SDK: {
    title: "Claude is busy",
    description:
      "The service is overloaded. Please try again in a few moments.",
  },
  PROCESS_CRASH: {
    title: "Claude crashed",
    description:
      "The Claude process exited unexpectedly. Try sending your message again.",
  },
  EXECUTABLE_NOT_FOUND: {
    title: "Claude CLI not found",
    description:
      "Install Claude Code CLI: npm install -g @anthropic-ai/claude-code",
    action: {
      label: "Copy command",
      onClick: () =>
        navigator.clipboard.writeText(
          "npm install -g @anthropic-ai/claude-code",
        ),
    },
  },
  NETWORK_ERROR: {
    title: "Network error",
    description: "Check your internet connection and try again.",
  },
  AUTH_FAILURE: {
    title: "Authentication failed",
    description: "Your session may have expired. Try logging in again.",
  },
  // Cursor CLI errors
  CURSOR_NOT_INSTALLED: {
    title: "Cursor CLI not found",
    description:
      "Install Cursor and enable the CLI in Cursor > Settings > Enable CLI",
    action: {
      label: "Open Cursor",
      onClick: () => {
        // Try to open Cursor app
        window.open("cursor://", "_blank")
      },
    },
  },
  CURSOR_AUTH_REQUIRED: {
    title: "Cursor authentication required",
    description:
      "Please log into the Cursor app with an active subscription.",
    action: {
      label: "Open Cursor",
      onClick: () => {
        window.open("cursor://", "_blank")
      },
    },
  },
  CURSOR_ERROR: {
    title: "Cursor error",
    description:
      "An error occurred with Cursor. Check that Cursor is running and try again.",
  },
  // OpenCode CLI errors
  OPENCODE_NOT_INSTALLED: {
    title: "OpenCode CLI not found",
    description: "Install OpenCode: npm install -g opencode",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("npm install -g opencode"),
    },
  },
  OPENCODE_AUTH_REQUIRED: {
    title: "OpenCode authentication required",
    description: "Run 'opencode auth login' to configure your API keys.",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("opencode auth login"),
    },
  },
  // Copilot CLI errors
  COPILOT_NOT_INSTALLED: {
    title: "GitHub Copilot CLI not found",
    description: "Install GitHub Copilot CLI: https://github.com/github/copilot-cli",
  },
  COPILOT_AUTH_REQUIRED: {
    title: "GitHub Copilot authentication required",
    description: "Run 'copilot /login' in your terminal to authenticate.",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("copilot /login"),
    },
  },
  COPILOT_ERROR: {
    title: "GitHub Copilot error",
    description: "An error occurred with Copilot. Check your login and try again.",
  },
  // Codex CLI errors
  CODEX_NOT_INSTALLED: {
    title: "OpenAI Codex not found",
    description: "Install Codex: npm i -g @openai/codex",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("npm i -g @openai/codex"),
    },
  },
  CODEX_AUTH_REQUIRED: {
    title: "OpenAI authentication required",
    description: "Set OPENAI_API_KEY or run 'codex auth' to authenticate.",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("codex auth"),
    },
  },
  CODEX_ERROR: {
    title: "OpenAI Codex error",
    description: "An error occurred with Codex. Check your API key and try again.",
  },
}

type UIMessageChunk = any // Inferred from subscription

type IPCChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  mode: "plan" | "agent"
  model?: string
  cli?: "claude-code" | "opencode" | "cursor" | "amp" | "droid" | "copilot" | "codex"
  taskId?: string  // Task being executed (for state engine)
  goalId?: string  // Goal being executed (orchestrator mode)
}

// Image attachment type matching the tRPC schema
type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

type FileAttachment = {
  path: string
  filename?: string
  size?: number
  mediaType?: string
}

export class IPCChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: IPCChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    // Extract prompt and images from last user message
    const lastUser = [...options.messages]
      .reverse()
      .find((m) => m.role === "user")
    const prompt = this.extractText(lastUser)
    const images = this.extractImages(lastUser)
    const files = this.extractFiles(lastUser)

    // Debug: log extracted files
    if (files.length > 0) {
      console.log("[IPCChatTransport] Files extracted:", files)
    }

    // Get sessionId for resume
    const lastAssistant = [...options.messages]
      .reverse()
      .find((m) => m.role === "assistant")
    const sessionId = (lastAssistant as any)?.metadata?.sessionId

    // Read extended thinking setting dynamically (so toggle applies to existing chats)
    const thinkingEnabled = appStore.get(extendedThinkingEnabledAtom)
    const maxThinkingTokens = thinkingEnabled ? 128_000 : undefined

    // Read CLI selection dynamically from store (so CLI changes apply to existing chats)
    const currentCli = useAgentSubChatStore
      .getState()
      .allSubChats.find((subChat) => subChat.id === this.config.subChatId)
      ?.cli || this.config.cli || "claude-code"

    // Read model selection dynamically (so model changes apply to existing chats)
    // Use per-agent model selection if available, fallback to legacy atom
    const lastSelectedModelPerAgent = appStore.get(lastSelectedModelPerAgentAtom)
    const selectedModelId = lastSelectedModelPerAgent[currentCli] || appStore.get(lastSelectedModelIdAtom)
    const modelString = MODEL_ID_MAP[selectedModelId] || selectedModelId

    const currentMode =
      useAgentSubChatStore
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)
        ?.mode || this.config.mode

    // Stream debug logging with TIMING
    const subId = this.config.subChatId.slice(-8)
    let chunkCount = 0
    let lastChunkType = ""
    let streamErrored = false  // Track if stream has errored to skip further enqueues
    const streamStartTime = performance.now()
    console.log(`[SD] R:START sub=${subId} cli=${currentCli} t=0ms`)
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "debug-session",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "ipc-chat-transport.ts:sendMessages",
        message: "IPC stream start",
        data: {
          subChatId: this.config.subChatId,
          chatId: this.config.chatId,
          cli: currentCli,
          mode: currentMode,
          promptLength: prompt.length,
          imagesCount: images.length,
          filesCount: files.length,
          hasModel: !!modelString,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion

    return new ReadableStream({
      start: (controller) => {
        const elapsed = () => `${(performance.now() - streamStartTime).toFixed(0)}ms`
        console.log(`[SD] R:STREAM_START sub=${subId} t=${elapsed()}`)
        
        const setActivity = (text: string | null) => {
          appStore.set(setStreamingActivityAtom, {
            subChatId: this.config.subChatId,
            text,
          })
        }
        const inferActivityFromTool = (chunk: UIMessageChunk): string | null => {
          if (chunk.type !== "tool-input-available") return null
          const toolName = chunk.toolName
          const input = (chunk as any).input || {}
          switch (toolName) {
            case "Read": {
              const filePath = input.file_path || ""
              const name = filePath.split("/").pop() || "file"
              return `Reading ${name}`
            }
            case "Grep": {
              const pattern = input.pattern ? `"${input.pattern}"` : ""
              return pattern ? `Searching ${pattern}` : "Searching"
            }
            case "Glob": {
              const pattern = input.pattern || ""
              return pattern ? `Exploring ${pattern}` : "Exploring files"
            }
            case "Edit": {
              const filePath = input.file_path || ""
              const name = filePath.split("/").pop() || "file"
              return `Editing ${name}`
            }
            case "Write": {
              const filePath = input.file_path || ""
              const name = filePath.split("/").pop() || "file"
              return `Writing ${name}`
            }
            case "Bash":
              return "Running command"
            default:
              return toolName ? `Running ${toolName}` : null
          }
        }

        const scheduleFlush =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (cb: FrameRequestCallback) => queueMicrotask(cb)
        let flushScheduled = false
        let pendingTextDeltaId: string | null = null
        let pendingTextDelta = ""
        const flushPendingTextDelta = () => {
          if (!pendingTextDeltaId || streamErrored) return
          try {
            controller.enqueue({
              type: "text-delta",
              id: pendingTextDeltaId,
              delta: pendingTextDelta,
            })
          } catch {
            // Ignore enqueue errors for pending flush
          }
          pendingTextDeltaId = null
          pendingTextDelta = ""
        }
        const schedulePendingFlush = () => {
          if (flushScheduled || streamErrored) return
          flushScheduled = true
          scheduleFlush(() => {
            flushScheduled = false
            flushPendingTextDelta()
          })
        }

        console.log(`[SD] R:SUB_CREATING sub=${subId} t=${elapsed()}`)
        const sub = trpcClient.claude.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            prompt,
            cwd: this.config.cwd,
            mode: currentMode,
            sessionId,
            cli: currentCli,
            ...(maxThinkingTokens && { maxThinkingTokens }),
            ...(modelString && { model: modelString }),
            ...(images.length > 0 && { images }),
            ...(files.length > 0 && { files }),
            ...(this.config.taskId && { taskId: this.config.taskId }),
            ...(this.config.goalId && { goalId: this.config.goalId }),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              chunkCount++
              lastChunkType = chunk.type
              
              // Log first chunk timing to trace latency
              if (chunkCount === 1) {
                console.log(`[SD] R:FIRST_CHUNK sub=${subId} type=${chunk.type} t=${elapsed()}`)
                // #region agent log
                fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sessionId: "debug-session",
                    runId: "pre-fix",
                    hypothesisId: "H2",
                    location: "ipc-chat-transport.ts:onData",
                    message: "First chunk received",
                    data: {
                      subChatId: this.config.subChatId,
                      chunkType: chunk.type,
                      elapsedMs: Number((performance.now() - streamStartTime).toFixed(0)),
                    },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {})
                // #endregion
              }

              // Update streaming activity label from tool calls
              const inferred = inferActivityFromTool(chunk)
              if (inferred) {
                setActivity(inferred)
              }

              // Debug: log all chunks when there's a pending question
              const currentPending = appStore.get(pendingUserQuestionsAtom)
              if (currentPending || chunk.type === "ask-user-question") {
                console.log("[PendingQ] Transport chunk:", {
                  type: chunk.type,
                  hasPending: !!currentPending,
                  chunkCount,
                })
              }

              // Handle AskUserQuestion - show question UI
              if (chunk.type === "ask-user-question") {
                console.log("[PendingQ] Transport: Setting pending question", {
                  subChatId: this.config.subChatId,
                  toolUseId: chunk.toolUseId,
                })
                appStore.set(pendingUserQuestionsAtom, {
                  subChatId: this.config.subChatId,
                  toolUseId: chunk.toolUseId,
                  questions: chunk.questions,
                })
              }

              // Handle AskUserQuestion timeout - clear pending question immediately
              if (chunk.type === "ask-user-question-timeout") {
                const pending = appStore.get(pendingUserQuestionsAtom)
                if (pending && pending.toolUseId === chunk.toolUseId) {
                  console.log("[PendingQ] Transport: Clearing timed out question", {
                    toolUseId: chunk.toolUseId,
                  })
                  appStore.set(pendingUserQuestionsAtom, null)
                }
              }



              // Handle authentication errors - show appropriate login modal
              if (chunk.type === "auth-error") {
                // Store the failed message for retry after successful auth
                // readyToRetry=false prevents immediate retry - modal sets it to true on OAuth success
                appStore.set(pendingAuthRetryMessageAtom, {
                  subChatId: this.config.subChatId,
                  prompt,
                  ...(images.length > 0 && { images }),
                  readyToRetry: false,
                })
                
                // Show the appropriate login modal based on CLI type
                const cli = chunk.cli
                if (cli && cli !== "claude-code") {
                  // Show CLI-specific login modal for AMP, Droid, Cursor, etc.
                  appStore.set(cliLoginModalAtom, { open: true, cli })
                } else {
                  // Show the Claude Code login modal (default)
                  appStore.set(agentsLoginModalOpenAtom, true)
                }
                
                // Use controller.error() instead of controller.close() so that
                // the SDK Chat properly resets status from "streaming" to "ready"
                // This allows user to retry sending messages after failed auth
                streamErrored = true
                controller.error(new Error("Authentication required"))
                return
              }

              // Handle errors - show toast to user FIRST before anything else
              if (chunk.type === "error") {
                // Track error in Sentry
                const category = chunk.debugInfo?.category || "UNKNOWN"
                Sentry.captureException(
                  new Error(chunk.errorText || "Claude transport error"),
                  {
                    tags: {
                      errorCategory: category,
                      mode: currentMode,
                    },
                    extra: {
                      debugInfo: chunk.debugInfo,
                      cwd: this.config.cwd,
                      chatId: this.config.chatId,
                      subChatId: this.config.subChatId,
                    },
                  },
                )

                // Show toast based on error category
                const config = ERROR_TOAST_CONFIG[category]

                if (config) {
                  toast.error(config.title, {
                    description: config.description,
                    duration: 8000,
                    action: config.action
                      ? {
                          label: config.action.label,
                          onClick: config.action.onClick,
                        }
                      : undefined,
                  })
                } else {
                  toast.error("Something went wrong", {
                    description:
                      chunk.errorText || "An unexpected error occurred",
                    duration: 8000,
                  })
                }
              }

              // Handle tasks-created - show success toast
              if (chunk.type === "tasks-created" && chunk.tasks && chunk.tasks.length > 0) {
                const taskCount = chunk.tasks.length
                const taskTitles = chunk.tasks.map(t => t.title).join(", ")
                toast.success(`${taskCount} task${taskCount > 1 ? "s" : ""} created`, {
                  description: taskTitles.length > 100 ? taskTitles.slice(0, 100) + "..." : taskTitles,
                  duration: 5000,
                })
              }

              // Skip enqueue if stream has already errored (e.g., auth error)
              if (streamErrored) {
                if (chunk.type === "finish") {
                  console.log(`[SD] R:FINISH_SKIP sub=${subId} (stream errored) t=${elapsed()}`)
                  setActivity(null)
                }
                return
              }

              if (chunk.type !== "text-delta") {
                flushPendingTextDelta()
              }

              // Try to enqueue, but don't crash if stream is already closed
              try {
                // Log all chunk types for debugging
                if (chunk.type === "text-start" || chunk.type === "text-delta" || chunk.type === "text-end") {
                  console.log(`[SD] R:ENQ sub=${subId} type=${chunk.type} n=${chunkCount} t=${elapsed()}`)
                  if (chunk.type === "text-start") {
                    // #region agent log
                    fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        sessionId: "debug-session",
                        runId: "pre-fix",
                        hypothesisId: "H2",
                        location: "ipc-chat-transport.ts:onData",
                        message: "Text start enqueued",
                        data: {
                          subChatId: this.config.subChatId,
                          chunkCount,
                          elapsedMs: Number((performance.now() - streamStartTime).toFixed(0)),
                        },
                        timestamp: Date.now(),
                      }),
                    }).catch(() => {})
                    // #endregion
                  }
                }
                if (chunk.type === "text-delta") {
                  const delta = chunk.delta || ""
                  if (pendingTextDeltaId && pendingTextDeltaId !== chunk.id) {
                    flushPendingTextDelta()
                  }
                  pendingTextDeltaId = chunk.id
                  pendingTextDelta += delta
                  schedulePendingFlush()
                  return
                }
                controller.enqueue(chunk)
              } catch (e) {
                // CRITICAL: Log when enqueue fails - this could explain missing chunks!
                console.log(`[SD] R:ENQUEUE_ERR sub=${subId} type=${chunk.type} n=${chunkCount} err=${e}`)
              }

              if (chunk.type === "finish") {
                console.log(`[SD] R:FINISH sub=${subId} n=${chunkCount} t=${elapsed()}`)
                // #region agent log
                fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sessionId: "debug-session",
                    runId: "pre-fix",
                    hypothesisId: "H2",
                    location: "ipc-chat-transport.ts:onData",
                    message: "Finish received",
                    data: {
                      subChatId: this.config.subChatId,
                      chunkCount,
                      elapsedMs: Number((performance.now() - streamStartTime).toFixed(0)),
                    },
                    timestamp: Date.now(),
                  }),
                }).catch(() => {})
                // #endregion
                setActivity(null)
                try {
                  controller.close()
                  console.log(`[SD] R:CLOSE_OK sub=${subId} t=${elapsed()}`)
                } catch {
                  // Already closed
                }
              }
            },
            onError: (err: Error) => {
              console.log(`[SD] R:ERROR sub=${subId} n=${chunkCount} last=${lastChunkType} t=${elapsed()} err=${err.message}`)
              setActivity(null)
              // CRITICAL: Unsubscribe on error to release tRPC subscription
              console.log(`[SD] R:UNSUB_START sub=${subId} t=${elapsed()}`)
              sub.unsubscribe()
              console.log(`[SD] R:UNSUB_DONE sub=${subId} t=${elapsed()}`)
              // Track transport errors in Sentry
              Sentry.captureException(err, {
                tags: {
                  errorCategory: "TRANSPORT_ERROR",
                  mode: currentMode,
                },
                extra: {
                  cwd: this.config.cwd,
                  chatId: this.config.chatId,
                  subChatId: this.config.subChatId,
                },
              })

              controller.error(err)
            },
            onComplete: () => {
              console.log(`[SD] R:COMPLETE sub=${subId} n=${chunkCount} last=${lastChunkType} t=${elapsed()}`)
              setActivity(null)
              // CRITICAL: Unsubscribe to release tRPC subscription and unblock UI
              console.log(`[SD] R:UNSUB_START sub=${subId} t=${elapsed()}`)
              sub.unsubscribe()
              console.log(`[SD] R:UNSUB_DONE sub=${subId} t=${elapsed()}`)
              // Fallback: clear any pending questions when stream completes
              // This handles edge cases where timeout chunk wasn't received
              const pending = appStore.get(pendingUserQuestionsAtom)
              if (pending && pending.subChatId === this.config.subChatId) {
                console.log("[PendingQ] Transport: Clearing pending question on stream complete (fallback)", {
                  pendingToolUseId: pending.toolUseId,
                })
                appStore.set(pendingUserQuestionsAtom, null)
              }
              try {
                controller.close()
                console.log(`[SD] R:CLOSE_OK sub=${subId} t=${elapsed()}`)
              } catch {
                // Already closed
              }
              console.log(`[SD] R:COMPLETE_DONE sub=${subId} t=${elapsed()}`)
            },
          },
        )
        
        // Log when subscription is established
        console.log(`[SD] R:SUB_CREATED sub=${subId} t=${elapsed()}`)

        // Handle abort
        options.abortSignal?.addEventListener("abort", () => {
          console.log(`[SD] R:ABORT sub=${subId} n=${chunkCount} last=${lastChunkType} t=${elapsed()}`)
          sub.unsubscribe()
          trpcClient.claude.cancel.mutate({ subChatId: this.config.subChatId })
          try {
            controller.close()
          } catch {
            // Already closed
          }
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null // Not needed for local app
  }

  private extractText(msg: UIMessage | undefined): string {
    if (!msg) return ""
    if (msg.parts) {
      return msg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
    }
    return ""
  }

  /**
   * Extract images from message parts
   * Looks for parts with type "data-image" that have base64Data
   */
  private extractImages(msg: UIMessage | undefined): ImageAttachment[] {
    if (!msg || !msg.parts) return []

    const images: ImageAttachment[] = []

    for (const part of msg.parts) {
      // Check for data-image parts with base64 data
      if (part.type === "data-image" && (part as any).data) {
        const data = (part as any).data
        if (data.base64Data && data.mediaType) {
          images.push({
            base64Data: data.base64Data,
            mediaType: data.mediaType,
            filename: data.filename,
          })
        }
      }
    }

    return images
  }

  private extractFiles(msg: UIMessage | undefined): FileAttachment[] {
    if (!msg || !msg.parts) return []

    const files: FileAttachment[] = []

    for (const part of msg.parts) {
      if (part.type === "data-file" && (part as any).data) {
        const data = (part as any).data
        if (data.path) {
          files.push({
            path: data.path,
            filename: data.filename,
            size: data.size,
            mediaType: data.mediaType,
          })
        }
      }
    }

    return files
  }
}
