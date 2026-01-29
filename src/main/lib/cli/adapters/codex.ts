import { spawn } from "child_process"
import { observable } from "@trpc/server/observable"
import type { CliAdapter, ChatInput, UIMessageChunk } from "../types"

// Lazy-loaded Codex SDK types and client
let CodexClass: typeof import("@openai/codex-sdk").Codex | null = null
let codexInstance: InstanceType<typeof import("@openai/codex-sdk").Codex> | null = null

// Active threads for cancellation (SDK-based)
const activeThreads = new Map<string, { abortController: AbortController }>()

/**
 * Get or create the singleton Codex client
 */
async function getCodexClient() {
  if (!CodexClass) {
    const sdk = await import("@openai/codex-sdk")
    CodexClass = sdk.Codex
  }
  
  if (!codexInstance) {
    codexInstance = new CodexClass!()
  }
  
  return codexInstance
}

/**
 * Resolve model string for Codex
 * Available models: o4-mini, gpt-5-codex, gpt-5.1-codex, etc.
 * @see https://developers.openai.com/codex/sdk
 */
function resolveModel(model?: string): string | undefined {
  if (!model || !model.trim()) return undefined // Use Codex default

  // Map UI model IDs to Codex model names
  const modelMap: Record<string, string> = {
    // Codex-specific models
    "o4-mini": "o4-mini",
    "gpt-5-codex": "gpt-5-codex",
    "gpt-5.1-codex": "gpt-5.1-codex",
    "gpt-5.2-codex": "gpt-5.2-codex",
    // Standard GPT models
    "gpt-5": "gpt-5",
    "gpt-5.1": "gpt-5.1",
    "gpt-5.2": "gpt-5.2",
    "gpt-4o": "gpt-4o",
  }

  const normalized = model.toLowerCase().trim()
  return modelMap[normalized] || model
}

/**
 * OpenAI Codex CLI Adapter
 *
 * Uses the official OpenAI Codex SDK for programmatic control.
 * Note: Codex SDK doesn't support system prompts - prompts are prepended to user message.
 *
 * AUTH: Codex uses OpenAI API authentication.
 * Set OPENAI_API_KEY environment variable or configure via CLI.
 * 
 * @see https://developers.openai.com/codex/sdk
 */
export const codexAdapter: CliAdapter = {
  id: "codex",
  name: "OpenAI Codex",

  async isAvailable(): Promise<boolean> {
    // Check if codex CLI is available (SDK uses it internally)
    return new Promise((resolve) => {
      const proc = spawn("which", ["codex"])
      proc.on("close", (code) => resolve(code === 0))
      proc.on("error", () => resolve(false))
    })
  },

  chat(input: ChatInput) {
    return observable<UIMessageChunk>((emit: { next: (chunk: UIMessageChunk) => void; complete: () => void; error: (err: Error) => void }) => {
      const model = resolveModel(input.model)
      const textId = `codex-text-${Date.now()}`
      let textStarted = false
      let isSubscriptionActive = true
      const abortController = new AbortController()

      // Safe emit that won't crash if subscription was cleaned up
      const safeEmit = (chunk: UIMessageChunk) => {
        if (!isSubscriptionActive) {
          console.log("[Codex SDK] Skipping emit - subscription inactive")
          return
        }
        emit.next(chunk)
      }

      // Build the user prompt (system + context + user message)
      // Codex SDK doesn't have system prompt support, so prepend it
      const promptParts: string[] = []
      if (input.rootSystemPrompt) {
        promptParts.push(`[SYSTEM INSTRUCTIONS - Follow these guidelines for all responses]\n${input.rootSystemPrompt}\n[END SYSTEM INSTRUCTIONS]`)
      }
      if (input.contextHistory) {
        promptParts.push(input.contextHistory)
      }
      promptParts.push(input.prompt)
      const fullPrompt = promptParts.join("\n\n---\n\n")

      // Store abort controller for cancellation
      activeThreads.set(input.subChatId, { abortController })

      // Run the SDK thread asynchronously
      const runThread = async () => {
        try {
          const codex = await getCodexClient()

          console.log("[Codex SDK] Starting thread:", {
            cwd: input.cwd,
            model: model || "default",
            hasSystemPrompt: !!input.rootSystemPrompt,
            promptLength: fullPrompt.length,
          })

          // Create thread with working directory and model
          const thread = codex.startThread({
            workingDirectory: input.cwd,
            model: model,
          })

          safeEmit({ type: "start" })

          // Use runStreamed for real-time output
          console.log("[Codex SDK] Running with streaming")
          
          const streamResult = await thread.runStreamed(fullPrompt, {
            signal: abortController.signal,
          })
          
          for await (const event of streamResult.events) {
            if (!isSubscriptionActive) break

            // Handle different event types from Codex
            if (event.type === "item.started" || event.type === "item.updated") {
              const item = event.item
              if (item.type === "agent_message") {
                if (!textStarted) {
                  safeEmit({ type: "text-start", id: textId })
                  textStarted = true
                }
                // For updates, emit the full text (SDK provides complete text, not delta)
                safeEmit({
                  type: "text-delta",
                  id: textId,
                  delta: item.text,
                })
              } else if (item.type === "command_execution") {
                console.log("[Codex SDK] Command execution:", item.command)
              } else if (item.type === "file_change") {
                console.log("[Codex SDK] File change:", item.changes?.length || 0, "files")
              } else if (item.type === "reasoning") {
                console.log("[Codex SDK] Reasoning:", item.text?.substring(0, 100))
              }
            } else if (event.type === "turn.completed") {
              console.log("[Codex SDK] Turn completed, usage:", event.usage)
              break
            } else if (event.type === "turn.failed") {
              console.error("[Codex SDK] Turn failed:", event.error)
              if (textStarted) {
                safeEmit({ type: "text-end", id: textId })
                textStarted = false
              }
              safeEmit({
                type: "error",
                errorText: event.error?.message || "Unknown Codex error",
              })
              break
            } else if (event.type === "error") {
              console.error("[Codex SDK] Stream error:", event)
              if (textStarted) {
                safeEmit({ type: "text-end", id: textId })
                textStarted = false
              }
              safeEmit({
                type: "error",
                errorText: event.message || "Unknown Codex error",
              })
              break
            }
          }

          // Cleanup
          if (textStarted) {
            safeEmit({ type: "text-end", id: textId })
          }
          safeEmit({ type: "finish" })
          emit.complete()

          activeThreads.delete(input.subChatId)

        } catch (error: any) {
          console.error("[Codex SDK] Error:", error)

          if (textStarted) {
            safeEmit({ type: "text-end", id: textId })
          }

          // Skip if aborted
          if (error.name === "AbortError") {
            safeEmit({ type: "finish" })
            emit.complete()
            activeThreads.delete(input.subChatId)
            return
          }

          // Detect specific error types
          const errorMessage = error.message || String(error)
          const isNotInstalled = errorMessage.includes("ENOENT") || errorMessage.includes("not found")
          const isAuthError = errorMessage.includes("unauthorized") ||
            errorMessage.includes("authentication") ||
            errorMessage.includes("api key") ||
            errorMessage.includes("OPENAI_API_KEY")

          if (isNotInstalled) {
            safeEmit({
              type: "error",
              errorText: "Codex CLI not found. Install it with: npm i -g @openai/codex",
            })
          } else if (isAuthError) {
            safeEmit({
              type: "error",
              errorText: "OpenAI API key required. Set OPENAI_API_KEY environment variable.",
            })
          } else {
            safeEmit({
              type: "error",
              errorText: `Codex SDK error: ${errorMessage}`,
            })
          }

          safeEmit({ type: "finish" })
          emit.complete()
          activeThreads.delete(input.subChatId)
        }
      }

      // Start the async thread
      runThread()

      // Return cleanup function
      return () => {
        console.log("[Codex SDK] Cleanup called for subChatId:", input.subChatId)
        isSubscriptionActive = false
        abortController.abort()
        activeThreads.delete(input.subChatId)
      }
    })
  },

  cancel(subChatId: string): void {
    const activeThread = activeThreads.get(subChatId)
    if (activeThread) {
      console.log("[Codex SDK] Cancelling thread for subChatId:", subChatId)
      activeThread.abortController.abort()
      activeThreads.delete(subChatId)
    }
  },
}
