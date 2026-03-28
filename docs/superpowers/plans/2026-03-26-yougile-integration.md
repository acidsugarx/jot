# Yougile Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Yougile as a live remote task source to Jot and enhance local tasks with subtasks, checklists, colored tags, colors, and time tracking.

**Architecture:** Rust-side provider pattern — all Yougile HTTP calls in `src-tauri/src/yougile/`, frontend reuses existing views with a source switcher. Separate `yougile_*` IPC commands, no shared dispatch. Local tasks enhanced with borrowed Yougile features.

**Tech Stack:** Rust (reqwest for HTTP, rusqlite for storage), React/TypeScript (Zustand, cmdk), Tauri v2 IPC.

**Spec:** `docs/superpowers/specs/2026-03-26-yougile-integration-design.md`

**Worktree:** `.worktrees/yougile-integration` (branch: `feature/yougile-integration`)

### Progress

| Task | Status |
|------|--------|
| Task 1: SQLite Schema Migrations | ✅ Done |
| Task 2: Rust Models for Local Enhancements | ✅ Done |
| Task 3: CRUD Functions for Checklists, Tags, Subtasks | ✅ Done |
| Task 4: Frontend Types and Store | Pending |
| Task 5: Checklist and Subtask UI Components | Pending |
| Task 6: Yougile Module Structure + reqwest | Pending |
| Task 7: Yougile HTTP Client | Pending |
| Task 8: Yougile Auth and Account Storage | Pending |
| Task 9: Yougile Tauri IPC Commands | Pending |
| Task 10: Frontend Yougile Types and Store | Pending |
| Task 11: Source Switcher and Breadcrumb | Pending |
| Task 12: Wire Views to Yougile Data | Pending |
| Task 13: Settings — Kill Switch and Accounts | Pending |
| Task 14: Quick Capture Yougile Integration | Pending |
| Task 15: Loading States, Error Toasts, Keyboard Nav | Pending |
| Task 16: Yougile Task Editor Pane | Pending |
| Task 17: Final Validation and Documentation | Pending |

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src-tauri/src/yougile/mod.rs` | Module exports for yougile crate |
| `src-tauri/src/yougile/models.rs` | Yougile API DTOs (task, board, column, project, user, auth) |
| `src-tauri/src/yougile/client.rs` | HTTP client wrapping reqwest, all Yougile API methods |
| `src-tauri/src/yougile/auth.rs` | Login flow, key generation, account CRUD in SQLite |
| `src-tauri/src/yougile/commands.rs` | Tauri IPC command handlers for Yougile operations |
| `src/types/yougile.ts` | Frontend Yougile type definitions |
| `src/store/use-yougile-store.ts` | Zustand slice for Yougile state (accounts, context, data) |
| `src/components/SourceSwitcher.tsx` | Local/Yougile toggle + breadcrumb navigation |
| `src/components/YougileTaskEditor.tsx` | Extended task editor for Yougile-specific fields |
| `src/components/ChecklistEditor.tsx` | Checklist UI (shared by local + Yougile) |
| `src/components/SubtaskList.tsx` | Subtask list UI (shared by local + Yougile) |
| `src/components/AccountsSettings.tsx` | Yougile accounts management tab in Settings |

### Modified Files

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Add `reqwest` dependency |
| `src-tauri/src/lib.rs` | Register yougile module + new IPC commands |
| `src-tauri/src/db.rs` | New migrations (subtasks, checklists, tags tables, yougile_accounts), new CRUD functions |
| `src-tauri/src/models.rs` | Add Checklist, ChecklistItem, Tag, local task enhancements |
| `src/types.ts` | Add Checklist, ChecklistItem, Tag, updated Task with new fields |
| `src/store/use-task-store.ts` | Add activeSource, yougileEnabled, checklist/subtask/tag methods |
| `src/Dashboard.tsx` | Add source switcher, breadcrumb bar, conditional Yougile rendering |
| `src/App.tsx` | Add source indicator, Yougile palette commands, inline pickers |
| `src/Settings.tsx` | Add Accounts tab, kill switch toggle in General |
| `src/components/TaskEditorPane.tsx` | Add checklists, subtasks, colored tags, colors, time tracking fields |
| `src/components/KanbanBoard.tsx` | Support Yougile columns as data source |
| `src/components/KanbanTaskCard.tsx` | Show colors, stickers, assigned users |
| `src/components/CalendarView.tsx` | Support Yougile deadline field |

---

## Phase 1: Local Task Enhancements

### Task 1: SQLite Schema Migrations for Local Enhancements ✅ DONE

**Files:**
- Modify: `src-tauri/src/db.rs` (add migrations in `run_migrations()` after line ~107)
- Test: `src-tauri/src/db.rs` (add tests at bottom)

- [ ] **Step 1: Write failing test for parent_id column**

Add to the `#[cfg(test)]` module at the bottom of `db.rs`:

```rust
#[test]
fn subtask_parent_id_column_exists_after_migration() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();
    conn.execute(
        "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at, parent_id)
         VALUES ('t1', 'parent', 'todo', 'none', '[]', '2025-01-01', '2025-01-01', NULL)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at, parent_id)
         VALUES ('t2', 'child', 'todo', 'none', '[]', '2025-01-01', '2025-01-01', 't1')",
        [],
    ).unwrap();
    let parent_id: Option<String> = conn.query_row(
        "SELECT parent_id FROM tasks WHERE id = 't2'", [], |row| row.get(0),
    ).unwrap();
    assert_eq!(parent_id, Some("t1".to_string()));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test subtask_parent_id_column_exists_after_migration -- --nocapture`
Expected: FAIL — "table tasks has no column named parent_id"

- [ ] **Step 3: Add parent_id migration to run_migrations()**

In `db.rs`, inside `run_migrations()`, after the existing `ALTER TABLE tasks ADD COLUMN description` migration block (around line 95-107), add:

```rust
    // Migration: add parent_id for subtasks
    let has_parent_id: bool = conn
        .prepare("SELECT parent_id FROM tasks LIMIT 0")
        .is_ok();
    if !has_parent_id {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN parent_id TEXT")
            .map_err(|e| e.to_string())?;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test subtask_parent_id_column_exists_after_migration -- --nocapture`
Expected: PASS

- [ ] **Step 5: Write failing test for color columns**

```rust
#[test]
fn color_columns_exist_after_migration() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();
    conn.execute(
        "UPDATE tasks SET color = '#ff0000' WHERE 1=0", [],
    ).unwrap();
    conn.execute(
        "UPDATE kanban_columns SET color = '#00ff00' WHERE 1=0", [],
    ).unwrap();
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd src-tauri && cargo test color_columns_exist_after_migration -- --nocapture`
Expected: FAIL — "no such column: color"

- [ ] **Step 7: Add color migration**

After the parent_id migration:

```rust
    // Migration: add color to tasks
    let has_task_color: bool = conn
        .prepare("SELECT color FROM tasks LIMIT 0")
        .is_ok();
    if !has_task_color {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN color TEXT")
            .map_err(|e| e.to_string())?;
    }

    // Migration: add color to kanban_columns
    let has_col_color: bool = conn
        .prepare("SELECT color FROM kanban_columns LIMIT 0")
        .is_ok();
    if !has_col_color {
        conn.execute_batch("ALTER TABLE kanban_columns ADD COLUMN color TEXT")
            .map_err(|e| e.to_string())?;
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd src-tauri && cargo test color_columns_exist_after_migration -- --nocapture`
Expected: PASS

- [ ] **Step 9: Write failing test for time tracking columns**

```rust
#[test]
fn time_tracking_columns_exist_after_migration() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();
    conn.execute(
        "UPDATE tasks SET time_estimated = 60, time_spent = 30 WHERE 1=0", [],
    ).unwrap();
}
```

- [ ] **Step 10: Run test to verify it fails, add migration, verify it passes**

Add after color migration:

```rust
    // Migration: add time tracking to tasks
    let has_time_est: bool = conn
        .prepare("SELECT time_estimated FROM tasks LIMIT 0")
        .is_ok();
    if !has_time_est {
        conn.execute_batch(
            "ALTER TABLE tasks ADD COLUMN time_estimated INTEGER;
             ALTER TABLE tasks ADD COLUMN time_spent INTEGER;"
        ).map_err(|e| e.to_string())?;
    }
```

Run: `cd src-tauri && cargo test time_tracking_columns_exist_after_migration -- --nocapture`
Expected: PASS

- [ ] **Step 11: Write failing test for checklists tables**

```rust
#[test]
fn checklists_tables_exist_after_migration() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();
    conn.execute(
        "INSERT INTO checklists (id, task_id, title, position) VALUES ('c1', 't1', 'My List', 0)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO checklist_items (id, checklist_id, text, completed, position)
         VALUES ('ci1', 'c1', 'Item 1', 0, 0)",
        [],
    ).unwrap();
}
```

- [ ] **Step 12: Run test to verify it fails, add migration, verify it passes**

Add to `run_migrations()`:

```rust
    // Migration: create checklists tables
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS checklists (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            title TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS checklist_items (
            id TEXT PRIMARY KEY,
            checklist_id TEXT NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            position INTEGER NOT NULL DEFAULT 0
        );"
    ).map_err(|e| e.to_string())?;
```

Run: `cd src-tauri && cargo test checklists_tables_exist_after_migration -- --nocapture`
Expected: PASS

- [ ] **Step 13: Write failing test for tags tables**

```rust
#[test]
fn tags_tables_exist_after_migration() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();
    conn.execute(
        "INSERT INTO tags (id, name, color) VALUES ('tag1', 'work', '#6b7280')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO task_tags (task_id, tag_id) VALUES ('t1', 'tag1')",
        [],
    ).unwrap();
}
```

- [ ] **Step 14: Run test to verify it fails, add migration, verify it passes**

Add to `run_migrations()`:

```rust
    // Migration: create tags tables
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#6b7280'
        );
        CREATE TABLE IF NOT EXISTS task_tags (
            task_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (task_id, tag_id)
        );"
    ).map_err(|e| e.to_string())?;
```

Run: `cd src-tauri && cargo test tags_tables_exist_after_migration -- --nocapture`
Expected: PASS

- [ ] **Step 15: Write failing test for tag migration from JSON to tables**

```rust
#[test]
fn existing_json_tags_migrated_to_tag_tables() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();

    // Insert a task with old-style JSON tags
    conn.execute(
        "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at)
         VALUES ('t1', 'Test', 'todo', 'none', '[\"work\",\"urgent\"]', '2025-01-01', '2025-01-01')",
        [],
    ).unwrap();

    // Run migration again (simulate restart)
    drop(conn);
    drop(db);
    let db2 = init_database(dir.path()).unwrap();
    let conn2 = db2.connection.lock().unwrap();

    // Check tags were migrated
    let tag_count: i64 = conn2.query_row(
        "SELECT COUNT(*) FROM tags", [], |row| row.get(0),
    ).unwrap();
    assert_eq!(tag_count, 2);

    let link_count: i64 = conn2.query_row(
        "SELECT COUNT(*) FROM task_tags WHERE task_id = 't1'", [], |row| row.get(0),
    ).unwrap();
    assert_eq!(link_count, 2);
}
```

- [ ] **Step 16: Implement JSON-to-table tag migration**

Add to `run_migrations()` after tags table creation:

```rust
    // Migration: migrate existing JSON tags to tag tables
    // Check if any tasks still have non-empty JSON tags to migrate
    let tasks_with_tags: Vec<(String, String)> = conn
        .prepare("SELECT id, tags FROM tasks WHERE tags != '[]' AND tags IS NOT NULL")
        .map_err(|e| e.to_string())?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for (task_id, tags_json) in &tasks_with_tags {
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(tags_json) {
            for tag_name in tags {
                let tag_id = uuid::Uuid::new_v4().to_string();
                // Insert tag if not exists
                conn.execute(
                    "INSERT OR IGNORE INTO tags (id, name, color) VALUES (?1, ?2, '#6b7280')",
                    rusqlite::params![tag_id, tag_name],
                ).ok();
                // Get the actual tag id (may have been inserted before)
                if let Ok(existing_id) = conn.query_row(
                    "SELECT id FROM tags WHERE name = ?1",
                    rusqlite::params![tag_name],
                    |row| row.get::<_, String>(0),
                ) {
                    conn.execute(
                        "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                        rusqlite::params![task_id, existing_id],
                    ).ok();
                }
            }
        }
    }
```

- [ ] **Step 17: Run migration test to verify it passes**

Run: `cd src-tauri && cargo test existing_json_tags_migrated_to_tag_tables -- --nocapture`
Expected: PASS

- [ ] **Step 18: Run all existing tests to verify no regressions**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 19: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(db): add schema migrations for subtasks, checklists, colored tags, colors, time tracking"
```

---

### Task 2: Rust Models for Local Enhancements ✅ DONE

**Files:**
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: Add Checklist and ChecklistItem structs**

Add after the existing `Task` struct in `models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Checklist {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub position: i64,
    pub items: Vec<ChecklistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub checklist_id: String,
    pub text: String,
    pub completed: bool,
    pub position: i64,
}
```

- [ ] **Step 2: Add Tag struct**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}
```

- [ ] **Step 3: Update Task struct with new fields**

Add fields to the existing `Task` struct (after `updated_at`):

```rust
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub time_estimated: Option<i64>,
    pub time_spent: Option<i64>,
```

- [ ] **Step 4: Update CreateTaskInput and UpdateTaskInput**

Add to `CreateTaskInput`:

```rust
    pub parent_id: Option<String>,
    pub color: Option<String>,
```

Add to `UpdateTaskInput`:

```rust
    pub color: Option<String>,
    pub time_estimated: Option<Option<i64>>,
    pub time_spent: Option<Option<i64>>,
```

- [ ] **Step 5: Add input types for checklists and tags**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChecklistInput {
    pub task_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChecklistItemInput {
    pub id: String,
    pub text: Option<String>,
    pub completed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddChecklistItemInput {
    pub checklist_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagInput {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagInput {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}
```

- [ ] **Step 6: Run cargo check to verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with warnings (unused fields) but no errors

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/models.rs
git commit -m "feat(models): add Checklist, ChecklistItem, Tag types and update Task with new fields"
```

---

### Task 3: CRUD Functions for Checklists, Tags, Subtasks ✅ DONE

**Files:**
- Modify: `src-tauri/src/db.rs` (add functions + IPC commands)
- Modify: `src-tauri/src/lib.rs` (register new commands)

- [ ] **Step 1: Write failing test for checklist CRUD**

Add to test module in `db.rs`:

```rust
#[test]
fn checklist_crud_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();

    // Insert a task first
    conn.execute(
        "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at)
         VALUES ('t1', 'Test', 'todo', 'none', '[]', '2025-01-01', '2025-01-01')",
        [],
    ).unwrap();
    drop(conn);

    let checklist = create_checklist_impl(&db, "t1", "My Checklist").unwrap();
    assert_eq!(checklist.title, "My Checklist");
    assert_eq!(checklist.task_id, "t1");

    let item = add_checklist_item_impl(&db, &checklist.id, "First item").unwrap();
    assert_eq!(item.text, "First item");
    assert!(!item.completed);

    update_checklist_item_impl(&db, &item.id, Some("Updated item"), Some(true)).unwrap();

    let checklists = get_checklists_impl(&db, "t1").unwrap();
    assert_eq!(checklists.len(), 1);
    assert_eq!(checklists[0].items.len(), 1);
    assert_eq!(checklists[0].items[0].text, "Updated item");
    assert!(checklists[0].items[0].completed);

    delete_checklist_impl(&db, &checklist.id).unwrap();
    let checklists = get_checklists_impl(&db, "t1").unwrap();
    assert_eq!(checklists.len(), 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test checklist_crud_round_trips -- --nocapture`
Expected: FAIL — functions not found

- [ ] **Step 3: Implement checklist CRUD functions**

Add to `db.rs` (private helpers section, before the test module):

```rust
pub fn create_checklist_impl(db: &DatabaseState, task_id: &str, title: &str) -> Result<Checklist, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM checklists WHERE task_id = ?1",
            rusqlite::params![task_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO checklists (id, task_id, title, position) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, task_id, title, position],
    ).map_err(|e| e.to_string())?;
    Ok(Checklist { id, task_id: task_id.to_string(), title: title.to_string(), position, items: vec![] })
}

pub fn add_checklist_item_impl(db: &DatabaseState, checklist_id: &str, text: &str) -> Result<ChecklistItem, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM checklist_items WHERE checklist_id = ?1",
            rusqlite::params![checklist_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO checklist_items (id, checklist_id, text, completed, position) VALUES (?1, ?2, ?3, 0, ?4)",
        rusqlite::params![id, checklist_id, text, position],
    ).map_err(|e| e.to_string())?;
    Ok(ChecklistItem { id, checklist_id: checklist_id.to_string(), text: text.to_string(), completed: false, position })
}

pub fn update_checklist_item_impl(db: &DatabaseState, item_id: &str, text: Option<&str>, completed: Option<bool>) -> Result<(), String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    if let Some(t) = text {
        conn.execute("UPDATE checklist_items SET text = ?1 WHERE id = ?2", rusqlite::params![t, item_id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(c) = completed {
        conn.execute("UPDATE checklist_items SET completed = ?1 WHERE id = ?2", rusqlite::params![c as i32, item_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn get_checklists_impl(db: &DatabaseState, task_id: &str) -> Result<Vec<Checklist>, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, task_id, title, position FROM checklists WHERE task_id = ?1 ORDER BY position"
    ).map_err(|e| e.to_string())?;
    let checklists: Vec<Checklist> = stmt.query_map(rusqlite::params![task_id], |row| {
        Ok(Checklist {
            id: row.get(0)?,
            task_id: row.get(1)?,
            title: row.get(2)?,
            position: row.get(3)?,
            items: vec![],
        })
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    let mut result = Vec::new();
    for mut checklist in checklists {
        let mut item_stmt = conn.prepare(
            "SELECT id, checklist_id, text, completed, position FROM checklist_items WHERE checklist_id = ?1 ORDER BY position"
        ).map_err(|e| e.to_string())?;
        checklist.items = item_stmt.query_map(rusqlite::params![checklist.id], |row| {
            Ok(ChecklistItem {
                id: row.get(0)?,
                checklist_id: row.get(1)?,
                text: row.get(2)?,
                completed: row.get::<_, i32>(3)? != 0,
                position: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        result.push(checklist);
    }
    Ok(result)
}

pub fn delete_checklist_impl(db: &DatabaseState, checklist_id: &str) -> Result<(), String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM checklist_items WHERE checklist_id = ?1", rusqlite::params![checklist_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM checklists WHERE id = ?1", rusqlite::params![checklist_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_checklist_item_impl(db: &DatabaseState, item_id: &str) -> Result<(), String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM checklist_items WHERE id = ?1", rusqlite::params![item_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test checklist_crud_round_trips -- --nocapture`
Expected: PASS

- [ ] **Step 5: Write failing test for tag CRUD**

```rust
#[test]
fn tag_crud_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();

    let tag = create_tag_impl(&db, "work", Some("#3b82f6")).unwrap();
    assert_eq!(tag.name, "work");
    assert_eq!(tag.color, "#3b82f6");

    let tags = get_tags_impl(&db).unwrap();
    assert_eq!(tags.len(), 1);

    update_tag_impl(&db, &tag.id, Some("office"), Some("#ef4444")).unwrap();
    let tags = get_tags_impl(&db).unwrap();
    assert_eq!(tags[0].name, "office");
    assert_eq!(tags[0].color, "#ef4444");

    delete_tag_impl(&db, &tag.id).unwrap();
    let tags = get_tags_impl(&db).unwrap();
    assert_eq!(tags.len(), 0);
}
```

- [ ] **Step 6: Implement tag CRUD functions**

```rust
pub fn create_tag_impl(db: &DatabaseState, name: &str, color: Option<&str>) -> Result<Tag, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let color = color.unwrap_or("#6b7280");
    conn.execute(
        "INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, name, color],
    ).map_err(|e| e.to_string())?;
    Ok(Tag { id, name: name.to_string(), color: color.to_string() })
}

pub fn get_tags_impl(db: &DatabaseState) -> Result<Vec<Tag>, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;
    let tags = stmt.query_map([], |row| {
        Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    Ok(tags)
}

pub fn update_tag_impl(db: &DatabaseState, id: &str, name: Option<&str>, color: Option<&str>) -> Result<(), String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    if let Some(n) = name {
        conn.execute("UPDATE tags SET name = ?1 WHERE id = ?2", rusqlite::params![n, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(c) = color {
        conn.execute("UPDATE tags SET color = ?1 WHERE id = ?2", rusqlite::params![c, id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn delete_tag_impl(db: &DatabaseState, id: &str) -> Result<(), String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM task_tags WHERE tag_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_task_tags_impl(db: &DatabaseState, task_id: &str) -> Result<Vec<Tag>, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color FROM tags t
         INNER JOIN task_tags tt ON tt.tag_id = t.id
         WHERE tt.task_id = ?1 ORDER BY t.name"
    ).map_err(|e| e.to_string())?;
    let tags = stmt.query_map(rusqlite::params![task_id], |row| {
        Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    Ok(tags)
}

pub fn set_task_tags_impl(db: &DatabaseState, task_id: &str, tag_ids: &[String]) -> Result<(), String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM task_tags WHERE task_id = ?1", rusqlite::params![task_id])
        .map_err(|e| e.to_string())?;
    for tag_id in tag_ids {
        conn.execute(
            "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![task_id, tag_id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 7: Run test, verify passes**

Run: `cd src-tauri && cargo test tag_crud_round_trips -- --nocapture`
Expected: PASS

- [ ] **Step 8: Write failing test for subtask queries**

```rust
#[test]
fn subtask_listing_returns_children() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();
    conn.execute(
        "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at)
         VALUES ('p1', 'Parent', 'todo', 'none', '[]', '2025-01-01', '2025-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at, parent_id)
         VALUES ('c1', 'Child 1', 'todo', 'none', '[]', '2025-01-01', '2025-01-01', 'p1')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at, parent_id)
         VALUES ('c2', 'Child 2', 'todo', 'none', '[]', '2025-01-01', '2025-01-01', 'p1')",
        [],
    ).unwrap();
    drop(conn);

    let subtasks = get_subtasks_impl(&db, "p1").unwrap();
    assert_eq!(subtasks.len(), 2);
}
```

- [ ] **Step 9: Implement get_subtasks_impl**

```rust
pub fn get_subtasks_impl(db: &DatabaseState, parent_id: &str) -> Result<Vec<Task>, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, description, status, priority, tags, due_date, linked_note_path,
                created_at, updated_at, parent_id, color, time_estimated, time_spent
         FROM tasks WHERE parent_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let tasks = stmt.query_map(rusqlite::params![parent_id], |row| {
        Ok(map_task_row_v2(row))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    Ok(tasks)
}
```

Note: `map_task_row_v2` is an updated version of `map_task_row` that also reads the new columns (`parent_id`, `color`, `time_estimated`, `time_spent`). Update the existing `map_task_row` function to include the new fields:

```rust
fn map_task_row(row: &rusqlite::Row) -> Task {
    let tags_json: String = row.get(5).unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let priority_str: String = row.get(4).unwrap_or_default();
    Task {
        id: row.get(0).unwrap_or_default(),
        title: row.get(1).unwrap_or_default(),
        description: row.get(2).unwrap_or_default(),
        status: row.get(3).unwrap_or_default(),
        priority: TaskPriority::from_str(&priority_str),
        tags,
        due_date: row.get(6).unwrap_or_default(),
        linked_note_path: row.get(7).unwrap_or_default(),
        created_at: row.get(8).unwrap_or_default(),
        updated_at: row.get(9).unwrap_or_default(),
        parent_id: row.get(10).unwrap_or_default(),
        color: row.get(11).unwrap_or_default(),
        time_estimated: row.get(12).unwrap_or_default(),
        time_spent: row.get(13).unwrap_or_default(),
    }
}
```

Also update `list_tasks()` and `fetch_task()` SQL queries to SELECT the new columns.

- [ ] **Step 10: Run test, verify passes**

Run: `cd src-tauri && cargo test subtask_listing_returns_children -- --nocapture`
Expected: PASS

- [ ] **Step 11: Add Tauri IPC command wrappers**

Add `#[tauri::command]` functions in `db.rs` that wrap the `_impl` functions:

```rust
#[tauri::command]
pub fn get_checklists(task_id: String, state: State<'_, DatabaseState>) -> Result<Vec<Checklist>, String> {
    get_checklists_impl(&state, &task_id)
}

#[tauri::command]
pub fn create_checklist(task_id: String, title: String, state: State<'_, DatabaseState>) -> Result<Checklist, String> {
    create_checklist_impl(&state, &task_id, &title)
}

#[tauri::command]
pub fn add_checklist_item(checklist_id: String, text: String, state: State<'_, DatabaseState>) -> Result<ChecklistItem, String> {
    add_checklist_item_impl(&state, &checklist_id, &text)
}

#[tauri::command]
pub fn update_checklist_item(id: String, text: Option<String>, completed: Option<bool>, state: State<'_, DatabaseState>) -> Result<(), String> {
    update_checklist_item_impl(&state, &id, text.as_deref(), completed)
}

#[tauri::command]
pub fn delete_checklist(id: String, state: State<'_, DatabaseState>) -> Result<(), String> {
    delete_checklist_impl(&state, &id)
}

#[tauri::command]
pub fn delete_checklist_item(id: String, state: State<'_, DatabaseState>) -> Result<(), String> {
    delete_checklist_item_impl(&state, &id)
}

#[tauri::command]
pub fn get_tags(state: State<'_, DatabaseState>) -> Result<Vec<Tag>, String> {
    get_tags_impl(&state)
}

#[tauri::command]
pub fn create_tag(name: String, color: Option<String>, state: State<'_, DatabaseState>) -> Result<Tag, String> {
    create_tag_impl(&state, &name, color.as_deref())
}

#[tauri::command]
pub fn update_tag(id: String, name: Option<String>, color: Option<String>, state: State<'_, DatabaseState>) -> Result<(), String> {
    update_tag_impl(&state, &id, name.as_deref(), color.as_deref())
}

#[tauri::command]
pub fn delete_tag(id: String, state: State<'_, DatabaseState>) -> Result<(), String> {
    delete_tag_impl(&state, &id)
}

#[tauri::command]
pub fn get_task_tags(task_id: String, state: State<'_, DatabaseState>) -> Result<Vec<Tag>, String> {
    get_task_tags_impl(&state, &task_id)
}

#[tauri::command]
pub fn set_task_tags(task_id: String, tag_ids: Vec<String>, state: State<'_, DatabaseState>) -> Result<(), String> {
    set_task_tags_impl(&state, &task_id, &tag_ids)
}

#[tauri::command]
pub fn get_subtasks(parent_id: String, state: State<'_, DatabaseState>) -> Result<Vec<Task>, String> {
    get_subtasks_impl(&state, &parent_id)
}
```

- [ ] **Step 12: Register new commands in lib.rs**

In `lib.rs`, add to the `.invoke_handler(tauri::generate_handler![...])` list (around line 365-384):

```rust
db::get_checklists,
db::create_checklist,
db::add_checklist_item,
db::update_checklist_item,
db::delete_checklist,
db::delete_checklist_item,
db::get_tags,
db::create_tag,
db::update_tag,
db::delete_tag,
db::get_task_tags,
db::set_task_tags,
db::get_subtasks,
```

- [ ] **Step 13: Run full test suite**

Run: `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
Expected: All pass

- [ ] **Step 14: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat(db): add CRUD operations for checklists, tags, and subtasks"
```

---

### Task 4: Update Frontend Types and Store for Local Enhancements

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/use-task-store.ts`

- [ ] **Step 1: Update types.ts**

Add after existing types:

```typescript
export interface Checklist {
  id: string;
  taskId: string;
  title: string;
  position: number;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  completed: boolean;
  position: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}
```

Update the `Task` interface — add after `updatedAt`:

```typescript
  parentId: string | null;
  color: string | null;
  timeEstimated: number | null;
  timeSpent: number | null;
```

Update `CreateTaskInput` — add:

```typescript
  parentId?: string | null;
  color?: string | null;
```

Update `UpdateTaskInput` — add:

```typescript
  color?: string | null;
  timeEstimated?: number | null;
  timeSpent?: number | null;
```

- [ ] **Step 2: Add checklist and tag methods to the Zustand store**

Add to the state interface in `use-task-store.ts`:

```typescript
  tags: Tag[]
  // Checklist methods
  getChecklists: (taskId: string) => Promise<Checklist[]>
  createChecklist: (taskId: string, title: string) => Promise<Checklist>
  addChecklistItem: (checklistId: string, text: string) => Promise<ChecklistItem>
  updateChecklistItem: (id: string, text?: string, completed?: boolean) => Promise<void>
  deleteChecklist: (id: string) => Promise<void>
  deleteChecklistItem: (id: string) => Promise<void>
  // Tag methods
  fetchTags: () => Promise<void>
  createTag: (name: string, color?: string) => Promise<Tag>
  updateTag: (id: string, name?: string, color?: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  getTaskTags: (taskId: string) => Promise<Tag[]>
  setTaskTags: (taskId: string, tagIds: string[]) => Promise<void>
  // Subtask methods
  getSubtasks: (parentId: string) => Promise<Task[]>
```

- [ ] **Step 3: Implement the store methods**

Add implementations in the `create()` callback. Follow the existing pattern — check `__TAURI_INTERNALS__`, invoke, update state:

```typescript
  tags: [],

  getChecklists: async (taskId) => {
    if (!('__TAURI_INTERNALS__' in window)) return [];
    return await invoke<Checklist[]>('get_checklists', { taskId });
  },

  createChecklist: async (taskId, title) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Not in Tauri');
    return await invoke<Checklist>('create_checklist', { taskId, title });
  },

  addChecklistItem: async (checklistId, text) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Not in Tauri');
    return await invoke<ChecklistItem>('add_checklist_item', { checklistId, text });
  },

  updateChecklistItem: async (id, text, completed) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    await invoke('update_checklist_item', { id, text, completed });
  },

  deleteChecklist: async (id) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    await invoke('delete_checklist', { id });
  },

  deleteChecklistItem: async (id) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    await invoke('delete_checklist_item', { id });
  },

  fetchTags: async () => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const tags = await invoke<Tag[]>('get_tags');
    set({ tags });
  },

  createTag: async (name, color) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Not in Tauri');
    const tag = await invoke<Tag>('create_tag', { name, color });
    set((state) => ({ tags: [...state.tags, tag] }));
    return tag;
  },

  updateTag: async (id, name, color) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    await invoke('update_tag', { id, name, color });
    set((state) => ({
      tags: state.tags.map((t) => t.id === id ? { ...t, ...(name && { name }), ...(color && { color }) } : t),
    }));
  },

  deleteTag: async (id) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    await invoke('delete_tag', { id });
    set((state) => ({ tags: state.tags.filter((t) => t.id !== id) }));
  },

  getTaskTags: async (taskId) => {
    if (!('__TAURI_INTERNALS__' in window)) return [];
    return await invoke<Tag[]>('get_task_tags', { taskId });
  },

  setTaskTags: async (taskId, tagIds) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    await invoke('set_task_tags', { taskId, tagIds });
  },

  getSubtasks: async (parentId) => {
    if (!('__TAURI_INTERNALS__' in window)) return [];
    return await invoke<Task[]>('get_subtasks', { parentId });
  },
```

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: Pass (may have warnings about unused methods — fine for now)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/store/use-task-store.ts
git commit -m "feat(store): add frontend types and store methods for checklists, tags, subtasks"
```

---

### Task 5: Checklist and Subtask UI Components

**Files:**
- Create: `src/components/ChecklistEditor.tsx`
- Create: `src/components/SubtaskList.tsx`
- Modify: `src/components/TaskEditorPane.tsx`

- [ ] **Step 1: Create ChecklistEditor component**

Create `src/components/ChecklistEditor.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { useTaskStore } from '@/store/use-task-store';
import type { Checklist, ChecklistItem } from '@/types';

interface ChecklistEditorProps {
  taskId: string;
  checklists: Checklist[];
  onUpdate: () => void;
}

export function ChecklistEditor({ taskId, checklists, onUpdate }: ChecklistEditorProps) {
  const store = useTaskStore();
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [newItemTexts, setNewItemTexts] = useState<Record<string, string>>({});

  const handleAddChecklist = useCallback(async () => {
    const title = newChecklistTitle.trim();
    if (!title) return;
    await store.createChecklist(taskId, title);
    setNewChecklistTitle('');
    onUpdate();
  }, [taskId, newChecklistTitle, store, onUpdate]);

  const handleAddItem = useCallback(async (checklistId: string) => {
    const text = (newItemTexts[checklistId] || '').trim();
    if (!text) return;
    await store.addChecklistItem(checklistId, text);
    setNewItemTexts((prev) => ({ ...prev, [checklistId]: '' }));
    onUpdate();
  }, [newItemTexts, store, onUpdate]);

  const handleToggleItem = useCallback(async (item: ChecklistItem) => {
    await store.updateChecklistItem(item.id, undefined, !item.completed);
    onUpdate();
  }, [store, onUpdate]);

  const handleDeleteChecklist = useCallback(async (id: string) => {
    await store.deleteChecklist(id);
    onUpdate();
  }, [store, onUpdate]);

  const handleDeleteItem = useCallback(async (id: string) => {
    await store.deleteChecklistItem(id);
    onUpdate();
  }, [store, onUpdate]);

  return (
    <div className="space-y-3">
      {checklists.map((checklist) => {
        const doneCount = checklist.items.filter((i) => i.completed).length;
        const totalCount = checklist.items.length;
        return (
          <div key={checklist.id} className="border border-zinc-800 rounded-lg p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-zinc-300">{checklist.title}</span>
              <div className="flex items-center gap-1">
                {totalCount > 0 && (
                  <span className="text-[10px] text-zinc-500">{doneCount}/{totalCount}</span>
                )}
                <button
                  onClick={() => handleDeleteChecklist(checklist.id)}
                  className="p-0.5 text-zinc-600 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="space-y-0.5">
              {checklist.items.map((item) => (
                <div key={item.id} className="flex items-center gap-1.5 group">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => handleToggleItem(item)}
                    className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0 h-3 w-3"
                  />
                  <span className={`text-xs flex-1 ${item.completed ? 'line-through text-zinc-600' : 'text-zinc-300'}`}>
                    {item.text}
                  </span>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-0.5 text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <input
                type="text"
                value={newItemTexts[checklist.id] || ''}
                onChange={(e) => setNewItemTexts((prev) => ({ ...prev, [checklist.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(checklist.id); }}
                placeholder="Add item..."
                className="flex-1 bg-transparent text-xs text-zinc-400 placeholder-zinc-600 outline-none"
              />
              <button
                onClick={() => handleAddItem(checklist.id)}
                className="p-0.5 text-zinc-600 hover:text-cyan-400"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={newChecklistTitle}
          onChange={(e) => setNewChecklistTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddChecklist(); }}
          placeholder="New checklist..."
          className="flex-1 bg-transparent text-xs text-zinc-400 placeholder-zinc-600 outline-none"
        />
        <button
          onClick={handleAddChecklist}
          className="p-0.5 text-zinc-600 hover:text-cyan-400"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create SubtaskList component**

Create `src/components/SubtaskList.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTaskStore } from '@/store/use-task-store';
import type { Task } from '@/types';

interface SubtaskListProps {
  parentId: string;
  subtasks: Task[];
  onUpdate: () => void;
  onSelect: (taskId: string) => void;
}

export function SubtaskList({ parentId, subtasks, onUpdate, onSelect }: SubtaskListProps) {
  const store = useTaskStore();
  const [newTitle, setNewTitle] = useState('');

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    await store.createTask({ title, parentId });
    setNewTitle('');
    onUpdate();
  }, [newTitle, parentId, store, onUpdate]);

  const handleToggle = useCallback(async (task: Task) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    await store.updateTaskStatus({ id: task.id, status: newStatus });
    onUpdate();
  }, [store, onUpdate]);

  const handleDelete = useCallback(async (id: string) => {
    await store.deleteTask(id);
    onUpdate();
  }, [store, onUpdate]);

  const doneCount = subtasks.filter((t) => t.status === 'done').length;

  return (
    <div className="space-y-1">
      {subtasks.length > 0 && (
        <div className="text-[10px] text-zinc-500 mb-0.5">{doneCount}/{subtasks.length} done</div>
      )}
      {subtasks.map((task) => (
        <div key={task.id} className="flex items-center gap-1.5 group">
          <input
            type="checkbox"
            checked={task.status === 'done'}
            onChange={() => handleToggle(task)}
            className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 h-3 w-3"
          />
          <span
            onClick={() => onSelect(task.id)}
            className={`text-xs flex-1 cursor-pointer hover:text-cyan-400 ${
              task.status === 'done' ? 'line-through text-zinc-600' : 'text-zinc-300'
            }`}
          >
            {task.title}
          </span>
          <button
            onClick={() => handleDelete(task.id)}
            className="p-0.5 text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Add subtask..."
          className="flex-1 bg-transparent text-xs text-zinc-400 placeholder-zinc-600 outline-none"
        />
        <button onClick={handleAdd} className="p-0.5 text-zinc-600 hover:text-cyan-400">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Integrate into TaskEditorPane**

In `src/components/TaskEditorPane.tsx`, add imports at the top:

```tsx
import { ChecklistEditor } from '@/components/ChecklistEditor';
import { SubtaskList } from '@/components/SubtaskList';
import type { Checklist, Tag, Task as TaskType } from '@/types';
```

Add state for checklists and subtasks inside the component:

```tsx
const [checklists, setChecklists] = useState<Checklist[]>([]);
const [subtasks, setSubtasks] = useState<TaskType[]>([]);

const loadExtras = useCallback(async () => {
  if (!task) return;
  const [cl, st] = await Promise.all([
    store.getChecklists(task.id),
    store.getSubtasks(task.id),
  ]);
  setChecklists(cl);
  setSubtasks(st);
}, [task, store]);

useEffect(() => { loadExtras(); }, [loadExtras]);
```

Add sections in the JSX after the tags section and before the footer:

```tsx
{/* Checklists */}
<div className="px-4 py-2 border-t border-zinc-800">
  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Checklists</div>
  <ChecklistEditor taskId={task.id} checklists={checklists} onUpdate={loadExtras} />
</div>

{/* Subtasks */}
<div className="px-4 py-2 border-t border-zinc-800">
  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Subtasks</div>
  <SubtaskList
    parentId={task.id}
    subtasks={subtasks}
    onUpdate={loadExtras}
    onSelect={(id) => store.selectTask(id)}
  />
</div>
```

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: Pass

- [ ] **Step 5: Run frontend tests**

Run: `npm test -- --run`
Expected: Pass

- [ ] **Step 6: Commit**

```bash
git add src/components/ChecklistEditor.tsx src/components/SubtaskList.tsx src/components/TaskEditorPane.tsx
git commit -m "feat(ui): add checklist editor and subtask list components to task editor pane"
```

---

## Phase 2: Yougile Backend

### Task 6: Add reqwest Dependency and Yougile Module Structure

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/yougile/mod.rs`
- Create: `src-tauri/src/yougile/models.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add reqwest to Cargo.toml**

Add to `[dependencies]` section in `src-tauri/Cargo.toml`:

```toml
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
tokio = { version = "1", features = ["macros"] }
```

Note: `rustls-tls` instead of native-tls for cross-platform compatibility without OpenSSL.

- [ ] **Step 2: Create yougile module files**

Create `src-tauri/src/yougile/mod.rs`:

```rust
pub mod models;
pub mod client;
pub mod auth;
pub mod commands;
```

Create `src-tauri/src/yougile/models.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// --- Auth ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthKeyResponse {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsWithCompany {
    pub login: String,
    pub password: String,
    pub company_id: Option<String>,
}

// --- Core Entities ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileProject {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub deleted: bool,
    pub timestamp: Option<i64>,
    pub users: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileBoard {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub deleted: bool,
    pub project_id: Option<String>,
    pub stickers: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileColumn {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub deleted: bool,
    pub board_id: Option<String>,
    pub color: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTask {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub column_id: Option<String>,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub assigned: Vec<String>,
    #[serde(default)]
    pub subtasks: Vec<String>,
    pub checklists: Option<Vec<YougileChecklist>>,
    pub stickers: Option<HashMap<String, String>>,
    pub deadline: Option<YougileDeadline>,
    pub time_tracking: Option<YougileTimeTracking>,
    pub stopwatch: Option<YougileStopwatch>,
    pub timer: Option<YougileTimer>,
    pub created_by: Option<String>,
    pub timestamp: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileChecklist {
    pub title: String,
    #[serde(default)]
    pub items: Vec<YougileChecklistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileChecklistItem {
    pub title: String,
    #[serde(default)]
    pub is_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileDeadline {
    pub deadline: Option<i64>,
    #[serde(rename = "type")]
    pub deadline_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTimeTracking {
    pub plan: Option<i64>,
    pub work: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileStopwatch {
    pub running: Option<bool>,
    pub time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTimer {
    pub running: Option<bool>,
    pub time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileUser {
    pub id: String,
    pub email: Option<String>,
    pub real_name: Option<String>,
    #[serde(default)]
    pub is_admin: bool,
    pub status: Option<String>,
    pub last_activity: Option<i64>,
}

// --- API List Response Wrapper ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileListResponse<T> {
    pub content: Vec<T>,
    pub paging: Option<YougilePaging>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougilePaging {
    pub count: Option<i64>,
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

// --- Create/Update DTOs ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateYougileTask {
    pub title: String,
    pub column_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<YougileDeadline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtasks: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateYougileTask {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<YougileDeadline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_tracking: Option<YougileTimeTracking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stickers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checklists: Option<Vec<YougileChecklist>>,
}

// --- Local Account Storage ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileAccount {
    pub id: String,
    pub email: String,
    pub company_id: String,
    pub company_name: String,
    pub api_key: String,
    pub created_at: String,
}
```

- [ ] **Step 3: Add yougile module to lib.rs**

At the top of `lib.rs`, after the existing module declarations (`mod db; mod models; mod parser;`), add:

```rust
mod yougile;
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles (warnings for unused modules are fine)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/yougile/ src-tauri/src/lib.rs
git commit -m "feat(yougile): add reqwest dependency and Yougile module structure with models"
```

---

### Task 7: Yougile HTTP Client

**Files:**
- Create: `src-tauri/src/yougile/client.rs`

- [ ] **Step 1: Implement the YougileClient**

Create `src-tauri/src/yougile/client.rs`:

```rust
use reqwest::{Client, StatusCode};
use super::models::*;

const BASE_URL: &str = "https://yougile.com/api-v2";

pub struct YougileClient {
    http: Client,
    api_key: String,
}

impl YougileClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http: Client::new(),
            api_key,
        }
    }

    // --- Auth (no key needed) ---

    pub async fn get_companies(login: &str, password: &str) -> Result<Vec<Company>, String> {
        let http = Client::new();
        let resp = http
            .post(format!("{BASE_URL}/auth/companies"))
            .json(&serde_json::json!({ "login": login, "password": password }))
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    pub async fn create_api_key(login: &str, password: &str, company_id: &str) -> Result<String, String> {
        let http = Client::new();
        let resp = http
            .post(format!("{BASE_URL}/auth/keys"))
            .json(&serde_json::json!({
                "login": login,
                "password": password,
                "companyId": company_id,
            }))
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        let key_resp: AuthKeyResponse = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        Ok(key_resp.key)
    }

    // --- Projects ---

    pub async fn get_projects(&self) -> Result<Vec<YougileProject>, String> {
        self.get_list("/projects").await
    }

    // --- Boards ---

    pub async fn get_boards(&self, project_id: &str) -> Result<Vec<YougileBoard>, String> {
        self.get_list_with_param("/boards", "projectId", project_id).await
    }

    // --- Columns ---

    pub async fn get_columns(&self, board_id: &str) -> Result<Vec<YougileColumn>, String> {
        self.get_list_with_param("/columns", "boardId", board_id).await
    }

    // --- Tasks ---

    pub async fn get_tasks(&self, column_id: &str) -> Result<Vec<YougileTask>, String> {
        self.get_list_with_param("/tasks", "columnId", column_id).await
    }

    pub async fn get_task(&self, task_id: &str) -> Result<YougileTask, String> {
        self.get(&format!("/tasks/{task_id}")).await
    }

    pub async fn create_task(&self, payload: &CreateYougileTask) -> Result<YougileTask, String> {
        self.post("/tasks", payload).await
    }

    pub async fn update_task(&self, task_id: &str, payload: &UpdateYougileTask) -> Result<YougileTask, String> {
        self.put(&format!("/tasks/{task_id}"), payload).await
    }

    pub async fn delete_task(&self, task_id: &str) -> Result<(), String> {
        let payload = UpdateYougileTask {
            deleted: Some(true),
            title: None, description: None, column_id: None, completed: None,
            archived: None, assigned: None, deadline: None, time_tracking: None,
            stickers: None, color: None, checklists: None,
        };
        self.put::<_, serde_json::Value>(&format!("/tasks/{task_id}"), &payload).await?;
        Ok(())
    }

    pub async fn move_task(&self, task_id: &str, column_id: &str) -> Result<YougileTask, String> {
        let payload = UpdateYougileTask {
            column_id: Some(column_id.to_string()),
            title: None, description: None, completed: None, archived: None,
            deleted: None, assigned: None, deadline: None, time_tracking: None,
            stickers: None, color: None, checklists: None,
        };
        self.put(&format!("/tasks/{task_id}"), &payload).await
    }

    // --- Users ---

    pub async fn get_users(&self, project_id: &str) -> Result<Vec<YougileUser>, String> {
        self.get_list_with_param("/users", "projectId", project_id).await
    }

    // --- Chat Subscribers ---

    pub async fn get_task_chat_subscribers(&self, task_id: &str) -> Result<Vec<String>, String> {
        let resp = self.authed_request(reqwest::Method::GET, &format!("/tasks/{task_id}/chat-subscribers"))
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        let body: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        Ok(body.as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default())
    }

    // --- Generic Helpers ---

    async fn get_list<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<Vec<T>, String> {
        let mut all = Vec::new();
        let mut offset = 0;
        let limit = 100;
        loop {
            let resp = self.authed_request(reqwest::Method::GET, path)
                .query(&[("limit", limit.to_string()), ("offset", offset.to_string())])
                .send()
                .await
                .map_err(|e| format!("Network error: {e}"))?;
            Self::check_status(&resp)?;
            let page: YougileListResponse<T> = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
            let count = page.content.len();
            all.extend(page.content);
            if count < limit as usize {
                break;
            }
            offset += limit;
        }
        Ok(all)
    }

    async fn get_list_with_param<T: serde::de::DeserializeOwned>(
        &self, path: &str, param_name: &str, param_value: &str,
    ) -> Result<Vec<T>, String> {
        let mut all = Vec::new();
        let mut offset = 0;
        let limit: i64 = 100;
        loop {
            let resp = self.authed_request(reqwest::Method::GET, path)
                .query(&[
                    (param_name, param_value.to_string()),
                    ("limit", limit.to_string()),
                    ("offset", offset.to_string()),
                ])
                .send()
                .await
                .map_err(|e| format!("Network error: {e}"))?;
            Self::check_status(&resp)?;
            let page: YougileListResponse<T> = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
            let count = page.content.len();
            all.extend(page.content);
            if count < (limit as usize) {
                break;
            }
            offset += limit;
        }
        Ok(all)
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self.authed_request(reqwest::Method::GET, path)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    async fn post<B: serde::Serialize, T: serde::de::DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, String> {
        let resp = self.authed_request(reqwest::Method::POST, path)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    async fn put<B: serde::Serialize, T: serde::de::DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, String> {
        let resp = self.authed_request(reqwest::Method::PUT, path)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    fn authed_request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{BASE_URL}{path}"))
            .bearer_auth(&self.api_key)
    }

    fn check_status(resp: &reqwest::Response) -> Result<(), String> {
        match resp.status() {
            s if s.is_success() => Ok(()),
            StatusCode::UNAUTHORIZED => Err("Unauthorized — API key may be invalid or revoked. Re-authenticate in Settings.".to_string()),
            StatusCode::FORBIDDEN => Err("Forbidden — insufficient permissions for this action.".to_string()),
            StatusCode::NOT_FOUND => Err("Not found — the resource may have been deleted.".to_string()),
            StatusCode::TOO_MANY_REQUESTS => Err("Rate limited by Yougile — try again in a moment.".to_string()),
            s => Err(format!("Yougile API error: {s}")),
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/yougile/client.rs
git commit -m "feat(yougile): implement HTTP client with full API coverage"
```

---

### Task 8: Yougile Auth and Account Storage

**Files:**
- Create: `src-tauri/src/yougile/auth.rs`
- Modify: `src-tauri/src/db.rs` (add yougile_accounts table migration + CRUD)

- [ ] **Step 1: Write failing test for yougile_accounts table**

Add to test module in `db.rs`:

```rust
#[test]
fn yougile_accounts_table_exists_after_migration() {
    let dir = tempfile::tempdir().unwrap();
    let db = init_database(dir.path()).unwrap();
    let conn = db.connection.lock().unwrap();
    conn.execute(
        "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
         VALUES ('a1', 'test@test.com', 'c1', 'TestCo', 'key123', '2025-01-01')",
        [],
    ).unwrap();
    let name: String = conn.query_row(
        "SELECT company_name FROM yougile_accounts WHERE id = 'a1'", [], |row| row.get(0),
    ).unwrap();
    assert_eq!(name, "TestCo");
}
```

- [ ] **Step 2: Run test to verify it fails, add migration, verify passes**

Add to `run_migrations()` in `db.rs`:

```rust
    // Migration: create yougile_accounts table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS yougile_accounts (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            company_id TEXT NOT NULL,
            company_name TEXT NOT NULL,
            api_key TEXT NOT NULL,
            created_at TEXT NOT NULL
        );"
    ).map_err(|e| e.to_string())?;
```

Run: `cd src-tauri && cargo test yougile_accounts_table_exists -- --nocapture`
Expected: PASS

- [ ] **Step 3: Add account CRUD functions in db.rs**

```rust
pub fn get_yougile_accounts_impl(db: &DatabaseState) -> Result<Vec<crate::yougile::models::YougileAccount>, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, email, company_id, company_name, api_key, created_at FROM yougile_accounts ORDER BY created_at"
    ).map_err(|e| e.to_string())?;
    let accounts = stmt.query_map([], |row| {
        Ok(crate::yougile::models::YougileAccount {
            id: row.get(0)?,
            email: row.get(1)?,
            company_id: row.get(2)?,
            company_name: row.get(3)?,
            api_key: row.get(4)?,
            created_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    Ok(accounts)
}

pub fn add_yougile_account_impl(
    db: &DatabaseState, email: &str, company_id: &str, company_name: &str, api_key: &str,
) -> Result<crate::yougile::models::YougileAccount, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = timestamp();
    conn.execute(
        "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, email, company_id, company_name, api_key, created_at],
    ).map_err(|e| e.to_string())?;
    Ok(crate::yougile::models::YougileAccount {
        id, email: email.to_string(), company_id: company_id.to_string(),
        company_name: company_name.to_string(), api_key: api_key.to_string(), created_at,
    })
}

pub fn remove_yougile_account_impl(db: &DatabaseState, account_id: &str) -> Result<(), String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    let rows = conn.execute(
        "DELETE FROM yougile_accounts WHERE id = ?1", rusqlite::params![account_id],
    ).map_err(|e| e.to_string())?;
    if rows == 0 { return Err("Account not found".to_string()); }
    Ok(())
}

pub fn get_yougile_account_by_id_impl(db: &DatabaseState, account_id: &str) -> Result<crate::yougile::models::YougileAccount, String> {
    let conn = db.connection.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, email, company_id, company_name, api_key, created_at FROM yougile_accounts WHERE id = ?1",
        rusqlite::params![account_id],
        |row| Ok(crate::yougile::models::YougileAccount {
            id: row.get(0)?,
            email: row.get(1)?,
            company_id: row.get(2)?,
            company_name: row.get(3)?,
            api_key: row.get(4)?,
            created_at: row.get(5)?,
        }),
    ).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Create auth.rs**

Create `src-tauri/src/yougile/auth.rs`:

```rust
use super::client::YougileClient;
use super::models::{Company, YougileAccount};
use crate::db::DatabaseState;

/// Step 1 of login: get companies for credentials
pub async fn login_get_companies(login: &str, password: &str) -> Result<Vec<Company>, String> {
    YougileClient::get_companies(login, password).await
}

/// Step 2 of login: create API key for a specific company and store it
pub async fn add_account(
    db: &DatabaseState,
    login: &str,
    password: &str,
    company_id: &str,
    company_name: &str,
) -> Result<YougileAccount, String> {
    let api_key = YougileClient::create_api_key(login, password, company_id).await?;
    crate::db::add_yougile_account_impl(db, login, company_id, company_name, &api_key)
}

/// Get a YougileClient for a stored account
pub fn client_for_account(db: &DatabaseState, account_id: &str) -> Result<YougileClient, String> {
    let account = crate::db::get_yougile_account_by_id_impl(db, account_id)?;
    Ok(YougileClient::new(account.api_key))
}
```

- [ ] **Step 5: Run cargo check**

Run: `cd src-tauri && cargo check`
Expected: Compiles

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/yougile/auth.rs
git commit -m "feat(yougile): add account storage and auth flow"
```

---

### Task 9: Yougile Tauri IPC Commands

**Files:**
- Create: `src-tauri/src/yougile/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create commands.rs with all IPC handlers**

Create `src-tauri/src/yougile/commands.rs`:

```rust
use tauri::State;
use crate::db::DatabaseState;
use super::auth;
use super::models::*;

// --- Auth Commands ---

#[tauri::command]
pub async fn yougile_login(login: String, password: String) -> Result<Vec<Company>, String> {
    auth::login_get_companies(&login, &password).await
}

#[tauri::command]
pub async fn yougile_add_account(
    login: String, password: String, company_id: String, company_name: String,
    state: State<'_, DatabaseState>,
) -> Result<YougileAccount, String> {
    auth::add_account(&state, &login, &password, &company_id, &company_name).await
}

#[tauri::command]
pub fn yougile_remove_account(account_id: String, state: State<'_, DatabaseState>) -> Result<(), String> {
    crate::db::remove_yougile_account_impl(&state, &account_id)
}

#[tauri::command]
pub fn yougile_get_accounts(state: State<'_, DatabaseState>) -> Result<Vec<YougileAccount>, String> {
    crate::db::get_yougile_accounts_impl(&state)
}

// --- Navigation Commands ---

#[tauri::command]
pub async fn yougile_get_projects(account_id: String, state: State<'_, DatabaseState>) -> Result<Vec<YougileProject>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_projects().await
}

#[tauri::command]
pub async fn yougile_get_boards(account_id: String, project_id: String, state: State<'_, DatabaseState>) -> Result<Vec<YougileBoard>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_boards(&project_id).await
}

#[tauri::command]
pub async fn yougile_get_columns(account_id: String, board_id: String, state: State<'_, DatabaseState>) -> Result<Vec<YougileColumn>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_columns(&board_id).await
}

#[tauri::command]
pub async fn yougile_get_users(account_id: String, project_id: String, state: State<'_, DatabaseState>) -> Result<Vec<YougileUser>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_users(&project_id).await
}

// --- Task Commands ---

#[tauri::command]
pub async fn yougile_get_tasks(account_id: String, column_id: String, state: State<'_, DatabaseState>) -> Result<Vec<YougileTask>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_tasks(&column_id).await
}

#[tauri::command]
pub async fn yougile_create_task(account_id: String, payload: CreateYougileTask, state: State<'_, DatabaseState>) -> Result<YougileTask, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.create_task(&payload).await
}

#[tauri::command]
pub async fn yougile_update_task(account_id: String, task_id: String, payload: UpdateYougileTask, state: State<'_, DatabaseState>) -> Result<YougileTask, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.update_task(&task_id, &payload).await
}

#[tauri::command]
pub async fn yougile_move_task(account_id: String, task_id: String, column_id: String, state: State<'_, DatabaseState>) -> Result<YougileTask, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.move_task(&task_id, &column_id).await
}

#[tauri::command]
pub async fn yougile_delete_task(account_id: String, task_id: String, state: State<'_, DatabaseState>) -> Result<(), String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.delete_task(&task_id).await
}
```

- [ ] **Step 2: Register all yougile commands in lib.rs**

Add to the `.invoke_handler(tauri::generate_handler![...])` in `lib.rs`:

```rust
yougile::commands::yougile_login,
yougile::commands::yougile_add_account,
yougile::commands::yougile_remove_account,
yougile::commands::yougile_get_accounts,
yougile::commands::yougile_get_projects,
yougile::commands::yougile_get_boards,
yougile::commands::yougile_get_columns,
yougile::commands::yougile_get_users,
yougile::commands::yougile_get_tasks,
yougile::commands::yougile_create_task,
yougile::commands::yougile_update_task,
yougile::commands::yougile_move_task,
yougile::commands::yougile_delete_task,
```

- [ ] **Step 3: Run full Rust validation**

Run: `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/yougile/commands.rs src-tauri/src/lib.rs
git commit -m "feat(yougile): add Tauri IPC commands for all Yougile operations"
```

---

## Phase 3: Yougile Frontend

### Task 10: Frontend Yougile Types and Store

**Files:**
- Create: `src/types/yougile.ts`
- Create: `src/store/use-yougile-store.ts`

- [ ] **Step 1: Create Yougile TypeScript types**

Create `src/types/yougile.ts`:

```typescript
export interface YougileCompany {
  id: string;
  title: string;
}

export interface YougileAccount {
  id: string;
  email: string;
  companyId: string;
  companyName: string;
  apiKey: string;
  createdAt: string;
}

export interface YougileProject {
  id: string;
  title: string;
  deleted: boolean;
  timestamp: number | null;
  users: Record<string, unknown> | null;
}

export interface YougileBoard {
  id: string;
  title: string;
  deleted: boolean;
  projectId: string | null;
  stickers: Record<string, unknown> | null;
}

export interface YougileColumn {
  id: string;
  title: string;
  deleted: boolean;
  boardId: string | null;
  color: number | null;
}

export interface YougileChecklist {
  title: string;
  items: YougileChecklistItem[];
}

export interface YougileChecklistItem {
  title: string;
  isCompleted: boolean;
}

export interface YougileDeadline {
  deadline: number | null;
  type: string | null;
}

export interface YougileTimeTracking {
  plan: number | null;
  work: number | null;
}

export interface YougileStopwatch {
  running: boolean | null;
  time: number | null;
}

export interface YougileTimer {
  running: boolean | null;
  time: number | null;
}

export interface YougileTask {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  columnId: string | null;
  completed: boolean;
  archived: boolean;
  deleted: boolean;
  assigned: string[];
  subtasks: string[];
  checklists: YougileChecklist[] | null;
  stickers: Record<string, string> | null;
  deadline: YougileDeadline | null;
  timeTracking: YougileTimeTracking | null;
  stopwatch: YougileStopwatch | null;
  timer: YougileTimer | null;
  createdBy: string | null;
  timestamp: number | null;
}

export interface YougileUser {
  id: string;
  email: string | null;
  realName: string | null;
  isAdmin: boolean;
  status: string | null;
  lastActivity: number | null;
}

export interface CreateYougileTask {
  title: string;
  columnId: string;
  description?: string;
  assigned?: string[];
  deadline?: YougileDeadline;
  completed?: boolean;
  archived?: boolean;
  subtasks?: string[];
}

export interface UpdateYougileTask {
  title?: string;
  description?: string;
  columnId?: string;
  completed?: boolean;
  archived?: boolean;
  deleted?: boolean;
  assigned?: string[];
  deadline?: YougileDeadline;
  timeTracking?: YougileTimeTracking;
  stickers?: Record<string, string>;
  color?: string;
  checklists?: YougileChecklist[];
}

export type DataSource = 'local' | 'yougile';

export interface YougileContext {
  accountId: string | null;
  projectId: string | null;
  projectName: string | null;
  boardId: string | null;
  boardName: string | null;
}
```

- [ ] **Step 2: Create Yougile Zustand store**

Create `src/store/use-yougile-store.ts`:

```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  YougileAccount, YougileProject, YougileBoard, YougileColumn,
  YougileTask, YougileUser, YougileCompany, YougileContext,
  DataSource, CreateYougileTask, UpdateYougileTask,
} from '@/types/yougile';

interface YougileState {
  // Feature flag
  yougileEnabled: boolean;
  setYougileEnabled: (enabled: boolean) => void;

  // Source
  activeSource: DataSource;
  setActiveSource: (source: DataSource) => void;

  // Context
  yougileContext: YougileContext;
  setYougileContext: (ctx: Partial<YougileContext>) => void;

  // Accounts
  accounts: YougileAccount[];
  fetchAccounts: () => Promise<void>;
  login: (email: string, password: string) => Promise<YougileCompany[]>;
  addAccount: (email: string, password: string, companyId: string, companyName: string) => Promise<YougileAccount>;
  removeAccount: (id: string) => Promise<void>;

  // Navigation data
  projects: YougileProject[];
  boards: YougileBoard[];
  columns: YougileColumn[];
  users: YougileUser[];
  fetchProjects: () => Promise<void>;
  fetchBoards: (projectId: string) => Promise<void>;
  fetchColumns: (boardId: string) => Promise<void>;
  fetchUsers: (projectId: string) => Promise<void>;

  // Task data
  tasks: YougileTask[];
  isLoading: boolean;
  error: string | null;
  fetchTasks: () => Promise<void>;
  createTask: (payload: CreateYougileTask) => Promise<YougileTask>;
  updateTask: (taskId: string, payload: UpdateYougileTask) => Promise<YougileTask>;
  moveTask: (taskId: string, columnId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;

  // UI
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;
  clearError: () => void;
}

const hasTauri = () => '__TAURI_INTERNALS__' in window;

export const useYougileStore = create<YougileState>((set, get) => ({
  yougileEnabled: false,
  setYougileEnabled: (enabled) => {
    set({ yougileEnabled: enabled });
    if (!enabled) {
      set({ activeSource: 'local' });
    }
  },

  activeSource: 'local',
  setActiveSource: (source) => set({ activeSource: source }),

  yougileContext: {
    accountId: null,
    projectId: null,
    projectName: null,
    boardId: null,
    boardName: null,
  },
  setYougileContext: (ctx) => set((s) => ({
    yougileContext: { ...s.yougileContext, ...ctx },
  })),

  accounts: [],
  fetchAccounts: async () => {
    if (!hasTauri()) return;
    const accounts = await invoke<YougileAccount[]>('yougile_get_accounts');
    set({ accounts });
  },

  login: async (email, password) => {
    if (!hasTauri()) return [];
    return await invoke<YougileCompany[]>('yougile_login', { login: email, password });
  },

  addAccount: async (email, password, companyId, companyName) => {
    if (!hasTauri()) throw new Error('Not in Tauri');
    const account = await invoke<YougileAccount>('yougile_add_account', {
      login: email, password, companyId, companyName,
    });
    set((s) => ({ accounts: [...s.accounts, account] }));
    return account;
  },

  removeAccount: async (id) => {
    if (!hasTauri()) return;
    await invoke('yougile_remove_account', { accountId: id });
    set((s) => ({
      accounts: s.accounts.filter((a) => a.id !== id),
      yougileContext: s.yougileContext.accountId === id
        ? { accountId: null, projectId: null, projectName: null, boardId: null, boardName: null }
        : s.yougileContext,
    }));
  },

  projects: [],
  boards: [],
  columns: [],
  users: [],

  fetchProjects: async () => {
    if (!hasTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    const projects = await invoke<YougileProject[]>('yougile_get_projects', {
      accountId: yougileContext.accountId,
    });
    set({ projects: projects.filter((p) => !p.deleted) });
  },

  fetchBoards: async (projectId) => {
    if (!hasTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    const boards = await invoke<YougileBoard[]>('yougile_get_boards', {
      accountId: yougileContext.accountId, projectId,
    });
    set({ boards: boards.filter((b) => !b.deleted) });
  },

  fetchColumns: async (boardId) => {
    if (!hasTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    const columns = await invoke<YougileColumn[]>('yougile_get_columns', {
      accountId: yougileContext.accountId, boardId,
    });
    set({ columns: columns.filter((c) => !c.deleted) });
  },

  fetchUsers: async (projectId) => {
    if (!hasTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    const users = await invoke<YougileUser[]>('yougile_get_users', {
      accountId: yougileContext.accountId, projectId,
    });
    set({ users });
  },

  tasks: [],
  isLoading: false,
  error: null,

  fetchTasks: async () => {
    if (!hasTauri()) return;
    const { yougileContext, columns } = get();
    if (!yougileContext.accountId || !yougileContext.boardId) return;
    set({ isLoading: true, error: null });
    try {
      const allTasks: YougileTask[] = [];
      for (const col of columns) {
        const tasks = await invoke<YougileTask[]>('yougile_get_tasks', {
          accountId: yougileContext.accountId, columnId: col.id,
        });
        allTasks.push(...tasks.filter((t) => !t.deleted));
      }
      set({ tasks: allTasks, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  createTask: async (payload) => {
    if (!hasTauri()) throw new Error('Not in Tauri');
    const { yougileContext } = get();
    if (!yougileContext.accountId) throw new Error('No account selected');
    const task = await invoke<YougileTask>('yougile_create_task', {
      accountId: yougileContext.accountId, payload,
    });
    set((s) => ({ tasks: [task, ...s.tasks] }));
    return task;
  },

  updateTask: async (taskId, payload) => {
    if (!hasTauri()) throw new Error('Not in Tauri');
    const { yougileContext } = get();
    if (!yougileContext.accountId) throw new Error('No account selected');
    const updated = await invoke<YougileTask>('yougile_update_task', {
      accountId: yougileContext.accountId, taskId, payload,
    });
    set((s) => ({ tasks: s.tasks.map((t) => t.id === taskId ? updated : t) }));
    return updated;
  },

  moveTask: async (taskId, columnId) => {
    if (!hasTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    // Optimistic update
    set((s) => ({ tasks: s.tasks.map((t) => t.id === taskId ? { ...t, columnId } : t) }));
    try {
      await invoke('yougile_move_task', {
        accountId: yougileContext.accountId, taskId, columnId,
      });
    } catch (e) {
      // Revert on failure
      set({ error: String(e) });
      get().fetchTasks();
    }
  },

  deleteTask: async (taskId) => {
    if (!hasTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) }));
    try {
      await invoke('yougile_delete_task', {
        accountId: yougileContext.accountId, taskId,
      });
    } catch (e) {
      set({ error: String(e) });
      get().fetchTasks();
    }
  },

  selectedTaskId: null,
  selectTask: (id) => set({ selectedTaskId: id }),
  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck && npm run lint`
Expected: Pass

- [ ] **Step 4: Commit**

```bash
git add src/types/yougile.ts src/store/use-yougile-store.ts
git commit -m "feat(yougile): add frontend Yougile types and Zustand store"
```

---

### Task 11: Source Switcher and Breadcrumb Components

**Files:**
- Create: `src/components/SourceSwitcher.tsx`
- Modify: `src/Dashboard.tsx`

- [ ] **Step 1: Create SourceSwitcher component**

Create `src/components/SourceSwitcher.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, Monitor, Cloud } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';

export function SourceSwitcher() {
  const {
    activeSource, setActiveSource, yougileEnabled,
    yougileContext, setYougileContext,
    accounts, projects, boards,
    fetchProjects, fetchBoards,
  } = useYougileStore();

  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showBoardPicker, setShowBoardPicker] = useState(false);

  if (!yougileEnabled) return null;

  const handleSourceToggle = () => {
    if (activeSource === 'local') {
      if (accounts.length === 0) return; // nudge to settings handled elsewhere
      setActiveSource('yougile');
    } else {
      setActiveSource('local');
    }
  };

  const handleSelectAccount = async (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    setYougileContext({
      accountId,
      projectId: null,
      projectName: null,
      boardId: null,
      boardName: null,
    });
    setShowOrgPicker(false);
    await fetchProjects();
  };

  const handleSelectProject = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    setYougileContext({
      projectId,
      projectName: project.title,
      boardId: null,
      boardName: null,
    });
    setShowProjectPicker(false);
    await fetchBoards(projectId);
  };

  const handleSelectBoard = (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) return;
    setYougileContext({ boardId, boardName: board.title });
    setShowBoardPicker(false);
  };

  const activeAccount = accounts.find((a) => a.id === yougileContext.accountId);

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Source toggle */}
      <button
        onClick={handleSourceToggle}
        className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
          activeSource === 'yougile'
            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
        }`}
      >
        {activeSource === 'local' ? <Monitor size={12} /> : <Cloud size={12} />}
        {activeSource === 'local' ? 'Local' : 'Yougile'}
      </button>

      {/* Breadcrumb (Yougile mode only) */}
      {activeSource === 'yougile' && (
        <div className="flex items-center gap-1 text-zinc-500">
          {/* Org picker */}
          <div className="relative">
            <button
              onClick={() => setShowOrgPicker(!showOrgPicker)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
            >
              {activeAccount?.companyName || 'Select org'}
              <ChevronDown size={10} />
            </button>
            {showOrgPicker && (
              <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleSelectAccount(a.id)}
                    className="block w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    {a.companyName}
                    <span className="text-zinc-600 ml-1">{a.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {yougileContext.accountId && (
            <>
              <span className="text-zinc-700">/</span>
              {/* Project picker */}
              <div className="relative">
                <button
                  onClick={() => setShowProjectPicker(!showProjectPicker)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
                >
                  {yougileContext.projectName || 'Select project'}
                  <ChevronDown size={10} />
                </button>
                {showProjectPicker && (
                  <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProject(p.id)}
                        className="block w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {yougileContext.projectId && (
            <>
              <span className="text-zinc-700">/</span>
              {/* Board picker */}
              <div className="relative">
                <button
                  onClick={() => setShowBoardPicker(!showBoardPicker)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
                >
                  {yougileContext.boardName || 'Select board'}
                  <ChevronDown size={10} />
                </button>
                {showBoardPicker && (
                  <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                    {boards.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => handleSelectBoard(b.id)}
                        className="block w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        {b.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrate SourceSwitcher into Dashboard header**

In `src/Dashboard.tsx`, add import:

```tsx
import { SourceSwitcher } from '@/components/SourceSwitcher';
```

Add `<SourceSwitcher />` in the Dashboard header area (the `backdrop-blur-md` header section), next to the existing tab navigation. The exact placement depends on the current header layout — place it to the left of the tabs or in its own row below the title bar area.

- [ ] **Step 3: Wire up board selection to fetch columns and tasks**

In `Dashboard.tsx`, add a `useEffect` that reacts to board changes from the Yougile store:

```tsx
import { useYougileStore } from '@/store/use-yougile-store';

// Inside the Dashboard component:
const yougileStore = useYougileStore();

useEffect(() => {
  if (yougileStore.activeSource === 'yougile' && yougileStore.yougileContext.boardId) {
    yougileStore.fetchColumns(yougileStore.yougileContext.boardId).then(() => {
      yougileStore.fetchTasks();
    });
  }
}, [yougileStore.activeSource, yougileStore.yougileContext.boardId]);
```

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: Pass

- [ ] **Step 5: Commit**

```bash
git add src/components/SourceSwitcher.tsx src/Dashboard.tsx
git commit -m "feat(ui): add source switcher and breadcrumb navigation to dashboard"
```

---

### Task 12: Wire Kanban/List/Calendar Views to Yougile Data

**Files:**
- Modify: `src/components/KanbanBoard.tsx`
- Modify: `src/Dashboard.tsx`
- Modify: `src/components/KanbanTaskCard.tsx`
- Modify: `src/components/CalendarView.tsx`

- [ ] **Step 1: Update Dashboard to pass Yougile data to views**

In `Dashboard.tsx`, update the rendering logic to branch on `activeSource`:

```tsx
const isYougile = yougileStore.activeSource === 'yougile';

// For Kanban tab, pass either local or Yougile columns/tasks
// For List tab, use either local filteredTasks or yougileStore.tasks
// For Calendar tab, use either local tasks or yougileStore.tasks with deadline mapping
```

The key change: when `isYougile` is true, the Kanban view receives `yougileStore.columns` (mapped to the `KanbanColumn` shape) and `yougileStore.tasks` (mapped to display data). Create a small mapping function:

```tsx
const yougileColumnsAsKanban = useMemo(() => {
  if (!isYougile) return [];
  return yougileStore.columns.map((col, idx) => ({
    id: col.id,
    name: col.title,
    statusKey: col.id, // use column ID as status key for Yougile
    position: idx,
  }));
}, [isYougile, yougileStore.columns]);
```

- [ ] **Step 2: Update KanbanBoard to handle Yougile drag-drop**

In `KanbanBoard.tsx`, the `handleDragEnd` for task moves needs to detect the source and call the right action:

```tsx
import { useYougileStore } from '@/store/use-yougile-store';

// Inside component:
const yougileStore = useYougileStore();
const isYougile = yougileStore.activeSource === 'yougile';

// In handleDragEnd for task drops:
if (isYougile) {
  await yougileStore.moveTask(taskId, newColumnId);
} else {
  await store.updateTaskStatus({ id: taskId, status: newStatusKey });
}
```

- [ ] **Step 3: Update KanbanTaskCard to show Yougile-specific data**

In `KanbanTaskCard.tsx`, when rendering a Yougile task, show:
- Color stripe (from `task.color`)
- Assigned user avatars (initials from `yougileStore.users`)
- Sticker badges
- Deadline date

This requires the card to accept either a local `Task` or a `YougileTask`. Create a union display type or pass normalized props.

- [ ] **Step 4: Update CalendarView for Yougile deadlines**

In `CalendarView.tsx`, when `isYougile`, map tasks by `deadline.deadline` (unix timestamp → date string) instead of `dueDate`.

- [ ] **Step 5: Run typecheck, lint, and tests**

Run: `npm run typecheck && npm run lint && npm test -- --run`
Expected: Pass

- [ ] **Step 6: Commit**

```bash
git add src/components/KanbanBoard.tsx src/components/KanbanTaskCard.tsx src/components/CalendarView.tsx src/Dashboard.tsx
git commit -m "feat(ui): wire kanban, list, and calendar views to Yougile data source"
```

---

## Phase 4: Quick Capture & Settings

### Task 13: Settings — Kill Switch and Accounts Tab

**Files:**
- Create: `src/components/AccountsSettings.tsx`
- Modify: `src/Settings.tsx`
- Modify: `src-tauri/src/db.rs` (store yougile_enabled setting)

- [ ] **Step 1: Add yougile_enabled to settings storage**

In `db.rs`, the existing settings system uses key-value pairs. The kill switch can be stored as `key = 'yougile_enabled'`, `value = 'true'` or `'false'`. No schema change needed — just use `save_setting()` and `load_settings()`.

Update `load_settings` and the `AppSettings` model to include `yougile_enabled`:

In `models.rs`, add to `AppSettings`:

```rust
pub yougile_enabled: bool,
```

In `db.rs` `load_settings()`, add:

```rust
let yougile_enabled: bool = conn
    .query_row("SELECT value FROM settings WHERE key = 'yougile_enabled'", [], |row| row.get::<_, String>(0))
    .map(|v| v == "true")
    .unwrap_or(false);
```

And include it in the returned `AppSettings`.

- [ ] **Step 2: Create AccountsSettings component**

Create `src/components/AccountsSettings.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';
import type { YougileCompany } from '@/types/yougile';

export function AccountsSettings() {
  const { accounts, login, addAccount, removeAccount, fetchAccounts } = useYougileStore();
  const [step, setStep] = useState<'list' | 'credentials' | 'company'>('list');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<YougileCompany[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await login(email, password);
      setCompanies(result);
      setStep('company');
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [email, password, login]);

  const handleSelectCompany = useCallback(async (company: YougileCompany) => {
    setIsLoading(true);
    setError(null);
    try {
      await addAccount(email, password, company.id, company.title);
      setStep('list');
      setEmail('');
      setPassword('');
      setCompanies([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [email, password, addAccount]);

  const handleRemove = useCallback(async (id: string) => {
    await removeAccount(id);
  }, [removeAccount]);

  if (step === 'credentials') {
    return (
      <div className="space-y-3">
        <div className="text-sm text-zinc-300 mb-2">Sign in to Yougile</div>
        {error && <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setStep('list')}
            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={handleLogin}
            disabled={isLoading || !email || !password}
            className="px-3 py-1.5 text-sm bg-cyan-500/10 text-cyan-400 rounded hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : 'Sign In'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'company') {
    return (
      <div className="space-y-3">
        <div className="text-sm text-zinc-300 mb-2">Select organization</div>
        {error && <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>}
        {companies.map((c) => (
          <button
            key={c.id}
            onClick={() => handleSelectCompany(c)}
            disabled={isLoading}
            className="block w-full text-left px-3 py-2 bg-zinc-800 border border-zinc-700 rounded hover:border-cyan-500 text-sm text-zinc-200"
          >
            {c.title}
          </button>
        ))}
        <button
          onClick={() => setStep('credentials')}
          className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.length === 0 ? (
        <div className="text-sm text-zinc-500">No Yougile accounts connected.</div>
      ) : (
        accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between px-3 py-2 bg-zinc-800 border border-zinc-700 rounded">
            <div>
              <div className="text-sm text-zinc-200">{account.companyName}</div>
              <div className="text-xs text-zinc-500">{account.email}</div>
            </div>
            <button
              onClick={() => handleRemove(account.id)}
              className="p-1 text-zinc-600 hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))
      )}
      <button
        onClick={() => setStep('credentials')}
        className="flex items-center gap-1 px-3 py-1.5 text-sm text-cyan-400 hover:text-cyan-300"
      >
        <Plus size={14} /> Add Account
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Update Settings.tsx**

In `src/Settings.tsx`:

Add imports:

```tsx
import { AccountsSettings } from '@/components/AccountsSettings';
import { useYougileStore } from '@/store/use-yougile-store';
```

Add "Accounts" to the tabs array (only visible when yougileEnabled):

```tsx
const yougileStore = useYougileStore();
```

In the General tab content, add the kill switch toggle:

```tsx
<div className="flex items-center justify-between py-2">
  <div>
    <div className="text-sm text-zinc-200">Yougile Integration</div>
    <div className="text-xs text-zinc-500">Connect to Yougile for remote task management</div>
  </div>
  <button
    onClick={() => {
      const newValue = !yougileStore.yougileEnabled;
      yougileStore.setYougileEnabled(newValue);
      store.updateSettings(/* save yougile_enabled */);
    }}
    className={`w-10 h-5 rounded-full transition-colors ${
      yougileStore.yougileEnabled ? 'bg-cyan-500' : 'bg-zinc-700'
    }`}
  >
    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
      yougileStore.yougileEnabled ? 'translate-x-5' : 'translate-x-0.5'
    }`} />
  </button>
</div>
```

Add the Accounts tab content (conditionally rendered when `yougileEnabled`):

```tsx
{yougileStore.yougileEnabled && activeTab === 'accounts' && (
  <AccountsSettings />
)}
```

- [ ] **Step 4: Update frontend types for AppSettings**

In `src/types.ts`, update `AppSettings`:

```typescript
export interface AppSettings {
  vaultDir: string | null;
  theme: string;
  yougileEnabled: boolean;
}
```

- [ ] **Step 5: Run typecheck, lint, and tests**

Run: `npm run typecheck && npm run lint && npm test -- --run`
Expected: Pass

- [ ] **Step 6: Commit**

```bash
git add src/components/AccountsSettings.tsx src/Settings.tsx src/types.ts src-tauri/src/db.rs src-tauri/src/models.rs
git commit -m "feat(settings): add Yougile kill switch and accounts management tab"
```

---

### Task 14: Quick Capture Yougile Integration

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add source indicator to Quick Capture input**

In `App.tsx`, import the Yougile store:

```tsx
import { useYougileStore } from '@/store/use-yougile-store';
```

Inside the component, read the source state:

```tsx
const yougileStore = useYougileStore();
const isYougile = yougileStore.activeSource === 'yougile';
```

Add a source badge next to the input field (inside the input area, before or after the icon):

```tsx
{yougileStore.yougileEnabled && (
  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
    isYougile
      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
      : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
  }`}>
    {isYougile
      ? `${yougileStore.yougileContext.boardName || 'Yougile'}`
      : 'LOCAL'
    }
  </span>
)}
```

- [ ] **Step 2: Add Yougile palette commands**

In the Command.List section where existing commands are listed (Dashboard, Settings, etc.), add conditional Yougile commands:

```tsx
{yougileStore.yougileEnabled && (
  <>
    <Command.Item
      onSelect={() => {
        yougileStore.setActiveSource(isYougile ? 'local' : 'yougile');
      }}
    >
      {isYougile ? 'Switch to Local' : 'Switch to Yougile'}
    </Command.Item>

    {isYougile && (
      <>
        <Command.Item onSelect={() => { /* open org picker state */ setPickerMode('org'); }}>
          Switch Org...
        </Command.Item>
        <Command.Item onSelect={() => { /* open board picker state */ setPickerMode('board'); }}>
          Switch Board...
        </Command.Item>
      </>
    )}
  </>
)}
```

- [ ] **Step 3: Add inline picker mode**

Add a `pickerMode` state: `'none' | 'org' | 'project' | 'board'`

When pickerMode is active, replace the task list with the picker items:

```tsx
const [pickerMode, setPickerMode] = useState<'none' | 'org' | 'project' | 'board'>('none');

// In the Command.List rendering:
{pickerMode === 'org' && (
  <Command.Group heading="Select Organization">
    {yougileStore.accounts.map((a) => (
      <Command.Item
        key={a.id}
        onSelect={async () => {
          yougileStore.setYougileContext({ accountId: a.id });
          await yougileStore.fetchProjects();
          setPickerMode('project');
        }}
      >
        {a.companyName} <span className="text-zinc-500 ml-1">{a.email}</span>
      </Command.Item>
    ))}
  </Command.Group>
)}

{pickerMode === 'project' && (
  <Command.Group heading="Select Project">
    {yougileStore.projects.map((p) => (
      <Command.Item
        key={p.id}
        onSelect={async () => {
          yougileStore.setYougileContext({ projectId: p.id, projectName: p.title });
          await yougileStore.fetchBoards(p.id);
          setPickerMode('board');
        }}
      >
        {p.title}
      </Command.Item>
    ))}
  </Command.Group>
)}

{pickerMode === 'board' && (
  <Command.Group heading="Select Board">
    {yougileStore.boards.map((b) => (
      <Command.Item
        key={b.id}
        onSelect={async () => {
          yougileStore.setYougileContext({ boardId: b.id, boardName: b.title });
          await yougileStore.fetchColumns(b.id);
          setPickerMode('none');
        }}
      >
        {b.title}
      </Command.Item>
    ))}
  </Command.Group>
)}
```

- [ ] **Step 4: Update task creation to support Yougile**

In the submit handler (where `Enter` creates a task), branch on source:

```tsx
if (isYougile && yougileStore.yougileContext.boardId) {
  const firstColumn = yougileStore.columns[0];
  if (firstColumn) {
    await yougileStore.createTask({
      title: query,
      columnId: firstColumn.id,
    });
  }
} else {
  await store.createTask({ rawInput: query });
}
```

- [ ] **Step 5: Handle Escape in picker mode**

In the keyboard handler, if `pickerMode !== 'none'`, Escape goes back one level:

```tsx
if (pickerMode !== 'none') {
  if (pickerMode === 'board') setPickerMode('project');
  else if (pickerMode === 'project') setPickerMode('org');
  else setPickerMode('none');
  return;
}
```

- [ ] **Step 6: Run typecheck, lint, tests**

Run: `npm run typecheck && npm run lint && npm test -- --run`
Expected: Pass

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(capture): add Yougile source indicator, commands, and inline pickers to Quick Capture"
```

---

## Phase 5: Polish

### Task 15: Loading States, Error Toasts, and Keyboard Navigation

**Files:**
- Modify: `src/Dashboard.tsx` (loading skeleton, error toast)
- Modify: `src/hooks/use-vim-bindings.ts` (Yougile task navigation)
- Modify: `src/components/KanbanBoard.tsx` (loading state)

- [ ] **Step 1: Add loading skeleton to Dashboard**

When `yougileStore.isLoading` is true and there are no tasks yet, show a skeleton:

```tsx
{isYougile && yougileStore.isLoading && yougileStore.tasks.length === 0 && (
  <div className="flex gap-4 p-4">
    {[1, 2, 3].map((i) => (
      <div key={i} className="flex-1 space-y-2">
        <div className="h-8 bg-zinc-800 rounded animate-pulse" />
        <div className="h-20 bg-zinc-800 rounded animate-pulse" />
        <div className="h-20 bg-zinc-800 rounded animate-pulse" />
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 2: Add error toast**

Add a simple toast component that renders when `yougileStore.error` is set:

```tsx
{yougileStore.error && (
  <div className="fixed bottom-4 right-4 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg shadow-lg z-50 max-w-sm">
    <div className="flex items-center justify-between gap-2">
      <span>{yougileStore.error}</span>
      <button onClick={() => yougileStore.clearError()} className="text-red-300 hover:text-red-200">x</button>
    </div>
  </div>
)}
```

- [ ] **Step 3: Update vim bindings for Yougile mode**

In `use-vim-bindings.ts`, the hook currently navigates through `store.tasks`. When in Yougile mode, it should navigate `yougileStore.tasks` instead. Import the Yougile store and branch:

```tsx
import { useYougileStore } from '@/store/use-yougile-store';

// Inside the hook:
const yougileStore = useYougileStore();
const isYougile = yougileStore.activeSource === 'yougile';
const activeTasks = isYougile ? yougileStore.tasks : /* existing task list */;
const selectTask = isYougile ? yougileStore.selectTask : store.selectTask;
```

- [ ] **Step 4: Run full validation**

Run: `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test && cd .. && npm run lint && npm run typecheck && npm test -- --run`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/Dashboard.tsx src/hooks/use-vim-bindings.ts src/components/KanbanBoard.tsx
git commit -m "feat(polish): add loading states, error toasts, and Yougile keyboard navigation"
```

---

### Task 16: Yougile Task Editor Pane

**Files:**
- Create: `src/components/YougileTaskEditor.tsx`
- Modify: `src/Dashboard.tsx`

- [ ] **Step 1: Create YougileTaskEditor component**

Create `src/components/YougileTaskEditor.tsx` — a task editor pane for Yougile tasks with:

- Title (editable textarea)
- Description (editable textarea with markdown preview)
- Column/status (dropdown of `yougileStore.columns`)
- Assigned users (multi-select from `yougileStore.users`, showing initials/names)
- Checklists (rendered from `task.checklists`, editable inline — update via `yougileStore.updateTask`)
- Stickers (displayed as colored badges)
- Deadline (date picker, maps to/from unix timestamp)
- Time tracking (plan vs work display, editable)
- Color picker (small palette)
- Close button, Escape to close

Follow the same visual style as `TaskEditorPane.tsx`:
- `text-xs` for labels
- `bg-zinc-800` for inputs
- `border-zinc-700` for borders
- Slide-in panel from the right

Save changes by calling `yougileStore.updateTask(taskId, { field: value })` on blur.

The component should be approximately 300-400 lines. Follow the existing `TaskEditorPane.tsx` patterns for auto-resize textareas, field blur saves, and keyboard navigation (Tab between fields, Escape to close).

- [ ] **Step 2: Integrate into Dashboard**

In `Dashboard.tsx`, render `YougileTaskEditor` when `isYougile && yougileStore.selectedTaskId`:

```tsx
import { YougileTaskEditor } from '@/components/YougileTaskEditor';

// In the render:
{isYougile && yougileStore.selectedTaskId && (
  <YougileTaskEditor
    task={yougileStore.tasks.find((t) => t.id === yougileStore.selectedTaskId)!}
    onClose={() => yougileStore.selectTask(null)}
  />
)}
{!isYougile && store.selectedTaskId && store.isEditorOpen && (
  <TaskEditorPane /* existing props */ />
)}
```

- [ ] **Step 3: Run typecheck, lint, tests**

Run: `npm run typecheck && npm run lint && npm test -- --run`
Expected: Pass

- [ ] **Step 4: Commit**

```bash
git add src/components/YougileTaskEditor.tsx src/Dashboard.tsx
git commit -m "feat(ui): add Yougile task editor pane with full field support"
```

---

### Task 17: Final Validation and Documentation Update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run full validation sequence**

Run:

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test && cd ..
npm run lint && npm run typecheck && npm test -- --run && npm run build
```

Expected: All pass, clean build

- [ ] **Step 2: Update CLAUDE.md with Yougile integration docs**

Add a new section to `CLAUDE.md` after the existing "Key Patterns" section:

```markdown
### Yougile Integration

Jot supports Yougile as a live remote data source. When enabled (Settings > General > Yougile Integration), users can switch between local SQLite tasks and Yougile tasks.

**Architecture:**
- All Yougile HTTP calls live in `src-tauri/src/yougile/` (Rust)
- Frontend uses a separate Zustand store (`use-yougile-store.ts`)
- Separate `yougile_*` IPC commands — not shared with local commands

**Modules:**

| Module | Purpose |
|--------|---------|
| `yougile/client.rs` | HTTP client (reqwest), all API calls with pagination |
| `yougile/models.rs` | Yougile API DTOs |
| `yougile/auth.rs` | Login flow, API key management |
| `yougile/commands.rs` | Tauri IPC command handlers |

**Frontend:**

| Module | Purpose |
|--------|---------|
| `types/yougile.ts` | TypeScript interfaces for Yougile entities |
| `store/use-yougile-store.ts` | Zustand store for Yougile state, navigation, CRUD |
| `components/SourceSwitcher.tsx` | Local/Yougile toggle + org/project/board breadcrumb |
| `components/YougileTaskEditor.tsx` | Task editor for Yougile-specific fields |
| `components/AccountsSettings.tsx` | Account management in Settings |

**Data flow:** Always-live — no local cache. Every view mount fetches from the API. Optimistic UI for mutations with revert on failure.

**Auth:** JWT API keys minted via email/password, stored in `yougile_accounts` SQLite table. Keys don't expire.

**Kill switch:** `settings.yougile_enabled` — off by default. Hides all Yougile UI when disabled.
```

Also add new IPC commands to the existing commands list:

```markdown
Yougile commands: `yougile_login`, `yougile_add_account`, `yougile_remove_account`, `yougile_get_accounts`, `yougile_get_projects`, `yougile_get_boards`, `yougile_get_columns`, `yougile_get_users`, `yougile_get_tasks`, `yougile_create_task`, `yougile_update_task`, `yougile_move_task`, `yougile_delete_task`.
```

Add local enhancement commands:

```markdown
Local enhancement commands: `get_checklists`, `create_checklist`, `add_checklist_item`, `update_checklist_item`, `delete_checklist`, `delete_checklist_item`, `get_tags`, `create_tag`, `update_tag`, `delete_tag`, `get_task_tags`, `set_task_tags`, `get_subtasks`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Yougile integration and local enhancement documentation"
```

- [ ] **Step 4: Run final check**

Run: `cd src-tauri && cargo test && cd .. && npm test -- --run`
Expected: All pass
