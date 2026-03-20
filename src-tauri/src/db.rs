use std::{env, fs, path::PathBuf, process::Command, sync::Mutex};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::models::{
    AppSettings, CreateTaskInput, Task, TaskPriority, TaskStatus, UpdateSettingsInput,
    UpdateTaskInput, UpdateTaskStatusInput,
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

fn run_migrations(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
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

    Ok(())
}

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
        status: input.status.unwrap_or(TaskStatus::Todo),
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
    };

    insert_task(&connection, &task)?;

    Ok(task)
}

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
pub fn open_linked_note(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Linked note path cannot be empty.".to_string());
    }

    if !PathBuf::from(&path).exists() {
        return Err(format!("Linked note does not exist: {path}"));
    }

    let status = if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&path)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    } else if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    } else {
        Command::new("xdg-open")
            .arg(&path)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    };

    if !status.success() {
        return Err(format!("Opening linked note failed with status: {status}"));
    }

    Ok(())
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

    set_task_status(&connection, &input.id, input.status)
}

#[tauri::command]
pub fn delete_task(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    remove_task(&connection, &id)
}

#[tauri::command]
pub fn update_task(db: State<'_, DatabaseState>, input: UpdateTaskInput) -> Result<Task, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    patch_task(&connection, &input)
}

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
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ",
            params![
                task.id,
                task.title,
                task.description,
                task.status.as_str(),
                task.priority.as_str(),
                tags,
                task.due_date,
                task.linked_note_path,
                task.created_at,
                task.updated_at
            ],
        )
        .map_err(|error| format!("Failed to insert task into SQLite: {error}"))?;

    Ok(())
}

fn list_tasks(connection: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, description, status, priority, tags, due_date, linked_note_path, created_at, updated_at
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

fn set_task_status(connection: &Connection, id: &str, status: TaskStatus) -> Result<Task, String> {
    let updated_at = timestamp();

    let affected_rows = connection
        .execute(
            "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status.as_str(), updated_at, id],
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
            SELECT id, title, description, status, priority, tags, due_date, linked_note_path, created_at, updated_at
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

    Ok(AppSettings { vault_dir })
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

fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let status = row.get::<_, String>(3)?;
    let priority = row.get::<_, String>(4)?;
    let tags = row.get::<_, String>(5)?;

    let tags = serde_json::from_str(&tags).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;

    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: TaskStatus::from_str(&status).ok_or_else(|| invalid_value_error(3, &status))?,
        priority: TaskPriority::from_str(&priority)
            .ok_or_else(|| invalid_value_error(4, &priority))?,
        tags,
        due_date: row.get(6)?,
        linked_note_path: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
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

fn patch_task(connection: &Connection, input: &UpdateTaskInput) -> Result<Task, String> {
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref title) = input.title {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err("Task title cannot be empty.".to_string());
        }
        sets.push("title = ?".to_string());
        values.push(Box::new(trimmed.to_string()));
    }

    if let Some(ref description) = input.description {
        sets.push("description = ?".to_string());
        values.push(Box::new(description.clone()));
    }

    if let Some(status) = input.status {
        sets.push("status = ?".to_string());
        values.push(Box::new(status.as_str().to_string()));
    }

    if let Some(priority) = input.priority {
        sets.push("priority = ?".to_string());
        values.push(Box::new(priority.as_str().to_string()));
    }

    if let Some(ref tags) = input.tags {
        let tags_json = serde_json::to_string(tags)
            .map_err(|error| format!("Failed to serialize tags: {error}"))?;
        sets.push("tags = ?".to_string());
        values.push(Box::new(tags_json));
    }

    if let Some(ref due_date) = input.due_date {
        sets.push("due_date = ?".to_string());
        values.push(Box::new(due_date.clone()));
    }

    if sets.is_empty() {
        return fetch_task(connection, &input.id)?
            .ok_or_else(|| format!("Task {} was not found.", input.id));
    }

    let updated_at = timestamp();
    sets.push("updated_at = ?".to_string());
    values.push(Box::new(updated_at));
    values.push(Box::new(input.id.clone()));

    let sql = format!("UPDATE tasks SET {} WHERE id = ?", sets.join(", "));

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

    #[test]
    fn task_crud_flow_round_trips_through_sqlite() {
        let connection = test_connection();
        let task = Task {
            id: "task-1".to_string(),
            title: "Write architecture review".to_string(),
            description: Some("Review the new auth middleware".to_string()),
            status: TaskStatus::Todo,
            priority: TaskPriority::High,
            tags: vec!["work".to_string(), "dev".to_string()],
            due_date: Some("2026-03-14T10:00:00Z".to_string()),
            linked_note_path: Some("/tmp/jot-note.md".to_string()),
            created_at: timestamp(),
            updated_at: timestamp(),
        };

        insert_task(&connection, &task).expect("task should insert");

        let tasks = list_tasks(&connection).expect("tasks should load");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, task.title);
        assert_eq!(tasks[0].priority, TaskPriority::High);

        let updated_task = set_task_status(&connection, &task.id, TaskStatus::Done)
            .expect("status update should succeed");
        assert_eq!(updated_task.status, TaskStatus::Done);

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
}
