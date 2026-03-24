# AGENTS.md

## Purpose
This repository now contains a working bootstrap for the Jot desktop app.
This file is the operating guide for coding agents working here.
Keep it updated as commands, configs, and architectural boundaries evolve.

## Repository Reality
- Source of truth: `PRD.md`
- Frontend scaffold exists with `package.json`, Vite, TypeScript, Tailwind, ESLint, and Vitest
- Tauri v2 backend scaffold exists in `src-tauri/` with Cargo manifest, config, icons, and capabilities
- Phase 1 foundation includes hidden-window startup, tray behavior, global shortcut registration, and IPC commands for `show_window` / `hide_window`
- Phase 2 foundation now includes SQLite initialization in app data, a persisted `tasks` table, Rust task types, and CRUD IPC commands
- Phase 3 foundation now includes raw-input parsing for tags/priority/dates, `@zettel` note generation via `JOT_VAULT_DIR`, and `open_linked_note`
- Phase 4 foundation includes a completely native standalone Settings Window (Raycast-style overlay), a Zustand store, task list display, and CmdK popup capture.
- **Phase 5 (Next)**: We are moving to the expanded Dashboard View (Board/List), robust Vim-centric bindings (j/k, x, o), and routing between the transient popup and deep management.
- GitHub Actions now include CI validation (`.github/workflows/ci.yml`) and tagged release publishing (`.github/workflows/release.yml`)
- No Cursor rules found in `.cursor/rules/` or `.cursorrules`
- No Copilot instructions found in `.github/copilot-instructions.md`
- The git repo currently has no commits

## Intended Stack
Derived from `PRD.md`:
- Rust + Tauri v2 backend/system layer
- React 18 + TypeScript + Vite frontend
- Tailwind CSS + `cmdk` UI stack
- Zustand state management
- SQLite persistence
- Nushell automation/scripts

Agents should assume this architecture unless the user changes direction.

## Delivery Order
Follow the PRD sequence unless explicitly told otherwise:
1. Foundation and IPC setup
2. Database and core Rust logic
3. NLP parsing and Zettel bridge
4. Transient React UI
5. Dashboard and Vim-style bindings

Do not prioritize polished UI over unfinished Rust core or IPC work.

## Commands

### Current State
The bootstrap is in place and these commands are available now.
Run them from the repository root unless a command explicitly targets `src-tauri/`.

### Standard Commands

#### Frontend
- Install deps: `npm install`
- Make helper overview: `make help`
- Dev server: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Test all: `npm run test`
- Test once/CI: `npm run test -- --run`
- Single test file: `npm run test -- src/path/to/file.test.ts`
- Single named test: `npm run test -- -t "test name"`

Preferred runner: Vitest.
Useful fallback: `npx vitest run src/path/to/file.test.ts -t "test name"`.

#### Rust / Tauri
- Check: `cargo check`
- Build: `cargo build`
- Test all: `cargo test`
- Single Rust test: `cargo test test_name`
- Filtered Rust tests: `cargo test parser::`
- Parser-specific tests: `cargo test parser::tests::`
- Format: `cargo fmt`
- Lint: `cargo clippy --all-targets --all-features -- -D warnings`
- Tauri dev: `cargo tauri dev`
- Tauri build: `cargo tauri build`

#### Makefile Helpers
- Package for current OS: `make package`
- Install current OS build locally: `make install-local`
- Local validation wrapper: `make ci`
- Rust fmt: `make fmt`
- Rust fmt check: `make fmt-check`
- Cross-stack lint: `make lint`

#### Recommended Full Validation Sequence
When both stacks exist, prefer:
1. `cargo fmt --check`
2. `cargo clippy --all-targets --all-features -- -D warnings`
3. `cargo test`
4. `npm run lint`
5. `npm run typecheck`
6. `npm run test -- --run`
7. `npm run build`

If a wrapper is added later, prefer a single `make ci`, `npm run ci`, or `just ci` target and document it here.

### GitHub Automation
- CI workflow: `.github/workflows/ci.yml` (runs on PR + push to `main`)
- Release workflow: `.github/workflows/release.yml` (runs on `v*` tags and publishes release assets)

## Single-Test Guidance
When the user asks for one test, run the narrowest target first.
- Frontend file: `npm run test -- src/path/to/file.test.ts`
- Frontend case: `npm run test -- -t "exact or partial name"`
- Rust exact test: `cargo test exact_test_name`
- Rust module filter: `cargo test parser::`

If workspaces/packages are introduced later, target the specific package before the whole repo.

## Code Style
These rules are inferred from `PRD.md` and the current scaffold and should act as defaults.

### General
- Keep modules small and composable
- Prefer explicit, readable code over clever abstractions
- Preserve keyboard-first UX in every user flow
- Keep implementation aligned with the current PRD phase
- Write code that another agent can extend safely

### Imports And Dependencies
- Group imports as standard library, third-party, then internal
- Remove unused imports immediately
- Prefer named imports in TypeScript unless a library strongly prefers defaults
- Avoid deep relative import chains once path aliases are available
- Do not add new dependencies unless the current stack cannot solve the problem cleanly

### Formatting
- Use the repo formatter and linter configs already present; do not hand-fight them
- Rust should follow `rustfmt`
- TypeScript/React should stay consistent with the existing ESLint + Vite + Tailwind setup
- Keep lines readable instead of aggressively compact
- Use trailing commas where the formatter expects them

### Types And Models
- Prefer precise types over `any` or loosely shaped objects
- Model task status/priority as enums or discriminated unions in app code
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
- Add tests alongside new logic once infrastructure exists
- Prioritize parser, SQLite CRUD, and path-generation tests
- Add integration tests for Tauri commands when feasible
- Add focused component tests for command palette and keyboard navigation
- Prefer deterministic tests over time-dependent behavior

### UI / UX Constraints
- Match the PRD's developer-first, high-density, keyboard-led feel
- Favor list workflows over bulky cards
- Keep shortcuts visible where relevant
- Use monospace for metadata and parsed operators
- Avoid clutter, heavy chrome, and mouse-first patterns

### Comments And Docs
- Add comments only when intent is not obvious from the code
- Document invariants, parser assumptions, and OS-specific behavior
- Keep docs aligned with implementation, not aspiration
- Update this file when commands or conventions become real

## Agent Workflow
- Read `PRD.md` before making architectural changes
- Check whether requested work belongs to the current phase
- Prefer real commands from this file over aspirational placeholders
- Prefer conventional file names and standard scripts when bootstrapping
- Update this file when scripts, test targets, or project layout change

## Rule File Status
At creation time:
- `.cursor/rules/`: not present
- `.cursorrules`: not present
- `.github/copilot-instructions.md`: not present

If any of those files are added later, merge their instructions into this document and avoid contradictions.
