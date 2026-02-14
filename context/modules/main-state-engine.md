# Module: main-state-engine

<!-- location: src/main/lib/state-engine -->
<!-- last-verified: 2026-02-14 -->

## Purpose

Bridges planning/execution data into prompts and writes execution outcomes back into task/goal state.

## Key Files

- `src/main/lib/state-engine/context.ts` - goal/task context builders
- `src/main/lib/state-engine/completion.ts` - task completion + memory upsert
- `src/main/lib/state-engine/parser.ts` - parse SUMMARY/INSIGHT outputs
- `src/main/lib/state-engine/prompt-template.ts` - enforce output format guidance

## Dependencies

- depends on `db` and task/goal schema
- called from `trpc/routers/claude.ts`

## Boundaries

- Owns execution context and completion parsing logic
- Should not own transport or UI rendering logic

