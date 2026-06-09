pub mod local;
pub mod sync;
pub mod yougile;

pub use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub use crate::provider::local::DbBoundLocalProvider;
pub use crate::provider::yougile::{DbBoundYougileProvider, YougileProviderContext};

// ── Error ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub message: String,
    pub provider: String,
    pub code: String,
}

impl ProviderError {
    pub fn new(message: impl Into<String>, provider: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            provider: provider.into(),
            code: code.into(),
        }
    }
}

impl From<String> for ProviderError {
    fn from(msg: String) -> Self {
        Self::new(msg, "unknown", "UNKNOWN")
    }
}

impl From<&str> for ProviderError {
    fn from(msg: &str) -> Self {
        Self::new(msg, "unknown", "UNKNOWN")
    }
}

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedTask {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    /// Normalized status: "todo", "in_progress", "done", "archived"
    pub status: String,
    /// Provider id, e.g. "local", "yougile"
    pub provider: String,
    pub color: Option<String>,
    pub tags: Vec<String>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Yougile column ID or derived from local status
    pub column_id: Option<String>,
    /// URL reference to the original task in the provider
    pub url: Option<String>,
    pub subtask_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUnifiedTask {
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub color: Option<String>,
    pub tags: Option<Vec<String>>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
    pub column_id: Option<String>,
    /// Raw input for NLP parsing (local provider)
    pub raw_input: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUnifiedTask {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub color: Option<String>,
    pub tags: Option<Vec<String>>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
    pub column_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    pub status: Option<Vec<String>>,
    pub column_id: Option<String>,
    pub search: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub tasks_added: usize,
    pub tasks_updated: usize,
    pub tasks_removed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub connected: bool,
    pub capabilities: Vec<String>,
}

// ── Provider Trait ───────────────────────────────────────────────────────────

/// Each provider implements this trait and registers with TaskEngine.
#[async_trait]
pub trait TaskProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &str;
    fn connected(&self) -> bool;
    fn capabilities(&self) -> Vec<String>;

    async fn list_tasks(
        &self,
        filter: Option<TaskFilter>,
    ) -> Result<Vec<UnifiedTask>, ProviderError>;
    async fn get_task(&self, id: &str) -> Result<UnifiedTask, ProviderError>;
    async fn create_task(&self, input: CreateUnifiedTask) -> Result<UnifiedTask, ProviderError>;
    async fn update_task(
        &self,
        id: &str,
        input: UpdateUnifiedTask,
    ) -> Result<UnifiedTask, ProviderError>;
    async fn delete_task(&self, id: &str) -> Result<(), ProviderError>;
    async fn sync(&self) -> Result<SyncResult, ProviderError>;
}

// ── Engine ───────────────────────────────────────────────────────────────────

pub struct TaskEngine {
    providers: Vec<Box<dyn TaskProvider>>,
}

impl TaskEngine {
    pub fn new() -> Self {
        Self {
            providers: Vec::new(),
        }
    }

    pub fn register(&mut self, provider: Box<dyn TaskProvider>) {
        self.providers.retain(|p| p.id() != provider.id());
        self.providers.push(provider);
    }

    pub fn get(&self, id: &str) -> Option<&dyn TaskProvider> {
        self.providers.iter().find(|p| p.id() == id).map(|p| p.as_ref())
    }

    pub fn list_providers(&self) -> Vec<ProviderInfo> {
        self.providers
            .iter()
            .map(|p| ProviderInfo {
                id: p.id().to_string(),
                name: p.name().to_string(),
                connected: p.connected(),
                capabilities: p.capabilities(),
            })
            .collect()
    }

    pub fn active_provider(&self, active_id: &str) -> Option<&dyn TaskProvider> {
        self.get(active_id).or_else(|| self.get("local"))
    }
}

impl Default for TaskEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ── Normalization helpers ────────────────────────────────────────────────────

/// Map a local status string to a normalised status
pub fn normalize_local_status(status: &str) -> &str {
    match status {
        "done" | "completed" => "done",
        "in_progress" | "in-progress" | "wip" => "in_progress",
        "archived" => "archived",
        _ => "todo",
    }
}

/// Map a Yougile task's completed/archived flags to a normalised status
pub fn yougile_status_to_unified(completed: bool, archived: bool) -> &'static str {
    if archived {
        "archived"
    } else if completed {
        "done"
    } else {
        "todo"
    }
}
