# Product Philosophy

<!-- last-verified: 2026-02-14 -->

## The Changing Nature of Startup Work

Early-stage startups move dynamically, testing multiple directions daily to find product-market fit. Some days are slow, some fast. There are no stable structures or processes yet — teams do whatever it takes to reach the next milestone.

Static tools like Notion and Linear don't fit this reality. They require upfront structure and manual synchronization. AI coding tools exist but aren't integrated into how startups actually operate.

## The Vision

One singular system where every conversation about an idea or task automatically becomes structured work. No forms, no manual planning, no context re-explaining.

The system should:
- Extract goals/tasks from conversation
- Route work to autonomous agents
- Verify outcomes automatically
- Build startup-specific memory over time
- Reduce human steering with each iteration

## The Autonomous Loop

```
Conversation → State → Execution → Evidence → Memory → Better Execution
```

1. **Conversation → State**: User describes idea. System extracts goal/tasks/constraints automatically.
2. **State → Execution**: Tasks route to agents in parallel isolated worktrees. System orchestrates.
3. **Execution → Evidence**: Agents verify work (tests, builds, deploys). Checkpoints stored.
4. **Evidence → Memory**: Outcomes written as learnings. System builds context about patterns, quality bar, constraints.
5. **Memory → Better Execution**: Next cycle requires less steering. Agents know the startup's way of working.

## What Users See vs What Happens

**Users see:**
- One chat interface
- Notifications only when stuck or decision needed
- Dashboard: Now (ready) / Next (working) / Blocked / Killed

**Hidden from users:**
- Agent parallel execution in background
- Worktree creation/cleanup
- Test runs, build verification
- Context propagation between tasks
- Memory formation and reuse

## Evolution Toward Autonomy

Over time, the system autonomously handles:

**Macro (Strategy):**
- Identifies which bets are working
- Proposes resource reallocation
- Suggests what to kill vs double down

**Meso (Team/Product):**
- Manages team context and conventions
- Unblocks dependencies
- Enforces quality without micromanaging

**Micro (Execution):**
- Plans breakdown
- Executes and verifies work
- Ships low-risk changes automatically
- Only escalates high-risk decisions

## Human Role Evolution

**You remain the architect:**
- Set vision and strategy
- Define quality bar
- Set risk tolerance
- Make high-stakes decisions

**System becomes the operator:**
- Planning breakdown
- Execution orchestration
- Verification loops
- Progress synthesis
- Routine decisions

## End Goal

A system capable of simulating and building startups autonomously by:
- Understanding startup-specific context deeply
- Running continuous build → test → ship cycles
- Learning from outcomes to improve future execution
- Only requiring human input for strategic direction and risk gates

The human becomes less operator, more architect. The system handles the cognitive load of execution.
