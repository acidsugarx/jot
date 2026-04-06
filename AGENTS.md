# AGENTS.md

## Purpose
This repository contains the Jot desktop app — a keyboard-centric task manager and Zettelkasten bridge.
This file is the operating guide for coding agents working here.
Keep it updated as commands, configs, and architectural boundaries evolve.

## Repository Reality
- Source of truth: `PRD.md`
- **71 commits** on `main`, remote `origin` → `git@github.com:acidsugarx/jot.git`
- Frontend: React 18 + TypeScript + Vite 7 + Tailwind CSS + Zustand + cmdk + @dnd-kit + Radix Tabs + Lucide React + DOMPurify
- Backend: Tauri v2 (Rust) with SQLite (rusqlite), reqwest (Yougile API), tauri-nspanel (macOS capture overlay)
- Phase 1–5 all have foundation in place:
  - **Phase 1**: Hidden-window startup, tray icon, global shortcuts (Opt+Space capture, Cmd+Shift+Space dashboard), `show_window` / `hide_window` IPC
  - **Phase 2**: SQLite init in app data, `tasks` table, Rust CRUD commands, columns, tags, checklists
  - **Phase 3**: Raw-input NLP parser for tags/priority/dates, `@zettel` note generation via `JOT_VAULT_DIR`, `open_linked_note`
  - **Phase 4**: Multi-window setup (capture overlay, dashboard, settings), Zustand stores, CmdK popup capture, Raycast-style settings with overlay title bar
  - **Phase 5**: Dashboard with list/kanban/calendar views, focus engine (zustand-vanilla) for vim-style navigation (j/k/x/o/e/d/m/Escape), Yougile integration with full keyboard navigation in task editor
- **Yougile integration** is live: multi-account auth, projects → boards → columns → tasks hierarchy, chat, file uploads, sprint/string stickers, breadcrumb navigation, and a dedicated `YougileTaskEditor` with rich-text description editor (contentEditable with formatting toolbar, keyboard shortcuts, smart paste)
- **Rich-text description editor** for Yougile tasks: `contentEditable` div with inline formatting toolbar (bold, italic, strikethrough, link, lists, code, checkboxes), `Ctrl+B/I/K` shortcuts, smart URL paste, DOMPurify sanitization. Works in both dashboard sidebar and quick-capture embedded mode.
- **Quick-capture editor layout**: Yougile task editor in the capture overlay uses dynamic window sizing (80% of screen height) with proper flex scrolling (`min-h-0` + `overflow-y-auto` chain). Escape in editing mode closes the editor back to task list instead of hiding the window.
- GitHub Actions CI (`.github/workflows/ci.yml`) runs on PR + push to `main`; release workflow (`.github/workflows/release.yml`) on `v*` tags
- Worktree at `.worktrees/focus-engine/` for parallel development
- No Cursor rules or Copilot instructions present

## Intended Stack
Derived from `PRD.md`:
- Rust + Tauri v2 backend/system layer (macOS primary, cross-platform via Tauri)
- React 18 + TypeScript + Vite frontend
- Tailwind CSS + cmdk + @dnd-kit UI stack
- Zustand state management (two stores + vanilla focus engine)
- SQLite persistence (rusqlite)
- tauri-nspanel for macOS NSPanel overlay behavior

Agents should assume this architecture unless the user changes direction.

## Delivery Order
All five PRD phases have foundational implementations. Future work extends and polishes:
1. Foundation and IPC setup ✅
2. Database and core Rust logic ✅
3. NLP parsing and Zettel bridge ✅
4. Transient React UI ✅
5. Dashboard and Vim-style bindings ✅ (ongoing refinement)

## Commands

### Standard Commands

#### Frontend
- Install deps: `npm install`
- Dev server (frontend only): `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Test all (watch): `npm run test`
- Test once/CI: `npm run test -- --run`
- Single test file: `npm run test -- src/path/to/file.test.ts`
- Single named test: `npm run test -- -t "test name"`

Preferred runner: Vitest (config in `vite.config.ts`, jsdom environment, `@testing-library/jest-dom/vitest` globals).

#### Rust / Tauri
- Check: `cargo check` (run from `src-tauri/`)
- Build: `cargo build` (run from `src-tauri/`)
- Test all: `cargo test` (run from `src-tauri/`)
- Single Rust test: `cargo test test_name` (run from `src-tauri/`)
- Parser-specific tests: `cargo test parser::tests::`
- Format: `cargo fmt` (run from `src-tauri/`)
- Lint: `cargo clippy --all-targets --all-features -- -D warnings` (run from `src-tauri/`)
- Tauri dev: `npm run tauri dev` or `cargo tauri dev`
- Tauri build: `npm run tauri build` or `cargo tauri build`

#### Makefile Helpers
- Package for current OS: `make package`
- Install current OS build locally: `make install-local`
- Local validation wrapper: `make ci`
- Rust fmt: `make fmt`
- Rust fmt check: `make fmt-check`
- Rust clippy: `make clippy`
- Frontend lint: `make lint`
- Frontend tests: `make test-frontend`
- Rust tests: `make test-rust`
- All tests: `make test`

#### Recommended Full Validation Sequence
Prefer `make ci` which runs:
1. `cargo fmt --check` (in `src-tauri/`)
2. `cargo clippy --all-targets --all-features -- -D warnings` (in `src-tauri/`)
3. `cargo test` (in `src-tauri/`)
4. `npm run lint`
5. `npm run typecheck`
6. `npm run test -- --run`
7. `npm run build`

### GitHub Automation
- CI workflow: `.github/workflows/ci.yml` — runs Rust check on Linux + Windows, full validation on macOS
- Release workflow: `.github/workflows/release.yml` — runs on `v*` tags, publishes macOS DMG + Linux AppImage

## Single-Test Guidance
When the user asks for one test, run the narrowest target first.
- Frontend file: `npm run test -- src/path/to/file.test.ts`
- Frontend case: `npm run test -- -t "exact or partial name"`
- Rust exact test: `cd src-tauri && cargo test exact_test_name`
- Rust module filter: `cd src-tauri && cargo test parser::`

## Architecture

### Multi-Window Tauri Setup
Three windows, each rendering a different React root routed in `src/main.tsx` via `getCurrentWindow().label`:

| Window | Root Component | Purpose |
|--------|---------------|---------|
| `main` | `App.tsx` | Quick capture NSPanel overlay (Opt+Space), always-on-top, transparent, auto-hides on blur |
| `dashboard` | `Dashboard.tsx` | Full task management — list/kanban/calendar views, sidebar, editor pane |
| `settings` | `Settings.tsx` | App config, vault path, theme, Yougile accounts (not wrapped in FocusProvider) |

Both `main` and `dashboard` windows are wrapped in `<FocusProvider>` for keyboard handling.

### Rust Backend (`src-tauri/src/`)
- `lib.rs` — Tauri command registrations, multi-window management, NSPanel setup, tray, global shortcuts
- `db.rs` — SQLite database: tasks, columns, tags, checklists, settings, yougile sync state
- `models.rs` — Rust data types (Task, KanbanColumn, AppSettings, Checklist, Tag, YougileSyncState, etc.)
- `parser.rs` — NLP parser for task input (`#tag`, `!priority`, `@zettel`, due dates)
- `yougile/` — Yougile REST API client via reqwest
  - `auth.rs` — Auth credential handling (multi-account)
  - `client.rs` — HTTP client with auth headers
  - `commands.rs` — Tauri commands wrapping API calls
  - `models.rs` — Request/response types

### Frontend State (Zustand)
- **`use-task-store`** (`src/store/use-task-store.ts`) — Local tasks. Talks to Rust via `invoke()`. Manages columns, CRUD, linked notes, settings, theme, checklists, tags. Cross-window sync via Tauri `emit`/`listen` on `tasks-updated` and `settings-updated` events.
- **`use-yougile-store`** (`src/store/use-yougile-store.ts`) — Yougile tasks. Direct REST API calls from frontend via Rust commands. Manages accounts → projects → boards → columns → tasks, chat, file attachments, sprint/string stickers. Polls every 30s when window is visible.

### Focus Engine
A zustand-vanilla store (`src/lib/focus-engine.ts`) manages keyboard-driven navigation:
- **Three modes**: NORMAL (vim keys), INSERT (text input), COMMAND (search/picker)
- **Key files**:
  - `src/lib/focus-engine.ts` — Core store with pane registry, focus tree, mode transitions
  - `src/components/FocusProvider.tsx` — React context provider, attaches global keydown listener
  - `src/hooks/use-focus-engine.ts` — React hooks to read engine state
  - `src/hooks/use-focusable.ts` — Hook for registering focusable items/panes

### Dual Task System
The app handles two task sources with a unified UI:
- **Local tasks** (`Task` type in `src/types.ts`) — SQLite, supports status/priority/tags/dueDate/linkedNotePath
- **Yougile tasks** (`YougileTask` type in `src/types/yougile.ts`) — Yougile API, supports columnId/completed/deadline/assigned/color

Components handle both via union types (`Task | YougileTask`). Use TypeScript type predicates for narrowing:
```typescript
function isYougileTask(task: Task | YougileTask): task is YougileTask {
  return 'columnId' in task && (task as YougileTask).columnId !== undefined;
}
```

### Key Frontend Components
- **`App.tsx`** — Capture bar with insert/normal/command modes, vim navigation, picker for org/project/board
- **`Dashboard.tsx`** — List/kanban/calendar tabs, sidebar filters, context menus, quick-add bar
- **`Settings.tsx`** — Tabbed settings (General, Vault, Appearance, Accounts)
- **`KanbanBoard.tsx`** / **`KanbanTaskCard.tsx`** — Drag-and-drop kanban via @dnd-kit
- **`TaskEditorPane.tsx`** — Slide-in editor for local tasks
- **`YougileTaskEditor.tsx`** — Rich editor for Yougile tasks: contentEditable description with formatting toolbar (`ToolbarBtn`), keyboard shortcuts (`Ctrl+B/I/K`, `Ctrl+Shift+S/C`), smart paste (URL auto-linking), checkbox toggle, DOMPurify sanitization. Color, assignees, chat, attachments, checklists. Supports `embedded` prop for quick-capture overlay.
- **`CalendarView.tsx`** — Calendar date-based task view
- **`HighlightedInput.tsx`** — NLP syntax highlighting in capture input
- **`FocusProvider.tsx`** / **`ModeIndicator.tsx`** — Focus engine integration
- **`SourceSwitcher.tsx`** — Toggle between local and Yougile task sources
- **`YougileBreadcrumbBar.tsx`** — Breadcrumb navigation for Yougile hierarchy

## Code Style

### General
- Keep modules small and composable
- Prefer explicit, readable code over clever abstractions
- Preserve keyboard-first UX in every user flow
- Write code that another agent can extend safely

### Imports And Dependencies
- Path alias `@/` maps to `src/` (configured in `vite.config.ts` and `tsconfig.app.json`)
- Group imports as: standard library, third-party, then internal (`@/`)
- Remove unused imports immediately
- Prefer named imports in TypeScript unless a library strongly prefers defaults
- Do not add new dependencies unless the current stack cannot solve the problem cleanly

### Formatting
- Use the repo formatter and linter configs already present; do not hand-fight them
- Rust should follow `rustfmt`
- TypeScript/React should stay consistent with ESLint + Vite + Tailwind setup
- Keep lines readable instead of aggressively compact
- Use trailing commas where the formatter expects them

### Types And Models
- Prefer precise types over `any` or loosely shaped objects
- Model task status/priority as string literal types in TypeScript, enums in Rust
- Mirror the SQLite schema with explicit Rust structs and TypeScript types
- Validate IPC payloads at the boundary
- Centralize shared contract types when practical

### Naming
- Rust: `snake_case` functions/modules, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants
- TypeScript: `camelCase` values/functions, `PascalCase` components/types, `UPPER_SNAKE_CASE` true constants
- Use descriptive action names such as `create_task`, `update_task_status`, `open_linked_note`
- Name UI components by purpose, not by visual styling
- Avoid unnecessary abbreviations

### React / Frontend
- Prefer function components and hooks
- Keep presentational components small and side-effect light
- Put system/backend interaction behind focused hooks or service modules
- Use Zustand deliberately; avoid an unstructured global dump
- Keep keyboard interactions explicit and testable
- Auto-save forms on change (`onBlur`, `onKeyDown`), not with explicit Save buttons

### Rust / Backend
- Keep Tauri commands thin and move domain logic into plain Rust modules
- Separate parsing, persistence, and integration concerns
- Treat file IO, URI launching, and process spawning as boundary code
- Prefer `Result`-returning functions over panics
- Keep SQLite access predictable and transactional where needed

### Error Handling
- Never silently swallow errors
- Return structured, actionable errors across IPC boundaries
- Add context to filesystem, SQLite, parsing, and process-launch failures
- Keep user-facing errors concise and logs detailed
- Handle missing config like vault paths explicitly and early

### Testing
- Vitest config in `vite.config.ts` (not a separate file), jsdom environment, `@testing-library/jest-dom/vitest` globals
- Add tests alongside new logic once infrastructure exists
- Prioritize parser, SQLite CRUD, and path-generation tests in Rust
- Add focused component tests for focus engine and keyboard navigation
- Prefer deterministic tests over time-dependent behavior

### UI / UX Constraints
- Match the PRD's developer-first, high-density, keyboard-led feel
- Favor list workflows over bulky cards
- Keep shortcuts visible where relevant
- Use monospace for metadata and parsed operators
- Avoid clutter, heavy chrome, and mouse-first patterns
- Dark mode brutalist: zinc-950 backgrounds, zinc-800 borders, glass effects (backdrop-blur-xl)
- Settings window uses `TitleBarStyle::Overlay` with horizontal tabs, no sidebars

### Comments And Docs
- Add comments only when intent is not obvious from the code
- Document invariants, parser assumptions, and OS-specific behavior
- Keep docs aligned with implementation, not aspiration
- Update this file when commands or conventions become real

## Key Patterns

- **Tauri IPC**: Frontend calls Rust via `invoke('command_name', { args })`. Commands registered in `lib.rs` with `#[tauri::command]`.
- **Window management**: `invoke('show_window')`, `invoke('hide_window')`, `invoke('open_dashboard_window')`, `invoke('open_settings_window')`.
- **Auto-hide logic**: Capture bar (App.tsx) hides on blur with debouncing, suppresses hide during picker mode and dialogs.
- **Source switching**: `activeSource` in yougile store toggles between `'local'` and `'yougile'`. Tab key in dashboard switches source.
- **Cross-window sync**: Tauri `emit`/`listen` events (`tasks-updated`, `settings-updated`, `yougile-sync-updated`, `theme-changed`) keep all windows in sync.
- **Capture panel window**: macOS NSPanel with transparent background — CSS uses `bg-transparent` and `bg-zinc-950/95` with `backdrop-blur-xl`. Dynamic resizing via `LogicalSize`. Yougile task editing uses 80% of screen height with flex scroll chain (`h-full max-h-full` card → `min-h-0 flex-1 overflow-hidden` editor → `min-h-0 flex-1 overflow-y-auto` content area).
- **TypeScript strictness**: The project uses strict TS. Union type narrowing requires type predicates, not just boolean checks.
- **Escape in editing mode**: The capture bar's `onEscape` handler checks `editingTask` — when true, closes the editor via `setEditingTaskId(null)` instead of hiding the window. This prevents the NSPanel from disappearing when the user just wants to exit the task editor.
- **Rich-text description**: Yougile task descriptions use `contentEditable` with `dangerouslySetInnerHTML`. HTML is sanitized via `sanitizeHtml()` (DOMPurify). The `descEditorRef` focuses the contentEditable div. Formatting commands use `document.execCommand` with editor re-focus. Smart paste detects URLs and wraps them in `<a>` tags.
- **Worktrees**: `.worktrees/focus-engine/` used for parallel development; test config excludes them.

## Agent Workflow
- Read `PRD.md` before making architectural changes
- Check whether requested work belongs to the current phase
- Prefer real commands from this file over aspirational placeholders
- Prefer conventional file names and standard scripts when bootstrapping
- Update this file when scripts, test targets, or project layout change
- Run `make ci` before declaring work complete to catch regressions

## Rule File Status
At creation time:
- `.cursor/rules/`: not present
- `.cursorrules`: not present
- `.github/copilot-instructions.md`: not present

If any of those files are added later, merge their instructions into this document and avoid contradictions.
