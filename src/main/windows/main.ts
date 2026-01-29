import {
  BrowserWindow,
  shell,
  nativeTheme,
  ipcMain,
  app,
  clipboard,
  session,
} from "electron"
import { join } from "path"
import { createIPCHandler } from "trpc-electron/main"
import { createAppRouter } from "../lib/trpc/routers"
import { getAuthManager, handleAuthCode, getBaseUrl } from "../index"

// Register IPC handlers for window operations (only once)
let ipcHandlersRegistered = false

function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  if (ipcHandlersRegistered) return
  ipcHandlersRegistered = true

  // App info
  ipcMain.handle("app:version", () => app.getVersion())
  // Note: Update checking is now handled by auto-updater module (lib/auto-updater.ts)
  ipcMain.handle("app:set-badge", (_event, count: number | null) => {
    if (process.platform === "darwin") {
      app.dock.setBadge(count ? String(count) : "")
    }
  })
  ipcMain.handle(
    "app:show-notification",
    (_event, options: { title: string; body: string }) => {
      const { Notification } = require("electron")
      new Notification(options).show()
    },
  )

  // API base URL for fetch requests
  ipcMain.handle("app:get-api-base-url", () => getBaseUrl())

  // Window controls
  ipcMain.handle("window:minimize", () => getWindow()?.minimize())
  ipcMain.handle("window:maximize", () => {
    const win = getWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })
  ipcMain.handle("window:close", () => getWindow()?.close())
  ipcMain.handle(
    "window:is-maximized",
    () => getWindow()?.isMaximized() ?? false,
  )
  ipcMain.handle("window:toggle-fullscreen", () => {
    const win = getWindow()
    if (win) {
      win.setFullScreen(!win.isFullScreen())
    }
  })
  ipcMain.handle(
    "window:is-fullscreen",
    () => getWindow()?.isFullScreen() ?? false,
  )

  // Traffic light visibility control (for hybrid native/custom approach)
  ipcMain.handle(
    "window:set-traffic-light-visibility",
    (_event, visible: boolean) => {
      const win = getWindow()
      if (win && process.platform === "darwin") {
        // In fullscreen, always show native traffic lights (don't let React hide them)
        if (win.isFullScreen()) {
          win.setWindowButtonVisibility(true)
        } else {
          win.setWindowButtonVisibility(visible)
        }
      }
    },
  )

  // Zoom controls
  ipcMain.handle("window:zoom-in", () => {
    const win = getWindow()
    if (win) {
      const zoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.min(zoom + 0.1, 3))
    }
  })
  ipcMain.handle("window:zoom-out", () => {
    const win = getWindow()
    if (win) {
      const zoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.max(zoom - 0.1, 0.5))
    }
  })
  ipcMain.handle("window:zoom-reset", () => {
    getWindow()?.webContents.setZoomFactor(1)
  })
  ipcMain.handle(
    "window:get-zoom",
    () => getWindow()?.webContents.getZoomFactor() ?? 1,
  )

  // DevTools
  ipcMain.handle("window:toggle-devtools", () => {
    const win = getWindow()
    if (win) {
      win.webContents.toggleDevTools()
    }
  })

  // Analytics
  ipcMain.handle("analytics:set-opt-out", async (_event, optedOut: boolean) => {
    const { setOptOut } = await import("../lib/analytics")
    setOptOut(optedOut)
  })

  // Shell
  ipcMain.handle("shell:open-external", (_event, url: string) =>
    shell.openExternal(url),
  )

  // Clipboard
  ipcMain.handle("clipboard:write", (_event, text: string) =>
    clipboard.writeText(text),
  )
  ipcMain.handle("clipboard:read", () => clipboard.readText())

  // Auth IPC handlers
  const validateSender = (event: Electron.IpcMainInvokeEvent): boolean => {
    const senderUrl = event.sender.getURL()
    try {
      const parsed = new URL(senderUrl)
      if (parsed.protocol === "file:") return true
      const hostname = parsed.hostname.toLowerCase()
      const trusted = ["21st.dev", "localhost", "127.0.0.1"]
      return trusted.some((h) => hostname === h || hostname.endsWith(`.${h}`))
    } catch {
      return false
    }
  }

  ipcMain.handle("auth:get-user", (event) => {
    if (!validateSender(event)) return null
    return getAuthManager().getUser()
  })

  ipcMain.handle("auth:is-authenticated", (event) => {
    if (!validateSender(event)) return false
    return getAuthManager().isAuthenticated()
  })

  ipcMain.handle("auth:logout", async (event) => {
    if (!validateSender(event)) return
    getAuthManager().logout()
    // Clear cookie from persist:main partition
    const ses = session.fromPartition("persist:main")
    try {
      await ses.cookies.remove(getBaseUrl(), "x-desktop-token")
      console.log("[Auth] Cookie cleared on logout")
    } catch (err) {
      console.error("[Auth] Failed to clear cookie:", err)
    }
    showLoginPage()
  })

  ipcMain.handle("auth:start-flow", (event) => {
    if (!validateSender(event)) return
    getAuthManager().startAuthFlow(getWindow())
  })

  ipcMain.handle("auth:submit-code", async (event, code: string) => {
    if (!validateSender(event)) return
    if (!code || typeof code !== "string") {
      getWindow()?.webContents.send("auth:error", "Invalid authorization code")
      return
    }
    await handleAuthCode(code)
  })

  // API key management
  ipcMain.handle("auth:get-api-keys", (event) => {
    if (!validateSender(event)) return {}
    try {
      const { AuthStore } = require("../auth-store")
      const authStore = new AuthStore(app.getPath("userData"))
      const authData = authStore.load()
      return {
        ampApiKey: authData?.ampApiKey || "",
      }
    } catch (error) {
      console.error("Failed to get API keys:", error)
      return {}
    }
  })

  ipcMain.handle("auth:set-api-key", async (event, service: string, apiKey: string) => {
    if (!validateSender(event)) return
    if (!service || !apiKey || typeof service !== "string" || typeof apiKey !== "string") {
      throw new Error("Invalid service or API key")
    }

    try {
      const { AuthStore } = require("../auth-store")
      const authStore = new AuthStore(app.getPath("userData"))
      const currentData = authStore.load() || {}

      // Update the specific API key
      if (service === "amp") {
        currentData.ampApiKey = apiKey
      }

      // Save back to store
      authStore.save(currentData)
      console.log(`[Auth] Saved ${service} API key`)
    } catch (error) {
      console.error(`Failed to save ${service} API key:`, error)
      throw error
    }
  })

  ipcMain.handle("auth:test-api-key", async (event, service: string, apiKey: string) => {
    if (!validateSender(event)) return { success: false, error: "Invalid request" }
    if (!service || !apiKey || typeof service !== "string" || typeof apiKey !== "string") {
      return { success: false, error: "Invalid service or API key" }
    }

    try {
      if (service === "amp") {
        // For AMP, we can do a simple test by trying to run a basic command
        // Since AMP requires authentication, we'll check if the API key is set properly
        const { spawn } = require("child_process")
        const testProc = spawn("amp", ["--help"], {
          env: { ...process.env, AMP_API_KEY: apiKey },
          timeout: 5000,
        })

        return new Promise((resolve) => {
          testProc.on("close", (code: number) => {
            // If it exits with 0, the API key is likely valid (help command worked)
            resolve({ success: code === 0 })
          })
          testProc.on("error", () => {
            resolve({ success: false, error: "Failed to execute AMP command" })
          })
        })
      }

      return { success: false, error: "Unknown service" }
    } catch (error) {
      console.error(`Failed to test ${service} API key:`, error)
      return { success: false, error: "Test failed" }
    }
  })

  // CLI login flow - opens browser for OAuth authentication
  ipcMain.handle("cli:open-login-flow", async (event, cli: string) => {
    if (!validateSender(event)) return

    const { spawn } = require("child_process")
    
    // CLI-specific login commands that open browser for OAuth
    const loginCommands: Record<string, { cmd: string; args: string[] }> = {
      amp: { cmd: "amp", args: ["login"] },
      droid: { cmd: "droid", args: [] }, // droid interactive mode handles login
      cursor: { cmd: "cursor", args: ["--login"] },
      opencode: { cmd: "opencode", args: ["auth", "login"] },
    }

    const config = loginCommands[cli]
    if (!config) {
      console.error(`[CLI] Unknown CLI for login: ${cli}`)
      return
    }

    console.log(`[CLI] Starting login flow for ${cli}`)

    // Spawn the login command - it will open a browser for OAuth
    const proc = spawn(config.cmd, config.args, {
      env: { ...process.env },
      stdio: "ignore", // Don't capture output, let it do its thing
      detached: true, // Run independently
    })

    // Don't wait for the process - it opens browser and may stay running
    proc.unref()
  })

  // CLI command runner - for checking auth status
  ipcMain.handle("cli:run-command", async (event, command: string) => {
    if (!validateSender(event)) return { exitCode: 1, stdout: "", stderr: "Invalid request" }

    const { exec } = require("child_process")
    const { promisify } = require("util")
    const execAsync = promisify(exec)

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 10000, // 10 second timeout
        env: { ...process.env },
      })
      return { exitCode: 0, stdout: stdout || "", stderr: stderr || "" }
    } catch (error: any) {
      return {
        exitCode: error.code || 1,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || "",
      }
    }
  })
}

// Current window reference
let currentWindow: BrowserWindow | null = null

/**
 * Show login page
 */
export function showLoginPage(): void {
  if (!currentWindow) return
  console.log("[Main] Showing login page")

  // In dev mode, login.html is in src/renderer, not out/renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    // Dev mode: load from source directory
    const loginPath = join(app.getAppPath(), "src/renderer/login.html")
    console.log("[Main] Loading login from:", loginPath)
    currentWindow.loadFile(loginPath)
  } else {
    // Production: load from built output
    currentWindow.loadFile(join(__dirname, "../renderer/login.html"))
  }
}

// Singleton IPC handler (prevents duplicate handlers on macOS window recreation)
let ipcHandler: ReturnType<typeof createIPCHandler> | null = null

/**
 * Get the current window reference
 * Used by tRPC procedures that need window access
 */
export function getWindow(): BrowserWindow | null {
  return currentWindow
}

/**
 * Create the main application window
 */
export function createMainWindow(): BrowserWindow {
  // Register IPC handlers before creating window
  registerIpcHandlers(getWindow)

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 500, // Allow narrow mobile-like mode
    minHeight: 600,
    show: false,
    title: "1Code",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff",
    // hiddenInset shows native traffic lights inset in the window
    // Start with traffic lights off-screen (custom ones shown in normal mode)
    // Native lights will be moved on-screen in fullscreen mode
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 15, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for electron-trpc
      webSecurity: true,
      partition: "persist:main", // Use persistent session for cookies
    },
  })

  // Update current window reference
  currentWindow = window

  // Setup tRPC IPC handler (singleton pattern)
  if (ipcHandler) {
    // Reuse existing handler, just attach new window
    ipcHandler.attachWindow(window)
  } else {
    // Create new handler with context
    ipcHandler = createIPCHandler({
      router: createAppRouter(getWindow),
      windows: [window],
      createContext: async () => ({
        getWindow,
      }),
    })
  }

  // Show window when ready
  window.on("ready-to-show", () => {
    console.log("[Main] Window ready to show")
    // Ensure native traffic lights are visible by default (login page, loading states)
    if (process.platform === "darwin") {
      window.setWindowButtonVisibility(true)
    }
    window.show()
  })

  // Emit fullscreen change events and manage traffic lights
  window.on("enter-full-screen", () => {
    // Always show native traffic lights in fullscreen
    if (process.platform === "darwin") {
      window.setWindowButtonVisibility(true)
    }
    window.webContents.send("window:fullscreen-change", true)
  })
  window.on("leave-full-screen", () => {
    // Show native traffic lights when exiting fullscreen (TrafficLights component will manage after mount)
    if (process.platform === "darwin") {
      window.setWindowButtonVisibility(true)
    }
    window.webContents.send("window:fullscreen-change", false)
  })

  // Emit focus change events
  window.on("focus", () => {
    window.webContents.send("window:focus-change", true)
  })
  window.on("blur", () => {
    window.webContents.send("window:focus-change", false)
  })

  // Handle external links
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // Handle window close
  window.on("closed", () => {
    currentWindow = null
  })

  // Load the renderer - no auth gate, app is local-first
  const devServerUrl = process.env.ELECTRON_RENDERER_URL

  console.log("[Main] Loading app (no auth gate)")
  if (devServerUrl) {
    window.loadURL(devServerUrl)
    window.webContents.openDevTools()
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"))
  }

  // Ensure traffic lights are visible after page load (covers reload/Cmd+R case)
  window.webContents.on("did-finish-load", () => {
    console.log("[Main] Page finished loading")
    if (process.platform === "darwin") {
      window.setWindowButtonVisibility(true)
    }
  })
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[Main] Page failed to load:", errorCode, errorDescription)
    },
  )

  return window
}
