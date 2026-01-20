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
 * Resolve model string for OpenCode
 * Converts short UI IDs to full provider/model format
 * @see https://opencode.ai for supported models
 */
function resolveModel(model?: string): string {
  if (!model || !model.trim()) return "anthropic/claude-sonnet-4-20250514"
  if (model.includes("/")) return model

  // Map UI model IDs to full provider/model format
  const modelMap: Record<string, string> = {
    // Anthropic Claude 4 models (primary selection)
    "claude-sonnet-4": "anthropic/claude-sonnet-4-20250514",
    "claude-opus-4": "anthropic/claude-opus-4-20250514",
    "claude-haiku-3.5": "anthropic/claude-haiku-3-20250513",
    // Legacy short names (backwards compatibility)
    sonnet: "anthropic/claude-sonnet-4-20250514",
    opus: "anthropic/claude-opus-4-20250514",
    haiku: "anthropic/claude-haiku-3-20250513",
    // OpenAI GPT-5 models
    "gpt-5.2": "openai/gpt-5.2",
    "gpt-5.1-codex": "openai/gpt-5.1-codex",
    "gpt-4o": "openai/gpt-4o",
    // Google Gemini 3 models
    "gemini-3-pro": "google/gemini-3-pro",
  }

  const normalized = model.toLowerCase().trim()
  return modelMap[normalized] || model
}


/**
 * OpenCode CLI Adapter
 *
 * Spawns the opencode CLI process and converts its output to UIMessageChunk format.
 * Handles ANSI stripping, UI artifact removal, and proper process lifecycle.
 *
 * AUTH: OpenCode requires provider API keys. If user sees auth errors,
 * they should run `opencode auth login` in terminal to configure authentication.
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

      // Build prompt with context if provided (for conversation continuity)
      const fullPrompt = input.contextHistory
        ? `${input.contextHistory}\n\n---\n\nUser: ${input.prompt}`
        : input.prompt

      // Build command arguments
      // Don't use --format json as it buffers output; use default format for streaming
      const args = ["run", "--model", model, fullPrompt]

      console.log("[OpenCode] Starting process:", {
        cwd: input.cwd,
        model,
        promptLength: fullPrompt.length,
      })

      const proc = spawn("opencode", args, {
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

      console.log("[OpenCode] Process spawned with PID:", proc.pid)

      // Generate unique text block ID
      const textId = `opencode-text-${Date.now()}`
      let textStarted = false
      let accumulated = ""

      // Emit start of message
      emit.next({ type: "start" })

      const handleOutput = (data: Buffer, source: "stdout" | "stderr") => {
        const text = data.toString()
        console.log(`[OpenCode] ${source} received, length:`, text.length)

        const sanitized = sanitizeOutput(text)
        if (!sanitized) return

        accumulated += sanitized

        // Start text block if not started
        if (!textStarted) {
          emit.next({ type: "text-start", id: textId })
          textStarted = true
        }

        // Emit text delta
        emit.next({
          type: "text-delta",
          id: textId,
          delta: sanitized,
        })
      }

      proc.stdout.on("data", (data) => handleOutput(data, "stdout"))
      proc.stderr.on("data", (data) => handleOutput(data, "stderr"))

      // Track if we've already handled an error (to prevent duplicate emits)
      let hasErrored = false

      proc.on("error", (error) => {
        console.error("[OpenCode] Process error:", error.message)
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
            errorText: "OpenCode CLI not found. Install it with: npm install -g opencode",
          })
        } else {
          emit.next({
            type: "error",
            errorText: `OpenCode error: ${error.message}`,
          })
        }
        emit.next({ type: "finish" })
        emit.complete()
        activeProcesses.delete(input.subChatId)
      })

      proc.on("close", (code) => {
        console.log("[OpenCode] Process closed with exit code:", code)
        console.log("[OpenCode] Accumulated output length:", accumulated.length)

        // Skip if error handler already handled this
        if (hasErrored) {
          console.log("[OpenCode] Skipping close handler - already handled by error handler")
          return
        }

        if (code !== 0 && code !== null) {
          // Check for auth-related errors in accumulated output
          const isAuthError = accumulated.toLowerCase().includes("unauthorized") ||
            accumulated.toLowerCase().includes("authentication") ||
            accumulated.toLowerCase().includes("api key") ||
            accumulated.toLowerCase().includes("invalid key") ||
            accumulated.toLowerCase().includes("not authenticated")

          if (isAuthError) {
            emit.next({
              type: "error",
              errorText: "Authentication required. Run `opencode auth login` in your terminal to configure API keys.",
            })
          } else {
            emit.next({
              type: "error",
              errorText: `OpenCode exited with code ${code}`,
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
            delta: "No response received from OpenCode. Check that the CLI is installed and configured correctly.",
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

      // Close stdin immediately - OpenCode reads from stdin if not a TTY and waits for it
      proc.stdin.end()
      console.log("[OpenCode] stdin closed")

      // Cleanup on unsubscribe
      return () => {
        console.log("[OpenCode] Cleanup called for subChatId:", input.subChatId)
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
      console.log("[OpenCode] Cancelling process for subChatId:", subChatId)
      proc.kill("SIGTERM")
      activeProcesses.delete(subChatId)
    }
  },
}
