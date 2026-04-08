mod checklists;
mod columns;
mod migrations;
mod notes;
mod settings;
mod tags;
mod tasks;
mod templates;
mod utils;
mod yougile_accounts;

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager, State};

use crate::models::{
    AppSettings, Checklist, ChecklistItem, CreateColumnInput, CreateTaskInput,
    CreateTaskTemplateInput, KanbanColumn, ReorderColumnsInput, Tag, Task, UpdateColumnInput,
    UpdateSettingsInput, UpdateTaskInput, UpdateTaskStatusInput, UpdateTaskTemplateInput,
    YougileSyncState,
};
use crate::parser::parse_task_input;

use utils::{require_non_empty_id, timestamp};

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

    migrations::run_migrations(&connection)?;
    app.manage(DatabaseState::new(connection));

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
            Some(parsed) => Some(notes::create_zettel_note(
                &connection,
                &title,
                parsed.due_date.as_deref(),
            )?),
            None => None,
        },
    };

    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        description: None,
        status: input.status.unwrap_or_else(|| "todo".to_string()),
        priority: input
            .priority
            .or_else(|| parsed_input.as_ref().and_then(|value| value.priority))
            .unwrap_or(crate::models::TaskPriority::None),
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

    tasks::insert_task(&connection, &task)?;

    Ok(task)
}

#[tauri::command]
pub fn get_tasks(db: State<'_, DatabaseState>) -> Result<Vec<Task>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tasks::list_tasks(&connection)
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

    tasks::set_task_status(&connection, &input.id, &input.status)
}

#[tauri::command]
pub fn update_task(db: State<'_, DatabaseState>, input: UpdateTaskInput) -> Result<Task, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tasks::patch_task(&connection, &input)
}

#[tauri::command]
pub fn delete_task(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    require_non_empty_id(&id, "Task")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tasks::remove_task(&connection, &id)
}

// ── Settings commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(db: State<'_, DatabaseState>) -> Result<AppSettings, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    settings::load_settings(&connection)
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

    settings::save_setting(&connection, "vault_dir", input.vault_dir.as_deref())?;

    settings::load_settings(&connection)
}

#[tauri::command]
pub fn update_theme(db: State<'_, DatabaseState>, theme: String) -> Result<AppSettings, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    settings::save_setting(&connection, "theme", Some(&theme))?;

    settings::load_settings(&connection)
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

    settings::save_setting(
        &connection,
        "yougile_enabled",
        Some(if enabled { "true" } else { "false" }),
    )?;

    if !enabled {
        settings::save_yougile_sync_state(
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

    settings::load_settings(&connection)
}

#[tauri::command]
pub fn get_yougile_sync_state(db: State<'_, DatabaseState>) -> Result<YougileSyncState, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    settings::load_yougile_sync_state(&connection)
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

    settings::save_yougile_sync_state(&connection, &state)?;
    settings::load_yougile_sync_state(&connection)
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
    let vault_dir = settings::resolve_vault_dir(&connection)?;
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

    columns::list_columns(&connection)
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

    let status_key = columns::unique_status_key(&connection, &name)?;

    let max_position: i32 = connection
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM kanban_columns",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to get max position: {error}"))?;

    let column = KanbanColumn {
        id: uuid::Uuid::new_v4().to_string(),
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

    columns::fetch_column(&connection, &input.id)?
        .ok_or_else(|| format!("Column {} was not found.", input.id))
}

#[tauri::command]
pub fn delete_column(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    require_non_empty_id(&id, "Column")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    let column = columns::fetch_column(&connection, &id)?
        .ok_or_else(|| format!("Column {id} was not found."))?;

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

    columns::list_columns(&connection)
}

// ── Template commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_task_templates(
    db: State<'_, DatabaseState>,
) -> Result<Vec<crate::models::TaskTemplate>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    templates::list_task_templates(&connection)
}

#[tauri::command]
pub fn create_task_template(
    db: State<'_, DatabaseState>,
    input: CreateTaskTemplateInput,
) -> Result<crate::models::TaskTemplate, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    templates::insert_task_template(&connection, input)
}

#[tauri::command]
pub fn update_task_template(
    db: State<'_, DatabaseState>,
    input: UpdateTaskTemplateInput,
) -> Result<crate::models::TaskTemplate, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    templates::patch_task_template(&connection, &input)
}

#[tauri::command]
pub fn delete_task_template(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    require_non_empty_id(&id, "Template")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    templates::remove_task_template(&connection, &id)
}

// ── Checklist commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_checklists(
    db: State<'_, DatabaseState>,
    task_id: String,
) -> Result<Vec<Checklist>, String> {
    require_non_empty_id(&task_id, "Task")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    checklists::list_checklists(&connection, &task_id)
}

#[tauri::command]
pub fn create_checklist(
    db: State<'_, DatabaseState>,
    task_id: String,
    title: String,
) -> Result<Checklist, String> {
    require_non_empty_id(&task_id, "Task")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    checklists::insert_checklist(&connection, &task_id, &title)
}

#[tauri::command]
pub fn add_checklist_item(
    db: State<'_, DatabaseState>,
    checklist_id: String,
    text: String,
) -> Result<ChecklistItem, String> {
    require_non_empty_id(&checklist_id, "Checklist")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    checklists::insert_checklist_item(&connection, &checklist_id, &text)
}

#[tauri::command]
pub fn update_checklist_item(
    db: State<'_, DatabaseState>,
    id: String,
    text: Option<String>,
    completed: Option<bool>,
) -> Result<(), String> {
    require_non_empty_id(&id, "Checklist item")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    checklists::patch_checklist_item(&connection, &id, text.as_deref(), completed)
}

#[tauri::command]
pub fn delete_checklist(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    require_non_empty_id(&id, "Checklist")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    checklists::remove_checklist(&connection, &id)
}

#[tauri::command]
pub fn delete_checklist_item(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    require_non_empty_id(&id, "Checklist item")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    checklists::remove_checklist_item(&connection, &id)
}

// ── Tag commands ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_tags(db: State<'_, DatabaseState>) -> Result<Vec<Tag>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tags::list_tags(&connection)
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

    tags::insert_tag(&connection, &name, color.as_deref())
}

#[tauri::command]
pub fn update_tag(
    db: State<'_, DatabaseState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    require_non_empty_id(&id, "Tag")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tags::patch_tag(&connection, &id, name.as_deref(), color.as_deref())
}

#[tauri::command]
pub fn delete_tag(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    require_non_empty_id(&id, "Tag")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tags::remove_tag(&connection, &id)
}

#[tauri::command]
pub fn get_task_tags(db: State<'_, DatabaseState>, task_id: String) -> Result<Vec<Tag>, String> {
    require_non_empty_id(&task_id, "Task")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tags::list_task_tags(&connection, &task_id)
}

#[tauri::command]
pub fn set_task_tags(
    db: State<'_, DatabaseState>,
    task_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    require_non_empty_id(&task_id, "Task")?;
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tags::replace_task_tags(&connection, &task_id, &tag_ids)
}

// ── Subtask commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_subtasks(db: State<'_, DatabaseState>, parent_id: String) -> Result<Vec<Task>, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|error| format!("Failed to lock SQLite connection: {error}"))?;

    tasks::list_subtasks(&connection, &parent_id)
}

// ── Yougile account public API ────────────────────────────────────────────────

pub use yougile_accounts::{
    add_yougile_account_impl, get_yougile_account_api_key_impl, get_yougile_accounts_impl,
    remove_yougile_account_impl,
};

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TaskPriority;

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        migrations::run_migrations(&connection).expect("migrations should succeed");
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

        tasks::insert_task(&connection, &task).expect("task should insert");

        let tasks_list = tasks::list_tasks(&connection).expect("tasks should load");
        assert_eq!(tasks_list.len(), 1);
        assert_eq!(tasks_list[0].title, task.title);
        assert_eq!(tasks_list[0].priority, TaskPriority::High);

        let updated_task = tasks::set_task_status(&connection, &task.id, "done")
            .expect("status update should succeed");
        assert_eq!(updated_task.status, "done");

        tasks::remove_task(&connection, &task.id).expect("task should delete");
        let tasks_list = tasks::list_tasks(&connection).expect("task list should still load");
        assert!(tasks_list.is_empty());
    }

    #[test]
    fn deleting_missing_task_returns_error() {
        let connection = test_connection();
        let result = tasks::remove_task(&connection, "missing-task");
        assert!(result.is_err());
    }

    #[test]
    fn database_path_is_created_under_parent_directory() {
        let parent = std::env::temp_dir().join(format!("jot-db-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&parent).expect("temp parent directory should exist");

        let database_path = parent.join("jot.db");
        let connection = Connection::open(&database_path).expect("database should open on disk");
        migrations::run_migrations(&connection).expect("migrations should succeed");

        assert!(database_path.exists());

        fs::remove_file(&database_path).expect("database file should be removable");
        fs::remove_dir_all(&parent).expect("temp parent should be removable");
    }

    #[test]
    fn zettel_note_is_generated_in_configured_vault() {
        let vault_dir =
            std::env::temp_dir().join(format!("jot-vault-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&vault_dir).expect("vault dir should be created");
        std::env::set_var("JOT_VAULT_DIR", &vault_dir);

        let connection = test_connection();

        let path = notes::create_zettel_note(
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
        let vault_dir =
            std::env::temp_dir().join(format!("jot-settings-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&vault_dir).expect("vault dir should be created");

        settings::save_setting(&connection, "vault_dir", Some(&vault_dir.to_string_lossy()))
            .expect("vault setting should save");

        let settings = settings::load_settings(&connection).expect("settings should load");
        assert_eq!(
            settings.vault_dir,
            Some(vault_dir.to_string_lossy().into_owned())
        );

        fs::remove_dir_all(&vault_dir).expect("vault dir should be removable");
    }

    #[test]
    fn yougile_sync_state_round_trips_through_settings() {
        let connection = test_connection();

        settings::save_yougile_sync_state(
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

        let loaded =
            settings::load_yougile_sync_state(&connection).expect("Yougile sync state should load");

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
        let cols = columns::list_columns(&connection).expect("columns should load");
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[0].status_key, "todo");
        assert_eq!(cols[1].status_key, "in_progress");
        assert_eq!(cols[2].status_key, "done");
    }

    #[test]
    fn create_column_generates_unique_status_key() {
        let connection = test_connection();
        // "todo" slug already exists; "To Do" slugifies to "to-do" which is free
        let key = columns::unique_status_key(&connection, "To Do").expect("key should generate");
        assert_eq!(key, "to-do");
        // Insert it, then try again — should get "to-do-2"
        connection
            .execute(
                "INSERT INTO kanban_columns (id, name, status_key, position) VALUES ('x', 'To Do', 'to-do', 99)",
                [],
            )
            .unwrap();
        let key2 = columns::unique_status_key(&connection, "To Do").expect("key should generate");
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
        tasks::insert_task(&connection, &task).expect("task should insert");

        // Give the task a status matching a column
        tasks::set_task_status(&connection, &task.id, "todo").expect("status should update");

        let cols = columns::list_columns(&connection).expect("columns should load");
        let todo_col = cols.iter().find(|c| c.status_key == "todo").unwrap();
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
        let checklist = checklists::insert_checklist(&connection, "task-1", "My Checklist")
            .expect("checklist should insert");
        assert_eq!(checklist.title, "My Checklist");
        assert_eq!(checklist.position, 0);
        assert!(checklist.items.is_empty());

        // Add item
        let item = checklists::insert_checklist_item(&connection, &checklist.id, "First item")
            .expect("checklist item should insert");
        assert_eq!(item.text, "First item");
        assert!(!item.completed);
        assert_eq!(item.position, 0);

        // Update item: toggle completed
        checklists::patch_checklist_item(&connection, &item.id, None, Some(true))
            .expect("should toggle completed");

        // Update item: change text
        checklists::patch_checklist_item(&connection, &item.id, Some("Updated item"), None)
            .expect("should update text");

        // Verify via get_checklists
        let checklists_list =
            checklists::list_checklists(&connection, "task-1").expect("should list checklists");
        assert_eq!(checklists_list.len(), 1);
        assert_eq!(checklists_list[0].items.len(), 1);
        assert_eq!(checklists_list[0].items[0].text, "Updated item");
        assert!(checklists_list[0].items[0].completed);

        // Delete checklist (cascades items)
        checklists::remove_checklist(&connection, &checklist.id).expect("should delete checklist");
        let checklists_list =
            checklists::list_checklists(&connection, "task-1").expect("should list checklists");
        assert!(checklists_list.is_empty());
    }

    #[test]
    fn tag_crud_round_trips() {
        let connection = test_connection();

        // Create tag
        let tag =
            tags::insert_tag(&connection, "work", Some("#3b82f6")).expect("tag should insert");
        assert_eq!(tag.name, "work");
        assert_eq!(tag.color, "#3b82f6");

        // Verify via get_tags
        let tags_list = tags::list_tags(&connection).expect("should list tags");
        assert_eq!(tags_list.len(), 1);
        assert_eq!(tags_list[0].name, "work");

        // Update name + color
        tags::patch_tag(&connection, &tag.id, Some("personal"), Some("#ef4444"))
            .expect("should update tag");

        let tags_list = tags::list_tags(&connection).expect("should list tags after update");
        assert_eq!(tags_list.len(), 1);
        assert_eq!(tags_list[0].name, "personal");
        assert_eq!(tags_list[0].color, "#ef4444");

        // Delete
        tags::remove_tag(&connection, &tag.id).expect("should delete tag");
        let tags_list = tags::list_tags(&connection).expect("should list tags after delete");
        assert!(tags_list.is_empty());
    }

    #[test]
    fn task_tags_round_trips() {
        let connection = test_connection();

        // Create 2 tags
        let tag1 = tags::insert_tag(&connection, "alpha", None).expect("tag1 should insert");
        let tag2 = tags::insert_tag(&connection, "beta", None).expect("tag2 should insert");

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
        tasks::insert_task(&connection, &task).expect("task should insert");

        // Set both tags
        tags::replace_task_tags(&connection, &task.id, &[tag1.id.clone(), tag2.id.clone()])
            .expect("should set task tags");

        let tags_list = tags::list_task_tags(&connection, &task.id).expect("should list task tags");
        assert_eq!(tags_list.len(), 2);

        // Replace with just 1 tag
        tags::replace_task_tags(&connection, &task.id, std::slice::from_ref(&tag1.id))
            .expect("should replace task tags");

        let tags_list = tags::list_task_tags(&connection, &task.id)
            .expect("should list task tags after replace");
        assert_eq!(tags_list.len(), 1);
        assert_eq!(tags_list[0].id, tag1.id);
    }

    #[test]
    fn foreign_keys_cascade_checklists_and_task_tags() {
        let connection = test_connection();
        insert_minimal_task(&connection, "task-fk");

        let checklist = checklists::insert_checklist(&connection, "task-fk", "Linked checklist")
            .expect("checklist should insert");
        checklists::insert_checklist_item(&connection, &checklist.id, "Cascade me")
            .expect("checklist item should insert");
        let tag = tags::insert_tag(&connection, "fk-tag", None).expect("tag should insert");
        tags::replace_task_tags(&connection, "task-fk", std::slice::from_ref(&tag.id))
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
        tasks::insert_task(&connection, &parent).expect("parent should insert");

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
        tasks::insert_task(&connection, &child1).expect("child1 should insert");

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
        tasks::insert_task(&connection, &child2).expect("child2 should insert");

        let subtasks =
            tasks::list_subtasks(&connection, "parent-sub").expect("should list subtasks");
        assert_eq!(subtasks.len(), 2);
    }

    #[test]
    fn yougile_accounts_table_exists_after_migration() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        migrations::run_migrations(&connection).expect("migrations should succeed");
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

        let account = yougile_accounts::add_yougile_account_impl(
            &db,
            "user@example.com",
            "company-1",
            "Acme",
            "secret-api-key",
        )
        .expect("account should insert");

        let api_key = yougile_accounts::get_yougile_account_api_key_impl(&db, &account.id)
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

        let api_key = yougile_accounts::get_yougile_account_api_key_impl(&db, "legacy-account")
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

        let first = yougile_accounts::add_yougile_account_impl(
            &db,
            "User@example.com",
            "company-1",
            "Acme",
            "first-key",
        )
        .expect("first account should insert");

        let second = yougile_accounts::add_yougile_account_impl(
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

        let api_key = yougile_accounts::get_yougile_account_api_key_impl(&db, &first.id)
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

        let api_key = yougile_accounts::get_yougile_account_api_key_impl(&db, "stale")
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
        assert_eq!(utils::slugify_title("Hello, World!"), "hello-world");
        assert_eq!(utils::slugify_title("  ###  "), "");
        assert_eq!(utils::slugify_title("Привет мир"), "");
        assert_eq!(
            utils::slugify_title("Release 1.2.3 notes"),
            "release-1-2-3-notes"
        );
    }

    #[test]
    fn task_template_crud_round_trips() {
        let connection = test_connection();

        let created = templates::insert_task_template(
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

        let listed = templates::list_task_templates(&connection).expect("templates should list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let updated = templates::patch_task_template(
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

        templates::remove_task_template(&connection, &created.id).expect("template should delete");
        let listed = templates::list_task_templates(&connection)
            .expect("templates should list after delete");
        assert!(listed.is_empty());
    }

    #[test]
    fn task_template_json_validation_rejects_wrong_shapes() {
        let connection = test_connection();

        let checklist_error = templates::insert_task_template(
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

        let sticker_error = templates::insert_task_template(
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
