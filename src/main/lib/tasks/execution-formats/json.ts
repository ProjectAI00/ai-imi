/**
 * JSON Execution Format
 *
 * Serializes execution payloads to pretty-printed JSON format.
 */

import type { ExecutionPayload } from "./types"

/**
 * Serialize an ExecutionPayload to pretty-printed JSON format
 */
export function toJson(payload: ExecutionPayload): string {
  // Remove undefined values for cleaner output
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  )
  return JSON.stringify(cleanPayload, null, 2)
}
