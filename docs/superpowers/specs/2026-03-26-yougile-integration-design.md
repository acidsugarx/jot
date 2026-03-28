# Yougile Integration — Design Spec

**Date:** 2026-03-26
**Status:** Approved

## Overview

Add Yougile (project management service) as a live remote data source to Jot. Users can switch between local SQLite tasks and Yougile tasks within the same UI. Yougile mode operates as a native macOS/Linux/Windows client — always fetching live data, no local sync or caching.

Additionally, enhance local tasks with features borrowed from Yougile: subtasks, checklists, colored tags, task/column colors, and time tracking.

## Goals

- Use Jot as a full Yougile task management client without opening a browser
- Switch between personal and work Yougile organizations seamlessly
- Keep local task mode fully independent — no data mixing
- Enhance local tasks with subtasks, checklists, colored labels, colors, time tracking
- Cross-platform: macOS, Linux, Windows — no OS-specific code
- Kill switch in Settings to disable all Yougile features (off by default)

## Non-Goals

- Chat/messaging integration (Yougile has group chats — we skip them)
- CRM/deal integration
- Offline queue or background sync
- User management or department administration
- File uploads/attachments (follow-up)
- Webhook consumption (no server to receive them)

---

## Architecture

### Approach: Rust-side Provider

All Yougile HTTP calls live in Rust. The frontend talks to Tauri IPC commands that dispatch to the right backend — SQLite for local, HTTP for Yougile.

```
Frontend (React)
    |
    v
Tauri IPC commands
    |
    +-- source == "local"   --> db.rs (SQLite)
    +-- source == "yougile" --> yougile/client.rs (HTTP --> Yougile API)
```

The Yougile IPC commands are separate from local commands (e.g. `yougile_get_tasks` vs `get_tasks`) since the data shapes differ. No shared dispatch layer — clean separation.

---

## Rust Backend

### Module Structure

```
src-tauri/src/
    yougile/
        mod.rs          -- public module exports
        client.rs       -- HTTP client (reqwest), all API calls
        models.rs       -- Yougile DTOs, serialization
        auth.rs         -- login flow, key generation, key storage
        mapper.rs       -- transforms between Yougile DTOs and IPC response types
    db.rs               -- existing + new schema migrations
    models.rs           -- existing + new local types (subtasks, checklists, etc.)
    lib.rs              -- existing + new IPC command registrations
```

### HTTP Client (`client.rs`)

- `reqwest` with `Bearer <jwt>` authorization header
- `YougileClient` struct: base URL (`https://yougile.com/api-v2`) + active API key
- Async methods mirroring the API:
  - `get_projects()`, `get_boards(project_id)`, `get_columns(board_id)`
  - `get_tasks(column_id)`, `create_task(...)`, `update_task(...)`, `delete_task(...)`
  - `get_subtasks(task_id)`, `update_checklist(...)`, `update_deadline(...)`
  - `update_time_tracking(...)`, `update_stickers(...)`, `assign_task(...)`
  - `get_users(project_id)`
- Rate limiting: on 429, retry once after 1s, then surface error
- All calls via `tauri::async_runtime`

### Authentication (`auth.rs`)

**Flow:**
1. User enters email + password in Settings
2. `POST /auth/companies` — returns list of organizations the user belongs to
3. User selects an organization
4. `POST /auth/keys` with `{ login, password, companyId }` — returns JWT API key
5. Key stored in SQLite `yougile_accounts` table
6. Credentials discarded — only the key is kept

**API keys do not expire.** User logs in once per org, key works across app restarts indefinitely. Re-auth only needed if the key is manually revoked on Yougile's site.

### Key Storage

```sql
CREATE TABLE yougile_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    company_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

One row per organization. Switching orgs = switching which row's `api_key` is active. Future improvement: OS keychain integration.

### Yougile Data Models (`models.rs`)

```rust
YougileTask {
    id: String,
    title: String,
    description: Option<String>,
    color: Option<String>,
    column_id: String,
    completed: bool,
    archived: bool,
    deleted: bool,
    assigned: Vec<String>,           // user IDs
    subtasks: Vec<String>,           // subtask IDs
    checklists: Vec<Checklist>,
    stickers: HashMap<String, String>,
    deadline: Option<Deadline>,
    time_tracking: Option<TimeTracking>,
    stopwatch: Option<Stopwatch>,
    timer: Option<Timer>,
    created_by: Option<String>,
    timestamp: Option<i64>,
}

YougileBoard    { id, title, project_id, stickers }
YougileColumn   { id, title, board_id, color }
YougileProject  { id, title, timestamp, users }
YougileUser     { id, email, real_name, is_admin, status }
```

### New Tauri IPC Commands

```
// Auth
yougile_login(email, password) -> Vec<Company>
yougile_add_account(email, password, company_id) -> Account
yougile_remove_account(account_id)
yougile_get_accounts() -> Vec<Account>

// Navigation
yougile_get_projects(account_id) -> Vec<Project>
yougile_get_boards(project_id) -> Vec<Board>
yougile_get_columns(board_id) -> Vec<Column>
yougile_get_users(project_id) -> Vec<User>

// Tasks
yougile_get_tasks(column_id) -> Vec<Task>
yougile_create_task(column_id, payload) -> Task
yougile_update_task(task_id, payload) -> Task
yougile_move_task(task_id, target_column_id)
yougile_delete_task(task_id)

// Task features
yougile_get_subtasks(task_id) -> Vec<Task>
yougile_update_checklist(task_id, checklist)
yougile_update_deadline(task_id, deadline)
yougile_update_time_tracking(task_id, tracking)
yougile_update_stickers(task_id, stickers)
yougile_assign_task(task_id, user_ids)
```

---

## Local Task Enhancements

Features borrowed from Yougile, added to local SQLite tasks.

### Schema Changes

```sql
-- Subtasks (reuse tasks table with parent reference)
ALTER TABLE tasks ADD COLUMN parent_id TEXT REFERENCES tasks(id);

-- Checklists
CREATE TABLE checklists (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE checklist_items (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
);

-- Color support
ALTER TABLE tasks ADD COLUMN color TEXT;
ALTER TABLE kanban_columns ADD COLUMN color TEXT;

-- Colored tags (replace JSON array with a proper table)
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6b7280'
);

CREATE TABLE task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);

-- Time tracking
ALTER TABLE tasks ADD COLUMN time_estimated INTEGER; -- minutes
ALTER TABLE tasks ADD COLUMN time_spent INTEGER;     -- minutes
```

### New Local IPC Commands

Existing commands extended + new ones for checklists/subtasks:

```
create_checklist(task_id, title) -> Checklist
update_checklist_item(item_id, text, completed)
delete_checklist(checklist_id)
get_subtasks(task_id) -> Vec<Task>
create_tag(name, color) -> Tag
get_tags() -> Vec<Tag>
update_tag(id, name, color)
delete_tag(id)
```

The existing `create_task` and `update_task` commands gain optional `parent_id`, `color`, `time_estimated`, `time_spent` fields.

### Tag Migration

Local tasks currently store tags as a JSON array string in the `tags` column. Migration to the new `tags` + `task_tags` tables:

1. Create `tags` and `task_tags` tables
2. Parse each task's `tags` JSON array, insert unique tag names into `tags` table with default color
3. Create `task_tags` junction rows
4. Drop the `tags` column from `tasks` table

This is a one-time migration run at app startup as part of the normal migration sequence in `db.rs`.

---

## Frontend

### State Management (`use-task-store.ts`)

Zustand store gains:

```typescript
// Source switching
activeSource: "local" | "yougile"
setActiveSource: (source) => void

// Yougile navigation context
yougileContext: {
    accountId: string | null
    projectId: string | null
    projectName: string | null
    boardId: string | null
    boardName: string | null
}
setYougileContext: (ctx: Partial<YougileContext>) => void

// Yougile-specific data (in-memory only, no persistence)
yougileColumns: YougileColumn[]
yougileTasks: YougileTask[]
yougileUsers: YougileUser[]

// Feature flag
yougileEnabled: boolean
```

When `activeSource === "yougile"`, fetch/create/update actions call `yougile_*` IPC commands. When `"local"`, existing behavior unchanged.

### Dashboard (`Dashboard.tsx`)

**Source switcher** in the header: toggle between `Local` and `Yougile`. Only visible when Yougile is enabled in Settings. When Yougile is selected but no account exists, nudge to Settings.

**Breadcrumb bar** (Yougile mode only): `OrgName > ProjectName > BoardName`. Each segment is a clickable dropdown to switch context. Appears below the header, above the tabs.

**Existing views** reused:
- **Kanban:** Yougile columns map directly to kanban columns. Drag-and-drop calls `yougile_move_task`.
- **List:** Shows all tasks across columns for the active board.
- **Calendar:** Filters tasks by `deadline` field.

### Task Editor Pane (`TaskEditorPane.tsx`)

Extended fields (rendered for both local and Yougile when applicable):

| Field | Local | Yougile |
|-------|-------|---------|
| Title | Yes | Yes |
| Description | Yes | Yes |
| Status/Column | Yes | Yes |
| Priority | Yes | Via stickers |
| Due date / Deadline | Yes | Yes |
| Tags / Stickers | Colored tags | Colored stickers |
| Checklists | Yes | Yes |
| Subtasks | Yes | Yes |
| Assigned users | No | Yes (avatar chips) |
| Time tracking | Yes | Yes |
| Task color | Yes | Yes |

### Quick Capture (`App.tsx`)

**Source indicator:** Badge in the input area showing `LOCAL` or the active org/board name (e.g. `WorkOrg / Sprint Board`).

**Task creation:** `Enter` creates a task in the appropriate backend. In Yougile mode, task goes to the active board's first column. NLP parsing still extracts title and deadline keywords.

**New palette commands:**

| Command | Action |
|---------|--------|
| Switch to Local | Sets source to local |
| Switch to Yougile | Sets source to Yougile |
| Switch Org... | Opens inline org picker |
| Switch Board... | Opens project -> board picker |
| Open Settings | Existing |
| Open Dashboard | Existing |

**Inline pickers** work as nested cmdk lists — keyboard-driven, no mouse needed. Selecting "Switch Board" shows projects, then boards, then returns to input.

### Settings (`Settings.tsx`)

**General tab** gains:
- "Enable Yougile Integration" toggle — off by default

**Accounts tab** (visible only when Yougile enabled):
- List of connected accounts: email + org name per row
- "Add Account" button: email/password form -> org selection -> save
- Remove account button per row

### Kill Switch Behavior

When "Enable Yougile Integration" is **off**:
- Source switcher hidden in Dashboard
- Yougile commands hidden in Quick Capture
- Breadcrumb bar hidden
- Accounts tab hidden in Settings
- No `yougile_*` IPC calls fire
- `activeSource` forced to `"local"`

When toggled **on**: Accounts tab appears, source switcher visible, first-time guidance to add account.

---

## Data Flow & Freshness

### Strategy: Always-Live

- Every view mount or tab/board switch triggers a fresh API fetch
- No persistent local cache — Yougile state lives only in Zustand (in-memory)
- Navigating away and back re-fetches

### Optimistic UI

- Task mutations (create, move, update, delete) update UI immediately
- API call fires in background
- On failure: revert UI state, show error toast with the failed action

### Error Handling

| Error | Behavior |
|-------|----------|
| 401 (invalid/revoked key) | Toast: "Session expired — re-authenticate in Settings" |
| 429 (rate limit) | Retry once after 1s, then toast: "Yougile is rate-limiting, try again shortly" |
| Network failure | Toast: "Can't reach Yougile — check connection". Last-fetched data stays in memory |
| 4xx/5xx on mutations | Revert optimistic update, toast with error details |

### What We Skip

- No background polling or auto-refresh (fresh data on navigation only)
- No offline queue (actions fail immediately if offline)
- No conflict resolution (always-fetch = always latest state)

---

## Cross-Platform

Fully cross-platform with no OS-specific code:
- `reqwest` for HTTP: works on macOS/Linux/Windows
- SQLite for key storage: already cross-platform in Jot
- Tauri v2 handles windowing across all platforms
- Future OS keychain integration would be the only platform-specific addition

---

## Implementation Phases

### Phase 1: Foundation
- Local task enhancements (subtasks, checklists, colored tags, colors, time tracking)
- SQLite schema migrations
- New local IPC commands
- Task editor pane extended

### Phase 2: Yougile Backend
- `yougile/` Rust module (client, models, auth, mapper)
- `yougile_accounts` table and auth flow
- All `yougile_*` IPC commands
- Error handling and rate limiting

### Phase 3: Yougile Frontend
- Source switcher and breadcrumb navigation in Dashboard
- Zustand store Yougile slice
- Kanban/List/Calendar views wired to Yougile data
- Task editor pane Yougile fields (assigned users, stickers, etc.)

### Phase 4: Quick Capture & Settings
- Quick Capture source awareness and inline pickers
- Settings: kill switch toggle, Accounts tab, login flow UI

### Phase 5: Polish
- Loading states and skeletons
- Error toasts and recovery flows
- Keyboard navigation for all new UI elements
- Cross-platform testing

---

## API Reference

Yougile REST API v2: https://yougile.com/api-v2#/
Swagger spec: `docs/yougile.json`
