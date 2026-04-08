use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::OnceLock;

use chrono::Utc;
#[cfg(not(test))]
use keyring::Entry;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::models::{
    AppSettings, Checklist, ChecklistItem, CreateColumnInput, CreateTaskInput,
    CreateTaskTemplateInput, KanbanColumn, ReorderColumnsInput, Tag, Task, TaskPriority,
    TaskTemplate, UpdateColumnInput, UpdateSettingsInput, UpdateTaskInput, UpdateTaskStatusInput,
    UpdateTaskTemplateInput, YougileSyncState,
};
use crate::parser::parse_task_input;

pub struct DatabaseState {
    connection: Mutex<Connection>,
}

impl DatabaseState {
    pub fn new(connection: Connection) -> Self {
        Self {
            connection: Mutex::new(connection),
        }
    }

    pub fn current_theme(&self) -> Option<tauri::Theme> {
        let conn = self.connection.lock().ok()?;
        let theme: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .ok()?;
        match theme.as_str() {
            "light" => Some(tauri::Theme::Light),
            _ => Some(tauri::Theme::Dark),
        }
    }
}

pub fn init_database(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;

    let database_path = app_data_dir.join("jot.db");
    let connection = Connection::open(database_path)
        .map_err(|error| format!("Failed to open SQLite database: {error}"))?;

    run_migrations(&connection)?;
    app.manage(DatabaseState::new(connection));

    Ok(())
}

#[cfg(not(test))]
const YOUGILE_KEYRING_SERVICE: &str = "dev.acidsugarx.jot.yougile";

#[cfg(test)]
static TEST_YOUGILE_KEYRING: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn db_error(action: &str, error: impl std::fmt::Display) -> String {
    format!("Failed to {action}: {error}")
}

fn build_patch_query(table: &str, sets: &[&str]) -> String {
    format!("UPDATE {table} SET {} WHERE id = ?", sets.join(", "))
}

#[cfg(test)]
fn store_yougile_api_key(account_id: &str, api_key: &str) -> Result<(), String> {
    let keyring = TEST_YOUGILE_KEYRING.get_or_init(|| Mutex::new(HashMap::new()));
    let mut keyring = keyring
        .lock()
        .map_err(|error| db_error("lock test keyring", error))?;
    keyring.insert(account_id.to_string(), api_key.to_string());
    Ok(())
}

#[cfg(not(test))]
fn store_yougile_api_key(account_id: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(YOUGILE_KEYRING_SERVICE, account_id)
        .map_err(|error| db_error("create Yougile keychain entry", error))?;
    entry
        .set_password(api_key)
        .map_err(|error| db_error("store Yougile API key in the system keychain", error))
}

#[cfg(test)]
fn load_yougile_api_key(account_id: &str) -> Result<Option<String>, String> {
    let keyring = TEST_YOUGILE_KEYRING.get_or_init(|| Mutex::new(HashMap::new()));
    let keyring = keyring
        .lock()
        .map_err(|error| db_error("lock test keyring", error))?;
    Ok(keyring.get(account_id).cloned())
}

#[cfg(not(test))]
fn load_yougile_api_key(account_id: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(YOUGILE_KEYRING_SERVICE, account_id)
        .map_err(|error| db_error("create Yougile keychain entry", error))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(db_error(
            "read Yougile API key from the system keychain",
            error,
        )),
    }
}

#[cfg(test)]
fn delete_yougile_api_key(account_id: &str) -> Result<(), String> {
    let keyring = TEST_YOUGILE_KEYRING.get_or_init(|| Mutex::new(HashMap::new()));
    let mut keyring = keyring
        .lock()
        .map_err(|error| db_error("lock test keyring", error))?;
    keyring.remove(account_id);
    Ok(())
}

#[cfg(not(test))]
fn delete_yougile_api_key(account_id: &str) -> Result<(), String> {
    let entry = Entry::new(YOUGILE_KEYRING_SERVICE, account_id)
        .map_err(|error| db_error("create Yougile keychain entry", error))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(db_error(
            "delete the Yougile API key from the system keychain",
            error,
        )),
    }
}

fn table_has_foreign_key(
    connection: &Connection,
    table: &str,
    from_column: &str,
    target_table: &str,
) -> Result<bool, String> {
    let sql = format!("PRAGMA foreign_key_list({table})");
    let mut stmt = connection
        .prepare(&sql)
        .map_err(|error| db_error("prepare foreign key inspection query", error))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(2)?, row.get::<_, String>(3)?))
        })
        .map_err(|error| db_error("query foreign key metadata", error))?;

    for row in rows {
        let (table_name, from) =
            row.map_err(|error| db_error("read foreign key metadata", error))?;
        if table_name == target_table && from == from_column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn rebuild_checklists_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = OFF;
            ALTER TABLE checklists RENAME TO checklists_old;
            CREATE TABLE checklists (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO checklists (id, task_id, title, position)
            SELECT c.id, c.task_id, c.title, c.position
            FROM checklists_old c
            INNER JOIN tasks t ON t.id = c.task_id;
            DROP TABLE checklists_old;
            PRAGMA foreign_keys = ON;
            ",
        )
        .map_err(|error| db_error("rebuild checklists table with foreign keys", error))
}

fn rebuild_checklist_items_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = OFF;
            ALTER TABLE checklist_items RENAME TO checklist_items_old;
            CREATE TABLE checklist_items (
                id TEXT PRIMARY KEY,
                checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                position INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO checklist_items (id, checklist_id, text, completed, position)
            SELECT ci.id, ci.checklist_id, ci.text, ci.completed, ci.position
            FROM checklist_items_old ci
            INNER JOIN checklists c ON c.id = ci.checklist_id;
            DROP TABLE checklist_items_old;
            PRAGMA foreign_keys = ON;
            ",
        )
        .map_err(|error| db_error("rebuild checklist_items table with foreign keys", error))
}

fn rebuild_task_tags_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = OFF;
            ALTER TABLE task_tags RENAME TO task_tags_old;
            CREATE TABLE task_tags (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, tag_id)
            );
            INSERT INTO task_tags (task_id, tag_id)
            SELECT tt.task_id, tt.tag_id
            FROM task_tags_old tt
            INNER JOIN tasks t ON t.id = tt.task_id
            INNER JOIN tags g ON g.id = tt.tag_id;
            DROP TABLE task_tags_old;
            PRAGMA foreign_keys = ON;
            ",
        )
        .map_err(|error| db_error("rebuild task_tags table with foreign keys", error))
}

fn ensure_foreign_key_constraints(connection: &Connection) -> Result<(), String> {
    if !table_has_foreign_key(connection, "checklists", "task_id", "tasks")? {
        rebuild_checklists_table(connection)?;
    }

    if !table_has_foreign_key(connection, "checklist_items", "checklist_id", "checklists")? {
        rebuild_checklist_items_table(connection)?;
    }

    let has_task_fk = table_has_foreign_key(connection, "task_tags", "task_id", "tasks")?;
    let has_tag_fk = table_has_foreign_key(connection, "task_tags", "tag_id", "tags")?;
    if !has_task_fk || !has_tag_fk {
        rebuild_task_tags_table(connection)?;
    }

    Ok(())
}

fn run_migrations(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'todo',
                priority TEXT NOT NULL DEFAULT 'none',
                tags TEXT NOT NULL DEFAULT '[]',
                due_date TEXT,
                linked_note_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS kanban_columns (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status_key TEXT NOT NULL UNIQUE,
                position INTEGER NOT NULL DEFAULT 0
            );
            ",
        )
        .map_err(|error| format!("Failed to run SQLite migrations: {error}"))?;

    // Add description column to existing databases
    let has_description: bool = connection
        .prepare("SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'description'")
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
        .map(|count| count > 0)
        .unwrap_or(false);

    if !has_description {
        connection
            .execute_batch("ALTER TABLE tasks ADD COLUMN description TEXT")
            .map_err(|error| format!("Failed to add description column: {error}"))?;
    }

    // Add parent_id column for subtask support
    let has_parent_id: bool = connection
        .prepare("SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'parent_id'")
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
        .map(|count| count > 0)
        .unwrap_or(false);

    if !has_parent_id {
        connection
            .execute_batch("ALTER TABLE tasks ADD COLUMN parent_id TEXT")
            .map_err(|error| format!("Failed to add parent_id column: {error}"))?;
    }

    // Add color column on tasks
    let has_task_color: bool = connection
        .prepare("SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'color'")
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
        .map(|count| count > 0)
        .unwrap_or(false);

    if !has_task_color {
        connection
            .execute_batch("ALTER TABLE tasks ADD COLUMN color TEXT")
            .map_err(|error| format!("Failed to add color column to tasks: {error}"))?;
    }

    // Add color column on kanban_columns
    let has_column_color: bool = connection
        .prepare("SELECT COUNT(*) FROM pragma_table_info('kanban_columns') WHERE name = 'color'")
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
        .map(|count| count > 0)
        .unwrap_or(false);

    if !has_column_color {
        connection
            .execute_batch("ALTER TABLE kanban_columns ADD COLUMN color TEXT")
            .map_err(|error| format!("Failed to add color column to kanban_columns: {error}"))?;
    }

    // Add time tracking columns on tasks
    let has_time_estimated: bool = connection
        .prepare("SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'time_estimated'")
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
        .map(|count| count > 0)
        .unwrap_or(false);

    if !has_time_estimated {
        connection
            .execute_batch("ALTER TABLE tasks ADD COLUMN time_estimated INTEGER")
            .map_err(|error| format!("Failed to add time_estimated column: {error}"))?;
    }

    let has_time_spent: bool = connection
        .prepare("SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'time_spent'")
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
        .map(|count| count > 0)
        .unwrap_or(false);

    if !has_time_spent {
        connection
            .execute_batch("ALTER TABLE tasks ADD COLUMN time_spent INTEGER")
            .map_err(|error| format!("Failed to add time_spent column: {error}"))?;
    }

    // Create checklists and checklist_items tables
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS checklists (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS checklist_items (
                id TEXT PRIMARY KEY,
                checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                position INTEGER NOT NULL DEFAULT 0
            );
            ",
        )
        .map_err(|error| format!("Failed to create checklists tables: {error}"))?;

    // Create tags and task_tags tables
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#6b7280'
            );

            CREATE TABLE IF NOT EXISTS task_tags (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, tag_id)
            );
            ",
        )
        .map_err(|error| format!("Failed to create tags tables: {error}"))?;

    // Migration: create yougile_accounts table
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS yougile_accounts (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                company_id TEXT NOT NULL,
                company_name TEXT NOT NULL,
                api_key TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())?;

    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS task_templates (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                color TEXT,
                checklists TEXT NOT NULL DEFAULT '[]',
                stickers TEXT NOT NULL DEFAULT '{}',
                column_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to create task_templates table: {e}"))?;

    ensure_foreign_key_constraints(connection)?;
    seed_default_columns(connection)?;

    Ok(())
}

fn seed_default_columns(connection: &Connection) -> Result<(), String> {
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM kanban_columns", [], |row| row.get(0))
        .map_err(|error| format!("Failed to count columns: {error}"))?;

    if count > 0 {
        return Ok(());
    }

    let defaults = [
        ("To Do", "todo", 0),
        ("In Progress", "in_progress", 1),
        ("Done", "done", 2),
    ];

    for (name, status_key, position) in defaults {
        let id = Uuid::new_v4().to_string();
        connection
            .execute(
                "INSERT INTO kanban_columns (id, name, status_key, position) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, status_key, position],
            )
            .map_err(|error| format!("Failed to seed default column '{name}': {error}"))?;
    }

    Ok(())
}

// ── Task commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_task(db: State<'_, DatabaseState>, input: CreateTaskInput) -> Result<Task, String> {
    let raw_input = input
        .raw_input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let parsed_input = raw_input.map(parse_task_input);

    let title = input
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| parsed_input.as_ref().map(|value| value.title.clone()))
        .filter(|value| !value.is_empty());

    let Some(title) = title else {
        return Err("Task title cannot be empty.".to_string());
    };

    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    let linked_note_path = match input.linked_note_path {
        Some(path) => Some(path),
        None => match parsed_input.as_ref().filter(|value| value.zettel_requested) {
            Some(parsed) => Some(create_zettel_note(
                &connection,
                &title,
                parsed.due_date.as_deref(),
            )?),
            None => None,
        },
    };

    let task = Task {
        id: Uuid::new_v4().to_string(),
        title,
        description: None,
        status: input.status.unwrap_or_else(|| "todo".to_string()),
        priority: input
            .priority
            .or_else(|| parsed_input.as_ref().and_then(|value| value.priority))
            .unwrap_or(TaskPriority::None),
        tags: input.tags.unwrap_or_else(|| {
            parsed_input
                .as_ref()
                .map(|value| value.tags.clone())
                .unwrap_or_default()
        }),
        due_date: input.due_date.or_else(|| {
            parsed_input
                .as_ref()
                .and_then(|value| value.due_date.clone())
        }),
        linked_note_path,
        created_at: timestamp(),
        updated_at: timestamp(),
        parent_id: input.parent_id,
        color: input.color,
        time_estimated: None,
        time_spent: None,
    };

    insert_task(&connection, &task)?;

    Ok(task)
}

#[tauri::command]
pub fn get_tasks(db: State<'_, DatabaseState>) -> Result<Vec<Task>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    list_tasks(&connection)
}

#[tauri::command]
pub fn update_task_status(
    db: State<'_, DatabaseState>,
    input: UpdateTaskStatusInput,
) -> Result<Task, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    set_task_status(&connection, &input.id, &input.status)
}

#[tauri::command]
pub fn update_task(db: State<'_, DatabaseState>, input: UpdateTaskInput) -> Result<Task, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    patch_task(&connection, &input)
}

#[tauri::command]
pub fn delete_task(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    remove_task(&connection, &id)
}

// ── Settings commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(db: State<'_, DatabaseState>) -> Result<AppSettings, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    load_settings(&connection)
}

#[tauri::command]
pub fn update_settings(
    db: State<'_, DatabaseState>,
    input: UpdateSettingsInput,
) -> Result<AppSettings, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    save_setting(&connection, "vault_dir", input.vault_dir.as_deref())?;

    load_settings(&connection)
}

#[tauri::command]
pub fn update_theme(db: State<'_, DatabaseState>, theme: String) -> Result<AppSettings, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    save_setting(&connection, "theme", Some(&theme))?;

    load_settings(&connection)
}

#[tauri::command]
pub fn update_yougile_enabled(
    db: State<'_, DatabaseState>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    save_setting(
        &connection,
        "yougile_enabled",
        Some(if enabled { "true" } else { "false" }),
    )?;

    if !enabled {
        save_yougile_sync_state(
            &connection,
            &YougileSyncState {
                active_source: "local".to_string(),
                account_id: None,
                project_id: None,
                project_name: None,
                board_id: None,
                board_name: None,
            },
        )?;
    }

    load_settings(&connection)
}

#[tauri::command]
pub fn get_yougile_sync_state(db: State<'_, DatabaseState>) -> Result<YougileSyncState, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    load_yougile_sync_state(&connection)
}

#[tauri::command]
pub fn update_yougile_sync_state(
    db: State<'_, DatabaseState>,
    state: YougileSyncState,
) -> Result<YougileSyncState, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    save_yougile_sync_state(&connection, &state)?;
    load_yougile_sync_state(&connection)
}

// ── Note commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_linked_note(db: State<'_, DatabaseState>, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Linked note path cannot be empty.".to_string());
    }

    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;
    let vault_dir = resolve_vault_dir(&connection)?;
    let vault_dir_canonical = Path::new(&vault_dir)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve vault directory: {error}"))?;

    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Linked note does not exist: {path}"));
    }

    let canonical = path_buf
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e}"))?;

    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }

    if !canonical.starts_with(&vault_dir_canonical) {
        return Err(format!(
            "Linked note must stay inside the configured vault: {}",
            vault_dir_canonical.display()
        ));
    }

    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| "Path contains invalid UTF-8".to_string())?;

    let status = if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(canonical_str)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    } else if cfg!(target_os = "windows") {
        Command::new("explorer")
            .arg(canonical_str)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    } else {
        Command::new("xdg-open")
            .arg(canonical_str)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    };

    if !status.success() {
        return Err(format!("Opening linked note failed with status: {status}"));
    }

    Ok(())
}

// ── Column commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_columns(db: State<'_, DatabaseState>) -> Result<Vec<KanbanColumn>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    list_columns(&connection)
}

#[tauri::command]
pub fn create_column(
    db: State<'_, DatabaseState>,
    input: CreateColumnInput,
) -> Result<KanbanColumn, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("Column name cannot be empty.".to_string());
    }

    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    let status_key = unique_status_key(&connection, &name)?;

    let max_position: i32 = connection
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM kanban_columns",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to get max position: {error}"))?;

    let column = KanbanColumn {
        id: Uuid::new_v4().to_string(),
        name,
        status_key,
        position: max_position + 1,
    };

    connection
        .execute(
            "INSERT INTO kanban_columns (id, name, status_key, position) VALUES (?1, ?2, ?3, ?4)",
            params![column.id, column.name, column.status_key, column.position],
        )
        .map_err(|error| format!("Failed to insert column: {error}"))?;

    Ok(column)
}

#[tauri::command]
pub fn update_column(
    db: State<'_, DatabaseState>,
    input: UpdateColumnInput,
) -> Result<KanbanColumn, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    if let Some(ref name) = input.name {
        let name = name.trim();
        if name.is_empty() {
            return Err("Column name cannot be empty.".to_string());
        }
        connection
            .execute(
                "UPDATE kanban_columns SET name = ?1 WHERE id = ?2",
                params![name, input.id],
            )
            .map_err(|error| format!("Failed to update column name: {error}"))?;
    }

    fetch_column(&connection, &input.id)?
        .ok_or_else(|| format!("Column {} was not found.", input.id))
}

#[tauri::command]
pub fn delete_column(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    let column =
        fetch_column(&connection, &id)?.ok_or_else(|| format!("Column {id} was not found."))?;

    // Refuse if tasks are assigned to this column
    let task_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE status = ?1",
            params![column.status_key],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to count tasks in column: {error}"))?;

    if task_count > 0 {
        return Err(format!(
            "Cannot delete column '{}': {} task(s) still assigned to it.",
            column.name, task_count
        ));
    }

    let affected = connection
        .execute("DELETE FROM kanban_columns WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete column: {error}"))?;

    if affected == 0 {
        return Err(format!("Column {id} was not found."));
    }

    Ok(())
}

#[tauri::command]
pub fn reorder_columns(
    db: State<'_, DatabaseState>,
    input: ReorderColumnsInput,
) -> Result<Vec<KanbanColumn>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    for (position, id) in input.ids.iter().enumerate() {
        connection
            .execute(
                "UPDATE kanban_columns SET position = ?1 WHERE id = ?2",
                params![position as i32, id],
            )
            .map_err(|error| format!("Failed to update column position: {error}"))?;
    }

    list_columns(&connection)
}

// ── Template commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_task_templates(db: State<'_, DatabaseState>) -> Result<Vec<TaskTemplate>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    list_task_templates(&connection)
}

#[tauri::command]
pub fn create_task_template(
    db: State<'_, DatabaseState>,
    input: CreateTaskTemplateInput,
) -> Result<TaskTemplate, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    insert_task_template(&connection, input)
}

#[tauri::command]
pub fn update_task_template(
    db: State<'_, DatabaseState>,
    input: UpdateTaskTemplateInput,
) -> Result<TaskTemplate, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    patch_task_template(&connection, &input)
}

#[tauri::command]
pub fn delete_task_template(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    remove_task_template(&connection, &id)
}

// ── Checklist commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_checklists(
    db: State<'_, DatabaseState>,
    task_id: String,
) -> Result<Vec<Checklist>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    list_checklists(&connection, &task_id)
}

#[tauri::command]
pub fn create_checklist(
    db: State<'_, DatabaseState>,
    task_id: String,
    title: String,
) -> Result<Checklist, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    insert_checklist(&connection, &task_id, &title)
}

#[tauri::command]
pub fn add_checklist_item(
    db: State<'_, DatabaseState>,
    checklist_id: String,
    text: String,
) -> Result<ChecklistItem, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    insert_checklist_item(&connection, &checklist_id, &text)
}

#[tauri::command]
pub fn update_checklist_item(
    db: State<'_, DatabaseState>,
    id: String,
    text: Option<String>,
    completed: Option<bool>,
) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    patch_checklist_item(&connection, &id, text.as_deref(), completed)
}

#[tauri::command]
pub fn delete_checklist(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    remove_checklist(&connection, &id)
}

#[tauri::command]
pub fn delete_checklist_item(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    remove_checklist_item(&connection, &id)
}

// ── Tag commands ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_tags(db: State<'_, DatabaseState>) -> Result<Vec<Tag>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    list_tags(&connection)
}

#[tauri::command]
pub fn create_tag(
    db: State<'_, DatabaseState>,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    insert_tag(&connection, &name, color.as_deref())
}

#[tauri::command]
pub fn update_tag(
    db: State<'_, DatabaseState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    patch_tag(&connection, &id, name.as_deref(), color.as_deref())
}

#[tauri::command]
pub fn delete_tag(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    remove_tag(&connection, &id)
}

#[tauri::command]
pub fn get_task_tags(db: State<'_, DatabaseState>, task_id: String) -> Result<Vec<Tag>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    list_task_tags(&connection, &task_id)
}

#[tauri::command]
pub fn set_task_tags(
    db: State<'_, DatabaseState>,
    task_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    replace_task_tags(&connection, &task_id, &tag_ids)
}

// ── Subtask commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_subtasks(db: State<'_, DatabaseState>, parent_id: String) -> Result<Vec<Task>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    list_subtasks(&connection, &parent_id)
}

// ── Private helpers ──────────────────────────────────────────────────────────

fn insert_task(connection: &Connection, task: &Task) -> Result<(), String> {
    let tags = serde_json::to_string(&task.tags)
        .map_err(|error| format!("Failed to serialize task tags: {error}"))?;

    connection
        .execute(
            "
            INSERT INTO tasks (
                id,
                title,
                description,
                status,
                priority,
                tags,
                due_date,
                linked_note_path,
                created_at,
                updated_at,
                parent_id,
                color,
                time_estimated,
                time_spent
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ",
            params![
                task.id,
                task.title,
                task.description,
                task.status,
                task.priority.as_str(),
                tags,
                task.due_date,
                task.linked_note_path,
                task.created_at,
                task.updated_at,
                task.parent_id,
                task.color,
                task.time_estimated,
                task.time_spent
            ],
        )
        .map_err(|error| format!("Failed to insert task into SQLite: {error}"))?;

    Ok(())
}

fn list_tasks(connection: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, description, status, priority, tags, due_date, linked_note_path, created_at, updated_at, parent_id, color, time_estimated, time_spent
            FROM tasks
            ORDER BY created_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare task query: {error}"))?;

    let rows = statement
        .query_map([], map_task_row)
        .map_err(|error| format!("Failed to query tasks: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read tasks from SQLite: {error}"))
}

fn set_task_status(connection: &Connection, id: &str, status: &str) -> Result<Task, String> {
    let updated_at = timestamp();

    let affected_rows = connection
        .execute(
            "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, updated_at, id],
        )
        .map_err(|error| format!("Failed to update task status: {error}"))?;

    if affected_rows == 0 {
        return Err(format!("Task {id} was not found."));
    }

    fetch_task(connection, id)?.ok_or_else(|| format!("Task {id} was not found after update."))
}

fn remove_task(connection: &Connection, id: &str) -> Result<(), String> {
    let affected_rows = connection
        .execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete task: {error}"))?;

    if affected_rows == 0 {
        return Err(format!("Task {id} was not found."));
    }

    Ok(())
}

fn fetch_task(connection: &Connection, id: &str) -> Result<Option<Task>, String> {
    let task = connection
        .query_row(
            "
            SELECT id, title, description, status, priority, tags, due_date, linked_note_path, created_at, updated_at, parent_id, color, time_estimated, time_spent
            FROM tasks
            WHERE id = ?1
            ",
            params![id],
            map_task_row,
        )
        .optional()
        .map_err(|error| format!("Failed to fetch task: {error}"))?;

    Ok(task)
}

fn patch_task(connection: &Connection, input: &UpdateTaskInput) -> Result<Task, String> {
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref title) = input.title {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err("Task title cannot be empty.".to_string());
        }
        sets.push("title = ?");
        values.push(Box::new(trimmed.to_string()));
    }

    if let Some(ref description) = input.description {
        sets.push("description = ?");
        values.push(Box::new(description.clone()));
    }

    if let Some(ref status) = input.status {
        sets.push("status = ?");
        values.push(Box::new(status.clone()));
    }

    if let Some(priority) = input.priority {
        sets.push("priority = ?");
        values.push(Box::new(priority.as_str().to_string()));
    }

    if let Some(ref tags) = input.tags {
        let tags_json = serde_json::to_string(tags)
            .map_err(|error| format!("Failed to serialize tags: {error}"))?;
        sets.push("tags = ?");
        values.push(Box::new(tags_json));
    }

    if let Some(ref due_date) = input.due_date {
        sets.push("due_date = ?");
        values.push(Box::new(due_date.clone()));
    }

    if let Some(ref color) = input.color {
        sets.push("color = ?");
        values.push(Box::new(color.clone()));
    }

    if let Some(time_estimated) = input.time_estimated {
        sets.push("time_estimated = ?");
        values.push(Box::new(time_estimated));
    }

    if let Some(time_spent) = input.time_spent {
        sets.push("time_spent = ?");
        values.push(Box::new(time_spent));
    }

    if sets.is_empty() {
        return fetch_task(connection, &input.id)?
            .ok_or_else(|| format!("Task {} was not found.", input.id));
    }

    let updated_at = timestamp();
    sets.push("updated_at = ?");
    values.push(Box::new(updated_at));
    values.push(Box::new(input.id.clone()));

    let sql = build_patch_query("tasks", &sets);

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    let affected_rows = connection
        .execute(&sql, params.as_slice())
        .map_err(|error| format!("Failed to update task: {error}"))?;

    if affected_rows == 0 {
        return Err(format!("Task {} was not found.", input.id));
    }

    fetch_task(connection, &input.id)?
        .ok_or_else(|| format!("Task {} was not found after update.", input.id))
}

fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let priority = row.get::<_, String>(4)?;
    let tags = row.get::<_, String>(5)?;

    let tags = serde_json::from_str(&tags).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;

    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: row.get(3)?,
        priority: TaskPriority::from_str(&priority)
            .ok_or_else(|| invalid_value_error(4, &priority))?,
        tags,
        due_date: row.get(6)?,
        linked_note_path: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        parent_id: row.get(10)?,
        color: row.get(11)?,
        time_estimated: row.get(12)?,
        time_spent: row.get(13)?,
    })
}

fn list_columns(connection: &Connection) -> Result<Vec<KanbanColumn>, String> {
    let mut stmt = connection
        .prepare("SELECT id, name, status_key, position FROM kanban_columns ORDER BY position ASC")
        .map_err(|error| format!("Failed to prepare columns query: {error}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(KanbanColumn {
                id: row.get(0)?,
                name: row.get(1)?,
                status_key: row.get(2)?,
                position: row.get(3)?,
            })
        })
        .map_err(|error| format!("Failed to query columns: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read columns from SQLite: {error}"))
}

fn fetch_column(connection: &Connection, id: &str) -> Result<Option<KanbanColumn>, String> {
    connection
        .query_row(
            "SELECT id, name, status_key, position FROM kanban_columns WHERE id = ?1",
            params![id],
            |row| {
                Ok(KanbanColumn {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    status_key: row.get(2)?,
                    position: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Failed to fetch column: {error}"))
}

fn insert_task_template(
    connection: &Connection,
    input: CreateTaskTemplateInput,
) -> Result<TaskTemplate, String> {
    let title = normalize_required_title(&input.title, "Template title")?;
    let now = timestamp();
    let template = TaskTemplate {
        id: Uuid::new_v4().to_string(),
        title,
        description: normalize_optional_text(input.description),
        color: normalize_optional_text(input.color),
        checklists: normalize_json_array(input.checklists.as_deref(), "checklists")?,
        stickers: normalize_json_object(input.stickers.as_deref(), "stickers")?,
        column_id: normalize_optional_text(input.column_id),
        created_at: now.clone(),
        updated_at: now,
    };

    connection
        .execute(
            "
            INSERT INTO task_templates (
                id,
                title,
                description,
                color,
                checklists,
                stickers,
                column_id,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ",
            params![
                template.id,
                template.title,
                template.description,
                template.color,
                template.checklists,
                template.stickers,
                template.column_id,
                template.created_at,
                template.updated_at,
            ],
        )
        .map_err(|error| format!("Failed to insert task template: {error}"))?;

    Ok(template)
}

fn list_task_templates(connection: &Connection) -> Result<Vec<TaskTemplate>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, description, color, checklists, stickers, column_id, created_at, updated_at
            FROM task_templates
            ORDER BY updated_at DESC, created_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare task template query: {error}"))?;

    let rows = statement
        .query_map([], map_task_template_row)
        .map_err(|error| format!("Failed to query task templates: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read task templates from SQLite: {error}"))
}

fn fetch_task_template(connection: &Connection, id: &str) -> Result<Option<TaskTemplate>, String> {
    connection
        .query_row(
            "
            SELECT id, title, description, color, checklists, stickers, column_id, created_at, updated_at
            FROM task_templates
            WHERE id = ?1
            ",
            params![id],
            map_task_template_row,
        )
        .optional()
        .map_err(|error| format!("Failed to fetch task template: {error}"))
}

fn patch_task_template(
    connection: &Connection,
    input: &UpdateTaskTemplateInput,
) -> Result<TaskTemplate, String> {
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref title) = input.title {
        let title = normalize_required_title(title, "Template title")?;
        sets.push("title = ?");
        values.push(Box::new(title));
    }

    if let Some(ref description) = input.description {
        sets.push("description = ?");
        values.push(Box::new(normalize_optional_text(Some(description.clone()))));
    }

    if let Some(ref color) = input.color {
        sets.push("color = ?");
        values.push(Box::new(normalize_optional_text(Some(color.clone()))));
    }

    if let Some(ref checklists) = input.checklists {
        sets.push("checklists = ?");
        values.push(Box::new(normalize_json_array(
            Some(checklists),
            "checklists",
        )?));
    }

    if let Some(ref stickers) = input.stickers {
        sets.push("stickers = ?");
        values.push(Box::new(normalize_json_object(Some(stickers), "stickers")?));
    }

    if let Some(ref column_id) = input.column_id {
        sets.push("column_id = ?");
        values.push(Box::new(normalize_optional_text(Some(column_id.clone()))));
    }

    if sets.is_empty() {
        return fetch_task_template(connection, &input.id)?
            .ok_or_else(|| format!("Task template {} was not found.", input.id));
    }

    let updated_at = timestamp();
    sets.push("updated_at = ?");
    values.push(Box::new(updated_at));
    values.push(Box::new(input.id.clone()));

    let sql = build_patch_query("task_templates", &sets);
    let params: Vec<&dyn rusqlite::types::ToSql> =
        values.iter().map(|value| value.as_ref()).collect();

    let affected_rows = connection
        .execute(&sql, params.as_slice())
        .map_err(|error| format!("Failed to update task template: {error}"))?;

    if affected_rows == 0 {
        return Err(format!("Task template {} was not found.", input.id));
    }

    fetch_task_template(connection, &input.id)?
        .ok_or_else(|| format!("Task template {} was not found after update.", input.id))
}

fn remove_task_template(connection: &Connection, id: &str) -> Result<(), String> {
    let affected_rows = connection
        .execute("DELETE FROM task_templates WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete task template: {error}"))?;

    if affected_rows == 0 {
        return Err(format!("Task template {id} was not found."));
    }

    Ok(())
}

fn map_task_template_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskTemplate> {
    Ok(TaskTemplate {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        checklists: row.get(4)?,
        stickers: row.get(5)?,
        column_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn normalize_required_title(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} cannot be empty."));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_json_array(value: Option<&str>, field_name: &str) -> Result<String, String> {
    normalize_json_value(value, field_name, true)
}

fn normalize_json_object(value: Option<&str>, field_name: &str) -> Result<String, String> {
    normalize_json_value(value, field_name, false)
}

fn normalize_json_value(
    value: Option<&str>,
    field_name: &str,
    expect_array: bool,
) -> Result<String, String> {
    let default = if expect_array { "[]" } else { "{}" };
    let raw = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default);
    let parsed: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Invalid JSON for {field_name}: {error}"))?;

    match (expect_array, &parsed) {
        (true, serde_json::Value::Array(_)) | (false, serde_json::Value::Object(_)) => {
            serde_json::to_string(&parsed)
                .map_err(|error| format!("Failed to serialize {field_name}: {error}"))
        }
        (true, _) => Err(format!("{field_name} must be a JSON array.")),
        (false, _) => Err(format!("{field_name} must be a JSON object.")),
    }
}

fn unique_status_key(connection: &Connection, name: &str) -> Result<String, String> {
    let base = slugify_title(name);
    let base = if base.is_empty() {
        "column".to_string()
    } else {
        base
    };

    // Check if base key is already taken
    let exists: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM kanban_columns WHERE status_key = ?1",
            params![base],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .map_err(|error| format!("Failed to check status key uniqueness: {error}"))?;

    if !exists {
        return Ok(base);
    }

    // Append a number suffix until unique
    for i in 2..=999 {
        let candidate = format!("{base}-{i}");
        let taken: bool = connection
            .query_row(
                "SELECT COUNT(*) FROM kanban_columns WHERE status_key = ?1",
                params![candidate],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .map_err(|error| format!("Failed to check status key uniqueness: {error}"))?;

        if !taken {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Could not generate a unique status key for '{name}'."
    ))
}

fn load_settings(connection: &Connection) -> Result<AppSettings, String> {
    let vault_dir = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'vault_dir'",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to load settings: {error}"))?
        .flatten();

    let theme = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'theme'",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to load theme setting: {error}"))?
        .flatten()
        .unwrap_or_else(|| "dark".to_string());

    let yougile_enabled: bool = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'yougile_enabled'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map(|v| v == "true")
        .unwrap_or(false);

    Ok(AppSettings {
        vault_dir,
        theme,
        yougile_enabled,
    })
}

fn load_yougile_sync_state(connection: &Connection) -> Result<YougileSyncState, String> {
    let keys = [
        "yougile_active_source",
        "yougile_account_id",
        "yougile_project_id",
        "yougile_project_name",
        "yougile_board_id",
        "yougile_board_name",
    ];

    let mut stmt = connection
        .prepare("SELECT key, value FROM settings WHERE key IN (?1, ?2, ?3, ?4, ?5, ?6)")
        .map_err(|error| format!("Failed to prepare sync state query: {error}"))?;

    let rows: std::collections::HashMap<String, String> = stmt
        .query_map(
            rusqlite::params![keys[0], keys[1], keys[2], keys[3], keys[4], keys[5]],
            |row| {
                let key: String = row.get(0)?;
                let value: String = row.get(1)?;
                Ok((key, value))
            },
        )
        .map_err(|error| format!("Failed to query sync state: {error}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(YougileSyncState {
        active_source: rows
            .get("yougile_active_source")
            .cloned()
            .unwrap_or_else(|| "local".to_string()),
        account_id: rows.get("yougile_account_id").cloned(),
        project_id: rows.get("yougile_project_id").cloned(),
        project_name: rows.get("yougile_project_name").cloned(),
        board_id: rows.get("yougile_board_id").cloned(),
        board_name: rows.get("yougile_board_name").cloned(),
    })
}

fn save_yougile_sync_state(
    connection: &Connection,
    state: &YougileSyncState,
) -> Result<(), String> {
    save_setting(
        connection,
        "yougile_active_source",
        Some(&state.active_source),
    )?;
    save_setting(
        connection,
        "yougile_account_id",
        state.account_id.as_deref(),
    )?;
    save_setting(
        connection,
        "yougile_project_id",
        state.project_id.as_deref(),
    )?;
    save_setting(
        connection,
        "yougile_project_name",
        state.project_name.as_deref(),
    )?;
    save_setting(connection, "yougile_board_id", state.board_id.as_deref())?;
    save_setting(
        connection,
        "yougile_board_name",
        state.board_name.as_deref(),
    )?;
    Ok(())
}

fn save_setting(connection: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO settings (key, value)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![key, value],
        )
        .map_err(|error| format!("Failed to save setting {key}: {error}"))?;

    Ok(())
}

fn invalid_value_error(index: usize, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::other(format!(
            "Invalid SQLite enum value: {value}"
        ))),
    )
}

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

fn create_zettel_note(
    connection: &Connection,
    title: &str,
    due_date: Option<&str>,
) -> Result<String, String> {
    let vault_dir = resolve_vault_dir(connection)?;

    let vault_path = PathBuf::from(vault_dir);
    fs::create_dir_all(&vault_path)
        .map_err(|error| format!("Failed to create vault directory: {error}"))?;

    let slug = slugify_title(title);
    let filename = format!("{}-{}.md", Utc::now().format("%Y%m%d%H%M"), slug);
    let note_path = vault_path.join(filename);
    let note_body = format_note(title, due_date);

    fs::write(&note_path, note_body)
        .map_err(|error| format!("Failed to write zettel note: {error}"))?;

    note_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve zettel note path: {error}"))
        .map(|path| path.to_string_lossy().into_owned())
}

fn resolve_vault_dir(connection: &Connection) -> Result<String, String> {
    let stored_path = load_settings(connection)?.vault_dir;

    stored_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| env::var("JOT_VAULT_DIR").ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "@zettel requires a vault path. Set it in Settings or via JOT_VAULT_DIR.".to_string()
        })
}

fn format_note(title: &str, due_date: Option<&str>) -> String {
    let mut lines = vec![
        "---".to_string(),
        format!("title: \"{}\"", title.replace('"', "\\\"")),
        format!("created_at: {}", Utc::now().to_rfc3339()),
    ];

    if let Some(due_date) = due_date {
        lines.push(format!("due_date: {due_date}"));
    }

    lines.extend([
        "tags:".to_string(),
        "  - jot".to_string(),
        "---".to_string(),
        "".to_string(),
        format!("# {title}"),
        "".to_string(),
    ]);

    lines.join("\n")
}

// ── Checklist helpers ─────────────────────────────────────────────────────────

fn list_checklists(connection: &Connection, task_id: &str) -> Result<Vec<Checklist>, String> {
    let mut stmt = connection
        .prepare(
            "
            SELECT
                c.id,
                c.task_id,
                c.title,
                c.position,
                ci.id,
                ci.checklist_id,
                ci.text,
                ci.completed,
                ci.position
            FROM checklists c
            LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
            WHERE c.task_id = ?1
            ORDER BY c.position ASC, ci.position ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare checklists query: {error}"))?;

    let mut rows = stmt
        .query(params![task_id])
        .map_err(|error| format!("Failed to query checklists: {error}"))?;

    let mut checklists: Vec<Checklist> = Vec::new();

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to read checklists row: {error}"))?
    {
        let checklist_id: String = row
            .get(0)
            .map_err(|error| format!("Failed to read checklist id: {error}"))?;

        if checklists.last().map(|checklist| checklist.id.as_str()) != Some(checklist_id.as_str()) {
            checklists.push(Checklist {
                id: checklist_id.clone(),
                task_id: row
                    .get(1)
                    .map_err(|error| format!("Failed to read checklist task id: {error}"))?,
                title: row
                    .get(2)
                    .map_err(|error| format!("Failed to read checklist title: {error}"))?,
                position: row
                    .get(3)
                    .map_err(|error| format!("Failed to read checklist position: {error}"))?,
                items: Vec::new(),
            });
        }

        let item_id: Option<String> = row
            .get(4)
            .map_err(|error| format!("Failed to read checklist item id: {error}"))?;
        if let Some(item_id) = item_id {
            let checklist = checklists
                .last_mut()
                .ok_or_else(|| "Checklist grouping failed while reading items.".to_string())?;
            checklist.items.push(ChecklistItem {
                id: item_id,
                checklist_id: row.get(5).map_err(|error| {
                    format!("Failed to read checklist item checklist id: {error}")
                })?,
                text: row
                    .get(6)
                    .map_err(|error| format!("Failed to read checklist item text: {error}"))?,
                completed: row.get::<_, i64>(7).map_err(|error| {
                    format!("Failed to read checklist item completion: {error}")
                })? != 0,
                position: row
                    .get(8)
                    .map_err(|error| format!("Failed to read checklist item position: {error}"))?,
            });
        }
    }

    Ok(checklists)
}

fn insert_checklist(
    connection: &Connection,
    task_id: &str,
    title: &str,
) -> Result<Checklist, String> {
    let max_position: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM checklists WHERE task_id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to get max checklist position: {error}"))?;

    let checklist = Checklist {
        id: Uuid::new_v4().to_string(),
        task_id: task_id.to_string(),
        title: title.to_string(),
        position: max_position + 1,
        items: Vec::new(),
    };

    connection
        .execute(
            "INSERT INTO checklists (id, task_id, title, position) VALUES (?1, ?2, ?3, ?4)",
            params![
                checklist.id,
                checklist.task_id,
                checklist.title,
                checklist.position
            ],
        )
        .map_err(|error| format!("Failed to insert checklist: {error}"))?;

    Ok(checklist)
}

fn insert_checklist_item(
    connection: &Connection,
    checklist_id: &str,
    text: &str,
) -> Result<ChecklistItem, String> {
    let max_position: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM checklist_items WHERE checklist_id = ?1",
            params![checklist_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to get max checklist item position: {error}"))?;

    let item = ChecklistItem {
        id: Uuid::new_v4().to_string(),
        checklist_id: checklist_id.to_string(),
        text: text.to_string(),
        completed: false,
        position: max_position + 1,
    };

    connection
        .execute(
            "INSERT INTO checklist_items (id, checklist_id, text, completed, position) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item.id, item.checklist_id, item.text, item.completed as i64, item.position],
        )
        .map_err(|error| format!("Failed to insert checklist item: {error}"))?;

    Ok(item)
}

fn patch_checklist_item(
    connection: &Connection,
    id: &str,
    text: Option<&str>,
    completed: Option<bool>,
) -> Result<(), String> {
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(text) = text {
        sets.push("text = ?");
        values.push(Box::new(text.to_string()));
    }

    if let Some(completed) = completed {
        sets.push("completed = ?");
        values.push(Box::new(completed as i64));
    }

    if sets.is_empty() {
        return Ok(());
    }

    values.push(Box::new(id.to_string()));
    let sql = build_patch_query("checklist_items", &sets);
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    connection
        .execute(&sql, params.as_slice())
        .map_err(|error| format!("Failed to update checklist item: {error}"))?;

    Ok(())
}

fn remove_checklist(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM checklist_items WHERE checklist_id = ?1",
            params![id],
        )
        .map_err(|error| format!("Failed to delete checklist items: {error}"))?;

    connection
        .execute("DELETE FROM checklists WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete checklist: {error}"))?;

    Ok(())
}

fn remove_checklist_item(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM checklist_items WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete checklist item: {error}"))?;

    Ok(())
}

// ── Tag helpers ──────────────────────────────────────────────────────────────

fn list_tags(connection: &Connection) -> Result<Vec<Tag>, String> {
    let mut stmt = connection
        .prepare("SELECT id, name, color FROM tags ORDER BY name ASC")
        .map_err(|error| format!("Failed to prepare tags query: {error}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|error| format!("Failed to query tags: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read tags: {error}"))
}

fn insert_tag(connection: &Connection, name: &str, color: Option<&str>) -> Result<Tag, String> {
    let tag = Tag {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        color: color.unwrap_or("#6b7280").to_string(),
    };

    connection
        .execute(
            "INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)",
            params![tag.id, tag.name, tag.color],
        )
        .map_err(|error| format!("Failed to insert tag: {error}"))?;

    Ok(tag)
}

fn patch_tag(
    connection: &Connection,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
) -> Result<(), String> {
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(name) = name {
        sets.push("name = ?");
        values.push(Box::new(name.to_string()));
    }

    if let Some(color) = color {
        sets.push("color = ?");
        values.push(Box::new(color.to_string()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    values.push(Box::new(id.to_string()));
    let sql = build_patch_query("tags", &sets);
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    connection
        .execute(&sql, params.as_slice())
        .map_err(|error| format!("Failed to update tag: {error}"))?;

    Ok(())
}

fn remove_tag(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM task_tags WHERE tag_id = ?1", params![id])
        .map_err(|error| format!("Failed to delete task_tags for tag: {error}"))?;

    connection
        .execute("DELETE FROM tags WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete tag: {error}"))?;

    Ok(())
}

fn list_task_tags(connection: &Connection, task_id: &str) -> Result<Vec<Tag>, String> {
    let mut stmt = connection
        .prepare(
            "SELECT t.id, t.name, t.color FROM tags t INNER JOIN task_tags tt ON t.id = tt.tag_id WHERE tt.task_id = ?1 ORDER BY t.name ASC",
        )
        .map_err(|error| format!("Failed to prepare task tags query: {error}"))?;

    let rows = stmt
        .query_map(params![task_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|error| format!("Failed to query task tags: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read task tags: {error}"))
}

fn replace_task_tags(
    connection: &Connection,
    task_id: &str,
    tag_ids: &[String],
) -> Result<(), String> {
    connection
        .execute("DELETE FROM task_tags WHERE task_id = ?1", params![task_id])
        .map_err(|error| format!("Failed to clear task tags: {error}"))?;

    for tag_id in tag_ids {
        connection
            .execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                params![task_id, tag_id],
            )
            .map_err(|error| format!("Failed to insert task tag: {error}"))?;
    }

    Ok(())
}

// ── Subtask helpers ──────────────────────────────────────────────────────────

fn list_subtasks(connection: &Connection, parent_id: &str) -> Result<Vec<Task>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, description, status, priority, tags, due_date, linked_note_path, created_at, updated_at, parent_id, color, time_estimated, time_spent
            FROM tasks
            WHERE parent_id = ?1
            ORDER BY created_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare subtasks query: {error}"))?;

    let rows = statement
        .query_map(params![parent_id], map_task_row)
        .map_err(|error| format!("Failed to query subtasks: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read subtasks: {error}"))
}

// ── Yougile account helpers ───────────────────────────────────────────────────

struct StoredYougileAccount {
    id: String,
    email: String,
    company_id: String,
    company_name: String,
    legacy_api_key: String,
    created_at: String,
}

fn list_stored_yougile_accounts(
    connection: &Connection,
) -> Result<Vec<StoredYougileAccount>, String> {
    let mut stmt = connection
        .prepare(
            "SELECT id, email, company_id, company_name, api_key, created_at FROM yougile_accounts ORDER BY created_at DESC",
        )
        .map_err(|error| db_error("prepare Yougile accounts query", error))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(StoredYougileAccount {
                id: row.get(0)?,
                email: row.get(1)?,
                company_id: row.get(2)?,
                company_name: row.get(3)?,
                legacy_api_key: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|error| db_error("query Yougile accounts", error))?;

    let accounts = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| db_error("read Yougile accounts", error))?;

    let mut deduped: Vec<StoredYougileAccount> = Vec::with_capacity(accounts.len());
    for account in accounts {
        let duplicate = deduped.iter().any(|existing| {
            existing.company_id == account.company_id
                && existing.email.eq_ignore_ascii_case(&account.email)
        });
        if !duplicate {
            deduped.push(account);
        }
    }

    Ok(deduped)
}

fn get_stored_yougile_account(
    connection: &Connection,
    account_id: &str,
) -> Result<StoredYougileAccount, String> {
    connection
        .query_row(
            "SELECT id, email, company_id, company_name, api_key, created_at FROM yougile_accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| {
                Ok(StoredYougileAccount {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    company_id: row.get(2)?,
                    company_name: row.get(3)?,
                    legacy_api_key: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .map_err(|error| db_error("load Yougile account", error))
}

fn resolve_yougile_api_key(
    connection: &Connection,
    account_id: &str,
    legacy_api_key: &str,
) -> Result<String, String> {
    let legacy_api_key = legacy_api_key.trim();

    match load_yougile_api_key(account_id) {
        Ok(Some(api_key)) => {
            if legacy_api_key.is_empty() {
                if let Err(error) = connection.execute(
                    "UPDATE yougile_accounts SET api_key = ?1 WHERE id = ?2",
                    params![api_key, account_id],
                ) {
                    log::warn!(
                        "Failed to backfill legacy SQLite API key for account '{account_id}': {error}"
                    );
                }
            }
            return Ok(api_key);
        }
        Ok(None) => {}
        Err(error) => {
            log::warn!(
                "Failed to read Yougile API key from keychain for account '{account_id}': {error}"
            );
        }
    }

    if legacy_api_key.is_empty() {
        return Err(
            "Yougile account is missing its API key in keychain and local storage. Remove and re-add this account."
                .to_string(),
        );
    }

    if let Err(error) = store_yougile_api_key(account_id, legacy_api_key) {
        log::warn!(
            "Failed to migrate Yougile API key to keychain for account '{account_id}': {error}. Falling back to SQLite key."
        );
    }

    Ok(legacy_api_key.to_string())
}

fn recover_yougile_api_key_from_related_accounts(
    connection: &Connection,
    missing_account: &StoredYougileAccount,
) -> Result<Option<String>, String> {
    let mut stmt = connection
        .prepare(
            "SELECT id, email, company_id, company_name, api_key, created_at
             FROM yougile_accounts
             WHERE LOWER(email) = LOWER(?1) AND company_id = ?2 AND id != ?3
             ORDER BY created_at DESC",
        )
        .map_err(|error| db_error("prepare related Yougile account lookup", error))?;

    let candidates = stmt
        .query_map(
            params![
                &missing_account.email,
                &missing_account.company_id,
                &missing_account.id
            ],
            |row| {
                Ok(StoredYougileAccount {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    company_id: row.get(2)?,
                    company_name: row.get(3)?,
                    legacy_api_key: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .map_err(|error| db_error("query related Yougile accounts", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| db_error("read related Yougile accounts", error))?;

    for candidate in candidates {
        let recovered_key =
            match resolve_yougile_api_key(connection, &candidate.id, &candidate.legacy_api_key) {
                Ok(key) => key,
                Err(_) => continue,
            };

        if missing_account.legacy_api_key.trim().is_empty() {
            if let Err(error) = connection.execute(
                "UPDATE yougile_accounts SET api_key = ?1 WHERE id = ?2",
                params![recovered_key, &missing_account.id],
            ) {
                log::warn!(
                    "Failed to backfill recovered API key into SQLite for account '{}': {error}",
                    missing_account.id
                );
            }
        }

        if let Err(error) = store_yougile_api_key(&missing_account.id, &recovered_key) {
            log::warn!(
                "Failed to backfill recovered API key into keychain for account '{}': {error}",
                missing_account.id
            );
        }

        log::warn!(
            "Recovered missing Yougile API key for account '{}' from related account '{}'",
            missing_account.id,
            candidate.id
        );
        return Ok(Some(recovered_key));
    }

    Ok(None)
}

pub fn get_yougile_accounts_impl(
    db: &DatabaseState,
) -> Result<Vec<crate::yougile::models::YougileAccount>, String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;

    list_stored_yougile_accounts(&conn).map(|accounts| {
        accounts
            .into_iter()
            .map(|account| crate::yougile::models::YougileAccount {
                id: account.id,
                email: account.email,
                company_id: account.company_id,
                company_name: account.company_name,
                created_at: account.created_at,
            })
            .collect()
    })
}

pub fn add_yougile_account_impl(
    db: &DatabaseState,
    email: &str,
    company_id: &str,
    company_name: &str,
    api_key: &str,
) -> Result<crate::yougile::models::YougileAccount, String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;
    let created_at = timestamp();
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM yougile_accounts WHERE LOWER(email) = LOWER(?1) AND company_id = ?2 ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![email, company_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| db_error("check existing Yougile account", error))?;
    let id = existing_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    if existing_id.is_some() {
        conn.execute(
            "UPDATE yougile_accounts
             SET company_name = ?1, api_key = ?2, created_at = ?3
             WHERE id = ?4",
            rusqlite::params![company_name, api_key, created_at, id],
        )
        .map_err(|error| db_error("update existing Yougile account", error))?;
    } else {
        conn.execute(
            "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, email, company_id, company_name, api_key, created_at],
        )
        .map_err(|error| db_error("insert Yougile account", error))?;
    }

    if let Err(error) = store_yougile_api_key(&id, api_key) {
        log::warn!(
            "Failed to store Yougile API key in keychain for account '{id}': {error}. Keeping legacy SQLite storage fallback."
        );
    }

    Ok(crate::yougile::models::YougileAccount {
        id,
        email: email.to_string(),
        company_id: company_id.to_string(),
        company_name: company_name.to_string(),
        created_at,
    })
}

pub fn remove_yougile_account_impl(db: &DatabaseState, account_id: &str) -> Result<(), String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM yougile_accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .map_err(|error| db_error("look up Yougile account", error))?;
    if exists == 0 {
        return Err("Account not found".to_string());
    }

    delete_yougile_api_key(account_id)?;

    let rows = conn
        .execute(
            "DELETE FROM yougile_accounts WHERE id = ?1",
            rusqlite::params![account_id],
        )
        .map_err(|error| db_error("delete Yougile account", error))?;
    if rows == 0 {
        return Err("Account not found".to_string());
    }
    Ok(())
}

pub fn get_yougile_account_api_key_impl(
    db: &DatabaseState,
    account_id: &str,
) -> Result<String, String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;
    let account = get_stored_yougile_account(&conn, account_id)?;
    match resolve_yougile_api_key(&conn, &account.id, &account.legacy_api_key) {
        Ok(api_key) => Ok(api_key),
        Err(primary_error) => {
            if let Some(api_key) = recover_yougile_api_key_from_related_accounts(&conn, &account)? {
                return Ok(api_key);
            }
            Err(primary_error)
        }
    }
}

fn slugify_title(title: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_dash = false;

    for character in title.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_was_dash = false;
        } else if !previous_was_dash {
            slug.push('-');
            previous_was_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        run_migrations(&connection).expect("migrations should succeed");
        connection
    }

    fn insert_minimal_task(connection: &Connection, id: &str) {
        let now = timestamp();
        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at) VALUES (?1, ?2, 'todo', 'none', '[]', ?3, ?3)",
                params![id, format!("Task {id}"), now],
            )
            .expect("task should insert");
    }

    #[test]
    fn task_crud_flow_round_trips_through_sqlite() {
        let connection = test_connection();
        let task = Task {
            id: "task-1".to_string(),
            title: "Write architecture review".to_string(),
            description: Some("Review the new auth middleware".to_string()),
            status: "todo".to_string(),
            priority: TaskPriority::High,
            tags: vec!["work".to_string(), "dev".to_string()],
            due_date: Some("2026-03-14T10:00:00Z".to_string()),
            linked_note_path: Some("/tmp/jot-note.md".to_string()),
            created_at: timestamp(),
            updated_at: timestamp(),
            parent_id: None,
            color: None,
            time_estimated: None,
            time_spent: None,
        };

        insert_task(&connection, &task).expect("task should insert");

        let tasks = list_tasks(&connection).expect("tasks should load");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, task.title);
        assert_eq!(tasks[0].priority, TaskPriority::High);

        let updated_task =
            set_task_status(&connection, &task.id, "done").expect("status update should succeed");
        assert_eq!(updated_task.status, "done");

        remove_task(&connection, &task.id).expect("task should delete");
        let tasks = list_tasks(&connection).expect("task list should still load");
        assert!(tasks.is_empty());
    }

    #[test]
    fn deleting_missing_task_returns_error() {
        let connection = test_connection();
        let result = remove_task(&connection, "missing-task");
        assert!(result.is_err());
    }

    #[test]
    fn database_path_is_created_under_parent_directory() {
        let parent = std::env::temp_dir().join(format!("jot-db-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&parent).expect("temp parent directory should exist");

        let database_path = parent.join("jot.db");
        let connection = Connection::open(&database_path).expect("database should open on disk");
        run_migrations(&connection).expect("migrations should succeed");

        assert!(database_path.exists());

        fs::remove_file(&database_path).expect("database file should be removable");
        fs::remove_dir_all(&parent).expect("temp parent should be removable");
    }

    #[test]
    fn zettel_note_is_generated_in_configured_vault() {
        let vault_dir = std::env::temp_dir().join(format!("jot-vault-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&vault_dir).expect("vault dir should be created");
        env::set_var("JOT_VAULT_DIR", &vault_dir);

        let connection = test_connection();

        let path = create_zettel_note(
            &connection,
            "Write architecture review",
            Some("2026-03-14T10:00:00Z"),
        )
        .expect("zettel note should be created");

        let content = fs::read_to_string(&path).expect("generated note should be readable");
        assert!(content.contains("# Write architecture review"));
        assert!(content.contains("due_date: 2026-03-14T10:00:00Z"));

        fs::remove_file(&path).expect("generated note should be removable");
        fs::remove_dir_all(&vault_dir).expect("vault dir should be removable");
    }

    #[test]
    fn stored_settings_override_environment_for_vault_path() {
        let connection = test_connection();
        let vault_dir = std::env::temp_dir().join(format!("jot-settings-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&vault_dir).expect("vault dir should be created");

        save_setting(&connection, "vault_dir", Some(&vault_dir.to_string_lossy()))
            .expect("vault setting should save");

        let settings = load_settings(&connection).expect("settings should load");
        assert_eq!(
            settings.vault_dir,
            Some(vault_dir.to_string_lossy().into_owned())
        );

        fs::remove_dir_all(&vault_dir).expect("vault dir should be removable");
    }

    #[test]
    fn yougile_sync_state_round_trips_through_settings() {
        let connection = test_connection();

        save_yougile_sync_state(
            &connection,
            &YougileSyncState {
                active_source: "yougile".to_string(),
                account_id: Some("account-1".to_string()),
                project_id: Some("project-1".to_string()),
                project_name: Some("Main".to_string()),
                board_id: Some("board-1".to_string()),
                board_name: Some("Sprint".to_string()),
            },
        )
        .expect("Yougile sync state should save");

        let loaded = load_yougile_sync_state(&connection).expect("Yougile sync state should load");

        assert_eq!(loaded.active_source, "yougile");
        assert_eq!(loaded.account_id.as_deref(), Some("account-1"));
        assert_eq!(loaded.project_id.as_deref(), Some("project-1"));
        assert_eq!(loaded.project_name.as_deref(), Some("Main"));
        assert_eq!(loaded.board_id.as_deref(), Some("board-1"));
        assert_eq!(loaded.board_name.as_deref(), Some("Sprint"));
    }

    #[test]
    fn default_columns_are_seeded_on_first_run() {
        let connection = test_connection();
        let columns = list_columns(&connection).expect("columns should load");
        assert_eq!(columns.len(), 3);
        assert_eq!(columns[0].status_key, "todo");
        assert_eq!(columns[1].status_key, "in_progress");
        assert_eq!(columns[2].status_key, "done");
    }

    #[test]
    fn create_column_generates_unique_status_key() {
        let connection = test_connection();
        // "todo" slug already exists; "To Do" slugifies to "to-do" which is free
        let key = unique_status_key(&connection, "To Do").expect("key should generate");
        assert_eq!(key, "to-do");
        // Insert it, then try again — should get "to-do-2"
        connection
            .execute(
                "INSERT INTO kanban_columns (id, name, status_key, position) VALUES ('x', 'To Do', 'to-do', 99)",
                [],
            )
            .unwrap();
        let key2 = unique_status_key(&connection, "To Do").expect("key should generate");
        assert_eq!(key2, "to-do-2");
    }

    #[test]
    fn delete_column_blocked_when_tasks_exist() {
        let connection = test_connection();
        let task = Task {
            id: "t1".to_string(),
            title: "Blocked task".to_string(),
            description: None,
            status: "archived".to_string(),
            priority: TaskPriority::None,
            tags: vec![],
            due_date: None,
            linked_note_path: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            parent_id: None,
            color: None,
            time_estimated: None,
            time_spent: None,
        };
        insert_task(&connection, &task).expect("task should insert");

        // Give the task a status matching a column
        set_task_status(&connection, &task.id, "todo").expect("status should update");

        let columns = list_columns(&connection).expect("columns should load");
        let todo_col = columns.iter().find(|c| c.status_key == "todo").unwrap();
        let result = connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE status = ?1",
                params![todo_col.status_key],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(result, 1);
    }

    #[test]
    fn subtask_parent_id_column_exists_after_migration() {
        let connection = test_connection();
        let now = timestamp();

        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at) VALUES ('parent-1', 'Parent', 'todo', 'none', '[]', ?1, ?1)",
                params![now],
            )
            .expect("parent task should insert");

        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, tags, parent_id, created_at, updated_at) VALUES ('child-1', 'Child', 'todo', 'none', '[]', 'parent-1', ?1, ?1)",
                params![now],
            )
            .expect("child task with parent_id should insert");

        let parent_id: Option<String> = connection
            .query_row(
                "SELECT parent_id FROM tasks WHERE id = 'child-1'",
                [],
                |row| row.get(0),
            )
            .expect("should read parent_id");

        assert_eq!(parent_id, Some("parent-1".to_string()));
    }

    #[test]
    fn color_columns_exist_after_migration() {
        let connection = test_connection();
        let now = timestamp();

        // Test color on tasks
        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, tags, color, created_at, updated_at) VALUES ('t-color', 'Colored task', 'todo', 'none', '[]', '#ff0000', ?1, ?1)",
                params![now],
            )
            .expect("task with color should insert");

        let task_color: Option<String> = connection
            .query_row("SELECT color FROM tasks WHERE id = 't-color'", [], |row| {
                row.get(0)
            })
            .expect("should read task color");

        assert_eq!(task_color, Some("#ff0000".to_string()));

        // Test color on kanban_columns
        connection
            .execute(
                "UPDATE kanban_columns SET color = '#00ff00' WHERE status_key = 'todo'",
                [],
            )
            .expect("kanban column color update should succeed");

        let col_color: Option<String> = connection
            .query_row(
                "SELECT color FROM kanban_columns WHERE status_key = 'todo'",
                [],
                |row| row.get(0),
            )
            .expect("should read column color");

        assert_eq!(col_color, Some("#00ff00".to_string()));
    }

    #[test]
    fn time_tracking_columns_exist_after_migration() {
        let connection = test_connection();
        let now = timestamp();

        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, tags, time_estimated, time_spent, created_at, updated_at) VALUES ('t-time', 'Timed task', 'todo', 'none', '[]', 3600, 1800, ?1, ?1)",
                params![now],
            )
            .expect("task with time columns should insert");

        let (estimated, spent): (Option<i64>, Option<i64>) = connection
            .query_row(
                "SELECT time_estimated, time_spent FROM tasks WHERE id = 't-time'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("should read time columns");

        assert_eq!(estimated, Some(3600));
        assert_eq!(spent, Some(1800));
    }

    #[test]
    fn checklists_tables_exist_after_migration() {
        let connection = test_connection();
        insert_minimal_task(&connection, "task-1");

        connection
            .execute(
                "INSERT INTO checklists (id, task_id, title, position) VALUES ('cl-1', 'task-1', 'My checklist', 0)",
                [],
            )
            .expect("checklist should insert");

        connection
            .execute(
                "INSERT INTO checklist_items (id, checklist_id, text, completed, position) VALUES ('ci-1', 'cl-1', 'First item', 0, 0)",
                [],
            )
            .expect("checklist item should insert");

        connection
            .execute(
                "INSERT INTO checklist_items (id, checklist_id, text, completed, position) VALUES ('ci-2', 'cl-1', 'Second item', 1, 1)",
                [],
            )
            .expect("completed checklist item should insert");

        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM checklist_items WHERE checklist_id = 'cl-1'",
                [],
                |row| row.get(0),
            )
            .expect("should count checklist items");

        assert_eq!(count, 2);
    }

    #[test]
    fn tags_tables_exist_after_migration() {
        let connection = test_connection();
        let now = timestamp();

        connection
            .execute(
                "INSERT INTO tags (id, name, color) VALUES ('tag-1', 'work', '#3b82f6')",
                [],
            )
            .expect("tag should insert");

        connection
            .execute(
                "INSERT INTO tags (id, name) VALUES ('tag-2', 'personal')",
                [],
            )
            .expect("tag with default color should insert");

        // Insert a task and link it via task_tags
        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, tags, created_at, updated_at) VALUES ('t-tagged', 'Tagged task', 'todo', 'none', '[]', ?1, ?1)",
                params![now],
            )
            .expect("task should insert");

        connection
            .execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES ('t-tagged', 'tag-1')",
                [],
            )
            .expect("task_tag should insert");

        connection
            .execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES ('t-tagged', 'tag-2')",
                [],
            )
            .expect("second task_tag should insert");

        let tag_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM task_tags WHERE task_id = 't-tagged'",
                [],
                |row| row.get(0),
            )
            .expect("should count task tags");

        assert_eq!(tag_count, 2);

        // Verify default color
        let default_color: String = connection
            .query_row("SELECT color FROM tags WHERE id = 'tag-2'", [], |row| {
                row.get(0)
            })
            .expect("should read default tag color");

        assert_eq!(default_color, "#6b7280");
    }

    #[test]
    fn checklist_crud_round_trips() {
        let connection = test_connection();
        insert_minimal_task(&connection, "task-1");

        // Create checklist
        let checklist = insert_checklist(&connection, "task-1", "My Checklist")
            .expect("checklist should insert");
        assert_eq!(checklist.title, "My Checklist");
        assert_eq!(checklist.position, 0);
        assert!(checklist.items.is_empty());

        // Add item
        let item = insert_checklist_item(&connection, &checklist.id, "First item")
            .expect("checklist item should insert");
        assert_eq!(item.text, "First item");
        assert!(!item.completed);
        assert_eq!(item.position, 0);

        // Update item: toggle completed
        patch_checklist_item(&connection, &item.id, None, Some(true))
            .expect("should toggle completed");

        // Update item: change text
        patch_checklist_item(&connection, &item.id, Some("Updated item"), None)
            .expect("should update text");

        // Verify via get_checklists
        let checklists = list_checklists(&connection, "task-1").expect("should list checklists");
        assert_eq!(checklists.len(), 1);
        assert_eq!(checklists[0].items.len(), 1);
        assert_eq!(checklists[0].items[0].text, "Updated item");
        assert!(checklists[0].items[0].completed);

        // Delete checklist (cascades items)
        remove_checklist(&connection, &checklist.id).expect("should delete checklist");
        let checklists = list_checklists(&connection, "task-1").expect("should list checklists");
        assert!(checklists.is_empty());
    }

    #[test]
    fn tag_crud_round_trips() {
        let connection = test_connection();

        // Create tag
        let tag = insert_tag(&connection, "work", Some("#3b82f6")).expect("tag should insert");
        assert_eq!(tag.name, "work");
        assert_eq!(tag.color, "#3b82f6");

        // Verify via get_tags
        let tags = list_tags(&connection).expect("should list tags");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "work");

        // Update name + color
        patch_tag(&connection, &tag.id, Some("personal"), Some("#ef4444"))
            .expect("should update tag");

        let tags = list_tags(&connection).expect("should list tags after update");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "personal");
        assert_eq!(tags[0].color, "#ef4444");

        // Delete
        remove_tag(&connection, &tag.id).expect("should delete tag");
        let tags = list_tags(&connection).expect("should list tags after delete");
        assert!(tags.is_empty());
    }

    #[test]
    fn task_tags_round_trips() {
        let connection = test_connection();

        // Create 2 tags
        let tag1 = insert_tag(&connection, "alpha", None).expect("tag1 should insert");
        let tag2 = insert_tag(&connection, "beta", None).expect("tag2 should insert");

        // Create a task
        let task = Task {
            id: "tt-task".to_string(),
            title: "Tagged task".to_string(),
            description: None,
            status: "todo".to_string(),
            priority: TaskPriority::None,
            tags: vec![],
            due_date: None,
            linked_note_path: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            parent_id: None,
            color: None,
            time_estimated: None,
            time_spent: None,
        };
        insert_task(&connection, &task).expect("task should insert");

        // Set both tags
        replace_task_tags(&connection, &task.id, &[tag1.id.clone(), tag2.id.clone()])
            .expect("should set task tags");

        let tags = list_task_tags(&connection, &task.id).expect("should list task tags");
        assert_eq!(tags.len(), 2);

        // Replace with just 1 tag
        replace_task_tags(&connection, &task.id, std::slice::from_ref(&tag1.id))
            .expect("should replace task tags");

        let tags =
            list_task_tags(&connection, &task.id).expect("should list task tags after replace");
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].id, tag1.id);
    }

    #[test]
    fn foreign_keys_cascade_checklists_and_task_tags() {
        let connection = test_connection();
        insert_minimal_task(&connection, "task-fk");

        let checklist = insert_checklist(&connection, "task-fk", "Linked checklist")
            .expect("checklist should insert");
        insert_checklist_item(&connection, &checklist.id, "Cascade me")
            .expect("checklist item should insert");
        let tag = insert_tag(&connection, "fk-tag", None).expect("tag should insert");
        replace_task_tags(&connection, "task-fk", std::slice::from_ref(&tag.id))
            .expect("task tags should insert");

        connection
            .execute("DELETE FROM tasks WHERE id = 'task-fk'", [])
            .expect("task delete should cascade");

        let checklist_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM checklists WHERE id = ?1",
                params![checklist.id],
                |row| row.get(0),
            )
            .expect("should count checklists");
        let item_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM checklist_items WHERE checklist_id = ?1",
                params![checklist.id],
                |row| row.get(0),
            )
            .expect("should count checklist items");
        let task_tag_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM task_tags WHERE tag_id = ?1",
                params![tag.id],
                |row| row.get(0),
            )
            .expect("should count task tags");

        assert_eq!(checklist_count, 0);
        assert_eq!(item_count, 0);
        assert_eq!(task_tag_count, 0);
    }

    #[test]
    fn subtask_listing_returns_children() {
        let connection = test_connection();

        // Insert parent task
        let parent = Task {
            id: "parent-sub".to_string(),
            title: "Parent task".to_string(),
            description: None,
            status: "todo".to_string(),
            priority: TaskPriority::None,
            tags: vec![],
            due_date: None,
            linked_note_path: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            parent_id: None,
            color: None,
            time_estimated: None,
            time_spent: None,
        };
        insert_task(&connection, &parent).expect("parent should insert");

        // Insert 2 child tasks
        let child1 = Task {
            id: "child-sub-1".to_string(),
            title: "Child 1".to_string(),
            description: None,
            status: "todo".to_string(),
            priority: TaskPriority::None,
            tags: vec![],
            due_date: None,
            linked_note_path: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            parent_id: Some("parent-sub".to_string()),
            color: None,
            time_estimated: None,
            time_spent: None,
        };
        insert_task(&connection, &child1).expect("child1 should insert");

        let child2 = Task {
            id: "child-sub-2".to_string(),
            title: "Child 2".to_string(),
            description: None,
            status: "todo".to_string(),
            priority: TaskPriority::None,
            tags: vec![],
            due_date: None,
            linked_note_path: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            parent_id: Some("parent-sub".to_string()),
            color: None,
            time_estimated: None,
            time_spent: None,
        };
        insert_task(&connection, &child2).expect("child2 should insert");

        let subtasks = list_subtasks(&connection, "parent-sub").expect("should list subtasks");
        assert_eq!(subtasks.len(), 2);
    }

    #[test]
    fn yougile_accounts_table_exists_after_migration() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        run_migrations(&connection).expect("migrations should succeed");
        connection
            .execute(
                "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
                 VALUES ('a1', 'test@test.com', 'c1', 'TestCo', 'key123', '2025-01-01')",
                [],
            )
            .unwrap();
        let name: String = connection
            .query_row(
                "SELECT company_name FROM yougile_accounts WHERE id = 'a1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "TestCo");
    }

    #[test]
    fn yougile_api_keys_stay_available_in_sqlite_fallback() {
        let db = DatabaseState::new(test_connection());

        let account = add_yougile_account_impl(
            &db,
            "user@example.com",
            "company-1",
            "Acme",
            "secret-api-key",
        )
        .expect("account should insert");

        let api_key = get_yougile_account_api_key_impl(&db, &account.id)
            .expect("api key should resolve from keyring");
        assert_eq!(api_key, "secret-api-key");

        let conn = db.connection.lock().expect("db lock should succeed");
        let stored: String = conn
            .query_row(
                "SELECT api_key FROM yougile_accounts WHERE id = ?1",
                params![account.id],
                |row| row.get(0),
            )
            .expect("should read stored api key column");

        assert_eq!(stored, "secret-api-key");
    }

    #[test]
    fn legacy_yougile_api_keys_migrate_on_first_read() {
        let db = DatabaseState::new(test_connection());
        let created_at = timestamp();
        {
            let conn = db.connection.lock().expect("db lock should succeed");
            conn.execute(
                "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
                 VALUES ('legacy-account', 'legacy@example.com', 'company-1', 'Acme', 'legacy-key', ?1)",
                params![created_at],
            )
            .expect("legacy account should insert");
        }

        let api_key = get_yougile_account_api_key_impl(&db, "legacy-account")
            .expect("legacy api key should migrate");
        assert_eq!(api_key, "legacy-key");

        let conn = db.connection.lock().expect("db lock should succeed");
        let stored: String = conn
            .query_row(
                "SELECT api_key FROM yougile_accounts WHERE id = 'legacy-account'",
                [],
                |row| row.get(0),
            )
            .expect("should read cleared legacy api key");

        assert_eq!(stored, "legacy-key");
    }

    #[test]
    fn add_yougile_account_updates_existing_company_case_insensitively() {
        let db = DatabaseState::new(test_connection());

        let first =
            add_yougile_account_impl(&db, "User@example.com", "company-1", "Acme", "first-key")
                .expect("first account should insert");

        let second = add_yougile_account_impl(
            &db,
            "user@example.com",
            "company-1",
            "Acme Updated",
            "second-key",
        )
        .expect("second account should update existing row");

        assert_eq!(first.id, second.id);

        let conn = db.connection.lock().expect("db lock should succeed");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM yougile_accounts WHERE LOWER(email) = LOWER(?1) AND company_id = ?2",
                params!["user@example.com", "company-1"],
                |row| row.get(0),
            )
            .expect("should count matching accounts");
        assert_eq!(count, 1);

        let company_name: String = conn
            .query_row(
                "SELECT company_name FROM yougile_accounts WHERE id = ?1",
                params![first.id],
                |row| row.get(0),
            )
            .expect("should read updated company name");
        assert_eq!(company_name, "Acme Updated");

        drop(conn);

        let api_key = get_yougile_account_api_key_impl(&db, &first.id)
            .expect("updated account key should resolve");
        assert_eq!(api_key, "second-key");
    }

    #[test]
    fn missing_yougile_key_recovers_from_related_account() {
        let db = DatabaseState::new(test_connection());
        {
            let conn = db.connection.lock().expect("db lock should succeed");
            conn.execute(
                "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
                 VALUES ('stale', 'User@example.com', 'company-1', 'Acme', '', '2025-01-01T00:00:00Z')",
                [],
            )
            .expect("stale account should insert");
            conn.execute(
                "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
                 VALUES ('fresh', 'user@example.com', 'company-1', 'Acme', 'fresh-key', '2025-01-01T00:00:01Z')",
                [],
            )
            .expect("fresh account should insert");
        }

        let api_key = get_yougile_account_api_key_impl(&db, "stale")
            .expect("stale account should recover key from related account");
        assert_eq!(api_key, "fresh-key");

        let conn = db.connection.lock().expect("db lock should succeed");
        let stale_key: String = conn
            .query_row(
                "SELECT api_key FROM yougile_accounts WHERE id = 'stale'",
                [],
                |row| row.get(0),
            )
            .expect("should read stale account api key");
        assert_eq!(stale_key, "fresh-key");
    }

    #[test]
    fn slugify_title_handles_edge_cases() {
        assert_eq!(slugify_title("Hello, World!"), "hello-world");
        assert_eq!(slugify_title("  ###  "), "");
        assert_eq!(slugify_title("Привет мир"), "");
        assert_eq!(slugify_title("Release 1.2.3 notes"), "release-1-2-3-notes");
    }

    #[test]
    fn task_template_crud_round_trips() {
        let connection = test_connection();

        let created = insert_task_template(
            &connection,
            CreateTaskTemplateInput {
                title: "  Bug Report  ".to_string(),
                description: Some("  Standard bug report body  ".to_string()),
                color: Some(" task-danger ".to_string()),
                checklists: Some(
                    r#"[{"title":"Triage","items":[{"title":"Repro","completed":false}]}]"#
                        .to_string(),
                ),
                stickers: Some(r#"{"sticker-1":"state-1"}"#.to_string()),
                column_id: Some("  column-1  ".to_string()),
            },
        )
        .expect("template should insert");

        assert_eq!(created.title, "Bug Report");
        assert_eq!(
            created.description.as_deref(),
            Some("Standard bug report body")
        );
        assert_eq!(created.color.as_deref(), Some("task-danger"));
        assert_eq!(created.column_id.as_deref(), Some("column-1"));

        let listed = list_task_templates(&connection).expect("templates should list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let updated = patch_task_template(
            &connection,
            &UpdateTaskTemplateInput {
                id: created.id.clone(),
                title: Some("Incident".to_string()),
                description: Some(String::new()),
                color: Some(String::new()),
                checklists: Some("[]".to_string()),
                stickers: Some("{}".to_string()),
                column_id: Some(String::new()),
            },
        )
        .expect("template should update");

        assert_eq!(updated.title, "Incident");
        assert_eq!(updated.description, None);
        assert_eq!(updated.color, None);
        assert_eq!(updated.column_id, None);
        assert_eq!(updated.checklists, "[]");
        assert_eq!(updated.stickers, "{}");

        remove_task_template(&connection, &created.id).expect("template should delete");
        let listed = list_task_templates(&connection).expect("templates should list after delete");
        assert!(listed.is_empty());
    }

    #[test]
    fn task_template_json_validation_rejects_wrong_shapes() {
        let connection = test_connection();

        let checklist_error = insert_task_template(
            &connection,
            CreateTaskTemplateInput {
                title: "Bad".to_string(),
                description: None,
                color: None,
                checklists: Some("{}".to_string()),
                stickers: None,
                column_id: None,
            },
        )
        .expect_err("object checklists should fail");
        assert!(checklist_error.contains("checklists must be a JSON array"));

        let sticker_error = insert_task_template(
            &connection,
            CreateTaskTemplateInput {
                title: "Bad".to_string(),
                description: None,
                color: None,
                checklists: None,
                stickers: Some("[]".to_string()),
                column_id: None,
            },
        )
        .expect_err("array stickers should fail");
        assert!(sticker_error.contains("stickers must be a JSON object"));
    }
}
