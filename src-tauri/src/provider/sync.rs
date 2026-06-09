use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::collections::HashMap;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::db::DatabaseState;
use crate::yougile;

// ── Event payloads ────────────────────────────────────────────────────────────

/// Emitted when the sync engine has new task data.
/// Payload is raw JSON matching the Yougile API shape (YougileTask[]).
pub const EVENT_PROVIDER_TASKS_UPDATED: &str = "provider-tasks-updated";

/// Emitted when sync state changes (started / stopped / errored).
pub const EVENT_PROVIDER_SYNC_STATE: &str = "provider-sync-state";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSyncStatePayload {
    pub provider: String,
    pub running: bool,
    pub error: Option<String>,
}

// ── Sync handle ───────────────────────────────────────────────────────────────

/// A handle that can stop a running sync loop.
struct SyncHandle {
    stop: Arc<AtomicBool>,
}

impl SyncHandle {
    fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

// ── Sync Manager ──────────────────────────────────────────────────────────────

/// Manages active sync loops by provider_id.
/// Registered as Tauri managed state.
pub struct SyncManager {
    active: Mutex<HashMap<String, SyncHandle>>,
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
        }
    }

    /// Start a Yougile sync loop. Stops any existing sync for the same provider.
    pub async fn start_yougile(
        &self,
        app: AppHandle,
        account_id: String,
        board_id: String,
        interval_ms: u64,
    ) {
        self.stop("yougile").await;

        let stop = Arc::new(AtomicBool::new(false));
        let handle = SyncHandle { stop: stop.clone() };
        self.active
            .lock()
            .await
            .insert("yougile".to_string(), handle);

        let provider_id = "yougile".to_string();

        tokio::spawn(async move {
            log::info!(
                "Starting sync loop for {provider_id} (board={board_id}, every {interval_ms}ms)"
            );

            let _ = app.emit(
                EVENT_PROVIDER_SYNC_STATE,
                ProviderSyncStatePayload {
                    provider: provider_id.clone(),
                    running: true,
                    error: None,
                },
            );

            // Initial fetch immediately
            Self::poll_yougile(&app, &account_id, &board_id, &provider_id).await;

            while !stop.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(interval_ms)).await;
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                Self::poll_yougile(&app, &account_id, &board_id, &provider_id).await;
            }

            log::info!("Sync loop stopped for {provider_id}");
            let _ = app.emit(
                EVENT_PROVIDER_SYNC_STATE,
                ProviderSyncStatePayload {
                    provider: provider_id,
                    running: false,
                    error: None,
                },
            );
        });
    }

    /// Stop a running sync loop.
    pub async fn stop(&self, provider_id: &str) {
        if let Some(handle) = self.active.lock().await.remove(provider_id) {
            handle.stop();
        }
    }

    /// Check if a sync loop is running.
    pub async fn is_running(&self, provider_id: &str) -> bool {
        self.active.lock().await.contains_key(provider_id)
    }

    /// Stop all active sync loops.
    pub async fn stop_all(&self) {
        let mut active = self.active.lock().await;
        for (_, handle) in active.drain() {
            handle.stop();
        }
    }

    async fn poll_yougile(
        app: &AppHandle,
        account_id: &str,
        board_id: &str,
        provider_id: &str,
    ) {
        let db = app.state::<DatabaseState>();
        let client = match yougile::auth::client_for_account(&db, account_id) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("{provider_id} sync: auth error: {e}");
                let _ = app.emit(
                    EVENT_PROVIDER_SYNC_STATE,
                    ProviderSyncStatePayload {
                        provider: provider_id.to_string(),
                        running: true,
                        error: Some(e),
                    },
                );
                return;
            }
        };

        // We use the raw YougileClient to fetch tasks in native format.
        // This avoids the TaskProvider abstraction for now — Phase 3
        // will unify types and switch to the provider pattern.
        let tasks: Vec<yougile::models::YougileTask> =
            match crate::yougile::commands::fetch_board_tasks_inner(&client, board_id).await {
                Ok(t) => t,
                Err(e) => {
                    log::warn!("{provider_id} sync: fetch error: {e}");
                    let _ = app.emit(
                        EVENT_PROVIDER_SYNC_STATE,
                        ProviderSyncStatePayload {
                            provider: provider_id.to_string(),
                            running: true,
                            error: Some(e),
                        },
                    );
                    return;
                }
            };

        // Emit raw JSON — frontend expects YougileTask[] shape
        let payload = serde_json::json!({
            "provider": provider_id,
            "tasks": tasks,
        });
        let _ = app.emit(EVENT_PROVIDER_TASKS_UPDATED, payload);
    }
}

impl Default for SyncManager {
    fn default() -> Self {
        Self::new()
    }
}
