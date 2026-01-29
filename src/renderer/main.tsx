// Only initialize Sentry in production to avoid IPC errors in dev mode
if (import.meta.env.PROD) {
  import("@sentry/electron/renderer").then((Sentry) => {
    Sentry.init()
  })
}

import ReactDOM from "react-dom/client"
import { App } from "./App"
import "./styles/globals.css"
import { preloadDiffHighlighter } from "./lib/themes/diff-view-highlighter"

console.log("[main.tsx] Script starting...")

// Preload shiki highlighter for diff view (prevents delay when opening diff sidebar)
preloadDiffHighlighter()

// Suppress ResizeObserver loop error - this is a non-fatal browser warning
// that can occur when layout changes trigger observation callbacks
// Common with virtualization libraries and diff viewers
const resizeObserverErr = /ResizeObserver loop/

// Handle both error event and unhandledrejection
window.addEventListener("error", (e) => {
  if (e.message && resizeObserverErr.test(e.message)) {
    e.stopImmediatePropagation()
    e.preventDefault()
    return false
  }
})

// Also override window.onerror for broader coverage
const originalOnError = window.onerror
window.onerror = (message, source, lineno, colno, error) => {
  if (typeof message === "string" && resizeObserverErr.test(message)) {
    return true // Suppress the error
  }
  if (originalOnError) {
    return originalOnError(message, source, lineno, colno, error)
  }
  return false
}

const rootElement = document.getElementById("root")
console.log("[main.tsx] Root element found:", !!rootElement)

if (rootElement) {
  console.log("[main.tsx] Creating React root...")
  try {
    const root = ReactDOM.createRoot(rootElement)
    console.log("[main.tsx] Rendering App...")
    root.render(<App />)
    console.log("[main.tsx] App rendered!")
  } catch (error) {
    console.error("[main.tsx] Failed to render App:", error)
    // Show error in DOM
    rootElement.innerHTML = `<div style="padding: 20px; color: red;">Failed to start: ${error}</div>`
  }
} else {
  console.error("[main.tsx] Root element not found!")
}
