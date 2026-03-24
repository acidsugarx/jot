# jot

[![CI](https://github.com/acidsugarx/jot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/acidsugarx/jot/actions/workflows/ci.yml)
[![Release](https://github.com/acidsugarx/jot/actions/workflows/release.yml/badge.svg)](https://github.com/acidsugarx/jot/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)

Keyboard-first task manager and Zettelkasten bridge. Runs as a system tray daemon with a Raycast-style capture bar that overlays fullscreen apps.

Built with Tauri v2 (Rust) + React + TypeScript.

## Features

- **Quick Capture** (`Opt+Space`) — command palette for rapid task entry with NLP parsing
- **Dashboard** (`Cmd+Shift+Space`) — list, kanban, and calendar views with vim bindings
- **Natural Language Input** — `Meeting friday #work !high @zettel` just works
- **Fullscreen Overlay** — capture window appears over fullscreen apps via NSPanel
- **Dark / Light Theme** — instant sync across all windows
- **Zettelkasten Bridge** — `@zettel` creates linked markdown notes in your Obsidian vault
- **Vim Navigation** — `j/k/h/l`, `e` edit, `x` toggle, `s` cycle status, `d` delete

## Install

Download the latest release from [Releases](https://github.com/acidsugarx/jot/releases), or build from source:

```bash
npm install
npm run tauri build
```

## Development

**Prerequisites:** Node.js 20+, Rust 1.77.2+, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run tauri dev
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Run app in development mode |
| `npm run lint` | Lint frontend |
| `npm run typecheck` | Type-check frontend |
| `npm test -- --run` | Run frontend tests |
| `cargo test` | Run Rust tests (from `src-tauri/`) |
| `cargo clippy --all-targets --all-features -- -D warnings` | Lint Rust (from `src-tauri/`) |

### Full validation

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test && cd ..
npm run lint && npm run typecheck && npm test -- --run && npm run build
```

## Architecture

```
src-tauri/src/
  lib.rs      Tauri setup, system tray, global shortcuts, NSPanel, IPC handlers
  db.rs       SQLite CRUD, migrations, zettel note creation
  models.rs   Type definitions
  parser.rs   NLP parser (tags, priority, dates, @zettel)

src/
  App.tsx              Quick capture window (cmdk palette + inline editor)
  Dashboard.tsx        Multi-view workspace (list/kanban/calendar)
  Settings.tsx         Configuration (vault path, theme)
  store/               Zustand store + Tauri IPC
  hooks/               Vim keybindings
  components/          Kanban board, calendar, task editor, shadcn/ui
```

## License

MIT License &copy; 2026 [Ilya Gilev](https://github.com/acidsugarx)
