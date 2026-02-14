# Renderer Architecture

Renderer is a React 19 app focused on chat-first workflows.

## Core Areas

- `src/renderer/features/agents` - chat UI, prompt input, tool rendering
- `src/renderer/features/sidebar` - navigation and task views
- `src/renderer/features/sub-chats` - parallel sub-chat management
- `src/renderer/features/terminal` - embedded terminal

## State Layers

- **Jotai**: lightweight UI and interaction atoms.
- **Zustand**: sub-chat tab/pin state and session-level view state.
- **React Query + tRPC**: server state and mutations.

## Important Runtime File

- `src/renderer/features/agents/lib/ipc-chat-transport.ts`  
  Converts chat requests into tRPC subscriptions and streams chunks back into UI.

