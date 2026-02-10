/**
 * Generate a unique ID (cuid-like)
 */
export function createId(): string {
  const timestamp = Date.now().toString(36)
  const randomPart = Math.random().toString(36).substring(2, 10)
  return `${timestamp}${randomPart}`
}

/**
 * Helper to format timestamp for display
 * @param date - Date object or timestamp
 * @returns ISO string
 */
export function formatTimestamp(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date
  return d.toISOString()
}
