use rusqlite::{params, Connection};

use crate::models::{Checklist, ChecklistItem};

use super::utils::{build_patch_query, db_error};

pub(crate) fn list_checklists(
    connection: &Connection,
    task_id: &str,
) -> Result<Vec<Checklist>, String> {
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

pub(crate) fn insert_checklist(
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
        id: uuid::Uuid::new_v4().to_string(),
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

pub(crate) fn insert_checklist_item(
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
        id: uuid::Uuid::new_v4().to_string(),
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

pub(crate) fn patch_checklist_item(
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

pub(crate) fn remove_checklist(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM checklist_items WHERE checklist_id = ?1",
            params![id],
        )
        .map_err(|error| db_error("delete checklist items", error))?;

    connection
        .execute("DELETE FROM checklists WHERE id = ?1", params![id])
        .map_err(|error| db_error("delete checklist", error))?;

    Ok(())
}

pub(crate) fn remove_checklist_item(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM checklist_items WHERE id = ?1", params![id])
        .map_err(|error| db_error("delete checklist item", error))?;

    Ok(())
}
