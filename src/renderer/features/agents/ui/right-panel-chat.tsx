import { useAtomValue } from "jotai"
import { useEffect, useRef } from "react"
import { ChatMarkdownRenderer } from "../../../components/chat-markdown-renderer"
import { selectedAgentChatIdAtom } from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { useChat } from "@ai-sdk/react"

/**
 * RightPanelChat - Displays the same conversation in the right panel
 * Mirrors the active chat but in a compact, read-only format
 */
export function RightPanelChat() {
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const { messages } = useChat({
    id: activeSubChatId || selectedChatId || "empty",
    experimental_throttle: 120,
  })
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [messages])

  if (!selectedChatId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No conversation selected
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No messages yet
      </div>
    )
  }

  return (
    <div
      ref={scrollContainerRef}
      className="h-full flex flex-col bg-background"
    >
      <div className="h-12 shrink-0 border-b border-border bg-background/80 backdrop-blur-sm" />
      <div
        className="flex-1 overflow-y-auto w-full outline-none"
        tabIndex={-1}
      >
        <div className="px-3 pb-4 space-y-4">
          {messages.map((message, idx) => (
            <div key={idx} className="space-y-2">
              {message.role === "user" ? (
                <div className="text-xs font-medium text-muted-foreground mb-1">You</div>
              ) : (
                <div className="text-xs font-medium text-muted-foreground mb-1">Assistant</div>
              )}
              {message.parts?.map((part: any, partIdx: number) => {
                if (part.type === "text" && part.text?.trim()) {
                  return (
                    <div key={partIdx} className="text-foreground">
                      <ChatMarkdownRenderer content={part.text} size="sm" />
                    </div>
                  )
                }
                return null
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
