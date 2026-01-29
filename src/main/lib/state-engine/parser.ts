export interface ParsedOutput {
  summary: string
  insights: Record<string, string>
}

/**
 * Parse agent output to extract structured data.
 * Extracts SUMMARY: block and INSIGHT: key = value patterns.
 */
export function parseAgentOutput(output: string): ParsedOutput {
  const insights: Record<string, string> = {}
  let summary = ""

  // Extract SUMMARY: block (everything after "SUMMARY:" until next section or end)
  const summaryMatch = output.match(
    /SUMMARY:\s*([\s\S]*?)(?=(?:^[A-Z]+:|$))/im
  )
  if (summaryMatch) {
    summary = summaryMatch[1].trim()
  }

  // Extract all INSIGHT: key = value patterns
  const insightRegex = /INSIGHT:\s*([^=]+?)\s*=\s*(.+?)(?=(?:INSIGHT:|$))/gi
  let match
  while ((match = insightRegex.exec(output)) !== null) {
    const key = match[1].trim()
    const value = match[2].trim()
    if (key && value) {
      insights[key] = value
    }
  }

  // If no explicit SUMMARY found, use last substantial paragraph
  if (!summary) {
    const paragraphs = output
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 50 && !p.startsWith("INSIGHT:"))

    if (paragraphs.length > 0) {
      summary = paragraphs[paragraphs.length - 1]
    }
  }

  return { summary, insights }
}
