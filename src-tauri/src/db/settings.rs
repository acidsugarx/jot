use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{AppSettings, YougileSyncState};

pub(crate) fn load_settings(connection: &Connection) -> Result<AppSettings, String> {
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

pub(crate) fn save_setting(
    connection: &Connection,
    key: &str,
    value: Option<&str>,
) -> Result<(), String> {
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

pub(crate) fn load_yougile_sync_state(connection: &Connection) -> Result<YougileSyncState, String> {
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

pub(crate) fn save_yougile_sync_state(
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

pub(crate) fn resolve_vault_dir(connection: &Connection) -> Result<String, String> {
    let stored_path = load_settings(connection)?.vault_dir;

    stored_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("JOT_VAULT_DIR").ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "@zettel requires a vault path. Set it in Settings or via JOT_VAULT_DIR.".to_string()
        })
}
