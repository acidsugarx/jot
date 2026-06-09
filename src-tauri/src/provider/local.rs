use super::{
    normalize_local_status, CreateUnifiedTask, ProviderError, TaskFilter, TaskProvider,
    UnifiedTask, UpdateUnifiedTask,
};
use crate::db::{tasks, DatabaseState};
use crate::models::{self, Task, TaskPriority};
use async_trait::async_trait;

pub struct LocalProvider;

impl LocalProvider {
    pub fn new() -> Self {
        Self
    }
}

// ── Conversion helpers ───────────────────────────────────────────────────────

fn task_to_unified(task: &Task) -> UnifiedTask {
    UnifiedTask {
        id: task.id.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
        status: normalize_local_status(&task.status).to_string(),
        provider: "local".to_string(),
        color: task.color.clone(),
        tags: task.tags.clone(),
        due_date: task.due_date.clone(),
        priority: Some(task.priority.as_str().to_string()),
        created_at: task.created_at.clone(),
        updated_at: task.updated_at.clone(),
        column_id: None,
        url: None,
        subtask_ids: Vec::new(),
    }
}

fn create_to_model(input: &CreateUnifiedTask) -> models::CreateTaskInput {
    models::CreateTaskInput {
        title: Some(input.title.clone()),
        raw_input: input.raw_input.clone(),
        status: input.status.clone(),
        priority: input.priority.as_deref().and_then(TaskPriority::from_str),
        tags: input.tags.clone(),
        due_date: input.due_date.clone(),
        linked_note_path: None,
        parent_id: None,
        color: input.color.clone(),
    }
}

fn update_to_model(id: &str, input: &UpdateUnifiedTask) -> models::UpdateTaskInput {
    models::UpdateTaskInput {
        id: id.to_string(),
        title: input.title.clone(),
        description: input.description.clone().map(Some),
        status: input.status.clone(),
        priority: input.priority.as_deref().and_then(TaskPriority::from_str),
        tags: input.tags.clone(),
        due_date: input.due_date.clone().map(Some),
        color: input.color.clone().map(Some),
        time_estimated: None,
        time_spent: None,
    }
}

// ── Provider implementation ──────────────────────────────────────────────────

#[async_trait]
impl TaskProvider for LocalProvider {
    fn id(&self) -> &'static str {
        "local"
    }

    fn name(&self) -> &str {
        "Local Tasks"
    }

    fn connected(&self) -> bool {
        true
    }

    fn capabilities(&self) -> Vec<String> {
        vec![
            "crud".to_string(),
            "tags".to_string(),
            "priority".to_string(),
            "due_date".to_string(),
            "linked_notes".to_string(),
            "subtasks".to_string(),
        ]
    }

    async fn list_tasks(
        &self,
        _filter: Option<TaskFilter>,
    ) -> Result<Vec<UnifiedTask>, ProviderError> {
        // This provider does not hold a db handle; the caller must provide one.
        // Use DbBoundLocalProvider or call through db.with_connection() in the command handler.
        Err(ProviderError::new(
            "Use DbBoundLocalProvider instead — LocalProvider requires a database handle per call",
            "local",
            "NEEDS_DB",
        ))
    }

    async fn get_task(&self, _id: &str) -> Result<UnifiedTask, ProviderError> {
        Err(ProviderError::new(
            "Use DbBoundLocalProvider instead",
            "local",
            "NEEDS_DB",
        ))
    }

    async fn create_task(&self, _input: CreateUnifiedTask) -> Result<UnifiedTask, ProviderError> {
        Err(ProviderError::new(
            "Use DbBoundLocalProvider instead",
            "local",
            "NEEDS_DB",
        ))
    }

    async fn update_task(
        &self,
        _id: &str,
        _input: UpdateUnifiedTask,
    ) -> Result<UnifiedTask, ProviderError> {
        Err(ProviderError::new(
            "Use DbBoundLocalProvider instead",
            "local",
            "NEEDS_DB",
        ))
    }

    async fn delete_task(&self, _id: &str) -> Result<(), ProviderError> {
        Err(ProviderError::new(
            "Use DbBoundLocalProvider instead",
            "local",
            "NEEDS_DB",
        ))
    }

    async fn sync(&self) -> Result<crate::provider::SyncResult, ProviderError> {
        Ok(crate::provider::SyncResult {
            tasks_added: 0,
            tasks_updated: 0,
            tasks_removed: 0,
        })
    }
}

// ── Concrete provider bound to a DatabaseState reference ─────────────────────

/// A LocalProvider that actually works — takes a reference to DatabaseState
/// for each operation. Used inside Tauri command handlers.
pub struct DbBoundLocalProvider<'a> {
    db: &'a DatabaseState,
}

impl<'a> DbBoundLocalProvider<'a> {
    pub fn new(db: &'a DatabaseState) -> Self {
        Self { db }
    }
}

#[async_trait]
impl<'a> TaskProvider for DbBoundLocalProvider<'a> {
    fn id(&self) -> &'static str {
        "local"
    }

    fn name(&self) -> &str {
        "Local Tasks"
    }

    fn connected(&self) -> bool {
        true
    }

    fn capabilities(&self) -> Vec<String> {
        vec![
            "crud".to_string(),
            "tags".to_string(),
            "priority".to_string(),
            "due_date".to_string(),
            "linked_notes".to_string(),
            "subtasks".to_string(),
        ]
    }

    async fn list_tasks(
        &self,
        _filter: Option<TaskFilter>,
    ) -> Result<Vec<UnifiedTask>, ProviderError> {
        self.db
            .with_connection(|conn: &rusqlite::Connection| {
                tasks::list_tasks(conn).map(|task_list: Vec<models::Task>| {
                    task_list.iter().map(task_to_unified).collect()
                })
            })
            .map_err(|e| ProviderError::new(e, "local", "LIST_FAILED"))
    }

    async fn get_task(&self, id: &str) -> Result<UnifiedTask, ProviderError> {
        let id = id.to_string();
        self.db
            .with_connection(move |conn| {
                tasks::fetch_task(conn, &id)?
                    .map(|t| task_to_unified(&t))
                    .ok_or_else(|| format!("Task {id} not found"))
            })
            .map_err(|e| ProviderError::new(e, "local", "GET_FAILED"))
    }

    async fn create_task(&self, input: CreateUnifiedTask) -> Result<UnifiedTask, ProviderError> {
        let model = create_to_model(&input);
        // create_task_inner uses the raw_input + parser, so we call it via db
        self.db
            .with_connection(|conn| {
                // Replicate create_task logic inline since it's complex
                let raw_input = model
                    .raw_input
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty());
                let parsed_input = raw_input.map(crate::parser::parse_task_input);

                let title = model
                    .title
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string)
                    .or_else(|| parsed_input.as_ref().map(|v| v.title.clone()))
                    .filter(|v| !v.is_empty());

                let title = match title {
                    Some(t) => t,
                    None => return Err("Task title cannot be empty.".to_string()),
                };

                let task = models::Task {
                    id: uuid::Uuid::new_v4().to_string(),
                    title,
                    description: None,
                    status: model.status.unwrap_or_else(|| "todo".to_string()),
                    priority: model
                        .priority
                        .or_else(|| parsed_input.as_ref().and_then(|v| v.priority))
                        .unwrap_or(models::TaskPriority::None),
                    tags: model.tags.unwrap_or_else(|| {
                        parsed_input
                            .as_ref()
                            .map(|v| v.tags.clone())
                            .unwrap_or_default()
                    }),
                    due_date: model
                        .due_date
                        .or_else(|| parsed_input.as_ref().and_then(|v| v.due_date.clone())),
                    linked_note_path: None,
                    created_at: crate::db::utils::timestamp(),
                    updated_at: crate::db::utils::timestamp(),
                    parent_id: model.parent_id,
                    color: model.color,
                    time_estimated: None,
                    time_spent: None,
                };

                tasks::insert_task(conn, &task)?;
                Ok(task_to_unified(&task))
            })
            .map_err(|e| ProviderError::new(e, "local", "CREATE_FAILED"))
    }

    async fn update_task(
        &self,
        id: &str,
        input: UpdateUnifiedTask,
    ) -> Result<UnifiedTask, ProviderError> {
        let model = update_to_model(id, &input);
        self.db
            .with_connection(|conn| tasks::patch_task(conn, &model).map(|t| task_to_unified(&t)))
            .map_err(|e| ProviderError::new(e, "local", "UPDATE_FAILED"))
    }

    async fn delete_task(&self, id: &str) -> Result<(), ProviderError> {
        let id = id.to_string();
        self.db
            .with_connection(move |conn| tasks::remove_task(conn, &id))
            .map_err(|e| ProviderError::new(e, "local", "DELETE_FAILED"))
    }

    async fn sync(&self) -> Result<crate::provider::SyncResult, ProviderError> {
        Ok(crate::provider::SyncResult {
            tasks_added: 0,
            tasks_updated: 0,
            tasks_removed: 0,
        })
    }
}
