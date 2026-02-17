#!/usr/bin/env bash
# Install imi — AI-native product ops CLI
# Usage: curl -fsSL https://raw.githubusercontent.com/ProjectAI00/ai-imi/main/scripts/install.sh | bash
#
# What this does:
#   1. Installs the `imi` CLI to ~/.local/bin
#   2. Injects imi instructions into every AI agent's global config
#      so every session — Claude Code, Codex, Cursor, Windsurf, Copilot — knows about imi

set -euo pipefail

INSTALL_DIR="${IMI_INSTALL_DIR:-$HOME/.local/bin}"
URL="https://raw.githubusercontent.com/ProjectAI00/ai-imi/main/scripts/imi"

# --- IMI instructions block (shared across all agents) ---
IMI_INSTRUCTIONS='# IMI Ops — Product State Engine

If the `imi` command is available, use it to track goals, tasks, and learnings.

**Start of every session:**
```bash
imi status        # See goals, tasks, progress
```

**When working:**
```bash
imi start <id>              # Mark task in-progress
imi complete <id> "summary" # Mark done with what you did
imi memory add <goal_id> <key> "insight"  # Store learnings
```

Run `imi help` for all commands.'

# --- Helpers ---
inject_if_missing() {
  local file="$1"
  local dir
  dir="$(dirname "$file")"
  mkdir -p "$dir"

  if [ -f "$file" ] && grep -q "IMI Ops" "$file" 2>/dev/null; then
    echo "  ✓ $file (already configured)"
    return
  fi

  if [ -f "$file" ] && [ -s "$file" ]; then
    # Append to existing file
    printf '\n\n%s\n' "$IMI_INSTRUCTIONS" >> "$file"
  else
    # Create new file
    printf '%s\n' "$IMI_INSTRUCTIONS" > "$file"
  fi
  echo "  + $file"
}

echo "Installing imi v0.2.0..."
echo ""

# --- Step 1: Install CLI ---
mkdir -p "$INSTALL_DIR"

# Try download, fall back to local copy if available
LOCAL_SCRIPT="$(cd "$(dirname "$0")" && pwd)/imi"
if [ -f "$LOCAL_SCRIPT" ]; then
  cp -f "$LOCAL_SCRIPT" "$INSTALL_DIR/imi" 2>/dev/null || ln -sf "$LOCAL_SCRIPT" "$INSTALL_DIR/imi"
elif command -v curl &>/dev/null; then
  curl -fsSL "$URL" -o "$INSTALL_DIR/imi"
elif command -v wget &>/dev/null; then
  wget -qO "$INSTALL_DIR/imi" "$URL"
else
  echo "Error: curl or wget required" >&2
  exit 1
fi

chmod +x "$INSTALL_DIR/imi"
echo "✓ CLI installed to $INSTALL_DIR/imi"

# --- Step 2: Inject into AI agent configs ---
echo ""
echo "Configuring AI agents:"

# Claude Code — reads ~/.claude/CLAUDE.md every session
inject_if_missing "$HOME/.claude/CLAUDE.md"

# Codex (OpenAI) — reads ~/.codex/instructions.md
inject_if_missing "$HOME/.codex/instructions.md"

# Windsurf/Codeium — reads global_rules.md
inject_if_missing "$HOME/.codeium/windsurf/memories/global_rules.md"

# Cursor — reads ~/.cursor/rules/imi.mdc (global rules)
CURSOR_RULE="---
description: IMI ops state engine for tracking goals and tasks
globs:
alwaysApply: true
---
${IMI_INSTRUCTIONS}"
CURSOR_DIR="$HOME/.cursor/rules"
mkdir -p "$CURSOR_DIR"
if [ -f "$CURSOR_DIR/imi.mdc" ] && grep -q "IMI Ops" "$CURSOR_DIR/imi.mdc" 2>/dev/null; then
  echo "  ✓ $CURSOR_DIR/imi.mdc (already configured)"
else
  printf '%s\n' "$CURSOR_RULE" > "$CURSOR_DIR/imi.mdc"
  echo "  + $CURSOR_DIR/imi.mdc"
fi

# GitHub Copilot — reads ~/.github/copilot-instructions.md
inject_if_missing "$HOME/.github/copilot-instructions.md"

# --- Step 3: Check PATH ---
echo ""
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo "⚠ Add to PATH (add to ~/.zshrc or ~/.bashrc):"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  echo ""
fi

echo "✓ Done! Every AI agent session will now know about imi."
echo ""
echo "Quick start:"
echo "  imi init        # Initialize in current project"
echo "  imi status      # See the dashboard"
echo "  imi help        # All commands"
