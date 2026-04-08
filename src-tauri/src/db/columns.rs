use rusqlite::{params, Connection, OptionalExtension};

use crate::models::KanbanColumn;

use super::utils::slugify_title;

pub(crate) fn list_columns(connection: &Connection) -> Result<Vec<KanbanColumn>, String> {
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

pub(crate) fn fetch_column(
    connection: &Connection,
    id: &str,
) -> Result<Option<KanbanColumn>, String> {
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

pub(crate) fn unique_status_key(connection: &Connection, name: &str) -> Result<String, String> {
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
