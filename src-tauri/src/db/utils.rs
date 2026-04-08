use chrono::Utc;

pub(crate) fn db_error(action: &str, error: impl std::fmt::Display) -> String {
    format!("Failed to {action}: {error}")
}

pub(crate) fn build_patch_query(table: &str, sets: &[&str]) -> String {
    format!("UPDATE {table} SET {} WHERE id = ?", sets.join(", "))
}

pub(crate) fn require_non_empty_id(id: &str, label: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err(format!("{label} ID cannot be empty."));
    }
    Ok(())
}

pub(crate) fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

pub(crate) fn slugify_title(title: &str) -> String {
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

pub(crate) fn normalize_required_title(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} cannot be empty."));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(crate) fn normalize_json_array(
    value: Option<&str>,
    field_name: &str,
) -> Result<String, String> {
    normalize_json_value(value, field_name, true)
}

pub(crate) fn normalize_json_object(
    value: Option<&str>,
    field_name: &str,
) -> Result<String, String> {
    normalize_json_value(value, field_name, false)
}

fn normalize_json_value(
    value: Option<&str>,
    field_name: &str,
    expect_array: bool,
) -> Result<String, String> {
    let default = if expect_array { "[]" } else { "{}" };
    let raw = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default);
    let parsed: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Invalid JSON for {field_name}: {error}"))?;

    match (expect_array, &parsed) {
        (true, serde_json::Value::Array(_)) | (false, serde_json::Value::Object(_)) => {
            serde_json::to_string(&parsed)
                .map_err(|error| format!("Failed to serialize {field_name}: {error}"))
        }
        (true, _) => Err(format!("{field_name} must be a JSON array.")),
        (false, _) => Err(format!("{field_name} must be a JSON object.")),
    }
}

pub(crate) fn invalid_value_error(index: usize, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::other(format!(
            "Invalid SQLite enum value: {value}"
        ))),
    )
}
