/**
 * Shared model configurations for CLI adapters
 * 
 * This file centralizes AI model definitions to avoid duplication
 * across new-chat-form.tsx and active-chat.tsx
 */

/**
 * Claude Code models (uses Claude's native model names)
 */
export const claudeCodeModels = [
    { id: "opus", name: "Claude Opus 4" },
    { id: "sonnet", name: "Claude Sonnet 4" },
    { id: "haiku", name: "Claude Haiku 3.5" },
] as const

/**
 * OpenCode models
 * Uses provider/model format for the fullName field
 * @see https://opencode.ai for supported models
 */
export const openCodeModels = [
    // Anthropic Claude 4
    { id: "claude-sonnet-4", name: "Claude Sonnet 4", fullName: "anthropic/claude-sonnet-4-20250514" },
    { id: "claude-opus-4", name: "Claude Opus 4", fullName: "anthropic/claude-opus-4-20250514" },
    { id: "claude-haiku-3.5", name: "Claude Haiku 3.5", fullName: "anthropic/claude-haiku-3-20250513" },
    // OpenAI GPT-5
    { id: "gpt-5.2", name: "GPT-5.2", fullName: "openai/gpt-5.2" },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", fullName: "openai/gpt-5.1-codex" },
    { id: "gpt-4o", name: "GPT-4o", fullName: "openai/gpt-4o" },
    // Google Gemini 3
    { id: "gemini-3-pro", name: "Gemini 3 Pro", fullName: "google/gemini-3-pro" },
] as const

/**
 * Cursor models
 * Uses Cursor subscription models directly
 * @see https://cursor.com for supported models
 */
export const cursorModels = [
    // Auto (recommended default)
    { id: "auto", name: "Auto (Recommended)" },
    // Anthropic
    { id: "claude-4.5-sonnet", name: "Claude 4.5 Sonnet" },
    { id: "claude-4.5-opus", name: "Claude 4.5 Opus" },
    // OpenAI
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    // Google
    { id: "gemini-3-pro", name: "Gemini 3 Pro" },
    // xAI
    { id: "grok-code", name: "Grok Code" },
] as const

/**
 * AMP modes
 * Uses AMP mode selection instead of specific models
 * @see https://ampcode.com for supported modes
 */
export const ampModels = [
    { id: "smart", name: "Smart (Opus 4.5)" },
    { id: "rush", name: "Rush (Haiku 4.5)" },
] as const

/**
 * Droid models
 * Uses Droid-supported models from Factory AI
 * @see https://factory.ai/droid for supported models
 */
export const droidModels = [
    // Anthropic Claude models
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    // OpenAI GPT models
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
    // Google Gemini models
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
] as const

/**
 * CLI type union
 */
export type CliType = "claude-code" | "opencode" | "cursor" | "amp" | "droid"

/**
 * Get models for a given CLI
 */
export function getModelsForCli(cli: CliType) {
    switch (cli) {
        case "claude-code":
            return claudeCodeModels
        case "opencode":
            return openCodeModels
        case "cursor":
            return cursorModels
        case "amp":
            return ampModels
        case "droid":
            return droidModels
        default:
            return claudeCodeModels
    }
}

/**
 * Get default model for a CLI
 */
export function getDefaultModelId(cli: CliType): string {
    switch (cli) {
        case "claude-code":
            return "sonnet"
        case "opencode":
            return "claude-sonnet-4"
        case "cursor":
            return "auto"
        case "amp":
            return "smart"
        case "droid":
            return "claude-opus-4-5-20251101"
        default:
            return "sonnet"
    }
}

/**
 * Auth error messages shown in UI when CLI auth fails
 */
export const AUTH_ERROR_MESSAGES = {
    opencode: "Authentication required. Run `opencode auth login` in your terminal to configure API keys.",
    cursor: "Authentication required. Please log into the Cursor app with an active subscription.",
    "claude-code": "Authentication required. Please connect your Claude Code account in Settings.",
    amp: "Authentication required. Please configure your API keys with AMP.",
    droid: "Authentication required. Please configure your API keys with Droid.",
} as const
