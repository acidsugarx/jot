# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Jot** is a keyboard-centric task manager and Zettelkasten bridge built with Tauri v2. It runs as a system tray daemon with multiple windows:

- **Quick Capture** (Opt+Space): cmdk-based command palette for rapid task entry
- **Dashboard** (Cmd+Shift+Space): Multi-view workspace with List, Kanban, and Calendar tabs
- **Settings** (Cmd+,): Configuration window for vault path and app settings

Tasks are stored in SQLite; notes are created as .md files in an external Obsidian vault.

## Development Commands

```bash
# Install dependencies
npm install

# Development (runs both Vite dev server and Tauri)
npm run tauri dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Building
npm run build          # Frontend only
npm run tauri build    # Full desktop app

# Running tests
npm test               # Vitest (watch mode)
npm test -- --run      # Vitest (single run, CI)
npm test -- <pattern>  # Run tests matching pattern
npm test -- -t "name"  # Run tests matching name

# Rust commands (run from src-tauri/)
cargo test                              # All Rust tests
cargo test test_name                    # Single test
cargo test parser::                     # Module filter
cargo fmt --check                       # Format check
cargo clippy --all-targets --all-features -- -D warnings  # Lint
```

### Full Validation Sequence

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test && cd ..
npm run lint && npm run typecheck && npm test -- --run && npm run build
```

## Architecture

### Backend (Rust + Tauri v2)

Located in `src-tauri/src/`:

| Module | Purpose |
|--------|---------|
| `lib.rs` | Tauri setup, system tray, global shortcuts, multi-window management, IPC handlers |
| `db.rs` | SQLite CRUD operations, database migrations, zettel note creation |
| `models.rs` | Type definitions (Task, TaskStatus, TaskPriority, AppSettings) |
| `parser.rs` | NLP parser for raw input (extracts #tags, !priority, dates, @zettel) |

### Frontend (React + TypeScript)

Located in `src/`. Uses `@` path alias mapped to `src/` (configured in `vite.config.ts` and `tsconfig.app.json`).

| Module | Purpose |
|--------|---------|
| `App.tsx` | Quick capture window - cmdk-based command palette |
| `Dashboard.tsx` | Multi-view workspace with List/Kanban/Calendar tabs |
| `Settings.tsx` | Settings window for vault configuration |
| `store/use-task-store.ts` | Zustand store for state management and IPC calls |
| `hooks/use-vim-bindings.ts` | Vim-style keyboard navigation (j/k/h/l, e/x/s/a/d/o) |
| `components/KanbanBoard.tsx` | Drag-and-drop kanban using @dnd-kit |
| `components/CalendarView.tsx` | Month-view calendar with task dots and day detail |
| `components/TaskEditorPane.tsx` | Slide-in panel for inline editing (title, description, status, priority, due date, tags) |
| `types.ts` | TypeScript interfaces matching Rust backend |
| `components/ui/` | shadcn/ui components (Badge, Button, ScrollArea, Tabs) |

## Key Patterns

### Multi-Window Architecture

All windows share a single `index.html` entry point. Routing happens in `main.tsx` by reading `getCurrentWindow().label`:

- `"main"` → renders `<App />` (Quick Capture)
- `"dashboard"` → renders `<Dashboard />`
- `"settings"` → renders `<Settings />`

New windows are created from Rust via `WebviewWindowBuilder` in `lib.rs` (see `open_dashboard_window()`, `open_settings_window()`). Each gets the same `index.html` URL but a different label, which the frontend uses to pick the right component.

**Window properties:**
- **Quick Capture** (`main`): Defined in `tauri.conf.json`. Transparent, no decorations, hidden by default. On macOS, converted to an **NSPanel** via `tauri-nspanel` at startup so it can overlay fullscreen apps (like Raycast/Spotlight). Uses `NonactivatingPanel` style mask, `CanJoinAllSpaces | FullScreenAuxiliary` collection behavior, and `PopUpMenu` window level (101). Auto-hides on blur. Close is intercepted to hide instead.
- **Dashboard** (`dashboard`): Created dynamically. 1000x700, resizable, macOS overlay title bar. Single instance (reuses if open). Normal window (not NSPanel).
- **Settings** (`settings`): Created dynamically. 850x600, non-resizable, macOS overlay title bar. Single instance. Normal window (not NSPanel).

### Keyboard Navigation

All windows are fully navigable without a mouse. Browser-style Tab element cycling is suppressed globally.

#### Quick Capture — Insert/Normal Mode

The capture bar has two modes (state: `mode` in `App.tsx`):

- **Insert mode** (default): Input is focused, typing creates tasks. Esc with text clears the query; Esc with empty input enters normal mode.
- **Normal mode**: Input is blurred, `j/k` navigate the task list and actions. `i` or `/` returns to insert mode. Second Esc hides the window.

| Key (Insert) | Action |
|-----|--------|
| `Enter` | Create task from query |
| `Esc` | Clear query, or enter normal mode if empty |
| `⌘,` | Open settings |

| Key (Normal) | Action |
|-----|--------|
| `j` / `k` | Navigate down/up |
| `g` / `G` | Jump to first/last |
| `Enter` / `e` | Select item (edit task, open dashboard/settings) |
| `x` | Toggle task status (todo ↔ done) |
| `d` | Delete selected task |
| `o` | Open linked note |
| `i` | Return to insert mode |
| `/` | Return to insert mode (clears query) |
| `Esc` | Hide window |

#### Inline Task Editor (Quick Capture)

- `Tab` / `Shift+Tab` cycles between fields (title → description → status → priority → due date → tags)
- `Esc` in a field blurs it; `Esc` when no field focused closes the editor

#### Dashboard

Uses `useVimBindings()` hook:

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate down/up in list or within column |
| `h` / `l` | Navigate left/right between kanban columns |
| `Enter` / `e` | Open task editor pane |
| `x` | Toggle task status (todo ↔ done) |
| `s` | Cycle status through columns |
| `a` | Archive / unarchive task |
| `d` | Delete selected task |
| `o` | Open linked note (if exists) |
| `/` | Focus search input |
| `Escape` | Close editor or deselect task |

#### Settings

| Key | Action |
|-----|--------|
| `h` / `l` (or arrows) | Switch between tabs |
| `Esc` | Close settings window (blurs field first if focused) |

Bindings are ignored when typing in input fields.

### NLP Input Parsing

Tasks are created from natural language input. Format:
```
[Task Title] #[tag] ![priority] [date/time] [@zettel]
```

Examples:
- `Write docs #work !high` → task with tag "work", high priority
- `Meeting tomorrow at 2pm #sales` → task with due date
- `Review PR friday` → due next Friday
- `Deploy next monday` → due next Monday
- `Ship feature in 3 days !high` → due in 3 days
- `Conference Mar 25 #speaking` → due March 25
- `Plan next week` → due in 1 week
- `Research topic @zettel` → creates linked .md file in vault

Parsed by `parser.rs::parse_task_input()`.

### IPC Communication

Frontend calls Rust via Tauri's `invoke()`. All store actions guard with `__TAURI_INTERNALS__` check first:

```typescript
if (!('__TAURI_INTERNALS__' in window)) { return; }
const tasks = await invoke<Task[]>('get_tasks');
```

Available commands: `create_task`, `get_tasks`, `update_task` (partial patch), `update_task_status`, `delete_task`, `open_linked_note`, `get_settings`, `update_settings`, `update_theme`, `show_window`, `hide_window`, `open_dashboard_window`, `open_settings_window`, `get_columns`, `create_column`, `update_column`, `delete_column`, `reorder_columns`.

### UI Layout Pattern

The capture window uses a strict flex layout to prevent overflow issues:

```tsx
<Command className="flex flex-col overflow-hidden">
  {/* Fixed: flex-shrink-0 */}
  <div className="flex-shrink-0">Input Area</div>
  <div className="flex-shrink-0">Settings (when open)</div>

  {/* Scrollable: min-h-0 flex-1 overflow-y-auto */}
  <div className="min-h-0 flex-1 overflow-y-auto">
    <Command.List>Tasks & Commands</Command.List>
  </div>

  {/* Fixed: flex-shrink-0 */}
  <div className="flex-shrink-0">Footer</div>
</Command>
```

### Styling: Dark/Light Theme

The app supports dark (default) and light themes. Theme preference is stored in the `settings` table (`key = 'theme'`).

**Dark mode (default):**
- Background: `bg-[#111111]` (dashboard), `bg-zinc-950` (capture window)
- Borders: `border-zinc-800` (subtle)
- Text: `text-zinc-200` (primary), `text-zinc-400` (muted)
- Accent: `text-cyan-400` / `bg-cyan-500/10` for interactive elements

**Light mode:**
- Implemented via CSS-only overrides in `styles.css` scoped to `[data-theme="light"]`
- Overrides Tailwind utility classes and hex background colors
- No component code changes needed for theme — all in `styles.css`
- Theme is applied by setting `data-theme` attribute on `<html>` element

**Common rules:**
- Selection: `selection:bg-cyan-500/30`
- Font: Sans-serif for UI, monospace (font-mono) for metadata/tags
- Rounded: `rounded-lg` for containers, minimal radius for badges
- No shadows, minimal borders, high information density
- Dashboard uses `backdrop-blur-md` on header; **do not use `backdrop-blur` on the capture window** — it causes black-square rendering on the transparent main window

### Markdown Description Preview

The task editor pane has a preview toggle for the description field. The renderer (`renderMarkdown()` in `TaskEditorPane.tsx`) supports:
- **bold**, *italic*, `inline code`
- [links](url)
- `- ` list items
- `# ` / `## ` / `### ` headers
- ` ``` ` code blocks
- `> ` blockquotes

Styled with `.prose-jot` classes in `styles.css`. Light theme variants included.

### Kanban Board

Located in `components/KanbanBoard.tsx`:
- Dynamic columns from `kanban_columns` table (default: todo, in_progress, done)
- Uses @dnd-kit for drag-and-drop (sortable columns, draggable tasks)
- `activationConstraint: { distance: 5 }` prevents accidental drags
- Drag overlay shows task being moved
- Dropping task into new column calls `updateTaskStatus()` IPC

### Zettel Note Creation

When `@zettel` is in input:
1. Rust resolves vault path from settings or `JOT_VAULT_DIR` env var
2. Creates file: `YYYYMMDDHHMM-slugified-title.md`
3. Writes YAML frontmatter + H1 title
4. Returns absolute path, stored in `task.linked_note_path`
5. Clicking "Note" button opens via OS default (Obsidian, Neovim, etc.)

## Database Schema

SQLite located at OS AppData directory (`jot.db`):

Task `status` is a free-form string matching a `kanban_columns.status_key`, or the reserved value `"archived"`. `TaskStatus` is `string` in TypeScript; the `TaskStatus` Rust enum has been removed.

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'none',
    tags TEXT NOT NULL DEFAULT '[]',
    due_date TEXT,
    linked_note_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Known keys: 'vault_dir' (string path), 'theme' ('dark' | 'light')

CREATE TABLE kanban_columns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status_key TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0
);
-- Seeded with defaults: (To Do/todo), (In Progress/in_progress), (Done/done)
```

## Common Issues

- **Input appears as black square**: Remove `backdrop-blur`, ensure `bg-transparent` on Command.Input (capture window only — main window has `transparent: true` in tauri.conf.json)
- **Settings overlapping tasks**: Ensure fixed areas have `flex-shrink-0`, scrollable has `min-h-0 flex-1 overflow-y-auto`
- **Window not showing**: Check window is created with correct label; main window starts hidden by design
- **Tauri commands not available**: Always check `__TAURI_INTERNALS__ in window` before invoking
