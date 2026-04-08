# AGENTS.md

## Purpose

This repository contains the Jot desktop app — a keyboard-centric task manager and Zettelkasten bridge.
This file is the operating guide for coding agents working here.
Keep it updated as commands, configs, and architectural boundaries evolve.

## Repository Reality

- Source of truth: `PRD.md`
- Remote `origin` → `git@github.com:acidsugarx/jot.git`
- GitHub Actions CI (`.github/workflows/ci.yml`) runs on PR + push to `main`; release workflow (`.github/workflows/release.yml`) on `v*` tags
- Worktree at `.worktrees/focus-engine/` for parallel development; test configs exclude `.worktrees/**`

### Frontend Stack

React 18 + TypeScript + Vite 7 + Tailwind CSS + Zustand 5 + cmdk + @dnd-kit + Radix Tabs + Lucide React + DOMPurify

| Package | Purpose |
|---------|---------|
| `react` / `react-dom` | UI framework |
| `zustand` | State management (3 stores + vanilla focus engine) |
| `cmdk` | Command palette (capture bar) |
| `@dnd-kit/core` + `@dnd-kit/sortable` | Drag-and-drop kanban |
| `@radix-ui/react-tabs` | Tab navigation |
| `lucide-react` | Icons |
| `dompurify` | HTML sanitization |
| `class-variance-authority` + `clsx` + `tailwind-merge` | Conditional styling utilities |
| `@tauri-apps/api` | Tauri IPC bridge |
| `@tauri-apps/plugin-dialog` | Native file dialogs |

### Backend Stack

Tauri v2 (Rust) with SQLite (rusqlite), reqwest (Yougile API), tauri-nspanel (macOS capture overlay)

| Crate | Purpose |
|-------|---------|
| `tauri` 2.x | App framework, IPC, multi-window |
| `rusqlite` | SQLite (bundled) |
| `reqwest` | HTTP client (json, rustls-tls, multipart) |
| `tauri-nspanel` | macOS NSPanel overlay |
| `keyring` | Secure credential storage (Yougile auth) |
| `serde` / `serde_json` | Serialization |
| `uuid` | ID generation |
| `chrono` | Date/time handling |
| `tokio` | Async runtime (macros, fs) |
| `url` | URL parsing and validation |
| `tauri-plugin-global-shortcut` | Global hotkeys |
| `tauri-plugin-dialog` | Native dialogs |
| `tauri-plugin-log` | Logging |

### Completed Phases

All five PRD phases are implemented. Future work extends and polishes:

1. **Foundation** — Hidden-window startup, tray icon, global shortcuts, IPC
2. **Database** — SQLite init, tasks/columns/tags/checklists tables, Rust CRUD
3. **NLP + Zettel** — Raw-input parser for tags/priority/dates, `@zettel` note generation
4. **Multi-window UI** — Capture overlay, dashboard, settings, Zustand stores, CmdK capture
5. **Dashboard + Vim** — List/kanban/calendar/templates views, focus engine, Yougile integration

## Commands

### Frontend

| Command | Purpose |
|---------|---------|
| `npm install` | Install deps |
| `npm run dev` | Dev server (frontend only, port 1420) |
| `npm run build` | Production build (`tsc -b && vite build`) |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (watch mode) |
| `npm run test -- --run` | Vitest (single run, CI) |
| `npm run test -- src/path/to/file.test.ts` | Single test file |
| `npm run test -- -t "test name"` | Single named test |

Vitest config lives in `vite.config.ts` (not a separate file): jsdom environment, globals enabled, setup at `src/test/setup.ts`.

### Rust / Tauri

All commands run from `src-tauri/`:

| Command | Purpose |
|---------|---------|
| `cargo check` | Type-check without building |
| `cargo build` | Compile |
| `cargo test` | Run all Rust tests |
| `cargo test test_name` | Single test |
| `cargo test parser::` | Module filter |
| `cargo fmt` | Format |
| `cargo fmt --check` | Check formatting |
| `cargo clippy --all-targets --all-features -- -D warnings` | Lint |

| Command | Purpose |
|---------|---------|
| `npm run tauri dev` | Dev mode (hot-reload frontend + Rust recompile) |
| `npm run tauri build` | Production build |

### Makefile

| Target | What it runs |
|--------|-------------|
| `make ci` | Full validation: fmt-check → clippy → cargo test → lint → typecheck → vitest → build |
| `make package` | Build OS-specific bundle |
| `make install-local` | Install current build locally |
| `make fmt` | `cargo fmt` |
| `make fmt-check` | `cargo fmt --check` |
| `make clippy` | Cargo clippy with warnings as errors |
| `make lint` | `npm run lint` |
| `make test-frontend` | `npm run test -- --run` |
| `make test-rust` | `cargo test` |
| `make test` | Both frontend and Rust tests |

### CI

- `make ci` is the authoritative validation sequence. Run it before declaring work complete.
- GitHub CI runs Rust check on Linux + Windows, full `make ci` on macOS.
- Release workflow publishes macOS DMG + Linux AppImage on `v*` tags.

## Architecture

### Multi-Window Setup

Three windows, each rendering a different React root routed in `src/main.tsx` via `getCurrentWindow().label`:

| Window | Root Component | Purpose |
|--------|---------------|---------|
| `main` | `App.tsx` | Quick capture NSPanel overlay (Opt+Space). Always-on-top, transparent, auto-hides on blur |
| `dashboard` | `Dashboard.tsx` | Full task management — list/kanban/calendar/templates views, sidebar, editor pane |
| `settings` | `Settings.tsx` | App config, vault path, theme, Yougile accounts |

All three windows are wrapped in `<FocusProvider>`. The `main` and `dashboard` windows use `captureKeys={true}` (intercepts vim keys). The `settings` window uses `captureKeys={false}` (only h/l tab switching and Escape). All windows are wrapped in `<ErrorBoundary>` for crash recovery.

### Rust Backend (`src-tauri/src/`)

```
src-tauri/src/
├── lib.rs              # Tauri setup: window management, tray, global shortcuts, command registration (38 commands)
├── models.rs           # Data types: Task, KanbanColumn, AppSettings, Checklist, Tag, YougileSyncState, etc.
├── parser.rs           # NLP parser: #tag, !priority, @zettel, date/time extraction
├── db/                 # Database layer (modular)
│   ├── mod.rs          # DatabaseState, init_database, all #[tauri::command] functions, test module
│   ├── migrations.rs   # Schema migrations, seeding, foreign key constraints
│   ├── tasks.rs        # Task CRUD helpers
│   ├── columns.rs      # Kanban column helpers
│   ├── templates.rs    # Task template CRUD helpers
│   ├── checklists.rs   # Checklist item CRUD helpers
│   ├── tags.rs         # Tag CRUD + task-tag association helpers
│   ├── settings.rs     # App settings + Yougile sync state persistence
│   ├── notes.rs        # Zettel note generation (vault directory, file creation)
│   ├── yougile_accounts.rs  # Yougile account management with keyring integration
│   └── utils.rs        # Shared query builders, normalizers, timestamps
└── yougile/            # Yougile REST API client
    ├── auth.rs         # Auth credential handling (multi-account)
    ├── client.rs       # HTTP client with auth headers
    ├── commands.rs     # Tauri commands wrapping API calls
    └── models.rs       # Request/response types
```

### Frontend State (Zustand)

Three Zustand stores + one vanilla store:

| Store | File | Purpose |
|-------|------|---------|
| **`use-task-store`** | `src/store/use-task-store.ts` | Local tasks. Talks to Rust via `invoke()`. Manages columns, CRUD, linked notes, settings, theme, checklists, tags. |
| **`use-yougile-store`** | `src/store/use-yougile-store.ts` | Yougile tasks. REST API calls via Rust commands. Manages accounts → projects → boards → columns → tasks, chat, file attachments, stickers. Polls every 30s when window is visible. |
| **`use-template-store`** | `src/store/use-template-store.ts` | Task templates. CRUD via Rust IPC. Used by capture bar and dashboard templates tab. |
| **Focus engine** | `src/lib/focus-engine.ts` | Zustand-vanilla store for keyboard-driven navigation. Three modes: NORMAL, INSERT, COMMAND. |

All stores use `useShallow` selectors in consuming components to prevent re-render storms.

### Cross-Window Sync

Tauri `emit`/`listen` events keep all windows in sync:

| Event | Purpose |
|-------|---------|
| `tasks-updated` | Local task changes |
| `settings-updated` | Settings changes |
| `yougile-sync-updated` | Yougile task changes |
| `theme-changed` | Theme toggle |

Cross-window navigation helpers in `src/lib/settings-navigation.ts`:
- `persistTemplateIntent()` / `consumeTemplateIntent()` — Capture bar → dashboard templates tab
- `consumeStoredSettingsTab()` — Capture bar → settings tab

### Focus Engine

Keyboard-driven navigation across all surfaces:

| File | Purpose |
|------|---------|
| `src/lib/focus-engine.ts` | Core vanilla store: pane registry, focus tree, mode transitions (NORMAL/INSERT/COMMAND) |
| `src/lib/focus-actions.ts` | Action resolver: `resolveNormalKeyActions`, `useRegisteredNormalKeyActions` — shared dispatch for App, Dashboard, Settings |
| `src/components/FocusProvider.tsx` | React context provider, attaches global keydown listener |
| `src/hooks/use-focus-engine.ts` | React hooks to read engine state |
| `src/hooks/use-focusable.ts` | Hook for registering focusable items/panes |

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

| Component | File | Purpose |
|-----------|------|---------|
| **App** | `src/App.tsx` | Capture bar: insert/normal modes, vim navigation, picker for org/project/board/template/columns, inline task editor |
| **Dashboard** | `src/Dashboard.tsx` | List/kanban/calendar/templates tabs, sidebar filters, context menus, quick-add bar, delete dialog |
| **Settings** | `src/Settings.tsx` | Tabbed settings (General, Vault, Appearance, Accounts) with h/l tab switching |
| **YougileTaskEditor** | `src/components/YougileTaskEditor.tsx` | Rich editor: contentEditable description, formatting toolbar, keyboard shortcuts, checklists, subtasks, color, assignees, chat, attachments, stickers, time tracking. `embedded` prop for capture overlay |
| **TaskEditorPane** | `src/components/TaskEditorPane.tsx` | Slide-in editor for local tasks |
| **KanbanBoard** | `src/components/KanbanBoard.tsx` | Drag-and-drop kanban via @dnd-kit |
| **KanbanTaskCard** | `src/components/KanbanTaskCard.tsx` | Individual kanban card with drag handle |
| **KanbanColumn** | `src/components/KanbanColumn.tsx` | Kanban column container |
| **CalendarView** | `src/components/CalendarView.tsx` | Calendar date-based task view |
| **TaskTemplatesSettings** | `src/components/TaskTemplatesSettings.tsx` | Template CRUD with rich-text description editor |
| **HighlightedInput** | `src/components/HighlightedInput.tsx` | NLP syntax highlighting in capture input |
| **FocusProvider** | `src/components/FocusProvider.tsx` | Focus engine React context |
| **ModeIndicator** | `src/components/ModeIndicator.tsx` | Current focus mode display |
| **SourceSwitcher** | `src/components/SourceSwitcher.tsx` | Toggle between local and Yougile task sources |
| **YougileBreadcrumbBar** | `src/components/YougileBreadcrumbBar.tsx` | Breadcrumb navigation for Yougile hierarchy |
| **YougileSubtaskList** | `src/components/YougileSubtaskList.tsx` | Subtask management for Yougile tasks |
| **ChecklistEditor** | `src/components/ChecklistEditor.tsx` | Checklist item editor |
| **HotkeyCheatSheet** | `src/components/HotkeyCheatSheet.tsx` | Keyboard shortcuts reference |
| **AccountsSettings** | `src/components/AccountsSettings.tsx` | Yougile account management in Settings |
| **ErrorBoundary** | `src/components/ErrorBoundary.tsx` | React error boundary with crash recovery UI |

### Key Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useFocusEngine` | `src/hooks/use-focus-engine.ts` | Read focus engine state |
| `useFocusable` | `src/hooks/use-focusable.ts` | Register focusable items/panes |
| `useRichTextEditor` | `src/hooks/use-rich-text-editor.tsx` | Shared rich-text editor logic (state, formatting, link input, paste handling). Used by YougileTaskEditor and TaskTemplatesSettings. |
| `useNlpSuggestions` | `src/hooks/use-nlp-suggestions.ts` | NLP suggestion generation for capture input |

### Key Libraries

| Module | File | Purpose |
|--------|------|---------|
| Focus engine | `src/lib/focus-engine.ts` | Vim-mode navigation store |
| Focus actions | `src/lib/focus-actions.ts` | Key-action resolver shared across windows |
| Sanitization | `src/lib/sanitize.ts` | DOMPurify wrapper for HTML sanitization |
| Formatting | `src/lib/formatting.ts` | Date/text formatting helpers |
| Yougile helpers | `src/lib/yougile-editor.ts` | Pure helper functions for editor (normalize, clone, sticker map) |
| Yougile types | `src/lib/yougile.ts` | Shared Yougile constants and utilities |
| Settings nav | `src/lib/settings-navigation.ts` | Cross-window navigation (template intent, settings tab) |
| Shortcuts | `src/lib/shortcuts.ts` | Keyboard shortcut definitions |
| Tauri helpers | `src/lib/tauri.ts` | Tauri IPC utility functions |
| Constants | `src/lib/constants.ts` | Shared constants |
| Utils | `src/lib/utils.ts` | General utility functions (`cn()` for className merging) |

### Styles

| File | Purpose |
|------|---------|
| `src/styles.css` | Global styles: Tailwind directives, light theme overrides (`[data-theme="light"]`), markdown prose styles, Yougile CKEditor 5 compatibility, contentEditable editor styles, rich-text toolbar styles |

The light theme uses CSS overrides under `[data-theme="light"]` with `!important` to override Tailwind's dark-first utility classes. Every dark-themed utility class used in components needs a corresponding override entry in `styles.css`.

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
- Rust follows `rustfmt` — run `cargo fmt` before committing
- TypeScript/React stays consistent with ESLint flat config (`eslint.config.js`)
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
- Use Zustand deliberately with `useShallow` selectors — never subscribe to the entire store
- Keep keyboard interactions explicit and testable
- Auto-save forms on change (`onBlur`, `onKeyDown`), not with explicit Save buttons
- Shared editor logic goes in `useRichTextEditor` hook (`src/hooks/use-rich-text-editor.tsx`)

### Rust / Backend

- Keep Tauri commands thin — move domain logic into `db/` module helpers
- Separate parsing, persistence, and integration concerns into distinct modules
- Treat file IO, URI launching, and process spawning as boundary code
- Prefer `Result`-returning functions over panics
- Keep SQLite access predictable and transactional where needed
- New CRUD operations belong in the appropriate `db/` submodule, exposed via `pub(crate)` helpers

### Error Handling

- Never silently swallow errors
- Return structured, actionable errors across IPC boundaries
- Add context to filesystem, SQLite, parsing, and process-launch failures
- Keep user-facing errors concise and logs detailed
- Handle missing config like vault paths explicitly and early

### Testing

- Vitest config in `vite.config.ts`, jsdom environment, `@testing-library/jest-dom/vitest` globals
- Test setup at `src/test/setup.ts`
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
- Light theme: all surfaces must have corresponding overrides in `styles.css`
- Settings window uses `TitleBarStyle::Overlay` with horizontal tabs, no sidebars

### Comments And Docs

- Add comments only when intent is not obvious from the code
- Document invariants, parser assumptions, and OS-specific behavior
- Keep docs aligned with implementation, not aspiration
- Update this file when commands or conventions change

## Key Patterns

### Tauri IPC

Frontend calls Rust via `invoke('command_name', { args })`. Commands registered in `lib.rs` with `#[tauri::command]`. 38 commands currently registered covering tasks, columns, templates, checklists, tags, settings, notes, Yougile accounts, and Yougile API operations.

### Window Management

- `invoke('show_window')`, `invoke('hide_window')`, `invoke('open_dashboard_window')`, `invoke('open_settings_window')`
- Capture bar hides on blur with debouncing, suppresses hide during picker mode and dialogs
- Dynamic window sizing via `LogicalSize` for capture overlay

### Capture Bar Modes

The capture bar (`App.tsx`) has two interaction modes:
- **INSERT** — Text input, NLP suggestions appear inline
- **NORMAL** — `j`/`k` navigate tasks/actions, `x` toggle, `e` edit, `d` delete (double-press to confirm), `s` cycle status, `m` move column, `:` command mode

Picker modes: `org` → `project` → `board` → `template` → `columns`. Each level has `border-l-2 border-l-cyan-500` selection indicator.

### Source Switching

`activeSource` in yougile store toggles between `'local'` and `'yougile'`. Tab key in dashboard switches source.

### Auto-hide Logic

Capture bar (App.tsx) hides on blur with debouncing, suppresses hide during picker mode and dialogs.

### Capture Panel Window

macOS NSPanel with transparent background. CSS uses `bg-transparent` and `bg-zinc-950/95` with `backdrop-blur-xl`. Yougile task editing uses 80% of screen height with flex scroll chain (`h-full max-h-full` card → `min-h-0 flex-1 overflow-hidden` editor → `min-h-0 flex-1 overflow-y-auto` content area).

### Escape in Editing Mode

The capture bar's `onEscape` handler checks `editingTask` — when true, closes the editor via `setEditingTaskId(null)` instead of hiding the window. This prevents the NSPanel from disappearing when the user just wants to exit the task editor.

### Rich-Text Description

Shared via `useRichTextEditor` hook (`src/hooks/use-rich-text-editor.tsx`):
- `contentEditable` div with `dangerouslySetInnerHTML`
- HTML sanitized via `sanitizeHtml()` (DOMPurify)
- Formatting commands use `document.execCommand` with editor re-focus
- Smart paste detects URLs and wraps them in `<a>` tags
- Link input popover with range preservation
- Shared `ToolbarBtn` component for formatting toolbar

### Zustand Store Subscriptions

Always use `useShallow` selectors when subscribing to Zustand stores:

```typescript
const { tasks, columns, createTask } = useTaskStore(
  useShallow((s) => ({ tasks: s.tasks, columns: s.columns, createTask: s.createTask }))
);
```

Never call `useTaskStore()` without a selector — it subscribes to the entire store and causes re-render storms.

### TypeScript Strictness

The project uses strict TS. Union type narrowing requires type predicates, not just boolean checks.

### Confirmation Pattern

Destructive actions (delete) require double-press: first `d` sets `pendingConfirm`, second `d` within a timeout executes the action. Any other key cancels.

### Worktrees

`.worktrees/focus-engine/` used for parallel development. Test configs exclude `.worktrees/**`.

## Agent Workflow

- Read `PRD.md` before making architectural changes
- Check whether requested work belongs to the current phase
- Prefer real commands from this file over aspirational placeholders
- Prefer conventional file names and standard scripts when bootstrapping
- Update this file when scripts, test targets, or project layout change
- Run `make ci` before declaring work complete to catch regressions

## Rule File Status

- `.cursor/rules/`: not present
- `.cursorrules`: not present
- `.github/copilot-instructions.md`: not present

If any of those files are added later, merge their instructions into this document and avoid contradictions.
