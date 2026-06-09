use async_trait::async_trait;
use crate::db::DatabaseState;
use crate::yougile::auth;
use crate::yougile::client::YougileClient;
use crate::yougile::models::YougileTask;
use super::{
    CreateUnifiedTask, ProviderError, TaskFilter, TaskProvider, UnifiedTask,
    UpdateUnifiedTask, yougile_status_to_unified,
};

/// Context needed by the Yougile provider for each operation.
pub struct YougileProviderContext<'a> {
    pub db: &'a DatabaseState,
    pub account_id: String,
    pub board_id: Option<String>,
}

/// A Yougile provider bound to a database + account.
/// Created per-request inside command handlers.
pub struct DbBoundYougileProvider<'a> {
    ctx: YougileProviderContext<'a>,
}

impl<'a> DbBoundYougileProvider<'a> {
    pub fn new(ctx: YougileProviderContext<'a>) -> Self {
        Self { ctx }
    }

    fn client(&self) -> Result<YougileClient, ProviderError> {
        auth::client_for_account(self.ctx.db, &self.ctx.account_id)
            .map_err(|e| ProviderError::new(e, "yougile", "AUTH_FAILED"))
    }
}

// ── Conversion helpers ───────────────────────────────────────────────────────

fn yougile_to_unified(task: &YougileTask) -> UnifiedTask {
    let status = yougile_status_to_unified(task.completed, task.archived);

    let deadline_ts = task
        .deadline
        .as_ref()
        .and_then(|d| d.deadline);

    let due_date = deadline_ts.and_then(|ts| {
        // Convert millisecond timestamp to ISO date string
        let secs = ts / 1000;
        let nanos = ((ts % 1000) * 1_000_000) as u32;
        chrono::DateTime::from_timestamp(secs, nanos)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
    });

    // Extract assignee emails (free-form) or IDs
    let tags: Vec<String> = task
        .assigned
        .iter()
        .map(|a| format!("@{}", a))
        .chain(
            task.subtasks
                .iter()
                .map(|s| format!("subtask:{}", s)),
        )
        .collect();

    UnifiedTask {
        id: task.id.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
        status: status.to_string(),
        provider: "yougile".to_string(),
        color: task.color.clone(),
        tags,
        due_date,
        priority: None,
        created_at: task
            .timestamp
            .and_then(|ts| {
                let secs = ts / 1000;
                let nanos = ((ts % 1000) * 1_000_000) as u32;
                chrono::DateTime::from_timestamp(secs, nanos)
                    .map(|dt| dt.to_rfc3339())
            })
            .unwrap_or_default(),
        updated_at: task
            .timestamp
            .and_then(|ts| {
                let secs = ts / 1000;
                let nanos = ((ts % 1000) * 1_000_000) as u32;
                chrono::DateTime::from_timestamp(secs, nanos)
                    .map(|dt| dt.to_rfc3339())
            })
            .unwrap_or_default(),
        column_id: task.column_id.clone(),
        url: Some(format!("https://yougile.com/#/task/{}", task.id)),
        subtask_ids: task.subtasks.clone(),
    }
}

fn create_to_yougile(input: &CreateUnifiedTask) -> crate::yougile::models::CreateYougileTask {
    let deadline = input.due_date.as_ref().and_then(|d| {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .ok()
            .and_then(|date| {
                date.and_hms_opt(0, 0, 0)
                    .map(|dt| dt.and_utc().timestamp_millis())
            })
            .map(|ts| crate::yougile::models::YougileDeadline {
                deadline: Some(ts),
                start_date: None,
                with_time: Some(false),
                history: Vec::new(),
                blocked_points: Vec::new(),
                links: Vec::new(),
                deleted: None,
                empty: None,
            })
    });

    crate::yougile::models::CreateYougileTask {
        title: input.title.clone(),
        raw_input: input.raw_input.clone(),
        column_id: input.column_id.clone().unwrap_or_default(),
        description: input.description.clone(),
        color: input.color.clone(),
        assigned: None,
        deadline,
        time_tracking: None,
        stickers: None,
        checklists: None,
        stopwatch: None,
        timer: None,
    }
}

// ── Provider implementation ──────────────────────────────────────────────────

#[async_trait]
impl<'a> TaskProvider for DbBoundYougileProvider<'a> {
    fn id(&self) -> &'static str {
        "yougile"
    }

    fn name(&self) -> &str {
        "Yougile"
    }

    fn connected(&self) -> bool {
        true
    }

    fn capabilities(&self) -> Vec<String> {
        vec![
            "crud".to_string(),
            "columns".to_string(),
            "assignees".to_string(),
            "chat".to_string(),
            "stickers".to_string(),
            "time_tracking".to_string(),
        ]
    }

    async fn list_tasks(
        &self,
        _filter: Option<TaskFilter>,
    ) -> Result<Vec<UnifiedTask>, ProviderError> {
        let client = self.client()?;

        // If we have a board_id, use get_board_tasks (parallel fetch)
        let tasks = if let Some(board_id) = &self.ctx.board_id {
            client.get_board_tasks(board_id).await
        } else {
            Err("No board selected. Use set_yougile_context to select a board.".to_string())
        }
        .map_err(|e| ProviderError::new(e, "yougile", "LIST_FAILED"))?;

        Ok(tasks
            .iter()
            .filter(|t| !t.deleted)
            .map(yougile_to_unified)
            .collect())
    }

    async fn get_task(&self, id: &str) -> Result<UnifiedTask, ProviderError> {
        let client = self.client()?;
        let task = client
            .get_task(id)
            .await
            .map_err(|e| ProviderError::new(e, "yougile", "GET_FAILED"))?;
        Ok(yougile_to_unified(&task))
    }

    async fn create_task(&self, input: CreateUnifiedTask) -> Result<UnifiedTask, ProviderError> {
        let client = self.client()?;
        let payload = create_to_yougile(&input);
        let task = client
            .create_task(&payload)
            .await
            .map_err(|e| ProviderError::new(e, "yougile", "CREATE_FAILED"))?;
        Ok(yougile_to_unified(&task))
    }

    async fn update_task(
        &self,
        id: &str,
        input: UpdateUnifiedTask,
    ) -> Result<UnifiedTask, ProviderError> {
        let client = self.client()?;

        let mut payload = crate::yougile::models::UpdateYougileTask::default();
        payload.title = input.title;
        payload.description = input.description;
        payload.color = input.color;
        payload.column_id = input.column_id;

        if let Some(status) = &input.status {
            match status.as_str() {
                "done" => payload.completed = Some(true),
                "archived" => payload.archived = Some(true),
                _ => {
                    payload.completed = Some(false);
                    payload.archived = Some(false);
                }
            }
        }

        let deadline = input.due_date.as_ref().and_then(|d| {
            chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .ok()
                .and_then(|date| {
                    date.and_hms_opt(0, 0, 0)
                        .map(|dt| dt.and_utc().timestamp_millis())
                })
                .map(|ts| crate::yougile::models::YougileDeadline {
                    deadline: Some(ts),
                    start_date: None,
                    with_time: Some(false),
                    history: Vec::new(),
                    blocked_points: Vec::new(),
                    links: Vec::new(),
                    deleted: None,
                    empty: None,
                })
        });
        if deadline.is_some() || input.due_date.is_some() {
            payload.deadline = deadline.or_else(|| {
                input.due_date.map(|_| crate::yougile::models::YougileDeadline {
                    deadline: None,
                    start_date: None,
                    with_time: None,
                    history: Vec::new(),
                    blocked_points: Vec::new(),
                    links: Vec::new(),
                    deleted: Some(true),
                    empty: None,
                })
            });
        }

        let task = client
            .update_task(id, &payload)
            .await
            .map_err(|e| ProviderError::new(e, "yougile", "UPDATE_FAILED"))?;
        Ok(yougile_to_unified(&task))
    }

    async fn delete_task(&self, id: &str) -> Result<(), ProviderError> {
        let client = self.client()?;
        client
            .delete_task(id)
            .await
            .map_err(|e| ProviderError::new(e, "yougile", "DELETE_FAILED"))
    }

    async fn sync(&self) -> Result<crate::provider::SyncResult, ProviderError> {
        let client = self.client()?;

        let tasks = if let Some(board_id) = &self.ctx.board_id {
            client.get_board_tasks(board_id).await
        } else {
            return Err(ProviderError::new(
                "No board selected for sync",
                "yougile",
                "NO_BOARD",
            ));
        }
        .map_err(|e| ProviderError::new(e, "yougile", "SYNC_FAILED"))?;

        // Return count of non-deleted tasks as sync result
        let active: Vec<_> = tasks.iter().filter(|t| !t.deleted).collect();
        Ok(crate::provider::SyncResult {
            tasks_added: 0,  // would need a diff against local cache
            tasks_updated: 0,
            tasks_removed: tasks.len() - active.len(),
        })
    }
}
