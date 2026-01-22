/**
 * CLI Adapter Provider
 *
 * Provides skills from installed CLI tools (ralphy, cursor, claude-code, etc.)
 * Discovers and wraps CLI tools as skill providers.
 */

import type { SkillProvider, Skill, SkillOperation } from "../types"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

// Known CLI tools and their configurations
const KNOWN_CLIS = [
  {
    id: "ralphy",
    name: "Ralphy",
    command: "ralphy",
    description: "Ralphy AI CLI assistant",
    operations: ["chat", "run", "plan"],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    description: "Anthropic Claude CLI agent",
    operations: ["chat", "run"],
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor",
    description: "Cursor AI CLI",
    operations: ["chat", "composer"],
  },
  {
    id: "amp",
    name: "Amp",
    command: "amp",
    description: "Sourcegraph Amp CLI",
    operations: ["chat", "run"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    description: "Open source CLI agent",
    operations: ["chat", "run"],
  },
  {
    id: "droid",
    name: "Droid",
    command: "droid",
    description: "Droid CLI assistant",
    operations: ["chat", "run"],
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    description: "AI pair programming CLI",
    operations: ["chat", "architect"],
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    description: "OpenAI Codex CLI",
    operations: ["run"],
  },
] as const

type KnownCliId = (typeof KNOWN_CLIS)[number]["id"]

/**
 * CLI Skill Provider Implementation
 */
export class CliSkillProvider implements SkillProvider {
  id = "cli-adapter"
  name = "CLI Adapter"
  description = "Provides skills from installed CLI tools"
  version = "1.0.0"

  private installedClis: Map<string, (typeof KNOWN_CLIS)[number]> = new Map()
  private initialized = false

  /**
   * Check if a CLI command is installed
   */
  private async isCliInstalled(command: string): Promise<boolean> {
    try {
      await execAsync(`which ${command}`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Initialize the provider by discovering installed CLIs
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const checks = KNOWN_CLIS.map(async (cli) => {
      const installed = await this.isCliInstalled(cli.command)
      if (installed) {
        this.installedClis.set(cli.id, cli)
      }
    })

    await Promise.all(checks)
    this.initialized = true
  }

  /**
   * Check if provider is available (has at least one CLI installed)
   */
  async isInstalled(): Promise<boolean> {
    await this.initialize()
    return this.installedClis.size > 0
  }

  /**
   * Discover available skills from installed CLIs
   */
  async discover(): Promise<Skill[]> {
    await this.initialize()

    const skills: Skill[] = []

    this.installedClis.forEach((cli, id) => {
      const operations: SkillOperation[] = cli.operations.map((op) => ({
        name: op,
        description: `Execute ${cli.name} ${op} command`,
        parameters: {
          prompt: {
            type: "string" as const,
            description: "The prompt or input for the CLI",
            required: true,
          },
          args: {
            type: "array" as const,
            description: "Additional command arguments",
            required: false,
          },
          cwd: {
            type: "string" as const,
            description: "Working directory",
            required: false,
          },
        },
      }))

      skills.push({
        id: `cli-${id}`,
        name: cli.name,
        description: cli.description,
        operations,
        category: "execution",
        mode: "agent",
        provider: this.id,
      })
    })

    return skills
  }

  /**
   * Invoke a CLI skill
   */
  async invoke(
    skill: Skill,
    operation: string,
    input: Record<string, unknown>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cliId = skill.id.replace("cli-", "") as KnownCliId
    const cli = this.installedClis.get(cliId)

    if (!cli) {
      throw new Error(`CLI '${cliId}' is not installed`)
    }

    const prompt = input.prompt as string
    const args = (input.args as string[]) || []
    const cwd = input.cwd as string | undefined

    // Build command
    const escapedPrompt = prompt.replace(/"/g, '\\"')
    const argsStr = args.join(" ")
    const command = `${cli.command} ${operation} "${escapedPrompt}" ${argsStr}`.trim()

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: 300000, // 5 minute timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      })

      return {
        stdout,
        stderr,
        exitCode: 0,
      }
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: execError.stdout || "",
        stderr: execError.stderr || String(error),
        exitCode: execError.code || 1,
      }
    }
  }

  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    this.installedClis.clear()
    this.initialized = false
  }

  /**
   * Get list of installed CLI IDs
   */
  getInstalledClis(): string[] {
    return Array.from(this.installedClis.keys())
  }

  /**
   * Check if a specific CLI is installed
   */
  hasCliInstalled(cliId: string): boolean {
    return this.installedClis.has(cliId)
  }
}

// Export singleton instance
export const cliSkillProvider = new CliSkillProvider()
