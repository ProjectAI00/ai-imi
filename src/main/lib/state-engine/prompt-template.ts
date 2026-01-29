export const TASK_OUTPUT_INSTRUCTIONS = `
## Output Format (REQUIRED)

When you complete this task, you MUST include the following in your final message:

### SUMMARY
Provide a clear summary of what you accomplished:
\`\`\`
SUMMARY: [2-5 sentences describing:
- What was implemented/changed
- Key files created or modified  
- Any important decisions made
- Gotchas or things to note]
\`\`\`

### INSIGHTS
Record any decisions, discoveries, or context that future tasks should know:
\`\`\`
INSIGHT: key = value
\`\`\`

### Examples of Good Output

SUMMARY: Implemented user authentication using Clerk. Created auth middleware 
in src/middleware.ts that protects /api/* and /dashboard/* routes. Added 
sign-in page at /login using Clerk's pre-built components. Note: Clerk 
webhook endpoint needs to be configured in the Clerk dashboard for user sync.

INSIGHT: auth_provider = Clerk
INSIGHT: protected_routes = /api/*, /dashboard/*
INSIGHT: auth_middleware = src/middleware.ts
INSIGHT: requires_setup = Clerk webhook configuration

### Examples of Bad Output (DON'T DO THIS)

❌ "Done"
❌ "Finished the task"  
❌ "Auth is working now"
❌ Summary without specific details
❌ No INSIGHT entries when decisions were made
`

export function wrapPromptWithInstructions(taskPrompt: string): string {
  return `${taskPrompt}\n\n${TASK_OUTPUT_INSTRUCTIONS}`
}

export function validateOutput(output: string): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  // Check for SUMMARY block
  const summaryMatch = output.match(/SUMMARY:\s*([\s\S]+?)(?=\n\n|INSIGHT:|$)/i)

  if (!summaryMatch) {
    issues.push("Missing SUMMARY block")
  } else {
    const summaryContent = summaryMatch[1].trim()

    // Check length (>50 chars)
    if (summaryContent.length <= 50) {
      issues.push(`SUMMARY too short (${summaryContent.length} chars, need >50)`)
    }

    // Check for low-effort content
    const lowEffortPatterns = [
      /^done\.?$/i,
      /^finished\.?$/i,
      /^completed\.?$/i,
      /^finished the task\.?$/i,
      /^task completed\.?$/i,
      /^it'?s? working\.?$/i,
      /^working now\.?$/i,
    ]

    for (const pattern of lowEffortPatterns) {
      if (pattern.test(summaryContent)) {
        issues.push("SUMMARY contains low-effort content without specific details")
        break
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}
