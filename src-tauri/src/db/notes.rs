use std::{fs, path::PathBuf};

use chrono::Utc;
use rusqlite::Connection;

use super::settings::resolve_vault_dir;
use super::utils::slugify_title;

pub(crate) fn create_zettel_note(
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
