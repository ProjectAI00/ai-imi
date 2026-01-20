import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { observable } from "@trpc/server/observable"
import type { CliAdapter, ChatInput, UIMessageChunk } from "../types"

// Active processes for cancellation
const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>()

/**
 * Strip ANSI escape codes from string
 * Handles:
 * - CSI sequences (colors, cursor movement, etc.)
 * - OSC sequences (window titles, hyperlinks)
 * - Control characters
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") // CSI sequences
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "") // OSC sequences
    .replace(/[\u0000-\u001f\u007f]/g, "") // Control characters (except newline handled separately)
}

/**
 * Clean CLI output - remove UI artifacts and spinner characters
 * Ported from ai-imi's sanitizeCliOutput
 */
function sanitizeOutput(chunk: string): string {
  const cleaned = stripAnsi(chunk).replace(/\r/g, "")
  const lines = cleaned.split("\n")
  const filtered: string[] = []
  let lastWasEmpty = false

  for (const line of lines) {
    // Filter out CLI UI elements (progress bars, spinners, box drawing)
    if (/[▣⬝■█▀━┃]/.test(line)) continue
    // Filter out keyboard shortcut hints
    if (/(esc interrupt|ctrl\+t|ctrl\+p)/i.test(line)) continue

    const isEmpty = !line.trim()
    // Keep single empty lines for paragraph breaks, but collapse multiple
    if (isEmpty) {
      if (!lastWasEmpty && filtered.length > 0) {
        filtered.push("")
      }
      lastWasEmpty = true
    } else {
      filtered.push(line)
      lastWasEmpty = false
    }
  }

  return filtered.join("\n").trim()
}

/**
 * Resolve model string for Droid
 * Maps UI model IDs to Droid-compatible model names
 */
function resolveModel(model?: string): string {
  if (!model || !model.trim()) return "claude-opus-4-5-20251101"
  if (model.includes("/")) return model

  // Map UI model IDs to Droid model format
  const modelMap: Record<string, string> = {
    // Claude 4.5
    "claude-opus-4-5-20251101": "claude-opus-4-5-20251101",
    "claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
    // GPT-5.x
    "gpt-5.2": "gpt-5.2",
    "gpt-5.1": "gpt-5.1",
    "gpt-5.1-codex": "gpt-5.1-codex",
    // Gemini 3
    "gemini-3-pro-preview": "gemini-3-pro-preview",
    "gemini-3-flash-preview": "gemini-3-flash-preview",
    // Legacy aliases
    "opus": "claude-opus-4-5-20251101",
    "sonnet": "claude-sonnet-4-5-20250929",
    "haiku": "claude-haiku-4-5-20251001",
  }

  const normalized = model.toLowerCase().trim()
  return modelMap[normalized] || model
}

/**
 * Droid CLI Adapter
 *
 * Spawns the droid CLI process and converts its output to UIMessageChunk format.
 * Handles ANSI stripping, UI artifact removal, and proper process lifecycle.
 *
 * AUTH: Droid requires provider API keys. If user sees auth errors,
 * they should configure authentication through Droid's setup process.
 */
export const droidAdapter: CliAdapter = {
  id: "droid",
  name: "Droid",

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("which", ["droid"])
      proc.on("close", (code) => resolve(code === 0))
      proc.on("error", () => resolve(false))
    })
  },

  chat(input: ChatInput) {
    return observable<UIMessageChunk>((emit: { next: (chunk: UIMessageChunk) => void; complete: () => void; error: (err: Error) => void }) => {
      const model = resolveModel(input.model)

      // Build prompt with context if provided (for conversation continuity)
      const fullPrompt = input.contextHistory
        ? `${input.contextHistory}\n\n---\n\nUser: ${input.prompt}`
        : input.prompt

      // Build command arguments for Droid
      // Droid uses: droid exec -o stream-json --model <model> "<prompt>"
      const args = ["exec", "-o", "stream-json", "--model", model, fullPrompt]

      console.log("[Droid] Starting process:", {
        cwd: input.cwd,
        model,
        promptLength: fullPrompt.length,
      })

      const proc = spawn("droid", args, {
        cwd: input.cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color", // Some CLIs need a proper terminal type
          NO_COLOR: "1", // Disable color output
          CLICOLOR: "0", // Alternative color disable
          FORCE_COLOR: "0", // Force no colors
        },
        stdio: "pipe",
      })

      activeProcesses.set(input.subChatId, proc)

      console.log("[Droid] Process spawned with PID:", proc.pid)

      // Generate unique text block ID
      const textId = `droid-text-${Date.now()}`
      let textStarted = false
      let accumulated = ""
      let jsonBuffer = ""

      // Emit start of message
      emit.next({ type: "start" })

      // Parse Droid's stream-json format
      const parseJsonLine = (line: string) => {
        try {
          const data = JSON.parse(line)
          
          // Handle different message types from Droid's stream-json format
          if (data.type === "assistant" || data.type === "message" && data.role === "assistant") {
            // Assistant text message
            const text = data.text || data.content || ""
            if (text) {
              accumulated += text
              if (!textStarted) {
                emit.next({ type: "text-start", id: textId })
                textStarted = true
              }
              emit.next({ type: "text-delta", id: textId, delta: text })
            }
          } else if (data.type === "text" || data.type === "content") {
            // Streaming text content
            const text = data.text || data.content || data.delta || ""
            if (text) {
              accumulated += text
              if (!textStarted) {
                emit.next({ type: "text-start", id: textId })
                textStarted = true
              }
              emit.next({ type: "text-delta", id: textId, delta: text })
            }
          } else if (data.type === "error") {
            // Error from Droid
            const errorText = data.message || data.error || "Unknown error from Droid"
            accumulated += errorText
            if (!textStarted) {
              emit.next({ type: "text-start", id: textId })
              textStarted = true
            }
            emit.next({ type: "text-delta", id: textId, delta: errorText })
          }
          // Ignore system, user, and other message types
        } catch (e) {
          // Not valid JSON, might be partial - buffer it
          console.log("[Droid] JSON parse error, buffering:", line.substring(0, 100))
        }
      }

      const handleOutput = (data: Buffer, source: "stdout" | "stderr") => {
        const text = data.toString()
        console.log(`[Droid] ${source} received, length:`, text.length)

        if (source === "stderr") {
          // stderr might contain error messages, accumulate for error detection
          const sanitized = sanitizeOutput(text)
          if (sanitized) {
            accumulated += sanitized
          }
          return
        }

        // Parse JSON lines from stdout
        jsonBuffer += text
        const lines = jsonBuffer.split("\n")
        // Keep the last potentially incomplete line in buffer
        jsonBuffer = lines.pop() || ""
        
        for (const line of lines) {
          if (line.trim()) {
            parseJsonLine(line.trim())
          }
        }
      }

      proc.stdout.on("data", (data) => handleOutput(data, "stdout"))
      proc.stderr.on("data", (data) => handleOutput(data, "stderr"))

      // Track if we've already handled an error (to prevent duplicate emits)
      let hasErrored = false

      proc.on("error", (error) => {
        console.error("[Droid] Process error:", error.message)
        hasErrored = true

        // End text block if started
        if (textStarted) {
          emit.next({ type: "text-end", id: textId })
        }

        // Check for ENOENT (CLI not installed)
        const isNotInstalled = error.message.includes("ENOENT") || error.message.includes("not found")

        if (isNotInstalled) {
          emit.next({
            type: "error",
            errorText: "Droid CLI not found. Please install Droid from Factory AI.",
          })
        } else {
          emit.next({
            type: "error",
            errorText: `Droid error: ${error.message}`,
          })
        }
        emit.next({ type: "finish" })
        emit.complete()
        activeProcesses.delete(input.subChatId)
      })

      proc.on("close", (code) => {
        console.log("[Droid] Process closed with exit code:", code)
        console.log("[Droid] Accumulated output length:", accumulated.length)

        // Skip if error handler already handled this
        if (hasErrored) {
          console.log("[Droid] Skipping close handler - already handled by error handler")
          return
        }

        if (code !== 0 && code !== null) {
          // Check for auth-related errors in accumulated output
          const isAuthError = accumulated.toLowerCase().includes("unauthorized") ||
            accumulated.toLowerCase().includes("authentication") ||
            accumulated.toLowerCase().includes("api key") ||
            accumulated.toLowerCase().includes("invalid key") ||
            accumulated.toLowerCase().includes("not authenticated") ||
            accumulated.toLowerCase().includes("login required")

          if (isAuthError) {
            emit.next({
              type: "auth-error",
              errorText: "You need to authenticate with Droid to continue.",
              cli: "droid",
            })
          } else {
            emit.next({
              type: "error",
              errorText: `Droid exited with code ${code}`,
            })
          }
        }

        // If no output was received, emit a fallback message
        if (!accumulated.trim()) {
          if (!textStarted) {
            emit.next({ type: "text-start", id: textId })
            textStarted = true
          }
          emit.next({
            type: "text-delta",
            id: textId,
            delta: "No response received from Droid. Check that the CLI is installed and configured correctly.",
          })
        }

        // End text block
        if (textStarted) {
          emit.next({ type: "text-end", id: textId })
        }

        emit.next({ type: "finish" })
        emit.complete()
        activeProcesses.delete(input.subChatId)
      })

      // Close stdin immediately - Droid reads from stdin if not a TTY and waits for it
      proc.stdin.end()
      console.log("[Droid] stdin closed")

      // Cleanup on unsubscribe
      return () => {
        console.log("[Droid] Cleanup called for subChatId:", input.subChatId)
        if (proc.exitCode === null) {
          proc.kill("SIGTERM")
        }
        activeProcesses.delete(input.subChatId)
      }
    })
  },

  cancel(subChatId: string): void {
    const proc = activeProcesses.get(subChatId)
    if (proc && proc.exitCode === null) {
      console.log("[Droid] Cancelling process for subChatId:", subChatId)
      proc.kill("SIGTERM")
      activeProcesses.delete(subChatId)
    }
  },
}