/**
 * Status Transition Logic
 *
 * Manages valid status transitions and provides validation utilities.
 */

import type { Status } from "./types"

// Valid status transitions map
const VALID_TRANSITIONS: Record<Status, Status[]> = {
  todo: ["ongoing"],
  ongoing: ["review", "done", "todo"], // can go back to todo if blocked
  review: ["done", "ongoing"], // can go back to ongoing if needs changes
  done: [], // terminal state
}

// Status metadata
const STATUS_INFO: Record<Status, { label: string; color: string; icon: string }> = {
  todo: { label: "To Do", color: "gray", icon: "circle" },
  ongoing: { label: "In Progress", color: "blue", icon: "play-circle" },
  review: { label: "In Review", color: "yellow", icon: "eye" },
  done: { label: "Done", color: "green", icon: "check-circle" },
}

/**
 * Check if a status transition is valid
 */
export function isValidTransition(from: Status, to: Status): boolean {
  if (from === to) return true // Same status is always valid
  return VALID_TRANSITIONS[from].includes(to)
}

/**
 * Get all valid next statuses from current status
 */
export function getNextStatuses(current: Status): Status[] {
  return VALID_TRANSITIONS[current]
}

/**
 * Check if status is a terminal state
 */
export function isTerminalStatus(status: Status): boolean {
  return VALID_TRANSITIONS[status].length === 0
}

/**
 * Check if status represents active work
 */
export function isActiveStatus(status: Status): boolean {
  return status === "ongoing" || status === "review"
}

/**
 * Get status info (label, color, icon)
 */
export function getStatusInfo(status: Status): { label: string; color: string; icon: string } {
  return STATUS_INFO[status]
}

/**
 * Validate a status value
 */
export function isValidStatus(value: string): value is Status {
  return ["todo", "ongoing", "review", "done"].includes(value)
}

/**
 * Attempt a status transition, returns the new status or throws
 */
export function transitionStatus(from: Status, to: Status): Status {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid status transition from '${from}' to '${to}'`)
  }
  return to
}

/**
 * Get all statuses in order
 */
export function getAllStatuses(): Status[] {
  return ["todo", "ongoing", "review", "done"]
}

/**
 * Calculate completion percentage based on status
 */
export function getStatusProgress(status: Status): number {
  switch (status) {
    case "todo":
      return 0
    case "ongoing":
      return 33
    case "review":
      return 66
    case "done":
      return 100
  }
}
