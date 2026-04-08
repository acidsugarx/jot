use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{CreateTaskTemplateInput, TaskTemplate, UpdateTaskTemplateInput};

use super::utils::{
    build_patch_query, normalize_json_array, normalize_json_object, normalize_optional_text,
    normalize_required_title, timestamp,
};

pub(crate) fn insert_task_template(
    connection: &Connection,
    input: CreateTaskTemplateInput,
) -> Result<TaskTemplate, String> {
    let title = normalize_required_title(&input.title, "Template title")?;
    let now = timestamp();
    let template = TaskTemplate {
        id: uuid::Uuid::new_v4().to_string(),
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

pub(crate) fn list_task_templates(connection: &Connection) -> Result<Vec<TaskTemplate>, String> {
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

pub(crate) fn fetch_task_template(
    connection: &Connection,
    id: &str,
) -> Result<Option<TaskTemplate>, String> {
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

pub(crate) fn patch_task_template(
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

pub(crate) fn remove_task_template(connection: &Connection, id: &str) -> Result<(), String> {
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
