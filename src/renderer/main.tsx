// Only initialize Sentry in production to avoid IPC errors in dev mode
if (import.meta.env.PROD) {
  import("@sentry/electron/renderer").then((Sentry) => {
    Sentry.init()
  })
}

import ReactDOM from "react-dom/client"
import { App } from "./App"
import "./styles/globals.css"

console.log("[main.tsx] Script starting...")
// #region agent log
fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sessionId: "debug-session",
    runId: "pre-fix",
    hypothesisId: "H0",
    location: "main.tsx:startup",
    message: "Renderer script start",
    data: {},
    timestamp: Date.now(),
  }),
}).catch(() => {})
// #endregion

// Skip diff highlighter preload to avoid main-thread cost during startup.

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
// #region agent log
fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sessionId: "debug-session",
    runId: "pre-fix",
    hypothesisId: "H0",
    location: "main.tsx:root-element",
    message: "Renderer root element",
    data: { found: !!rootElement },
    timestamp: Date.now(),
  }),
}).catch(() => {})
// #endregion

if (rootElement) {
  console.log("[main.tsx] Creating React root...")
  try {
    const root = ReactDOM.createRoot(rootElement)
    console.log("[main.tsx] Rendering App...")
    root.render(<App />)
    console.log("[main.tsx] App rendered!")
    // #region agent log
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 50) continue
          fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: "debug-session",
              runId: "pre-fix",
              hypothesisId: "H6",
              location: "main.tsx:longtask",
              message: "Renderer long task",
              data: {
                name: entry.name,
                durationMs: Math.round(entry.duration),
                startTimeMs: Math.round(entry.startTime),
                entryType: entry.entryType,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {})
        }
      })
      longTaskObserver.observe({ entryTypes: ["longtask"] })
    } catch {
      // Ignore if PerformanceObserver or longtask entries are unsupported
    }
    // #endregion
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/83cfda58-76b2-4ee9-ad45-47baf28861df", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "debug-session",
        runId: "pre-fix",
        hypothesisId: "H0",
        location: "main.tsx:render",
        message: "Renderer app rendered",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
  } catch (error) {
    console.error("[main.tsx] Failed to render App:", error)
    // Show error in DOM
    rootElement.innerHTML = `<div style="padding: 20px; color: red;">Failed to start: ${error}</div>`
  }
} else {
  console.error("[main.tsx] Root element not found!")
}
