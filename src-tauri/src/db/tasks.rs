use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{Task, TaskPriority, UpdateTaskInput};

use super::utils::{build_patch_query, invalid_value_error, timestamp};

pub(crate) fn insert_task(connection: &Connection, task: &Task) -> Result<(), String> {
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

pub(crate) fn list_tasks(connection: &Connection) -> Result<Vec<Task>, String> {
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

pub(crate) fn set_task_status(
    connection: &Connection,
    id: &str,
    status: &str,
) -> Result<Task, String> {
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

pub(crate) fn remove_task(connection: &Connection, id: &str) -> Result<(), String> {
    let affected_rows = connection
        .execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete task: {error}"))?;

    if affected_rows == 0 {
        return Err(format!("Task {id} was not found."));
    }

    Ok(())
}

pub(crate) fn fetch_task(connection: &Connection, id: &str) -> Result<Option<Task>, String> {
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

pub(crate) fn patch_task(connection: &Connection, input: &UpdateTaskInput) -> Result<Task, String> {
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

pub(crate) fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
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

pub(crate) fn list_subtasks(connection: &Connection, parent_id: &str) -> Result<Vec<Task>, String> {
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
