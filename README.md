# Jot

[![CI](https://github.com/acidsugarx/jot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/acidsugarx/jot/actions/workflows/ci.yml)
[![Release](https://github.com/acidsugarx/jot/actions/workflows/release.yml/badge.svg)](https://github.com/acidsugarx/jot/actions/workflows/release.yml)

Jot is a keyboard-first desktop task manager built with Tauri (Rust) and React (TypeScript).
It is designed for quick capture, fast task flow, and optional Zettelkasten note linking.

## Current Status

- Foundation, tray behavior, and global shortcuts are implemented.
- SQLite persistence and task CRUD are implemented.
- Raw-input parser (`#tags`, `!priority`, dates, `@zettel`) is implemented.
- Settings window + dashboard foundation are implemented.
- Phase 5 (expanded dashboard + Vim-centric navigation) is in progress.

## Tech Stack

- Rust + Tauri v2
- React 18 + TypeScript + Vite
- Zustand
- SQLite (rusqlite)
- Tailwind CSS + cmdk

## Local Development

Prerequisites:

- Node.js 20+
- Rust stable (1.77.2+)
- Tauri OS dependencies (see the official Tauri prerequisites docs for your platform)

Install dependencies:

```bash
npm install
```

Run app in development mode:

```bash
cargo tauri dev
```

## Useful Commands

- Frontend dev: `npm run dev`
- Frontend build: `npm run build`
- Frontend lint: `npm run lint`
- Frontend typecheck: `npm run typecheck`
- Frontend tests (watch): `npm run test`
- Frontend tests (CI): `npm run test -- --run`
- Rust fmt check: `cargo fmt --check` (run in `src-tauri/`)
- Rust clippy: `cargo clippy --all-targets --all-features -- -D warnings` (run in `src-tauri/`)
- Rust tests: `cargo test` (run in `src-tauri/`)
