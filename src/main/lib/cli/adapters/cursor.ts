import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { observable } from "@trpc/server/observable"
import { app } from "electron"
import path from "path"
import fs from "fs"
import type { CliAdapter, ChatInput, UIMessageChunk } from "../types"

// Active processes for cancellation
const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>()

/**
 * Get path to the bundled cursor-agent binary from @nothumanwork/cursor-agents-sdk
 */
function getBundledCursorAgentPath(): string {
  const isDev = !app.isPackaged

  // In dev mode, the binary is in node_modules
  // In production, it should be bundled with the app
  let basePath: string
  if (isDev) {
    basePath = path.join(app.getAppPath(), "node_modules", "@nothumanwork", "cursor-agents-sdk")
  } else {
    // In production, check both possible locations
    basePath = path.join(process.resourcesPath, "node_modules", "@nothumanwork", "cursor-agents-sdk")
    if (!fs.existsSync(basePath)) {
      basePath = path.join(app.getAppPath(), "node_modules", "@nothumanwork", "cursor-agents-sdk")
    }
  }

  // Read manifest to get the actual binary path
  const manifestPath = path.join(basePath, "vendor", "manifest.json")

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
    const binaryPath = path.join(basePath, manifest.path)

    console.log("[Cursor] Bundled binary path:", binaryPath)
    console.log("[Cursor] Binary exists:", fs.existsSync(binaryPath))

    return binaryPath
  } catch (error) {
    console.error("[Cursor] Failed to read manifest:", error)
    // Fallback to expected path
    const platform = process.platform === "win32" ? "windows" : process.platform
    const arch = process.arch
    const binaryName = process.platform === "win32" ? "cursor-agent.cmd" : "cursor-agent"
    return path.join(basePath, "vendor", `*`, `${platform}-${arch}`, binaryName)
  }
}

/**
 * Strip ANSI escape codes from string
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") // CSI sequences
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "") // OSC sequences
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") // Control chars except \t, \n, \r
}

/**
 * Clean CLI output - remove UI artifacts and spinner characters
 */
function sanitizeOutput(chunk: string): string {
  const cleaned = stripAnsi(chunk).replace(/\r/g, "\n")
  const lines = cleaned.split("\n")
  const filtered: string[] = []
  let lastWasEmpty = false

  const stripUsageFooter = (line: string): string | null => {
    const usageMatch = line.match(
      /(Total usage est:|Usage by model:|Total duration \(API\):|Total duration \(wall\):|Premium requests|Total code changes:|\b\d+(?:\.\d+)?k?\s+input\b|\b\d+(?:\.\d+)?k?\s+output\b|\b\d+(?:\.\d+)?k?\s+cache read\b)/i
    )
    if (!usageMatch) return line
    const trimmed = line.slice(0, usageMatch.index).trimEnd()
    return trimmed ? trimmed : null
  }

  for (const line of lines) {
    // Filter out CLI UI elements (progress bars, spinners, box drawing)
    const hasSpinner = /[▣⬝■█▀━┃]/.test(line)
    const lineWithoutSpinner = line.replace(/[▣⬝■█▀━┃]/g, " ")
    const lineForEmpty = lineWithoutSpinner.trim()
    if (!lineForEmpty) continue
    // Filter out keyboard shortcut hints
    if (/(esc interrupt|ctrl\+t|ctrl\+p)/i.test(line)) continue

    const cleanedLine = stripUsageFooter(hasSpinner ? `• ${lineForEmpty}` : lineWithoutSpinner)
    if (cleanedLine === null) continue
    const isEmpty = !cleanedLine.trim()
    if (isEmpty) {
      if (!lastWasEmpty && filtered.length > 0) {
        filtered.push("")
      }
      lastWasEmpty = true
    } else {
      filtered.push(cleanedLine)
      lastWasEmpty = false
    }
  }

  // Don't trim - preserve leading/trailing newlines for proper chunk concatenation
  return filtered.join("\n")
}

/**
 * Resolve model string for Cursor Agent CLI
 */
function resolveModel(model?: string): string | undefined {
  if (!model || !model.trim()) return undefined

  // Map common model names to cursor-agent format
  // Cursor supports: opus-4.5, sonnet-4.5, sonnet-4.5-thinking, etc.
  const modelMap: Record<string, string> = {
    "auto": "auto",
    "sonnet": "sonnet-4.5",
    "opus": "opus-4.5",
    "haiku": "auto", // Cursor doesn't have haiku, fallback to auto
    "claude-4.5-sonnet": "sonnet-4.5",
    "claude-4.5-opus": "opus-4.5",
    "claude-opus-4.5": "opus-4.5",
    "claude-sonnet-4.5": "sonnet-4.5",
    "gpt-5.2": "gpt-5.2",
    "gpt-5.2-codex": "gpt-5.2-codex",
  }

  return modelMap[model] || model
}

/**
 * Cursor Agent CLI Adapter
 *
 * Uses the bundled cursor-agent binary from @nothumanwork/cursor-agents-sdk.
 * This binary is downloaded during npm install and works independently of
 * the Cursor desktop app installation.
 *
 * AUTH: Uses cursor-agent's own authentication. User must run `cursor-agent login`
 * or provide CURSOR_API_KEY environment variable.
 */
export const cursorAdapter: CliAdapter = {
  id: "cursor",
  name: "Cursor",

  async isAvailable(): Promise<boolean> {
    try {
      const binaryPath = getBundledCursorAgentPath()
      return fs.existsSync(binaryPath)
    } catch {
      return false
    }
  },

  chat(input: ChatInput) {
    return observable<UIMessageChunk>((emit) => {
      const binaryPath = getBundledCursorAgentPath()

      // Build prompt with root system prompt, context, and user message
      const promptParts: string[] = []
      
      // 1. Root system prompt (consistent behavior layer)
      if (input.rootSystemPrompt) {
        promptParts.push(input.rootSystemPrompt)
      }
      
      // 2. Conversation history (if any)
      if (input.contextHistory) {
        promptParts.push(input.contextHistory)
      }
      
      // 3. Current user message
      promptParts.push(`User: ${input.prompt}`)
      
      const fullPrompt = promptParts.join("\n\n---\n\n")

      // Build command arguments for cursor-agent
      // cursor-agent --print --output-format text --model <model> "<prompt>"
      const model = resolveModel(input.model) || "auto"
      const args = [
        "--print", // Non-interactive mode, outputs to console
        "--output-format", "text", // Plain text output
        "--force", // Allow commands without explicit approval
        "--model", model, // Explicitly specify model (auto is unlimited for Pro)
      ]
      args.push(fullPrompt)

      console.log("[Cursor] Starting bundled cursor-agent:", {
        binary: binaryPath,
        cwd: input.cwd,
        model: model || "(default)",
        promptLength: fullPrompt.length,
      })

      const proc = spawn(binaryPath, args, {
        cwd: input.cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          NO_COLOR: "1",
          CLICOLOR: "0",
          FORCE_COLOR: "0",
        },
        stdio: "pipe",
      })

      activeProcesses.set(input.subChatId, proc)

      console.log("[Cursor] Process spawned with PID:", proc.pid)

      const textId = `cursor-text-${Date.now()}`
      let textStarted = false
      let accumulated = ""
      let isCancelled = false // Track if stream was cancelled

      // Safe emit wrapper - no-op after cancellation
      const safeEmit = (chunk: UIMessageChunk) => {
        if (isCancelled) return
        try {
          emit.next(chunk)
        } catch {
          isCancelled = true // Mark as cancelled on emit error
        }
      }
      const safeComplete = () => {
        if (isCancelled) return
        try {
          emit.complete()
        } catch {
          // Already closed
        }
      }

      safeEmit({ type: "start" })

      const handleOutput = (data: Buffer, source: "stdout" | "stderr") => {
        if (isCancelled) return
        const text = data.toString()
        console.log(`[Cursor] ${source} received, length:`, text.length)

        const sanitized = sanitizeOutput(text)
        if (!sanitized) return

        accumulated += sanitized

        if (!textStarted) {
          safeEmit({ type: "text-start", id: textId })
          textStarted = true
        }

        safeEmit({
          type: "text-delta",
          id: textId,
          delta: sanitized,
        })
      }

      proc.stdout.on("data", (data) => handleOutput(data, "stdout"))
      proc.stderr.on("data", (data) => handleOutput(data, "stderr"))

      let hasErrored = false

      proc.on("error", (error) => {
        if (isCancelled) return
        console.error("[Cursor] Process error:", error.message)
        hasErrored = true

        if (textStarted) {
          safeEmit({ type: "text-end", id: textId })
        }

        const isNotInstalled = error.message.includes("ENOENT") || error.message.includes("not found")

        if (isNotInstalled) {
          safeEmit({
            type: "error",
            errorText: "Cursor Agent binary not found. Try reinstalling the app or running: bun add @nothumanwork/cursor-agents-sdk",
            debugInfo: {
              category: "CURSOR_NOT_INSTALLED",
              cli: "cursor",
            },
          } as UIMessageChunk)
        } else {
          safeEmit({
            type: "error",
            errorText: `Cursor error: ${error.message}`,
            debugInfo: {
              category: "CURSOR_ERROR",
              cli: "cursor",
            },
          } as UIMessageChunk)
        }
        safeEmit({ type: "finish" })
        safeComplete()
        activeProcesses.delete(input.subChatId)
      })

      proc.on("close", (code) => {
        if (isCancelled) {
          console.log("[Cursor] Process closed after cancel, skipping emit")
          activeProcesses.delete(input.subChatId)
          return
        }
        console.log("[Cursor] Process closed with exit code:", code)
        console.log("[Cursor] Accumulated output length:", accumulated.length)

        if (hasErrored) {
          console.log("[Cursor] Skipping close handler - already handled by error handler")
          return
        }

        if (code !== 0 && code !== null) {
          // Check for auth-related errors
          const lowerAccumulated = accumulated.toLowerCase()
          const isAuthError = lowerAccumulated.includes("unauthorized") ||
            lowerAccumulated.includes("authentication") ||
            lowerAccumulated.includes("not logged in") ||
            lowerAccumulated.includes("login required") ||
            lowerAccumulated.includes("api key") ||
            lowerAccumulated.includes("please log in") ||
            lowerAccumulated.includes("cursor-agent login")

          if (isAuthError) {
            // Emit auth error with login instructions
            if (!textStarted) {
              safeEmit({ type: "text-start", id: textId })
              textStarted = true
            }
            safeEmit({
              type: "text-delta",
              id: textId,
              delta: "\n\n**Authentication Required**\n\nPlease authenticate with Cursor by running this command in your terminal:\n\n```\ncursor-agent login\n```\n\nOr set the `CURSOR_API_KEY` environment variable.",
            })
            safeEmit({
              type: "error",
              errorText: "Authentication required. Run 'cursor-agent login' in your terminal to authenticate.",
              debugInfo: {
                category: "CURSOR_AUTH_REQUIRED",
                cli: "cursor",
              },
            } as UIMessageChunk)
          } else {
            safeEmit({
              type: "error",
              errorText: `Cursor exited with code ${code}`,
              debugInfo: {
                category: "CURSOR_ERROR",
                cli: "cursor",
                exitCode: code,
              },
            } as UIMessageChunk)
          }
        }

        // If no output was received, emit a fallback message
        if (!accumulated.trim()) {
          if (!textStarted) {
            safeEmit({ type: "text-start", id: textId })
            textStarted = true
          }
          safeEmit({
            type: "text-delta",
            id: textId,
            delta: "No response received from Cursor Agent. Make sure you're authenticated by running: cursor-agent login",
          })
        }

        if (textStarted) {
          safeEmit({ type: "text-end", id: textId })
        }

        safeEmit({ type: "finish" })
        safeComplete()
        activeProcesses.delete(input.subChatId)
      })

      proc.stdin.end()
      console.log("[Cursor] stdin closed")

      return () => {
        console.log("[Cursor] Cleanup called for subChatId:", input.subChatId)
        isCancelled = true
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
      console.log("[Cursor] Cancelling process for subChatId:", subChatId)
      proc.kill("SIGTERM")
      activeProcesses.delete(subChatId)
    }
  },
}
