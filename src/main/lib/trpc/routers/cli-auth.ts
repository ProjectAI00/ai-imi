import { z } from "zod"
import { spawn } from "child_process"
import { shell } from "electron"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"
import { app } from "electron"
import { router, publicProcedure } from "../index"

/**
 * Get path to the bundled cursor-agent binary
 */
async function getCursorAgentPath(): Promise<string> {
  const isDev = !app.isPackaged
  let basePath: string
  if (isDev) {
    basePath = path.join(app.getAppPath(), "node_modules", "@nothumanwork", "cursor-agents-sdk")
  } else {
    basePath = path.join(process.resourcesPath, "node_modules", "@nothumanwork", "cursor-agents-sdk")
    try {
      await fs.access(basePath)
    } catch {
      basePath = path.join(app.getAppPath(), "node_modules", "@nothumanwork", "cursor-agents-sdk")
    }
  }

  const manifestPath = path.join(basePath, "vendor", "manifest.json")
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"))
    return path.join(basePath, manifest.path)
  } catch {
    // Fallback
    const platform = process.platform === "win32" ? "windows" : process.platform
    const arch = process.arch
    return path.join(basePath, "vendor", "*", `${platform}-${arch}`, "cursor-agent")
  }
}

/**
 * Run a CLI command and capture output with a timeout
 * Returns early if the timeout is reached while still capturing output
 */
function runCliCommandWithTimeout(
  command: string, 
  args: string[], 
  timeoutMs: number = 5000,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let resolved = false
    
    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: "pipe",
    })
    
    proc.stdout?.on("data", (data) => {
      stdout += data.toString()
    })
    
    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })
    
    // Set timeout to return early
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        resolve({ stdout, stderr, exitCode: -1, timedOut: true })
      }
    }, timeoutMs)
    
    proc.on("close", (code) => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        resolve({ stdout, stderr, exitCode: code || 0, timedOut: false })
      }
    })
    
    proc.on("error", (err) => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        resolve({ stdout, stderr: err.message, exitCode: 1, timedOut: false })
      }
    })
  })
}

/**
 * Run a CLI command and capture output (waits for completion)
 */
function runCliCommand(command: string, args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    
    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: "pipe",
    })
    
    proc.stdout?.on("data", (data) => {
      stdout += data.toString()
    })
    
    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })
    
    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 })
    })
    
    proc.on("error", (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 })
    })
  })
}

/**
 * Extract OAuth URL from CLI output
 */
function extractOAuthUrl(output: string): string | null {
  // Look for explicit URL hints first
  const linkMatch = output.match(/navigate to this link:\s*(https:\/\/[^\s]+)/i)
  if (linkMatch) {
    return linkMatch[1].replace(/['"`,)}\]]+$/, "")
  }
  
  // Common patterns for OAuth URLs
  const patterns = [
    /https:\/\/cursor\.com\/[^\s]+/i,
    /https:\/\/github\.com\/login\/device[^\s]*/i,
    /https:\/\/platform\.openai\.com[^\s]*/i,
    /https:\/\/[^\s]+oauth[^\s]*/i,
    /https:\/\/[^\s]+login[^\s]*/i,
    /https:\/\/[^\s]+auth[^\s]*/i,
  ]
  
  for (const pattern of patterns) {
    const match = output.match(pattern)
    if (match) {
      return match[0].replace(/['"`,)}\]]+$/, "") // Clean trailing punctuation
    }
  }
  return null
}

/**
 * CLI Auth Router
 * Handles OAuth flows for Cursor, Copilot, and Codex
 */
export const cliAuthRouter = router({
  /**
   * Start Cursor OAuth flow
   */
  startCursorAuth: publicProcedure.mutation(async () => {
    const binaryPath = await getCursorAgentPath()
    
    if (!existsSync(binaryPath)) {
      throw new Error("Cursor agent not found. Please reinstall the app.")
    }
    
    console.log("[CLI Auth] Starting Cursor login flow...")
    
    // Run cursor-agent login with NO_OPEN_BROWSER to capture URL
    // Use timeout since login command waits for user authentication
    const result = await runCliCommandWithTimeout(binaryPath, ["login"], 5000, {
      NO_OPEN_BROWSER: "1",
    })
    
    console.log("[CLI Auth] Cursor login output:", result.stdout, result.stderr, "timedOut:", result.timedOut)
    
    // Extract OAuth URL from output
    const combinedOutput = result.stdout + "\n" + result.stderr
    const oauthUrl = extractOAuthUrl(combinedOutput)
    
    if (oauthUrl) {
      return { oauthUrl, needsManualAuth: false }
    }
    
    // If no URL found, user might already be logged in or needs manual auth
    if (combinedOutput.toLowerCase().includes("already logged in") || 
        combinedOutput.toLowerCase().includes("authenticated")) {
      return { oauthUrl: null, needsManualAuth: false, alreadyAuthenticated: true }
    }
    
    // Fallback: open the login flow normally and let it handle browser
    return { oauthUrl: null, needsManualAuth: true }
  }),

  /**
   * Start GitHub Copilot OAuth flow
   */
  startCopilotAuth: publicProcedure.mutation(async () => {
    console.log("[CLI Auth] Starting Copilot login flow...")
    
    // Check if user already has GitHub auth via gh CLI
    try {
      const ghStatus = await runCliCommand("gh", ["auth", "status"])
      console.log("[CLI Auth] gh auth status:", ghStatus.stdout, ghStatus.stderr)
      
      if (ghStatus.exitCode === 0 && !ghStatus.stderr.includes("not logged in")) {
        // User is authenticated with GitHub
        return { oauthUrl: null, needsManualAuth: false, alreadyAuthenticated: true }
      }
    } catch {
      // gh not installed, continue with manual flow
    }
    
    // Check if copilot config has logged_in_users
    const configPath = `${process.env.HOME}/.copilot/config.json`
    try {
      const config = JSON.parse(await fs.readFile(configPath, "utf-8"))
      if (config.logged_in_users && config.logged_in_users.length > 0) {
        return { oauthUrl: null, needsManualAuth: false, alreadyAuthenticated: true }
      }
    } catch {
      // Config doesn't exist or parse error, continue
    }
    
    // For GitHub Copilot, use gh auth login with device flow
    // This works whether or not the user has copilot CLI installed
    return { 
      oauthUrl: "https://github.com/login/device",
      needsManualAuth: true,
      message: "Sign in with your GitHub account to use Copilot"
    }
  }),

  /**
   * Start OpenAI Codex OAuth flow
   */
  startCodexAuth: publicProcedure.mutation(async () => {
    console.log("[CLI Auth] Starting Codex auth flow...")
    
    // Try to find codex CLI
    const codexPaths = [
      "/usr/local/bin/codex",
      "/opt/homebrew/bin/codex",
      `${process.env.HOME}/.local/bin/codex`,
    ]
    
    let codexPath = ""
    for (const p of codexPaths) {
      if (existsSync(p)) {
        codexPath = p
        break
      }
    }
    
    if (!codexPath) {
      // Codex not installed - provide OpenAI API key page
      return { 
        oauthUrl: "https://platform.openai.com/api-keys",
        needsManualAuth: true,
        installInstructions: "Install OpenAI Codex: npm i -g @openai/codex"
      }
    }
    
    // Run codex auth
    const result = await runCliCommand(codexPath, ["auth"])
    
    console.log("[CLI Auth] Codex auth output:", result.stdout, result.stderr)
    
    const combinedOutput = result.stdout + "\n" + result.stderr
    const oauthUrl = extractOAuthUrl(combinedOutput)
    
    if (oauthUrl) {
      return { oauthUrl, needsManualAuth: false }
    }
    
    // Default to OpenAI API keys page
    return { 
      oauthUrl: "https://platform.openai.com/api-keys",
      needsManualAuth: true 
    }
  }),

  /**
   * Open URL in default browser
   */
  openAuthUrl: publicProcedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ input }) => {
      await shell.openExternal(input.url)
      return { success: true }
    }),

  /**
   * Check if CLI is authenticated
   */
  checkAuthStatus: publicProcedure
    .input(z.object({ cli: z.enum(["cursor", "copilot", "codex"]) }))
    .query(async ({ input }) => {
      const { cli } = input
      
      try {
        if (cli === "cursor") {
          const binaryPath = getCursorAgentPath()
          const result = await runCliCommand(binaryPath, ["status"])
          const isAuthenticated = result.exitCode === 0 && 
            !result.stdout.toLowerCase().includes("not logged in") &&
            !result.stderr.toLowerCase().includes("not logged in")
          return { isAuthenticated }
        }
        
        if (cli === "copilot") {
          // Check copilot config for logged in users
          const configPath = `${process.env.HOME}/.copilot/config.json`
          try {
            const config = JSON.parse(await fs.readFile(configPath, "utf-8"))
            if (config.logged_in_users && config.logged_in_users.length > 0) {
              return { isAuthenticated: true }
            }
          } catch {
            // Config doesn't exist or parse error
          }
          
          // Also check gh auth status
          try {
            const ghStatus = await runCliCommand("gh", ["auth", "status"])
            if (ghStatus.exitCode === 0) {
              return { isAuthenticated: true }
            }
          } catch {
            // gh not available
          }
          
          return { isAuthenticated: false }
        }
        
        if (cli === "codex") {
          // Codex uses OPENAI_API_KEY
          const hasKey = !!process.env.OPENAI_API_KEY
          return { isAuthenticated: hasKey }
        }
        
        return { isAuthenticated: false }
      } catch {
        return { isAuthenticated: false }
      }
    }),

  /**
   * Run the full login flow (opens browser)
   */
  runLoginFlow: publicProcedure
    .input(z.object({ cli: z.enum(["cursor", "copilot", "codex"]) }))
    .mutation(async ({ input }) => {
      const { cli } = input
      
      if (cli === "cursor") {
        const binaryPath = getCursorAgentPath()
        // Run login without NO_OPEN_BROWSER - let it open browser
        spawn(binaryPath, ["login"], {
          detached: true,
          stdio: "ignore",
        }).unref()
        return { started: true }
      }
      
      if (cli === "copilot") {
        // For Copilot, open GitHub device flow directly
        await shell.openExternal("https://github.com/login/device")
        return { started: true }
      }
      
      if (cli === "codex") {
        // For Codex, open OpenAI API keys page
        await shell.openExternal("https://platform.openai.com/api-keys")
        return { started: true }
      }
      
      return { started: false }
    }),
})
