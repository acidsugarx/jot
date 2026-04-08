use rusqlite::{params, Connection};

use crate::models::Tag;

use super::utils::build_patch_query;

pub(crate) fn list_tags(connection: &Connection) -> Result<Vec<Tag>, String> {
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

pub(crate) fn insert_tag(
    connection: &Connection,
    name: &str,
    color: Option<&str>,
) -> Result<Tag, String> {
    let tag = Tag {
        id: uuid::Uuid::new_v4().to_string(),
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

pub(crate) fn patch_tag(
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

pub(crate) fn remove_tag(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM task_tags WHERE tag_id = ?1", params![id])
        .map_err(|error| format!("Failed to delete task_tags for tag: {error}"))?;

    connection
        .execute("DELETE FROM tags WHERE id = ?1", params![id])
        .map_err(|error| format!("Failed to delete tag: {error}"))?;

    Ok(())
}

pub(crate) fn list_task_tags(connection: &Connection, task_id: &str) -> Result<Vec<Tag>, String> {
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

pub(crate) fn replace_task_tags(
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
