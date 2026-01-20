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
 * AMP CLI Adapter
 *
 * Spawns the amp CLI process and converts its output to UIMessageChunk format.
 * Handles ANSI stripping, UI artifact removal, and proper process lifecycle.
 *
 * AUTH: AMP requires provider API keys. If user sees auth errors,
 * they should configure authentication through AMP's setup process.
 */
export const ampAdapter: CliAdapter = {
  id: "amp",
  name: "AMP",

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("which", ["amp"])
      proc.on("close", (code) => resolve(code === 0))
      proc.on("error", () => resolve(false))
    })
  },

  chat(input: ChatInput) {
    return observable<UIMessageChunk>((emit: { next: (chunk: UIMessageChunk) => void; complete: () => void; error: (err: Error) => void }) => {
      // Build prompt with context if provided (for conversation continuity)
      const fullPrompt = input.contextHistory
        ? `${input.contextHistory}\n\n---\n\nUser: ${input.prompt}`
        : input.prompt

      // AMP uses modes: "smart" or "rush"
      const mode = input.model === "rush" ? "rush" : "smart"

      // Build command arguments for AMP
      // AMP uses execute mode: amp -x "<prompt>" --mode <mode>
      // The message must be passed as the argument to -x or piped via stdin
      const args = ["-x", fullPrompt, "--mode", mode, "--no-ide"]

      console.log("[AMP] Starting process:", {
        cwd: input.cwd,
        mode,
        promptLength: fullPrompt.length,
      })

      const proc = spawn("amp", args, {
        cwd: input.cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color", // Some CLIs need a proper terminal type
          NO_COLOR: "1", // Disable color output
          CLICOLOR: "0", // Alternative color disable
          FORCE_COLOR: "0", // Force no colors
          // Add AMP API key if provided
          ...(input.ampApiKey && { AMP_API_KEY: input.ampApiKey }),
        },
        stdio: "pipe",
      })

      activeProcesses.set(input.subChatId, proc)

      console.log("[AMP] Process spawned with PID:", proc.pid)

      // Generate unique text block ID
      const textId = `amp-text-${Date.now()}`
      let textStarted = false
      let accumulated = ""

      // Emit start of message
      emit.next({ type: "start" })

      const handleOutput = (data: Buffer, source: "stdout" | "stderr") => {
        const text = data.toString()
        console.log(`[AMP] ${source} received, length:`, text.length)

        // If using --stream-json, AMP should output JSON stream format
        // For now, handle as regular text until we verify JSON format
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
        console.error("[AMP] Process error:", error.message)
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
            errorText: "AMP CLI not found. Please install AMP first.",
          })
        } else {
          emit.next({
            type: "error",
            errorText: `AMP error: ${error.message}`,
          })
        }
        emit.next({ type: "finish" })
        emit.complete()
        activeProcesses.delete(input.subChatId)
      })

      proc.on("close", (code) => {
        console.log("[AMP] Process closed with exit code:", code)
        console.log("[AMP] Accumulated output length:", accumulated.length)

        // Skip if error handler already handled this
        if (hasErrored) {
          console.log("[AMP] Skipping close handler - already handled by error handler")
          return
        }

        if (code !== 0 && code !== null) {
          // Check for auth-related errors in accumulated output
          const lowerAccumulated = accumulated.toLowerCase()
          const isAuthError = lowerAccumulated.includes("unauthorized") ||
            lowerAccumulated.includes("authentication") ||
            lowerAccumulated.includes("api key") ||
            lowerAccumulated.includes("invalid key") ||
            lowerAccumulated.includes("not authenticated") ||
            lowerAccumulated.includes("login required") ||
            lowerAccumulated.includes("unexpected error") ||
            lowerAccumulated.includes("not logged in")
          
          // Check for payment/credits required (402 error)
          const isPaymentError = lowerAccumulated.includes("402") ||
            lowerAccumulated.includes("paid credits") ||
            lowerAccumulated.includes("add credits")

          if (isAuthError) {
            emit.next({
              type: "auth-error",
              errorText: "You need to authenticate with AMP to continue.",
              cli: "amp",
            })
          } else if (isPaymentError) {
            emit.next({
              type: "error",
              errorText: "AMP execute mode requires paid credits. Add credits at https://ampcode.com/pay",
            })
          } else {
            emit.next({
              type: "error",
              errorText: `AMP exited with code ${code}. Make sure AMP is properly configured.`,
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
            delta: "No response received from AMP. Check that the CLI is installed and configured correctly.",
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

      // Close stdin immediately - AMP reads from stdin if not a TTY and waits for it
      proc.stdin.end()
      console.log("[AMP] stdin closed")

      // Cleanup on unsubscribe
      return () => {
        console.log("[AMP] Cleanup called for subChatId:", input.subChatId)
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
      console.log("[AMP] Cancelling process for subChatId:", subChatId)
      proc.kill("SIGTERM")
      activeProcesses.delete(subChatId)
    }
  },
}