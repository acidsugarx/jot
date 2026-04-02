# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

jot is a Tauri v2 desktop task manager with a quick-capture overlay (like Spotlight/Alfred), a full dashboard, and Yougile (project management API) integration. macOS is the primary platform.

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (frontend only, no Tauri)
npm run tauri dev    # Start full Tauri app with hot reload

npm run build        # tsc + vite build (frontend)
npm run tauri build  # Production Tauri build

npm run typecheck    # TypeScript type checking (npx tsc --noEmit)
npm run lint         # ESLint
npm test             # Vitest (run once)
npm test -- --watch  # Vitest in watch mode
make ci              # Full CI: fmt-check + clippy + lint + typecheck + test-frontend + build
```

Run a single test file: `npx vitest run src/lib/__tests__/focus-engine.test.ts`
Run Rust tests only: `make test-rust` | Frontend only: `make test-frontend`
Format Rust code: `make fmt` | Check formatting: `make fmt-check` | Clippy: `make clippy`

Always run `npm run typecheck` after TypeScript changes. The CI pipeline runs `make ci`.

## Architecture

### Multi-Window Tauri Setup

The app uses multiple Tauri windows, each rendering a different React root:

- **"main" window** → `App.tsx` — Quick capture bar (NSPanel overlay, transparent, always-on-top, no decorations). Activated by global hotkey (Opt+Space). Auto-hides on blur.
- **"dashboard" window** → `Dashboard.tsx` — Full task management with list/kanban/calendar views.
- **"settings" window** → `Settings.tsx` — App configuration, Yougile account setup.

Routing happens in `src/main.tsx` via `getCurrentWindow().label`. Both "main" and "dashboard" windows are wrapped in `<FocusProvider>` for keyboard handling. The "settings" window is not.

### Rust Backend (`src-tauri/src/`)

- `lib.rs` — Tauri command registrations, window management (show/hide/toggle)
- `db.rs` — SQLite database for local tasks (via rusqlite)
- `models.rs` — Shared Rust data types (Task, Column, AppSettings)
- `parser.rs` — NLP parser for task input (`#tag`, `!priority`, `@zettel`, due dates)
- `yougile/` — Yougile API client (REST via reqwest)
  - `mod.rs` — Module declarations
  - `auth.rs` — Auth credential handling
  - `client.rs` — HTTP client with auth
  - `commands.rs` — Tauri commands wrapping API calls
  - `models.rs` — Request/response types

### Frontend State

Two Zustand stores:

- **`use-task-store`** (`src/store/use-task-store.ts`) — Local tasks. Talks to Rust backend via `invoke()`. Manages columns, CRUD, linked notes, settings.
- **`use-yougile-store`** (`src/store/use-yougile-store.ts`) — Yougile tasks. Direct REST API calls from frontend. Manages accounts → projects → boards → columns → tasks hierarchy, plus chat and file attachments.

### Dual Task System

The app handles two task sources with a unified UI:

- **Local tasks** (`Task` type in `src/types.ts`) — stored in SQLite, supports status/priority/tags/dueDate/linkedNotePath
- **Yougile tasks** (`YougileTask` type in `src/types/yougile.ts`) — from Yougile API, supports columnId/completed/deadline/assigned/color

Components handle both via union types (`Task | YougileTask`). Use TypeScript type predicates for narrowing:

```typescript
// Type predicate — required for proper narrowing in conditionals
function isYougileTask(task: Task | YougileTask): task is YougileTask {
  return 'columnId' in task && (task as YougileTask).columnId !== undefined;
}
```

The shared `isYougileTask` in `src/lib/yougile.ts` uses `Record<string, unknown>` parameter (returns boolean, no narrowing). For components that need narrowing, define a local type predicate with `task is YougileTask`.

### Key Components

- **`App.tsx`** — Capture bar with insert/normal modes, vim-style navigation, picker for org/project/board selection
- **`Dashboard.tsx`** — Full UI with list/kanban/calendar tabs, sidebar filters, context menus, quick-add bar
- **`KanbanBoard.tsx`** / **`KanbanTaskCard.tsx`** — Drag-and-drop kanban via @dnd-kit, handles both task types
- **`YougileTaskEditor.tsx`** — Rich editor for Yougile tasks (description, color, assignees, chat, attachments)
- **`use-vim-bindings.ts`** — Shared vim keybindings hook (j/k navigation, x toggle, d delete, e edit, m move, etc.)

### Focus Engine

A zustand-vanilla store (`src/lib/focus-engine.ts`) manages keyboard-driven navigation across panes and focusable items. It tracks three modes: NORMAL (vim keys), INSERT (text input), and COMMAND (search/picker). Key files:

- `src/lib/focus-engine.ts` — Core zustand store with pane registry, focus tree, and mode transitions
- `src/components/FocusProvider.tsx` — React context provider, attaches global keydown listener when `captureKeys` is true
- `src/hooks/use-focus-engine.ts` — React hooks (`useFocusEngine`, `useFocusEngineStore`) to read engine state
- `src/hooks/use-focusable.ts` — Hook for registering focusable items and panes into the engine tree

### Zettelkasten Integration

When `@zettel` appears in task input, the Rust parser flags it. On task creation, a markdown note is created in the configured Obsidian vault path, linked back to the task via `linkedNotePath`. Press `o` on a local task to open its linked note.

## Key Patterns

- **Path aliases**: `@/` maps to `src/` (configured in `vite.config.ts` and `tsconfig.app.json`).
- **Tauri IPC**: Frontend calls Rust via `invoke('command_name', { args })`. Commands are registered in `lib.rs` with `#[tauri::command]`.
- **Window management**: `invoke('show_window')`, `invoke('hide_window')`, `invoke('open_dashboard_window')`, `invoke('open_settings_window')`.
- **Auto-hide logic**: Capture bar (App.tsx) hides on blur with debouncing, suppresses hide during picker mode and dialogs.
- **Source switching**: `activeSource` in yougile store toggles between `'local'` and `'yougile'`. Tab key in dashboard switches source.
- **TypeScript strictness**: The project uses strict TS. Union type narrowing requires type predicates, not just boolean checks.

## Important Notes

- The capture bar window is an NSPanel with transparent background — CSS uses `bg-transparent` and `bg-zinc-950/95` with `backdrop-blur-xl`.
- Window resizing is dynamic based on content height (App.tsx calculates and sets `LogicalSize`).
- The Yougile store polls every 30s for task updates when in Yougile mode and the window is visible.
- File uploads to Yougile use multipart form data via the frontend fetch API.
- The `cmdk` library powers the command palette in the capture bar.
- Vitest config lives in `vite.config.ts` (not a separate file). Test environment is jsdom with `@testing-library/jest-dom/vitest` globals.
- Worktrees are used for development (`.worktrees/` dir); test config excludes them.
