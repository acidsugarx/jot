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

**You're in fullscreen.** Doesn't matter. jot renders as a native overlay — it appears over everything.

## Features

- **Instant capture** — `Opt+Space` summons the input bar, type your task, press Enter
- **Natural language** — `Meeting friday #work !high` parses tags, priority, and dates automatically
- **Dashboard** — `Cmd+Shift+Space` opens list, kanban, and calendar views
- **Vim everywhere** — `j/k` navigate, `x` toggle done, `e` edit, `s` cycle status, `d` delete
- **Obsidian bridge** — add `@zettel` to any task and a linked markdown note appears in your vault
- **Yougile sync** — connect your [Yougile](https://yougile.com) boards for team task management
- **Dark & light themes** — matches your system, instantly
- **Local-first** — your tasks live in SQLite on your machine. No account required

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
- **Windows** — `.msi`

### Build from source

```bash
git clone https://github.com/acidsugarx/jot.git
cd jot
npm install
npm run tauri build
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Opt+Space` | Open capture bar |
| `Cmd+Shift+Space` | Open dashboard |
| `Enter` | Create task / confirm |
| `Esc` | Dismiss / clear |
| `j` / `k` | Move up / down |
| `e` | Edit selected task |
| `x` | Toggle done |
| `s` | Cycle status |
| `d` | Delete task |
| `m` | Move to next column |
| `/` | Focus search |
| `?` | Show all shortcuts |

## Development

**Prerequisites:** Node.js 20+, Rust 1.77.2+, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run tauri dev
```

```bash
make ci        # full validation (fmt + clippy + typecheck + lint + test)
make package   # build OS-specific bundle
```

## Contributing

Bug reports and pull requests are welcome at [acidsugarx/jot](https://github.com/acidsugarx/jot).

## License

MIT License &copy; 2026 [Ilya Gilev](https://github.com/acidsugarx)
