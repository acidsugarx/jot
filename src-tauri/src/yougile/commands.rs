use super::auth;
use super::models::*;
use crate::db::DatabaseState;
use crate::parser::parse_task_input;
use chrono::DateTime;
use tauri::State;

fn require_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} cannot be empty."));
    }
    Ok(())
}

fn apply_raw_input(payload: CreateYougileTask) -> CreateYougileTask {
    let Some(raw_input) = payload.raw_input.as_deref() else {
        return payload;
    };

    let parsed = parse_task_input(raw_input);
    let deadline = payload.deadline.or_else(|| {
        parsed
            .due_date
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|date_time| YougileDeadline {
                deadline: Some(date_time.timestamp_millis()),
                start_date: None,
                with_time: Some(false),
                history: Vec::new(),
                blocked_points: Vec::new(),
                links: Vec::new(),
                deleted: None,
                empty: None,
            })
    });

    CreateYougileTask {
        title: if parsed.title.is_empty() {
            payload.title
        } else {
            parsed.title
        },
        raw_input: None,
        column_id: payload.column_id,
        description: payload.description,
        color: payload.color,
        assigned: payload.assigned,
        deadline,
        time_tracking: payload.time_tracking,
        stickers: payload.stickers,
        checklists: payload.checklists,
        stopwatch: payload.stopwatch,
        timer: payload.timer,
    }
}

fn mime_type_from_file_name(file_name: &str) -> String {
    let ext = file_name
        .rsplit('.')
        .next()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
    .to_string()
}

// --- Auth Commands ---

#[tauri::command]
pub async fn yougile_login(login: String, password: String) -> Result<Vec<Company>, String> {
    require_non_empty(&login, "Login")?;
    require_non_empty(&password, "Password")?;
    auth::login_get_companies(&login, &password).await
}

#[tauri::command]
pub async fn yougile_add_account(
    login: String,
    password: String,
    company_id: String,
    company_name: String,
    state: State<'_, DatabaseState>,
) -> Result<YougileAccount, String> {
    require_non_empty(&login, "Login")?;
    require_non_empty(&password, "Password")?;
    require_non_empty(&company_id, "Company ID")?;
    auth::add_account(&state, &login, &password, &company_id, &company_name).await
}

#[tauri::command]
pub fn yougile_remove_account(
    account_id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    require_non_empty(&account_id, "Account ID")?;
    crate::db::remove_yougile_account_impl(&state, &account_id)
}

#[tauri::command]
pub fn yougile_get_accounts(
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileAccount>, String> {
    crate::db::get_yougile_accounts_impl(&state)
}

// --- Chat Commands ---

#[tauri::command]
pub async fn yougile_get_chat_messages(
    account_id: String,
    task_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
    state: State<'_, DatabaseState>,
) -> Result<Vec<ChatMessage>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&task_id, "Task ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_chat_messages(&task_id, limit, offset).await
}

#[tauri::command]
pub async fn yougile_send_chat_message(
    account_id: String,
    task_id: String,
    text: String,
    text_html: Option<String>,
    state: State<'_, DatabaseState>,
) -> Result<ChatMessageIdResponse, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&task_id, "Task ID")?;
    require_non_empty(&text, "Message text")?;
    let client = auth::client_for_account(&state, &account_id)?;
    let html = text_html.unwrap_or_else(|| format!("<p>{}</p>", text.replace('\n', "<br>")));
    let payload = CreateChatMessage {
        text: text.clone(),
        text_html: html,
        label: None,
    };
    client.send_chat_message(&task_id, &payload).await
}

#[tauri::command]
pub async fn yougile_upload_file(
    account_id: String,
    file_name: String,
    file_bytes: Vec<u8>,
    mime_type: String,
    state: State<'_, DatabaseState>,
) -> Result<FileUploadResponse, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&file_name, "File name")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.upload_file(file_name, file_bytes, mime_type).await
}

#[tauri::command]
pub async fn yougile_upload_file_path(
    account_id: String,
    file_path: String,
    state: State<'_, DatabaseState>,
) -> Result<FileUploadResponse, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&file_path, "File path")?;

    let client = auth::client_for_account(&state, &account_id)?;
    let path = std::path::Path::new(&file_path);
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Invalid file path: {file_path} - {e}"))?;
    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }
    let file_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {file_path}"))?
        .to_string();
    let file_bytes = tokio::fs::read(&canonical)
        .await
        .map_err(|error| format!("Failed to read file at '{}': {error}", canonical.display()))?;
    let mime_type = mime_type_from_file_name(&file_name);

    client.upload_file(file_name, file_bytes, mime_type).await
}

// --- File Download ---

#[tauri::command]
pub async fn yougile_download_file(url: String, save_path: String) -> Result<(), String> {
    require_non_empty(&url, "Download URL")?;
    require_non_empty(&save_path, "Save path")?;

    let requested_path = std::path::PathBuf::from(save_path.trim());
    let file_name = requested_path
        .file_name()
        .ok_or_else(|| "Save path must include a file name.".to_string())?
        .to_os_string();
    let parent = requested_path
        .parent()
        .ok_or_else(|| "Save path must include a parent directory.".to_string())?;

    tokio::fs::create_dir_all(parent).await.map_err(|error| {
        format!(
            "Failed to create download directory '{}': {error}",
            parent.display()
        )
    })?;

    let canonical_parent = parent.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve download directory '{}': {error}",
            parent.display()
        )
    })?;
    let canonical_save = canonical_parent.join(file_name);

    let bytes = super::client::YougileClient::download_file(&url).await?;
    tokio::fs::write(&canonical_save, &bytes)
        .await
        .map_err(|e| {
            format!(
                "Failed to write file to '{}': {e}",
                canonical_save.display()
            )
        })
}

// --- Navigation Commands ---

#[tauri::command]
pub async fn yougile_get_projects(
    account_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileProject>, String> {
    require_non_empty(&account_id, "Account ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_projects().await
}

#[tauri::command]
pub async fn yougile_get_boards(
    account_id: String,
    project_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileBoard>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&project_id, "Project ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_boards(&project_id).await
}

#[tauri::command]
pub async fn yougile_get_columns(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileColumn>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&board_id, "Board ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_columns(&board_id).await
}

#[tauri::command]
pub async fn yougile_get_users(
    account_id: String,
    project_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileUser>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&project_id, "Project ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_users(&project_id).await
}

#[tauri::command]
pub async fn yougile_get_all_users(
    account_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileUser>, String> {
    require_non_empty(&account_id, "Account ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_all_users().await
}

#[tauri::command]
pub async fn yougile_get_string_stickers(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileStringSticker>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&board_id, "Board ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_string_stickers(&board_id).await
}

#[tauri::command]
pub async fn yougile_get_sprint_stickers(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileSprintSticker>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&board_id, "Board ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_sprint_stickers(&board_id).await
}

// --- Task Commands ---

#[tauri::command]
pub async fn yougile_get_tasks(
    account_id: String,
    column_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileTask>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&column_id, "Column ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_tasks(&column_id).await
}

#[tauri::command]
pub async fn yougile_get_task(
    account_id: String,
    task_id: String,
    state: State<'_, DatabaseState>,
) -> Result<YougileTask, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&task_id, "Task ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_task(&task_id).await
}

#[tauri::command]
pub async fn yougile_get_board_tasks(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileTask>, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&board_id, "Board ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_board_tasks(&board_id).await
}

#[tauri::command]
pub async fn yougile_create_task(
    account_id: String,
    payload: CreateYougileTask,
    state: State<'_, DatabaseState>,
) -> Result<YougileTask, String> {
    require_non_empty(&account_id, "Account ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    let payload = apply_raw_input(payload);
    client.create_task(&payload).await
}

#[tauri::command]
pub async fn yougile_update_task(
    account_id: String,
    task_id: String,
    payload: UpdateYougileTask,
    state: State<'_, DatabaseState>,
) -> Result<YougileTask, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&task_id, "Task ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.update_task(&task_id, &payload).await
}

#[tauri::command]
pub async fn yougile_move_task(
    account_id: String,
    task_id: String,
    column_id: String,
    state: State<'_, DatabaseState>,
) -> Result<YougileTask, String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&task_id, "Task ID")?;
    require_non_empty(&column_id, "Column ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.move_task(&task_id, &column_id).await
}

#[tauri::command]
pub async fn yougile_delete_task(
    account_id: String,
    task_id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    require_non_empty(&account_id, "Account ID")?;
    require_non_empty(&task_id, "Task ID")?;
    let client = auth::client_for_account(&state, &account_id)?;
    client.delete_task(&task_id).await
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn apply_raw_input_preserves_template_fields() {
        let payload = CreateYougileTask {
            title: "Fallback title".to_string(),
            raw_input: Some("Write release notes tomorrow".to_string()),
            column_id: "column-1".to_string(),
            description: Some("<p>Template body</p>".to_string()),
            color: Some("task-blue".to_string()),
            assigned: None,
            deadline: None,
            time_tracking: None,
            stickers: Some(HashMap::from([(
                "sticker-1".to_string(),
                "state-1".to_string(),
            )])),
            checklists: Some(vec![YougileChecklist {
                id: None,
                title: "Checklist".to_string(),
                items: vec![YougileChecklistItem {
                    id: None,
                    title: "Ship".to_string(),
                    completed: false,
                }],
            }]),
            stopwatch: None,
            timer: None,
        };

        let applied = apply_raw_input(payload);

        assert_eq!(applied.title, "Write release notes");
        assert_eq!(applied.description.as_deref(), Some("<p>Template body</p>"));
        assert_eq!(applied.color.as_deref(), Some("task-blue"));
        assert_eq!(
            applied
                .stickers
                .as_ref()
                .and_then(|stickers| stickers.get("sticker-1")),
            Some(&"state-1".to_string())
        );
        assert_eq!(
            applied
                .checklists
                .as_ref()
                .and_then(|checklists| checklists.first())
                .map(|checklist| checklist.title.as_str()),
            Some("Checklist")
        );
        assert!(applied.deadline.is_some());
    }
}
