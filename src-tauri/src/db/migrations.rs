use rusqlite::Connection;

use super::utils::db_error;

pub(crate) fn run_migrations(connection: &Connection) -> Result<(), String> {
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
        let id = uuid::Uuid::new_v4().to_string();
        connection
            .execute(
                "INSERT INTO kanban_columns (id, name, status_key, position) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, name, status_key, position],
            )
            .map_err(|error| format!("Failed to seed default column '{name}': {error}"))?;
    }

    Ok(())
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
