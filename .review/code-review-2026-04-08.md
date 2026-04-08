# Code Quality, Logic & Security Review — Jot Application

**Date**: 2026-04-08
**Scope**: Full codebase — Rust backend (`src-tauri/src/`) and TypeScript frontend (`src/`)

---

## 1. Security Issues

### S1. API keys stored in plaintext in SQLite
**File**: `src-tauri/src/db.rs:1979`
Yougile API keys are stored as plain text in the `yougile_accounts` table.
**Risk**: Any process or user with read access to `jot.db` can extract API keys.
**Recommendation**: Use the OS keychain (macOS Keychain via `keyring` crate) or encrypt keys at rest with a derived key.

### S2. `open_url` command lacks URL scheme validation
**File**: `src-tauri/src/lib.rs:266-293`
The `open_url` command only checks for empty strings but allows any URL scheme (`file://`, `javascript:`, etc.).
**Risk**: A compromised frontend could open `file:///etc/passwd` or trigger arbitrary scheme handlers.
**Recommendation**: Validate that the URL starts with `http://` or `https://`.

### S3. `open_linked_note` path traversal risk
**File**: `src-tauri/src/db.rs:492-536`
The command canonicalizes the path but doesn't verify it stays within the configured vault directory.
**Risk**: A crafted `linked_note_path` could open arbitrary files on the system.
**Recommendation**: Verify `canonical.starts_with(vault_dir_canonical)` before opening.

### S4. `yougile_download_file` path traversal — partial mitigation
**File**: `src-tauri/src/yougile/commands.rs:187-218`
Contains a `..` check but this is insufficient: `save_path` could contain encoded traversals or symlinks. The `canonicalize` approach is better but the `..` string check is redundant and gives false confidence.
**Recommendation**: Remove the string `..` check, rely solely on canonicalize, and optionally restrict to known safe directories.

### S5. DOMPurify `ALLOW_DATA_ATTR: false` conflicts with `data-*` in ALLOWED_ATTR
**File**: `src/lib/sanitize.ts:15-17`
`ALLOWED_ATTR` includes `'data-*'` but `ALLOW_DATA_ATTR: false` will strip all data attributes. This is a logic contradiction — `data-*` glob patterns require `ALLOW_DATA_ATTR: true`.
**Impact**: Data attributes are silently stripped even though the config intends to allow them.

### S6. `document.execCommand` is deprecated
**File**: `src/components/YougileTaskEditor.tsx:405`
The rich-text editor relies entirely on `document.execCommand` for formatting.
**Risk**: MDN marks it as deprecated; browsers may remove it.
**Recommendation**: Plan migration to `InputEvent`-based editing or a library like TipTap/ProseMirror.

### S7. `window.prompt()` used for link insertion
**File**: `src/components/YougileTaskEditor.tsx:420-421`
Uses `window.prompt()` which creates a system dialog that can't be styled and breaks keyboard flow.
**Recommendation**: Replace with an inline URL input component.

---

## 2. Code Quality Issues

### Q1. Massive component files
**Files**: `src/App.tsx` (1858 lines), `src/components/YougileTaskEditor.tsx` (1684 lines)
Both files are monolithic components with dozens of state variables and effects.
**Recommendation**: Extract sub-components (e.g., `TaskList`, `PickerPanel`, `ChatPanel`, `StickerSection`) into separate files.

### Q2. Repeated `isTauri()` / `'__TAURI_INTERNALS__' in window` guards
**Files**: Throughout frontend stores (`use-task-store.ts`, `use-yougile-store.ts`, `use-template-store.ts`)
All repeat the same `isTauri()` check at the start of every async method.
**Recommendation**: Create a shared `withTauri<T>(fn: () => Promise<T>): Promise<T | null>` wrapper or use an interceptor pattern.

### Q3. Duplicated date formatting logic
**Files**: `src/components/YougileTaskEditor.tsx:65-76`, `src/lib/formatting.ts:51-60`, `src/App.tsx:279,993`, `src/components/YougileTaskEditor.tsx:960,993`
Same pattern: `new Date().toISOString().split('T')[0]` repeated in multiple locations.
**Recommendation**: Consolidate into `src/lib/formatting.ts` with a `todayDateInput()` helper.

### Q4. Mutable ref pattern for `window.__jotActions`
**Files**: `src/App.tsx:1046-1094`, `src/components/YougileTaskEditor.tsx:334-382`
Both components write to a global `window.__jotActions` object, creating a race condition if both are mounted. The cleanup in `YougileTaskEditor` attempts to restore the previous value but this is fragile.
**Recommendation**: Use a proper event emitter or named action registry instead of a shared global.

### Q5. Error handling inconsistency in Rust
**File**: `src-tauri/src/db.rs`
Some functions use `map_err(|e| e.to_string())` (lines 1945, 1976) while others use `map_err(|error| format!("Failed to ...: {error}"))` (lines 302, 355).
**Recommendation**: Create a `DbError` type and implement `From<rusqlite::Error>` for consistent error messages.

### Q6. `db.rs` is 2725 lines
**File**: `src-tauri/src/db.rs`
Contains all database logic, migrations, CRUD, helpers, and tests.
**Recommendation**: Split into `db/migrations.rs`, `db/tasks.rs`, `db/columns.rs`, `db/tags.rs`, `db/checklists.rs`, `db/templates.rs`, `db/yougile_accounts.rs`, `db/settings.rs`.

### Q7. Dynamic SQL construction via string formatting
**Files**: `src-tauri/src/db.rs:1000-1079`, `1230-1292`, `1732-1767`, `1830-1862`
The `patch_task`, `patch_task_template`, `patch_checklist_item`, and `patch_tag` functions build SQL via `format!("UPDATE ... SET {} WHERE id = ?", sets.join(", "))`. While parameterized (safe from injection), this pattern is error-prone and hard to audit.
**Recommendation**: Consider using a query builder or at minimum a helper function like `fn build_patch_query(table: &str, sets: &[&str]) -> String`.

### Q8. `#[allow(dead_code)]` at module level
**File**: `src-tauri/src/yougile/models.rs:1`
Suppresses dead code warnings for the entire module instead of individual items.
**Recommendation**: Apply `#[allow(dead_code)]` only to specific unused items or remove unused items.

---

## 3. Logic Issues

### L1. Race condition in `YougileTaskEditor` sync effect
**File**: `src/components/YougileTaskEditor.tsx:276-287`
The `useEffect` that syncs local state from `task` prop depends only on `taskId` (intentional), but the `descHtml` sync at line 494-502 depends on `task.description` changes, creating a conflict where both effects can fight over the contentEditable content.
**Recommendation**: Use a single source of truth pattern — either always derive from prop or always use local state.

### L2. `checklists` dependency in `window.__jotActions` effect
**File**: `src/components/YougileTaskEditor.tsx:382`
The effect depends on `checklists` which changes on every checklist toggle, causing the entire `__jotActions` object to be re-created.
**Recommendation**: Use a ref for `checklists` in this effect (similar to `onSelectRef` pattern in `use-focusable.ts`).

### L3. Optimistic update without rollback in `moveTask`
**File**: `src/store/use-yougile-store.ts:535-557`
The optimistic update for `moveTask` does revert on error by re-fetching, but the re-fetch may return stale data if the server state hasn't settled.
**Recommendation**: Store the pre-optimistic state and restore it directly on error.

### L4. Module-level mutable state `lastFetchTime`
**File**: `src/store/use-yougile-store.ts:56`
`let lastFetchTime = 0` is module-level mutable state shared across all component instances.
**Risk**: In tests or if the store is recreated, this variable persists incorrectly.
**Recommendation**: Move into the Zustand store state.

### L5. `getBoardTasks` creates new `YougileClient` instances per column
**File**: `src-tauri/src/yougile/client.rs:118-137`
Each parallel task fetch spawns a new `YougileClient` with its own HTTP connection pool.
**Recommendation**: Clone the existing client (or use `Arc`) to reuse the connection pool.

### L6. `insert_task` doesn't insert `time_estimated`/`time_spent`
**File**: `src-tauri/src/db.rs:893-933`
The `Task` struct has `time_estimated` and `time_spent` fields (lines 341-342), the columns exist in the DB, but `insert_task` doesn't include them in the INSERT statement.
**Impact**: These fields are silently lost on task creation (they're always `None` anyway due to `CreateTaskInput` not having them, but this is a latent bug).

### L7. `yougile_download_file` canonicalize may fail for new files
**File**: `src-tauri/src/yougile/commands.rs:193-207`
The fallback logic tries to canonicalize the parent directory, but if the save path is in a non-existent directory, it fails with a confusing error.
**Recommendation**: Create parent directories explicitly before writing.

---

## 4. Performance Issues

### P1. `structuredClone` on every render of checklists
**File**: `src/components/YougileTaskEditor.tsx:231,281`
`structuredClone(task.checklists)` runs on every task prop change.
**Recommendation**: Only clone when the reference actually changes (compare by reference first).

### P2. No memoization on sticker rendering
**File**: `src/components/YougileTaskEditor.tsx:1335-1409`
The sticker definitions map re-renders all sticker inputs on any state change.
**Recommendation**: Use `React.memo` for individual sticker rows.

### P3. N+1 query pattern in `list_checklists`
**File**: `src-tauri/src/db.rs:1613-1639`
Fetches all checklists, then loops to fetch items for each checklist individually.
**Recommendation**: Use a JOIN query or batch fetch all items at once.

### P4. File upload sends bytes as `Array.from(new Uint8Array(bytes))`
**File**: `src/store/use-yougile-store.ts:673`
Converts `ArrayBuffer` to a regular JS array of numbers, which is extremely memory-inefficient for large files (each byte becomes a full JS number object).
**Recommendation**: Use Tauri's raw byte support or Base64 encoding.

### P5. Chat messages re-fetched with retry on every send
**File**: `src/store/use-yougile-store.ts:157-168`
`refreshChatAfterSend` fetches messages, checks for the new one, waits 300ms, and fetches again if not found.
**Recommendation**: Append the sent message optimistically and reconcile on next poll.

---

## 5. Best Practice Improvements

### B1. No input validation on Tauri command parameters
**Files**: Throughout `src-tauri/src/db.rs` and `src-tauri/src/yougile/commands.rs`
Tauri commands trust that the frontend sends valid data (e.g., valid UUIDs, non-negative positions).
**Recommendation**: Add validation at the IPC boundary, especially for IDs and user-provided strings.

### B2. Missing foreign key constraints
**File**: `src-tauri/src/db.rs:172-210`
- `checklist_items.checklist_id` has no FK constraint to `checklists.id`
- `task_tags.task_id` and `task_tags.tag_id` have no FK constraints
**Impact**: Orphaned records possible if parent deletion fails partway.
**Recommendation**: Add `REFERENCES` clauses and `ON DELETE CASCADE`.

### B3. No database migration versioning
**File**: `src-tauri/src/db.rs:62-244`
Migrations use `ALTER TABLE ... ADD COLUMN` with existence checks instead of a versioned migration system.
**Risk**: Migration ordering becomes fragile as more migrations are added.
**Recommendation**: Use a `_migrations` table with version numbers.

### B4. `unwrap_or_else(|_| Client::new())` swallows HTTP client build errors
**File**: `src-tauri/src/yougile/client.rs:13-17`
If the client builder fails (e.g., TLS backend unavailable), it silently falls back to a default client.
**Recommendation**: Log the error or propagate it.

### B5. `Map` in Zustand state causes unnecessary re-renders
**File**: `src/lib/focus-engine.ts:45-46`
`panes: Map<string, PaneConfig>` and `nodes: Map<string, FocusNode[]>` are mutable objects. Zustand uses reference equality by default, but `new Map(state.panes)` creates a new map on every registration change.
**Recommendation**: Consider using plain objects or a proper immutable Map implementation.

### B6. No TypeScript `strict` null checks on DOM operations
**File**: `src/components/YougileTaskEditor.tsx:35`
`(ref as React.MutableRefObject<HTMLDivElement | null>).current = node` bypasses type safety.
**Recommendation**: Use a proper callback ref pattern.

### B7. `any` type in `patch_task` values vector
**File**: `src-tauri/src/db.rs:1002`
`values: Vec<Box<dyn rusqlite::types::ToSql>>` — while not technically `Any`, the dynamic typing makes it easy to introduce type mismatches.
**Recommendation**: Consider a typed builder pattern.

---

## 6. Missing Test Coverage

### T1. No frontend tests found
Despite Vitest being configured, no test files were found in `src/`.
**Recommendation**: Add tests for:
- `tokenize()` in `src/lib/formatting.ts`
- `sanitizeHtml()` in `src/lib/sanitize.ts`
- Focus engine dispatch logic
- Store actions (mocked Tauri invoke)

### T2. No integration tests for Yougile API client
**File**: `src-tauri/src/yougile/client.rs`
The client has no tests; only the models have unit tests.
**Recommendation**: Add mock-based tests for pagination, error handling, and retry logic.

### T3. No test for `slugify_title`
**File**: `src-tauri/src/db.rs:2031-2046`
This function handles Unicode and special characters but has no edge case tests.
**Recommendation**: Test with Unicode, empty strings, all-special-char strings, and very long titles.

---

## Architecture Strengths

- The dual-task system (local + Yougile) is well-designed with clear type separation
- The focus engine is a thoughtful vim-style navigation system with proper mode management
- Cross-window sync via Tauri events is correctly implemented
- The NLP parser is comprehensive with good test coverage
- Security on the download path (URL validation to yougile.com domain) shows awareness

## Architecture Concerns

- The frontend stores are becoming god objects — `use-yougile-store.ts` at 789 lines manages auth, navigation, tasks, chat, file uploads, and sync state
- The `window.__jotActions` global is a code smell that will cause bugs as the app grows
- The Rust `db.rs` at 2725 lines needs decomposition before adding more features

---

## 7. NLP Locale / Internationalization Issues

### L-NLP-1. No OS locale awareness
**Files**: `src-tauri/src/parser.rs:84-227`, `src-tauri/Cargo.toml:21`
The parser never queries the OS locale. On macOS, `sys-locale::get_locale()` returns values like `"ru_RU"`, `"de_DE"`, etc. The `chrono` crate supports locale-aware formatting via the `unstable-locales` feature, but the parser doesn't attempt to use it.
**Impact**: Users with non-English system locales cannot enter dates naturally in their language.

### L-NLP-2. Weekdays — English only
**File**: `src-tauri/src/parser.rs:187-198`
`parse_weekday()` matches only `"monday"`, `"mon"`, `"tuesday"`, `"tue"`, etc. Inputs like `"понедельник"`, `"пн"`, `"пятница"`, `"пт"`, `"Montag"`, `"Mo"`, `"lundi"`, `"lun"` are silently consumed as title text.

### L-NLP-3. Months — English only
**File**: `src-tauri/src/parser.rs:211-227`
`parse_month_name()` matches only `"jan"`, `"january"`, etc. Localized month names like `"январь"`, `"март"`, `"Januar"`, `"mars"`, `"янв"` are not recognized.

### L-NLP-4. Relative expressions — English only
**File**: `src-tauri/src/parser.rs:89-141`
`"today"`, `"tomorrow"`, `"next"`, `"in"`, `"week"`, `"day"/"days"` are all hardcoded. Russian equivalents `"сегодня"`, `"завтра"`, `"следующий"`, `"через"`, `"неделя"/"недель"`, `"день"/"дня"/"дней"` are completely ignored. Same for German, French, etc.

### L-NLP-5. AM/PM — English only
**File**: `src-tauri/src/parser.rs:283-289`
`parse_time_token()` recognizes only `"am"`/`"pm"`. Russian-speaking users typically use 24h format, but may also write `"утра"`/`"вечера"` or `"дп"`/`"пп"`.

### L-NLP-6. Frontend highlighting not synced with parser
**File**: `src/components/HighlightedInput.tsx:47-55`
The highlight layer has its own hardcoded English keyword list (`"today"`, `"tomorrow"`, `"at"` + AM/PM regex) that is not shared with the Rust parser. Adding localized keywords to one would not be reflected in the other.

### L-NLP-7. No infrastructure for adding locales
There is no keyword map system, config file, or plugin mechanism for adding new languages. Each new language requires editing multiple hardcoded `match` arms in Rust and a separate regex set in TypeScript.

### Recommended Approach for Locale Support

**Step 1 — Add `sys-locale` + chrono `unstable-locales` feature**

In `Cargo.toml`:
```toml
chrono = { version = "0.4", features = ["clock", "serde", "unstable-locales"] }
sys-locale = "0.3"
```

`sys-locale::get_locale()` returns the OS locale (e.g. `"ru-RU"`, `"en-US"`). The `unstable-locales` feature (named for API stability, not functionality) provides `chrono::Locale::try_from_str()` and locale-aware formatting.

**Step 2 — Create a localized keyword registry**

Create `src-tauri/src/parser/locale_keywords.rs`:
```rust
use chrono::Weekday;

struct LocaleKeywords {
    today: Vec<&'static str>,
    tomorrow: Vec<&'static str>,
    next: Vec<&'static str>,
    week: Vec<&'static str>,
    in_offset: Vec<&'static str>,
    at: Vec<&'static str>,
    day_units: Vec<&'static str>,
    week_units: Vec<&'static str>,
    weekdays: Vec<(&'static str, Weekday)>,
    weekdays_short: Vec<(&'static str, Weekday)>,
    months: Vec<(&'static str, u32)>,
    months_short: Vec<(&'static str, u32)>,
}
```

Provide implementations for `"en"`, `"ru"`, `"de"`, `"fr"`, etc. with fallback to English. Select at startup based on `sys-locale::get_locale()`.

**Step 3 — Parameterize the parser**

Refactor `parse_due_date_tokens()`, `parse_weekday()`, `parse_month_name()` to accept `&LocaleKeywords` instead of hardcoded strings. The top-level `parse_task_input()` selects the correct keywords once.

**Step 4 — Expose keywords to frontend highlighting**

Add a Tauri command `get_nlp_keywords` that returns the localized keywords as JSON. `HighlightedInput.tsx` uses them to build its regexes dynamically. This keeps highlighting in sync with the parser.

**Step 5 — Add per-locale tests**

```rust
#[test]
fn parses_russian_weekdays() {
    let parsed = parse_task_input("Встреча пятница");
    assert_eq!(parsed.title, "Встреча");
    assert!(parsed.due_date.is_some());
}

#[test]
fn parses_russian_relative_dates() {
    let parsed = parse_task_input("Созвон через 3 дня");
    assert_eq!(parsed.title, "Созвон");
    assert!(parsed.due_date.is_some());
}
```

---

## Recommended Prioritization

1. **Priority 1 — Security**: Address S1 (plaintext API keys) and S2 (URL scheme validation) first
2. **Priority 2 — Stability**: Fix L2 (checklists dependency in `__jotActions`) and Q4 (global action registry)
3. **Priority 3 — Performance**: Address P4 (file upload byte conversion) and P3 (N+1 checklist queries)
4. **Priority 4 — Maintainability**: Decompose `db.rs`, `App.tsx`, and `YougileTaskEditor.tsx`
5. **Priority 5 — Test coverage**: Add frontend unit tests and Rust integration tests
6. **Priority 6 — NLP Locale**: Add OS locale detection and localized keyword support to the NLP parser and frontend highlighting
