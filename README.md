<div align="center">

# jot

Capture thoughts before they escape.

Keyboard-first task manager for people who think in keystrokes.

[![CI](https://github.com/acidsugarx/jot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/acidsugarx/jot/actions/workflows/ci.yml)
[![Release](https://github.com/acidsugarx/jot/actions/workflows/release.yml/badge.svg)](https://github.com/acidsugarx/jot/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)

</div>

---

`Opt+Space` → type a thought → done.

No windows to open, no buttons to click. jot lives in your menu bar and shows up when you need it — even over fullscreen apps.

```
Meeting with Sarah friday #work !high @zettel
```

Tags, priority, due date, and a linked note — all from one line. No forms, no clicks.

## Why jot?

**You're in a meeting.** Someone says "we need to follow up on the API migration." You hit `Opt+Space`, type the task, and you're back to paying attention. Two seconds, zero context switch.

**You're coding.** You're in the zone and remember a bug. `Opt+Space`, type it, back to coding. Your flow never breaks.

**You're in fullscreen.** Doesn't matter. jot renders as a native macOS overlay — it appears over everything.

---

## Features

### Instant Capture

Press `Opt+Space` and start typing. jot's capture bar appears as a native overlay on top of any application, including fullscreen windows. Type your task, press `Enter`, and it disappears. The entire interaction takes under two seconds.

The input bar doubles as a command palette — navigate tasks with `j`/`k`, open the editor with `e`, toggle done with `x`, or switch into command mode with `:` to trigger actions.

### Natural Language Parsing

jot parses structured syntax inline as you type, with live syntax highlighting:

```
Write architecture review tomorrow at 10am #work !high @zettel
```

| Syntax | Effect |
|--------|--------|
| `#tag` | One or more tags |
| `!high` | Priority (`low`, `medium`, `high`, `urgent`) |
| `tomorrow`, `friday`, `next week` | Due date (natural language) |
| `@zettel` | Create a linked markdown note in your vault |

NLP suggestions appear as you type — recognized tags, priorities, dates, and the zettel flag are highlighted in real-time.

### Dashboard

Press `Cmd+Shift+Space` to open the full dashboard with three views:

- **List view** — Dense, scannable task rows with inline status, priority, tags, and due dates
- **Kanban board** — Drag-and-drop columns powered by `@dnd-kit`, customizable column names and order
- **Calendar view** — Date-based task layout for deadline-aware planning

A sidebar provides quick filters: inbox, today, tag-based, and status-based. A source switcher toggles between local tasks and Yougile boards with `Tab`.

### Vim-First Navigation

Every surface is keyboard-driven. The focus engine provides three modes:

| Mode | Purpose | Keys |
|------|---------|------|
| **NORMAL** | Navigate and act | `j`/`k` move, `x` toggle, `e` edit, `d` delete, `s` cycle status, `m` move column |
| **INSERT** | Type text | Automatic in input fields |
| **COMMAND** | Search and pick | `/` search, `:` actions |

The mode indicator shows the current state. Escape always returns to NORMAL or closes the current context.

### Rich-Text Task Editor

Both local and Yougile tasks open in a slide-in editor pane with full keyboard navigation:

- **Title** — Auto-resizing, saves on blur
- **Description** — Rich-text editor (contentEditable) with formatting toolbar: bold, italic, strikethrough, links, ordered/unordered lists, code blocks, checkboxes
- **Keyboard shortcuts** — `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link, smart URL paste
- **Status, Priority, Due Date** — Inline selectors, auto-save on change
- **Tags** — Type to add, backspace to remove
- **Checklists** — Nested checklist items with add/toggle/edit/delete
- **Subtasks** — Yougile subtask management with inline creation
- **Color labels** — Per-task color coding
- **Assignees** — Multi-user assignment for Yougile tasks
- **Stickers** — Sprint and string sticker support
- **Chat** — Thread-based task chat with file attachments
- **Time tracking** — Stopwatch display with elapsed time

Every field in the editor is a focusable node — `j`/`k` steps between fields, `Enter` activates, `i` enters edit mode.

### Yougile Integration

Connect your [Yougile](https://yougile.com) workspace for team task management:

- **Multi-account** — Add multiple Yougile organizations and switch between them
- **Hierarchy navigation** — Browse organizations → projects → boards → columns with breadcrumb navigation
- **Full task sync** — Create, edit, and manage Yougile tasks directly from jot
- **Real-time updates** — 30-second polling keeps tasks in sync when the window is visible
- **Rich descriptions** — Full CKEditor 5 compatibility for viewing and editing Yougile descriptions
- **File uploads** — Attach files to tasks via drag-and-drop or paste
- **Board columns** — Map Yougile columns to jot's kanban view

### Obsidian Bridge

Add `@zettel` to any task and jot generates a timestamped markdown note in your configured vault:

```
202604081400-write-architecture-review.md
```

The note includes YAML frontmatter, an H1 title, and a back-link. Click the note icon on any task to open it in Obsidian or your configured editor. The vault path is configurable in Settings.

### Task Templates

Create reusable task templates with pre-filled fields:

- Title, description, status, priority, tags, and due date
- Templates appear in the capture bar — select one to pre-fill a new task
- Manage templates from Settings or the capture bar's "Manage Templates" action
- Rich-text description editor for template content

### Kanban Board

Customize your workflow with flexible columns:

- Default columns: Todo, In Progress, Done
- Add, rename, reorder, and delete columns
- Drag-and-drop tasks between columns via `@dnd-kit`
- Column protection — can't delete a column that has tasks
- Hidden column filter in the capture bar to show/hide columns per session

### Dark & Light Themes

jot matches your system appearance. The dark theme uses a brutalist zinc-950 palette with cyan accents. The light theme provides clean, high-contrast visibility with proper overrides for every surface — selection indicators, editor rings, prose rendering, and interactive states.

### Local-First Architecture

Your tasks live in SQLite on your machine. No account required, no cloud dependency, no network latency. All data is stored in the OS-native application data directory. Yougile sync is optional and additive.

---

## Install

### Homebrew (macOS)

```bash
brew tap acidsugarx/tap
brew install --cask jot

xattr -d com.apple.quarantine /Applications/jot.app
```

### Download

Grab the latest installer from [Releases](https://github.com/acidsugarx/jot/releases):

- **macOS** — `.dmg` (Apple Silicon)
- **Linux** — `.AppImage`

### Build from source

```bash
git clone https://github.com/acidsugarx/jot.git
cd jot
npm install
npm run tauri build
```

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Opt+Space` | Open capture bar |
| `Cmd+Shift+Space` | Open dashboard |

### Capture Bar

| Key | Action |
|-----|--------|
| `Enter` | Create task / confirm |
| `Esc` | Dismiss / clear / close editor |
| `j` / `k` | Navigate tasks and actions |
| `e` | Edit selected task |
| `x` | Toggle done |
| `d` | Delete task (press twice to confirm) |
| `s` | Cycle status |
| `m` | Move to next column |
| `:` | Enter command mode |
| `/` | Focus search |

### Dashboard

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate task list |
| `h` / `l` | Navigate between panes |
| `e` | Open editor for selected task |
| `x` | Toggle done |
| `d` | Delete task (press twice to confirm) |
| `s` | Cycle status |
| `m` | Move to next column |
| `Tab` | Switch between local and Yougile sources |
| `/` | Focus search |
| `Esc` | Close editor / return to list |

### Task Editor

| Key | Action |
|-----|--------|
| `j` / `k` | Move between fields |
| `Enter` | Activate field / open dropdown |
| `i` | Enter edit mode on text fields |
| `Esc` | Return to field navigation |

### Rich-Text Description

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+K` | Insert link |
| `Ctrl+Shift+S` | Strikethrough |
| `Ctrl+Shift+C` | Insert checkbox |

---

## Architecture

jot is built on a multi-window Tauri v2 architecture with a Rust backend and React frontend:

```
┌─────────────────────────────────────────────────────┐
│  macOS NSPanel (Opt+Space)                          │
│  Capture overlay — always-on-top, transparent       │
│  React root → App.tsx                               │
├─────────────────────────────────────────────────────┤
│  Standard Window (Cmd+Shift+Space)                  │
│  Dashboard — list/kanban/calendar views             │
│  React root → Dashboard.tsx                         │
├─────────────────────────────────────────────────────┤
│  Settings Window                                    │
│  Configuration — accounts, vault, appearance        │
│  React root → Settings.tsx                          │
└─────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌───────────────┐
│  Rust Backend    │  │  Yougile API  │
│  SQLite (local)  │  │  REST (sync)  │
│  NLP Parser      │  │               │
│  Zettel Bridge   │  │               │
└─────────────────┘  └───────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Tauri v2 |
| Database | SQLite via rusqlite |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| State | Zustand (with shallow selectors) |
| Drag & Drop | @dnd-kit |
| Command Palette | cmdk |
| Icons | Lucide React |
| Sanitization | DOMPurify |
| API Client | reqwest (Rust) |

### Project Structure

```
src/                      # Frontend (React + TypeScript)
├── components/           # UI components
│   ├── YougileTaskEditor.tsx   # Rich task editor
│   ├── TaskEditorPane.tsx      # Local task editor
│   ├── KanbanBoard.tsx         # Drag-and-drop kanban
│   ├── CalendarView.tsx        # Calendar date view
│   ├── ErrorBoundary.tsx       # Crash recovery
│   └── ...
├── hooks/                # React hooks
│   ├── use-rich-text-editor.tsx  # Shared editor logic
│   ├── use-focus-engine.ts       # Focus engine hooks
│   └── use-focusable.ts          # Focusable item registration
├── lib/                  # Utilities
│   ├── focus-engine.ts          # Vim-mode navigation store
│   ├── sanitize.ts              # DOMPurify wrapper
│   ├── formatting.ts            # Date/text formatting
│   └── yougile-editor.ts        # Editor helper functions
├── store/                # Zustand state
│   ├── use-task-store.ts        # Local tasks (SQLite)
│   └── use-yougile-store.ts     # Yougile tasks (API)
└── types/                # TypeScript types

src-tauri/src/            # Backend (Rust)
├── lib.rs                # Tauri commands, windows, shortcuts
├── db/                   # Database layer (modular)
│   ├── mod.rs                  # Commands + DatabaseState
│   ├── migrations.rs           # Schema migrations
│   ├── tasks.rs                # Task CRUD
│   ├── columns.rs              # Kanban columns
│   ├── templates.rs            # Task templates
│   ├── checklists.rs           # Checklist items
│   ├── tags.rs                 # Tags
│   ├── settings.rs             # App settings
│   ├── notes.rs                # Zettel note generation
│   ├── yougile_accounts.rs     # Yougile auth
│   └── utils.rs                # Query builders
├── models.rs             # Data types
├── parser.rs             # NLP parser
└── yougile/              # Yougile API client
    ├── auth.rs
    ├── client.rs
    ├── commands.rs
    └── models.rs
```

---

## Development

**Prerequisites:** Node.js 20+, Rust 1.77.2+, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
# Install dependencies
npm install

# Start dev server (frontend hot-reload + Rust recompile)
npm run tauri dev

# Run all checks
make ci        # fmt + clippy + typecheck + lint + test + build

# Individual commands
npm run dev           # Frontend only
npm run typecheck     # TypeScript check
npm run lint          # ESLint
npm run test -- --run # Vitest
cd src-tauri && cargo test   # Rust tests
cd src-tauri && cargo clippy # Rust linter

# Build for production
npm run tauri build
make package          # OS-specific bundle
```

---

## Contributing

Bug reports and pull requests are welcome at [acidsugarx/jot](https://github.com/acidsugarx/jot).

Please run `make ci` before submitting — it catches formatting, linting, type, and test issues across both Rust and TypeScript.

---

## License

MIT License &copy; 2026 [Ilya Gilev](https://github.com/acidsugarx)
