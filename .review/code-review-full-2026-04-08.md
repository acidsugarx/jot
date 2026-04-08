# Jot Codebase Review

**Date**: 2026-04-08
**Scope**: Full codebase — frontend, Rust backend, architecture, performance, UX/UI, security, code quality

---

## Architecture & Structure

### The Good

- **Clean multi-window architecture**: Three distinct windows (capture overlay, dashboard, settings) each with their own React root, routed via `getCurrentWindow().label` in `src/main.tsx`. This is the correct Tauri pattern — each window is independent and lightweight.
- **Layered Rust backend**: Clear separation between `db.rs` (persistence), `parser.rs` (NLP), `yougile/` (API client), `models.rs` (types). Commands in `lib.rs` are thin wrappers that delegate to domain modules.
- **Focus engine as vanilla Zustand store** (`src/lib/focus-engine.ts`): Smart architectural choice — the focus engine is framework-agnostic, testable, and doesn't couple to React's render cycle. The `useFocusable` hook bridges it cleanly.
- **Keychain integration** (`src-tauri/src/db.rs:74-158`): API keys stored in macOS Keychain via `keyring` crate with test-mode fallback to in-memory HashMap. Clean `#[cfg(test)]` / `#[cfg(not(test))]` split.
- **DOMPurify sanitization layer** (`src/lib/sanitize.ts`): All user HTML passes through sanitization before rendering. Explicit allowlists for tags and attributes.

### The Bad

- **Giant component files**: `YougileTaskEditor.tsx` is 2194 lines, `App.tsx` is 2028 lines, `Dashboard.tsx` is 1483 lines, `db.rs` is 3434 lines. These are monoliths that mix concerns (state, effects, rendering, keyboard handling, API calls). A single component shouldn't exceed ~400 lines.
- **Store does too much**: `use-yougile-store.ts` manages accounts, projects, boards, columns, tasks, chat, file uploads, stickers, users, subtasks, and polling — all in one store. Should be split into domain stores (e.g., `use-yougile-auth-store`, `use-yougile-task-store`, `use-yougile-chat-store`).
- **No error boundaries**: The user hit a white screen crash from `TaskTemplatesSettings` — there's no React error boundary anywhere in the tree. One unhandled exception kills the entire window.
- **`dangerouslySetInnerHTML` + `contentEditable`**: This is inherently fragile. React's virtual DOM and the browser's contentEditable fight over ownership of the DOM. The codebase has already had multiple bugs from this pattern (event pooling crashes, cursor destruction, innerHTML loops).

### The Ugly

- **Inline HTML strings for checkboxes** (`src/components/YougileTaskEditor.tsx:551-558`): The `insertCheckbox` function builds CKEditor-compatible HTML by concatenating raw strings like `<ul class="todo-list"><li><span class="todo-list__label todo-list__label_without-description">...`. This is extremely fragile — any typo or structural change in Yougile's CKEditor output will silently break it.
- **`document.execCommand`**: Used throughout for formatting. This API is deprecated and behaves inconsistently across browsers. For a production editor, a proper rich-text library (ProseMirror, TipTap, Slate) would be far more reliable.
- **Polling every 30s** (`use-yougile-store.ts`): The store polls Yougile API every 30 seconds when the window is visible. No ETags, no delta sync, no WebSocket — full fetch every time. This will hit rate limits and waste bandwidth.

---

## Performance

### The Good

- **`useMemo` for derived data**: `activeTasks`, `visibleYougileTasks`, `yougileTasksByColumn`, `yougileColumnsAsKanban` are all properly memoized.
- **Virtual scrolling in capture overlay**: `ITEM_HEIGHT`, `MAX_VISIBLE_TASKS` constants suggest awareness of viewport-based rendering.
- **Rust `Mutex<Connection>`** for SQLite: Single-threaded access with proper locking. No async runtime overhead for DB calls.

### The Bad

- **No selector optimization in Zustand**: Components destructure many values from stores:
  ```typescript
  // src/Dashboard.tsx:377-398 — 20+ destructured values from useTaskStore
  const { tasks, columns, settings, error, isLoading, fetchTasks, ... } = useTaskStore();
  ```
  Every destructured value causes a re-render when ANY store property changes. Should use `useTaskStore(state => state.tasks)` selectors or `useShallow` from zustand.
- **`useYougileStore()` without selectors** (`src/App.tsx:377`, `src/Dashboard.tsx:400`): The entire yougile store object is subscribed. Every chat message, every sticker fetch, every polling cycle re-renders the parent component.
- **`structuredClone` on every task sync** (`YougileTaskEditor.tsx:271-273`): `cloneChecklists` deep-clones the entire checklist tree on every task identity change. For large checklists this is expensive.
- **Subtask resolution fetches individually** (`src/store/use-yougile-store.ts:743-783`): `fetchSubtaskTasks` calls `yougile_get_task` for each subtask ID sequentially with `Promise.all`. For tasks with 10+ subtasks, this creates 10+ HTTP requests.

### The Ugly

- **Focus engine re-renders**: `useFocusEngineStore((s) => s.activePane)` in `Dashboard.tsx:372-375` subscribes to the entire engine state. Any node registration, pane switch, or index change triggers a Dashboard re-render.
- **No debouncing on auto-save**: `save()` in `InlineTaskEditor` (`src/App.tsx:125-127`) fires `updateTask` on every blur. If the user tabs through fields quickly, it fires multiple sequential IPC calls.

---

## UX/UI

### The Good

- **Keyboard-first design**: Every action has a key binding. The focus engine with NORMAL/INSERT/COMMAND modes is well thought out. `j`/`k` navigation, `x` toggle, `d` delete, `o` add new — consistent vim-style UX.
- **Dark brutalist aesthetic**: Consistent zinc-950 backgrounds, zinc-800 borders, cyan-500 accents. Monospace metadata. The visual language is cohesive and distinctive.
- **Quick capture overlay**: NSPanel with transparent background, auto-hide on blur, `Opt+Space` global shortcut. This is the killer feature — instant task capture without context switch.
- **Double-press confirmation**: The `pendingConfirm` pattern for destructive actions (x/d) prevents accidental toggles/deletes without modal dialogs. Smart UX.
- **Breadcrumb navigation**: `Ctrl+W` → `h`/`l` to switch between org/project/board is efficient once learned.

### The Bad

- **No onboarding/discoverability**: There are no tooltips, no tutorial, no progressive disclosure. A new user has no idea what `Ctrl+W`, `j`/`k`, `x`, `d`, `o` do. The footer hints are minimal.
- **Inconsistent editor behavior**: The local task editor (`InlineTaskEditor`) uses standard `<input>`/`<textarea>` fields. The Yougile editor uses `contentEditable` with formatting toolbar. The template editor uses yet another `contentEditable` setup. Three different editing paradigms in one app.
- **No undo/redo**: There's no undo for task status toggles, deletions, or edits. A mistaken `x` press (even with double-confirm) is irreversible.
- **Column filter is ephemeral**: The quick capture column filter resets when the window closes. Users who always hide certain columns must re-filter every time.

### The Ugly

- **White screen crashes**: The `contentEditable` editors have crashed multiple times during development. No error boundaries exist. One crash = dead window with no recovery except restarting the app.
- **Escape key overload**: Escape does different things depending on context (close picker, close editor, navigate back from subtask, hide window, exit INSERT mode). The priority chain is complex and has had multiple bugs.
- **No loading states for Yougile**: When Yougile tasks are loading, there's often no skeleton/spinner. The list just appears empty, making it unclear if there are no tasks or if they're still loading.

---

## Security

### The Good

- **Path traversal protection**: `open_linked_note` canonicalizes paths and verifies they're within the vault directory (`src-tauri/src/db.rs:728-733`). `yougile_download_file` does the same.
- **URL scheme validation**: Only `http`/`https` URLs are opened (`src-tauri/src/lib.rs:284-287`).
- **API keys in Keychain**: Not stored in SQLite or plaintext.
- **DOMPurify sanitization**: All user HTML is sanitized before rendering.

### The Bad

- **No CSRF protection on Yougile API**: The API key is sent as a bearer token on every request. If the key is compromised, there's no additional protection.
- **`document.execCommand('insertHTML')`**: The smart paste handler inserts sanitized HTML via `execCommand`, but the sanitization happens before insertion. If DOMPurify misses something, it's already in the DOM.
- **No rate limiting on IPC commands**: A malicious or buggy frontend could spam `invoke()` calls. The Rust commands have no rate limiting or throttling.

---

## Code Quality

### The Good

- **Consistent error handling in Rust**: `db_error()` helper provides uniform error messages. `require_non_empty_id()` validates inputs at the boundary.
- **Type safety**: TypeScript strict mode, discriminated unions (`Task | YougileTask`), type predicates for narrowing.
- **Foreign key constraints**: Properly enforced with migration rebuild (`ensure_foreign_key_constraints`).
- **Test coverage**: Parser tests, slugify tests, formatting tests, sanitize tests, App component tests. Both Rust and TypeScript tests exist.

### The Bad

- **`eslint-disable` comments**: Multiple `// eslint-disable-next-line react-hooks/exhaustive-deps` in `YougileTaskEditor.tsx:390`, `YougileTaskEditor.tsx:1696`. These suppress legitimate warnings about missing dependencies.
- **`as` type assertions**: `focusRef as React.MutableRefObject<HTMLDivElement | null>` appears in both `LocalTaskListRow` and `YougileTaskListRow`. This is a code smell — the ref type should be handled properly.
- **Magic numbers**: `ITEM_HEIGHT = 36`, `GROUP_HEADER_HEIGHT = 28`, `MAX_VISIBLE_TASKS = 6`, `EDITOR_HEIGHT = 340` — these are scattered constants, not responsive values.
- **Inconsistent naming**: Mix of `handleTitleBlur`, `handleStatusChange`, `handleAddTag` (camelCase) with `onClose`, `onEdit`, `onDelete` (on-prefix). Both patterns exist without clear convention.

### The Ugly

- **3434-line `db.rs`**: This file contains every database operation, migration, helper, and test. It should be split into `db/migrations.rs`, `db/tasks.rs`, `db/columns.rs`, `db/settings.rs`, etc.
- **Copy-paste between editors**: `YougileTaskEditor` and `TaskTemplatesSettings` share ~200 lines of identical `contentEditable` logic (paste handler, keydown handler, checkbox insertion, formatting commands). This should be extracted into a shared `useRichTextEditor` hook.
- **`// eslint-disable-next-line @typescript-eslint/no-unused-vars`** in `normalizeChatHtml` (`YougileTaskEditor.tsx:178`): The `_label` parameter is declared but intentionally unused. The function signature should be refactored.

---

## Top 10 Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| **P0** | White screen crashes | Add React error boundaries to all three window roots |
| **P0** | Store re-render storms | Use Zustand selectors or `useShallow` for all store subscriptions |
| **P1** | 2194-line `YougileTaskEditor` | Extract sub-components: `DescriptionEditor`, `ChecklistEditor`, `SubtaskList`, `ChatPanel`, `StickerSection` |
| **P1** | Copy-paste editor logic | Create `useRichTextEditor()` hook shared between task editor and template editor |
| **P1** | Deprecated `document.execCommand` | Evaluate TipTap or ProseMirror for rich-text editing |
| **P2** | 3434-line `db.rs` | Split into `db/` module directory with separate files per domain |
| **P2** | No undo/redo | Implement undo stack for task mutations (at minimum for status toggles) |
| **P2** | Polling without delta sync | Add ETag/If-Modified-Since headers or switch to WebSocket for Yougile |
| **P3** | No onboarding | Add first-run tutorial or interactive cheat sheet overlay |
| **P3** | Ephemeral column filter | Persist `hiddenColumnIds` to localStorage or SQLite settings |
