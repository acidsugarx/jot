# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Jot** is a keyboard-centric task manager and Zettelkasten bridge built with Tauri v2. It runs as a system tray daemon with a global shortcut (Opt+Space) for quick task capture. Tasks are stored in SQLite; notes are created as .md files in an external Obsidian vault.

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
npm test               # Vitest
cargo test             # Rust unit tests (in src-tauri/)
```

## Architecture

### Backend (Rust + Tauri v2)

Located in `src-tauri/src/`:

| Module | Purpose |
|--------|---------|
| `lib.rs` | Tauri setup, system tray, global shortcuts, IPC command handlers |
| `db.rs` | SQLite CRUD operations, database migrations, zettel note creation |
| `models.rs` | Type definitions (Task, TaskStatus, TaskPriority, AppSettings) |
| `parser.rs` | NLP parser for raw input (extracts #tags, !priority, dates, @zettel) |

### Frontend (React + TypeScript)

Located in `src/`:

| Module | Purpose |
|--------|---------|
| `App.tsx` | Main UI - cmdk-based command palette with task list and settings |
| `store/use-task-store.ts` | Zustand store for state management and IPC calls |
| `types.ts` | TypeScript interfaces matching Rust backend |
| `components/ui/` | shadcn/ui components (Badge, Button, ScrollArea) |

## Key Patterns

### NLP Input Parsing

Tasks are created from natural language input. Format:
```
[Task Title] #[tag] ![priority] [date/time] [@zettel]
```

Examples:
- `Write docs #work !high` → task with tag "work", high priority
- `Meeting tomorrow at 2pm #sales` → task with due date
- `Research topic @zettel` → creates linked .md file in vault

Parsed by `parser.rs::parse_task_input()`.

### IPC Communication

Frontend calls Rust via Tauri's `invoke()`:

```typescript
import { invoke } from '@tauri-apps/api/core';

// All store actions check for Tauri availability first:
if (!('__TAURI_INTERNALS__' in window)) { return; }
const tasks = await invoke<Task[]>('get_tasks');
```

Available commands: `create_task`, `get_tasks`, `update_task_status`, `delete_task`, `open_linked_note`, `get_settings`, `update_settings`, `show_window`, `hide_window`.

### UI Layout Pattern

The App uses a strict flex layout to prevent overflow issues:

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

**Never use `backdrop-blur` or `transparent: true` in window config** - these cause rendering issues.

### Styling: Brutalist Dark Mode

- Background: `bg-zinc-950` (true black tones)
- Borders: `border-zinc-800` (subtle)
- Text: `text-zinc-200` (primary), `text-zinc-400` (muted)
- Accent: `text-cyan-400` / `bg-cyan-500/10` for interactive elements
- Font: Sans-serif for UI, monospace (font-mono) for metadata/tags
- Rounded: `rounded-lg` for containers, minimal radius for badges
- No shadows, minimal borders, high information density

### Zettel Note Creation

When `@zettel` is in input:
1. Rust resolves vault path from settings or `JOT_VAULT_DIR` env var
2. Creates file: `YYYYMMDDHHMM-slugified-title.md`
3. Writes YAML frontmatter + H1 title
4. Returns absolute path, stored in `task.linked_note_path`
5. Clicking "Note" button opens via OS default (Obsidian, Neovim, etc.)

## Database Schema

SQLite located at OS AppData directory (`jot.db`):

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
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
```

## Common Issues

- **Input appears as black square**: Remove `backdrop-blur`, ensure `bg-transparent` on Command.Input
- **Settings overlapping tasks**: Ensure fixed areas have `flex-shrink-0`, scrollable has `min-h-0 flex-1 overflow-y-auto`
- **Window not showing**: Check `transparent: false` in tauri.conf.json, avoid decorations
- **Tauri commands not available**: Always check `__TAURI_INTERNALS__ in window` before invoking
