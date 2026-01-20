import type { CliAdapter, CliAdapterRegistry } from "./types"

/** Adapter registry (populated on init) */
const adapters: CliAdapterRegistry = new Map()

/**
 * Register a CLI adapter
 */
export function registerAdapter(adapter: CliAdapter): void {
  adapters.set(adapter.id, adapter)
}

/**
 * Get a CLI adapter by ID
 */
export function getAdapter(cli: string): CliAdapter | undefined {
  return adapters.get(cli)
}

/**
 * Get all registered adapters
 */
export function getAllAdapters(): CliAdapter[] {
  return Array.from(adapters.values())
}

/**
 * Check which CLIs are available
 */
export async function getAvailableClis(): Promise<string[]> {
  const available: string[] = []
  for (const [id, adapter] of adapters) {
    if (await adapter.isAvailable()) {
      available.push(id)
    }
  }
  return available
}
