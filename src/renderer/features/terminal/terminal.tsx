import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { Terminal as XTerm } from "xterm"
import type { FitAddon } from "@xterm/addon-fit"
import type { SearchAddon } from "@xterm/addon-search"
import type { SerializeAddon } from "@xterm/addon-serialize"
import { useTheme } from "next-themes"
import { useSetAtom, useAtomValue } from "jotai"
import { trpc } from "@/lib/trpc"
import { terminalCwdAtom } from "./atoms"
import { fullThemeDataAtom } from "@/lib/atoms"
import {
  createTerminalInstance,
  getDefaultTerminalBg,
  setupClickToMoveCursor,
  setupFocusListener,
  setupKeyboardHandler,
  setupPasteHandler,
  setupResizeHandlers,
} from "./helpers"
import { getTerminalTheme, getTerminalThemeFromVSCode } from "./config"
import { parseCwd } from "./parseCwd"
import { sanitizeForTitle } from "./commandBuffer"
import { shellEscapePaths } from "./utils"
import { TerminalSearch } from "./TerminalSearch"
import type { TerminalProps, TerminalStreamEvent } from "./types"
import "xterm/css/xterm.css"

export function Terminal({
  paneId,
  cwd,
  workspaceId,
  tabId,
  initialCommands,
  initialCwd,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const serializeAddonRef = useRef<SerializeAddon | null>(null)
  const isExitedRef = useRef(false)
  const commandBufferRef = useRef("")

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [terminalCwd, setTerminalCwd] = useState<string | null>(
    initialCwd || cwd,
  )
  const setGlobalCwds = useSetAtom(terminalCwdAtom)

  // Theme detection
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  
  // VS Code theme data (if a full theme is selected)
  const fullThemeData = useAtomValue(fullThemeDataAtom)

  // Ref for terminalCwd to avoid effect re-runs when cwd changes
  const terminalCwdRef = useRef(terminalCwd)
  terminalCwdRef.current = terminalCwd

  // Ref for paneId to use in callbacks
  const paneIdRef = useRef(paneId)
  paneIdRef.current = paneId

  // Lazy mutation refs - mutations are created on first use, not on mount
  // This avoids creating 5 tRPC subscriptions immediately on component mount
  const trpcClient = trpc.useUtils().client
  
  // Store trpcClient in a ref to make lazy getters truly stable
  const trpcClientRef = useRef(trpcClient)
  trpcClientRef.current = trpcClient
  
  const createOrAttachRef = useRef<typeof trpcClient.terminal.createOrAttach.mutate | null>(null)
  const writeRef = useRef<typeof trpcClient.terminal.write.mutate | null>(null)
  const resizeRef = useRef<typeof trpcClient.terminal.resize.mutate | null>(null)
  const detachRef = useRef<typeof trpcClient.terminal.detach.mutate | null>(null)
  const clearScrollbackRef = useRef<typeof trpcClient.terminal.clearScrollback.mutate | null>(null)
  
  // Lazy getters that initialize mutations on first call (stable with empty deps)
  const getCreateOrAttach = useCallback(() => {
    if (!createOrAttachRef.current) {
      createOrAttachRef.current = trpcClientRef.current.terminal.createOrAttach.mutate
    }
    return createOrAttachRef.current
  }, [])
  
  const getWrite = useCallback(() => {
    if (!writeRef.current) {
      writeRef.current = trpcClientRef.current.terminal.write.mutate
    }
    return writeRef.current
  }, [])
  
  const getResize = useCallback(() => {
    if (!resizeRef.current) {
      resizeRef.current = trpcClientRef.current.terminal.resize.mutate
    }
    return resizeRef.current
  }, [])
  
  const getDetach = useCallback(() => {
    if (!detachRef.current) {
      detachRef.current = trpcClientRef.current.terminal.detach.mutate
    }
    return detachRef.current
  }, [])
  
  const getClearScrollback = useCallback(() => {
    if (!clearScrollbackRef.current) {
      clearScrollbackRef.current = trpcClientRef.current.terminal.clearScrollback.mutate
    }
    return clearScrollbackRef.current
  }, [])

  // Parse terminal data for cwd (OSC 7 sequences)
  const updateCwdFromData = useCallback(
    (data: string) => {
      const parsedCwd = parseCwd(data)
      if (parsedCwd !== null) {
        console.log("[Terminal] Parsed cwd from OSC-7:", parsedCwd)
        setTerminalCwd(parsedCwd)
        // Also update global atom for the tabs to show
        setGlobalCwds((prev) => ({
          ...prev,
          [paneIdRef.current]: parsedCwd,
        }))
      }
    },
    [setGlobalCwds],
  )

  const updateCwdRef = useRef(updateCwdFromData)
  updateCwdRef.current = updateCwdFromData

  // Handle stream data
  const handleStreamData = useCallback((event: TerminalStreamEvent) => {
    if (!xtermRef.current) return

    if (event.type === "data" && event.data) {
      xtermRef.current.write(event.data)
      updateCwdRef.current(event.data)
    } else if (event.type === "exit") {
      isExitedRef.current = true
      xtermRef.current.writeln(
        `\r\n\r\n[Process exited with code ${event.exitCode}]`,
      )
      xtermRef.current.writeln("[Press any key to restart]")
    }
  }, [])

  // Subscribe to terminal output
  trpc.terminal.stream.useSubscription(paneId, {
    onData: handleStreamData,
    onError: (err) => {
      console.error("[Terminal] Stream error:", err)
      xtermRef.current?.write(
        `\r\n\x1b[31m[Connection error: ${err.message}]\x1b[0m\r\n`,
      )
    },
    enabled: true,
  })

  // Initialize terminal
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    console.log("[Terminal:useEffect] MOUNT - paneId:", paneId)
    console.log(
      "[Terminal:useEffect] Container rect:",
      container.getBoundingClientRect(),
    )

    let isUnmounted = false

    // Create xterm instance
    console.log("[Terminal:useEffect] Creating terminal instance...", {
      isDark,
    })
    const { xterm, fitAddon, serializeAddon, cleanup } = createTerminalInstance(
      container,
      {
        cwd: terminalCwdRef.current || cwd,
        isDark,
        onFileLinkClick: (path, line, column) => {
          console.log("[Terminal] File link clicked:", path, line, column)
          // TODO: Open file in editor
        },
        onUrlClick: (url) => {
          console.log("[Terminal] URL clicked:", url)
          window.desktopApi.openExternal(url)
        },
      },
    )

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    serializeAddonRef.current = serializeAddon
    isExitedRef.current = false

    // Lazy load search addon
    import("@xterm/addon-search").then(({ SearchAddon }) => {
      if (isUnmounted || !xtermRef.current) return
      const searchAddon = new SearchAddon()
      xtermRef.current.loadAddon(searchAddon)
      searchAddonRef.current = searchAddon
    })

    // Apply serialized state from server
    const applySerializedState = (serializedState: string) => {
      if (serializedState) {
        xterm.write(serializedState)
      }
    }

    // Restart terminal after exit
    const restartTerminal = () => {
      isExitedRef.current = false
      xterm.clear()
      getCreateOrAttach()(
        {
          paneId,
          tabId,
          workspaceId,
          cols: xterm.cols,
          rows: xterm.rows,
          cwd: terminalCwdRef.current || cwd,
        },
      ).then((result) => {
        applySerializedState(result.serializedState)
      }).catch((err) => {
        console.error("[Terminal] Failed to restart terminal:", err)
        xterm.write(
          `\x1b[31m[Failed to restart terminal: ${err.message}]\x1b[0m\r\n`,
        )
        xterm.writeln("[Press any key to try again]")
        isExitedRef.current = true
      })
    }

    // Input handler
    const handleTerminalInput = (data: string) => {
      if (isExitedRef.current) {
        restartTerminal()
        return
      }
      getWrite()({ paneId, data })
    }

    // Key handler for command buffer (tab title)
    const handleKeyPress = (event: {
      key: string
      domEvent: KeyboardEvent
    }) => {
      const { domEvent } = event
      if (domEvent.key === "Enter") {
        const title = sanitizeForTitle(commandBufferRef.current)
        if (title) {
          // TODO: Set tab title
        }
        commandBufferRef.current = ""
      } else if (domEvent.key === "Backspace") {
        commandBufferRef.current = commandBufferRef.current.slice(0, -1)
      } else if (domEvent.key === "c" && domEvent.ctrlKey) {
        commandBufferRef.current = ""
      } else if (
        domEvent.key.length === 1 &&
        !domEvent.ctrlKey &&
        !domEvent.metaKey
      ) {
        commandBufferRef.current += domEvent.key
      }
    }

    // Create or attach to session
    getCreateOrAttach()(
      {
        paneId,
        tabId,
        workspaceId,
        cols: xterm.cols,
        rows: xterm.rows,
        cwd: initialCwd || cwd,
        initialCommands,
      },
    ).then((result) => {
      applySerializedState(result.serializedState)
      xterm.focus()
    }).catch((err) => {
      xterm.write(
        `\x1b[31m[Failed to start terminal: ${err.message}]\x1b[0m\r\n`,
      )
    })

    // Set up handlers
    const inputDisposable = xterm.onData(handleTerminalInput)
    const keyDisposable = xterm.onKey(handleKeyPress)

    const handleClear = () => {
      xterm.clear()
      getClearScrollback()({ paneId })
    }

    const handleWrite = (data: string) => {
      if (!isExitedRef.current) {
        getWrite()({ paneId, data })
      }
    }

    const cleanupKeyboard = setupKeyboardHandler(xterm, {
      onShiftEnter: () => handleWrite("\x1b\r"), // ESC + CR for line continuation
      onClear: handleClear,
    })

    const cleanupClickToMove = setupClickToMoveCursor(xterm, {
      onWrite: handleWrite,
    })

    const cleanupFocus = setupFocusListener(xterm, () => {
      // TODO: Set focused pane
    })

    const cleanupResize = setupResizeHandlers(
      container,
      xterm,
      fitAddon,
      (cols, rows) => {
        getResize()({ paneId, cols, rows })
      },
    )

    const cleanupPaste = setupPasteHandler(xterm, {
      onPaste: (text) => {
        commandBufferRef.current += text
      },
    })

    // Cleanup on unmount
    return () => {
      console.log("[Terminal:useEffect] UNMOUNT - paneId:", paneId)
      isUnmounted = true
      inputDisposable.dispose()
      keyDisposable.dispose()
      cleanupKeyboard()
      cleanupClickToMove()
      cleanupFocus?.()
      cleanupResize()
      cleanupPaste()
      cleanup()

      // Serialize terminal state before detaching
      console.log("[Terminal:useEffect] Serializing state before detach...")
      const serializedState = serializeAddon.serialize()

      // Detach instead of kill - keeps session alive for reattach
      getDetach()({ paneId, serializedState })

      console.log("[Terminal:useEffect] Disposing xterm...")
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      serializeAddonRef.current = null
      console.log("[Terminal:useEffect] UNMOUNT complete")
    }
    // Note: terminalCwd is accessed via ref to avoid remounting on cwd changes
    // Lazy getters are stable callbacks, no need to include in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, cwd, workspaceId, tabId, initialCwd, initialCommands, isDark, getCreateOrAttach, getWrite, getResize, getDetach, getClearScrollback])

  // Update theme when isDark changes or VS Code theme changes (without recreating terminal)
  useEffect(() => {
    if (xtermRef.current) {
      const newTheme = getTerminalThemeFromVSCode(fullThemeData?.colors, isDark)
      xtermRef.current.options.theme = newTheme
    }
  }, [isDark, fullThemeData])

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && e.metaKey && !e.shiftKey) {
        e.preventDefault()
        setIsSearchOpen((prev) => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Drag and drop files
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const files = Array.from(event.dataTransfer.files)
      if (files.length === 0) return

      // Get file paths (Electron exposes webUtils)
      const paths = files.map((file) => {
        // @ts-expect-error - Electron's webUtils API
        return window.webUtils?.getPathForFile?.(file) || file.name
      })
      const text = shellEscapePaths(paths)

      if (!isExitedRef.current) {
        writeRef.current({ paneId, data: text })
      }
    },
    [paneId],
  )

  const terminalBg = useMemo(() => {
    // Use VS Code theme terminal background if available
    if (fullThemeData?.colors?.["terminal.background"]) {
      return fullThemeData.colors["terminal.background"]
    }
    if (fullThemeData?.colors?.["editor.background"]) {
      return fullThemeData.colors["editor.background"]
    }
    return getDefaultTerminalBg(isDark)
  }, [isDark, fullThemeData])

  return (
    <div
      role="application"
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: terminalBg }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <TerminalSearch
        searchAddon={searchAddonRef.current}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ padding: "8px" }}
      />
    </div>
  )
}
