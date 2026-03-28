use super::auth;
use super::models::*;
use crate::db::DatabaseState;
use crate::parser::parse_task_input;
use chrono::DateTime;
use tauri::State;

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
        checklists: payload.checklists,
        stopwatch: payload.stopwatch,
        timer: payload.timer,
    }
}

// --- Auth Commands ---

#[tauri::command]
pub async fn yougile_login(login: String, password: String) -> Result<Vec<Company>, String> {
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
    auth::add_account(&state, &login, &password, &company_id, &company_name).await
}

#[tauri::command]
pub fn yougile_remove_account(
    account_id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    crate::db::remove_yougile_account_impl(&state, &account_id)
}

#[tauri::command]
pub fn yougile_get_accounts(
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileAccount>, String> {
    crate::db::get_yougile_accounts_impl(&state)
}

// --- Navigation Commands ---

#[tauri::command]
pub async fn yougile_get_projects(
    account_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileProject>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_projects().await
}

#[tauri::command]
pub async fn yougile_get_boards(
    account_id: String,
    project_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileBoard>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_boards(&project_id).await
}

#[tauri::command]
pub async fn yougile_get_columns(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileColumn>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_columns(&board_id).await
}

#[tauri::command]
pub async fn yougile_get_users(
    account_id: String,
    project_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileUser>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_users(&project_id).await
}

#[tauri::command]
pub async fn yougile_get_string_stickers(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileStringSticker>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_string_stickers(&board_id).await
}

#[tauri::command]
pub async fn yougile_get_sprint_stickers(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileSprintSticker>, String> {
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
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_tasks(&column_id).await
}

#[tauri::command]
pub async fn yougile_get_board_tasks(
    account_id: String,
    board_id: String,
    state: State<'_, DatabaseState>,
) -> Result<Vec<YougileTask>, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.get_board_tasks(&board_id).await
}

#[tauri::command]
pub async fn yougile_create_task(
    account_id: String,
    payload: CreateYougileTask,
    state: State<'_, DatabaseState>,
) -> Result<YougileTask, String> {
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
    let client = auth::client_for_account(&state, &account_id)?;
    client.move_task(&task_id, &column_id).await
}

#[tauri::command]
pub async fn yougile_delete_task(
    account_id: String,
    task_id: String,
    state: State<'_, DatabaseState>,
) -> Result<(), String> {
    let client = auth::client_for_account(&state, &account_id)?;
    client.delete_task(&task_id).await
}
