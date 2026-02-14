import { cn } from "../../../lib/utils"
import { ArrowUp, Loader2, Square } from "lucide-react"

interface AgentSendButtonProps {
  /** Whether the system is currently streaming */
  isStreaming?: boolean
  /** Whether the system is currently submitting/generating */
  isSubmitting?: boolean
  /** Whether the button should be disabled */
  disabled?: boolean
  /** Main click handler */
  onClick: () => void
  /** Optional stop handler for streaming state */
  onStop?: () => void
  /** Additional CSS classes */
  className?: string
  /** Whether this is plan mode (orange styling) */
  isPlanMode?: boolean
  /** Current chat mode for styling */
  chatMode?: "plan" | "agent" | "ask"
}

export function AgentSendButton({
  isStreaming = false,
  isSubmitting = false,
  disabled = false,
  onClick,
  onStop,
  className = "",
  isPlanMode = false,
  chatMode,
}: AgentSendButtonProps) {
  // Determine the actual click handler based on state
  const handleClick = () => {
    if (isStreaming && onStop) {
      onStop()
    } else {
      onClick()
    }
  }

  // Determine if button should be disabled
  const isDisabled = isStreaming ? false : disabled

  // Determine icon to show
  const getIcon = () => {
    if (isStreaming) {
      return <Square className="size-3 fill-current" />
    }
    if (isSubmitting) {
      return <Loader2 className="size-4 animate-spin" />
    }
    return <ArrowUp className="size-4" />
  }

  // Determine aria-label
  const getAriaLabel = () => {
    if (isStreaming) return "Stop generation"
    if (isSubmitting) return "Generating..."
    return "Send message"
  }

  // Apply glow effect when button is active and ready to send
  const shouldShowGlow = !isStreaming && !isSubmitting && !disabled

  const effectiveMode = chatMode || (isPlanMode ? "plan" : "agent")

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-label={getAriaLabel()}
      title={isStreaming ? "Stop (Esc)" : isSubmitting ? "Generating..." : "Send (Enter)"}
      className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center transition-all duration-150 ease-out active:scale-[0.97]",
        // Base styling
        "disabled:opacity-50 disabled:cursor-not-allowed",
        // Mode-specific styling
        effectiveMode === "plan"
          ? "bg-orange-500 hover:bg-orange-600 text-white"
          : effectiveMode === "ask"
          ? "bg-blue-500 hover:bg-blue-600 text-white"
          : "bg-foreground hover:bg-foreground/90 text-background",
        // Glow effect when ready
        shouldShowGlow && "shadow-[0_0_0_2px_white,0_0_0_4px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_2px_#1a1a1a,0_0_0_4px_rgba(255,255,255,0.08)]",
        className
      )}
    >
      {getIcon()}
    </button>
  )
}
