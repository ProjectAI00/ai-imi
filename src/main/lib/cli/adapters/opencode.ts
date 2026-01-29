import { spawn } from "child_process"
import { observable } from "@trpc/server/observable"
import type { CliAdapter, ChatInput, UIMessageChunk } from "../types"

// Lazy-loaded OpenCode SDK types and client
let createOpencodeFunc: typeof import("@opencode-ai/sdk").createOpencode | null = null
let opencodeInstance: Awaited<ReturnType<typeof import("@opencode-ai/sdk").createOpencode>> | null = null

// Active sessions for cancellation (SDK-based)
const activeSessions = new Map<string, { sessionId: string; abort: () => Promise<void> }>()

/**
 * Get or create the singleton OpenCode client
 */
async function getOpencodeClient() {
  if (!createOpencodeFunc) {
    const sdk = await import("@opencode-ai/sdk")
    createOpencodeFunc = sdk.createOpencode
  }
  
  if (!opencodeInstance) {
    opencodeInstance = await createOpencodeFunc!({
      hostname: "127.0.0.1",
      port: 4096,
      timeout: 10000,
    })
  }
  
  return opencodeInstance.client
}

/**
 * Resolve model string for OpenCode
 * Converts short UI IDs to full provider/model format
 * @see https://opencode.ai for supported models
 */
function resolveModel(model?: string): { providerID: string; modelID: string } {
  const defaultModel = { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }
  if (!model || !model.trim()) return defaultModel
  
  // If already in provider/model format
  if (model.includes("/")) {
    const [providerID, modelID] = model.split("/")
    return { providerID, modelID }
  }

  // Map UI model IDs to full provider/model format
  const modelMap: Record<string, { providerID: string; modelID: string }> = {
    // Anthropic Claude 4 models (primary selection)
    "claude-sonnet-4": { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    "claude-opus-4": { providerID: "anthropic", modelID: "claude-opus-4-20250514" },
    "claude-haiku-3.5": { providerID: "anthropic", modelID: "claude-haiku-3-20250513" },
    // Legacy short names (backwards compatibility)
    sonnet: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    opus: { providerID: "anthropic", modelID: "claude-opus-4-20250514" },
    haiku: { providerID: "anthropic", modelID: "claude-haiku-3-20250513" },
    // OpenAI GPT-5 models
    "gpt-5.2": { providerID: "openai", modelID: "gpt-5.2" },
    "gpt-5.1-codex": { providerID: "openai", modelID: "gpt-5.1-codex" },
    "gpt-4o": { providerID: "openai", modelID: "gpt-4o" },
    // Google Gemini 3 models
    "gemini-3-pro": { providerID: "google", modelID: "gemini-3-pro" },
  }

  const normalized = model.toLowerCase().trim()
  return modelMap[normalized] || defaultModel
}


/**
 * OpenCode CLI Adapter
 *
 * Uses the official OpenCode SDK for programmatic control.
 * Supports real system prompts via noReply context injection.
 *
 * AUTH: OpenCode requires provider API keys. If user sees auth errors,
 * they should run `opencode auth login` in terminal to configure authentication.
 * 
 * @see https://opencode.ai/docs/sdk/
 */
export const openCodeAdapter: CliAdapter = {
  id: "opencode",
  name: "OpenCode",

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("which", ["opencode"])
      proc.on("close", (code) => resolve(code === 0))
      proc.on("error", () => resolve(false))
    })
  },

  chat(input: ChatInput) {
    return observable<UIMessageChunk>((emit: { next: (chunk: UIMessageChunk) => void; complete: () => void; error: (err: Error) => void }) => {
      const model = resolveModel(input.model)
      const textId = `opencode-text-${Date.now()}`
      let textStarted = false
      let isSubscriptionActive = true

      // Safe emit that won't crash if subscription was cleaned up
      const safeEmit = (chunk: UIMessageChunk) => {
        if (!isSubscriptionActive) {
          console.log("[OpenCode SDK] Skipping emit - subscription inactive")
          return
        }
        emit.next(chunk)
      }

      // Run the SDK session asynchronously
      const runSession = async () => {
        try {
          const client = await getOpencodeClient()

          console.log("[OpenCode SDK] Creating session:", {
            cwd: input.cwd,
            model: `${model.providerID}/${model.modelID}`,
            hasSystemPrompt: !!input.rootSystemPrompt,
            systemPromptLength: input.rootSystemPrompt?.length || 0,
          })

          // Create a new session
          const session = await client.session.create({
            body: { title: `Session ${Date.now()}` },
          })

          if (!session.data?.id) {
            throw new Error("Failed to create OpenCode session")
          }

          const sessionId = session.data.id

          // Store session for cancellation
          activeSessions.set(input.subChatId, {
            sessionId,
            abort: async () => {
              try {
                await client.session.abort({ path: { id: sessionId } })
              } catch (e) {
                console.error("[OpenCode SDK] Error aborting session:", e)
              }
            },
          })

          safeEmit({ type: "start" })

          // Step 1: Subscribe to events for streaming (before sending prompt)
          const events = await client.global.event()
          
          // Process events in background
          const eventPromise = (async () => {
            for await (const event of events.stream) {
              if (!isSubscriptionActive) break
              
              // Handle different event types
              if (event.type === "message.part.text.delta") {
                if (!textStarted) {
                  safeEmit({ type: "text-start", id: textId })
                  textStarted = true
                }
                safeEmit({
                  type: "text-delta",
                  id: textId,
                  delta: (event as any).properties?.content || "",
                })
              } else if (event.type === "message.complete") {
                console.log("[OpenCode SDK] Message complete")
                break
              } else if (event.type === "session.error") {
                console.error("[OpenCode SDK] Session error:", (event as any).properties)
                break
              }
            }
          })()

          // Step 2: Build prompt with system message and context
          const promptParts: Array<{ type: "text"; text: string }> = []
          
          // Add conversation history if any
          if (input.contextHistory) {
            promptParts.push({ type: "text", text: input.contextHistory })
          }
          
          // Add user message
          promptParts.push({ type: "text", text: input.prompt })

          // Step 3: Send prompt with native system parameter (TRUE system prompt!)
          console.log("[OpenCode SDK] Sending prompt with system message")
          await client.session.prompt({
            path: { id: sessionId },
            body: {
              model: model,
              system: input.rootSystemPrompt || undefined,  // Native system prompt support!
              parts: promptParts,
            },
          })

          // Wait for events to complete
          await eventPromise

          // Cleanup
          if (textStarted) {
            safeEmit({ type: "text-end", id: textId })
          }
          safeEmit({ type: "finish" })
          emit.complete()

          activeSessions.delete(input.subChatId)

        } catch (error: any) {
          console.error("[OpenCode SDK] Error:", error)

          if (textStarted) {
            safeEmit({ type: "text-end", id: textId })
          }

          // Detect specific error types
          const errorMessage = error.message || String(error)
          const isNotInstalled = errorMessage.includes("ENOENT") || errorMessage.includes("not found") || errorMessage.includes("ECONNREFUSED")
          const isAuthError = errorMessage.includes("unauthorized") ||
            errorMessage.includes("authentication") ||
            errorMessage.includes("api key")

          if (isNotInstalled) {
            safeEmit({
              type: "error",
              errorText: "OpenCode server not running. Start it with: opencode server",
            })
          } else if (isAuthError) {
            safeEmit({
              type: "error",
              errorText: "Authentication required. Run `opencode auth login` in your terminal.",
            })
          } else {
            safeEmit({
              type: "error",
              errorText: `OpenCode SDK error: ${errorMessage}`,
            })
          }

          safeEmit({ type: "finish" })
          emit.complete()
          activeSessions.delete(input.subChatId)
        }
      }

      // Start the async session
      runSession()

      // Return cleanup function
      return () => {
        console.log("[OpenCode SDK] Cleanup called for subChatId:", input.subChatId)
        isSubscriptionActive = false
        const activeSession = activeSessions.get(input.subChatId)
        if (activeSession) {
          activeSession.abort().catch((err) => {
            console.error("[OpenCode SDK] Error aborting session:", err)
          })
          activeSessions.delete(input.subChatId)
        }
      }
    })
  },

  cancel(subChatId: string): void {
    const activeSession = activeSessions.get(subChatId)
    if (activeSession) {
      console.log("[OpenCode SDK] Cancelling session for subChatId:", subChatId)
      activeSession.abort().catch((err) => {
        console.error("[OpenCode SDK] Error aborting session:", err)
      })
      activeSessions.delete(subChatId)
    }
  },
}
