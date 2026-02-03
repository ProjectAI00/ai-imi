"use client"

import { Button } from "../../../components/ui/button"
import { IconSidebarToggle } from "../../../components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "../../../components/ui/tooltip"
import { Kbd } from "../../../components/ui/kbd"

interface AgentsHeaderControlsProps {
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  hasUnseenChanges?: boolean
  isSubChatsSidebarOpen?: boolean
}

export function AgentsHeaderControls({
  isSidebarOpen,
  onToggleSidebar,
  hasUnseenChanges = false,
  isSubChatsSidebarOpen = false,
}: AgentsHeaderControlsProps) {
  const label = isSidebarOpen ? "Close sidebar" : "Open sidebar"
  return (
    <TooltipProvider>
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="h-7 w-7 p-0 hover:bg-transparent text-foreground flex-shrink-0 rounded-none relative border-0 shadow-none"
            aria-label={label}
          >
            <IconSidebarToggle className="h-4 w-4 relative z-10" />
            {/* Unseen changes indicator */}
            {hasUnseenChanges && (
              <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-[#307BD0] ring-2 ring-background z-20" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {label}
          <Kbd>⌘\</Kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
