#![allow(dead_code)] // TODO: add #[allow(dead_code)] on individual unused items

use std::collections::HashMap;

use serde::{de::Deserializer, Deserialize, Serialize};
use serde_json::Value;

fn deserialize_nullable_bool<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<bool>::deserialize(deserializer)?.unwrap_or(false))
}

fn json_value_to_string(value: Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(value) => Some(value),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Array(value) => serde_json::to_string(&value).ok(),
        Value::Object(mut value) => {
            for key in ["id", "value", "title", "name"] {
                if let Some(candidate) = value.remove(key) {
                    if let Some(parsed) = json_value_to_string(candidate) {
                        return Some(parsed);
                    }
                }
            }
            serde_json::to_string(&Value::Object(value)).ok()
        }
    }
}

fn deserialize_flexible_string_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Vec<Value>>::deserialize(deserializer)?.unwrap_or_default();
    Ok(value.into_iter().filter_map(json_value_to_string).collect())
}

fn deserialize_optional_flexible_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(json_value_to_string))
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: String,
    #[serde(alias = "name")]
    pub title: String,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub is_admin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthKeyResponse {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WithIdResponse {
    pub id: String,
}

// ── Core entities ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileProject {
    pub id: String,
    pub title: String,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
    pub timestamp: Option<i64>,
    pub color: Option<String>,
    pub users: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileBoard {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileColumn {
    pub id: String,
    pub title: String,
    pub board_id: Option<String>,
    pub color: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileUser {
    pub id: String,
    pub email: Option<String>,
    #[serde(default)]
    pub real_name: Option<String>,
    #[serde(default)]
    pub is_admin: Option<bool>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub last_activity: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileStringStickerState {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileStringSticker {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
    #[serde(default)]
    pub states: Vec<YougileStringStickerState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileSprintStickerState {
    pub id: String,
    pub name: String,
    pub begin: Option<i64>,
    pub end: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileSprintSticker {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
    #[serde(default)]
    pub states: Vec<YougileSprintStickerState>,
}

// ── Task sub-types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileChecklistItem {
    pub id: Option<String>,
    pub title: String,
    #[serde(
        default,
        rename = "isCompleted",
        deserialize_with = "deserialize_nullable_bool"
    )]
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileChecklist {
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub items: Vec<YougileChecklistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileDeadline {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub with_time: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_flexible_string_vec")]
    pub history: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_flexible_string_vec")]
    pub blocked_points: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_flexible_string_vec")]
    pub links: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTimeTracking {
    pub plan: Option<f64>,
    pub work: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileStopwatch {
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub running: bool,
    #[serde(default, alias = "time")]
    pub seconds: i64,
    #[serde(default, alias = "timestamp")]
    pub at_moment: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTimer {
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub running: bool,
    #[serde(default)]
    pub seconds: i64,
    #[serde(default, alias = "timestamp")]
    pub since: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

// ── Core task entity ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTask {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub column_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub completed: bool,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub archived: bool,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
    #[serde(default, deserialize_with = "deserialize_flexible_string_vec")]
    pub assigned: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_flexible_string_vec")]
    pub subtasks: Vec<String>,
    pub checklists: Option<Vec<YougileChecklist>>,
    pub stickers: Option<HashMap<String, Value>>,
    pub deadline: Option<YougileDeadline>,
    pub time_tracking: Option<YougileTimeTracking>,
    pub stopwatch: Option<YougileStopwatch>,
    pub timer: Option<YougileTimer>,
    #[serde(default)]
    pub completed_timestamp: Option<i64>,
    #[serde(default)]
    pub archived_timestamp: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_flexible_string")]
    pub created_by: Option<String>,
    pub timestamp: Option<i64>,
}

// ── Chat messages ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: i64,
    pub from_user_id: String,
    pub text: String,
    #[serde(default)]
    pub text_html: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub edit_timestamp: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_nullable_bool")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatMessage {
    pub text: String,
    pub text_html: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageIdResponse {
    pub id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadResponse {
    pub result: String,
    pub url: String,
    pub full_url: String,
}

// ── API response wrapper ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougilePaging {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub count: Option<i64>,
    #[serde(default)]
    pub next: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileListResponse<T> {
    pub content: Vec<T>,
    pub paging: Option<YougilePaging>,
}

// ── Create / Update DTOs ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateYougileTask {
    pub title: String,
    #[serde(skip_serializing)]
    pub raw_input: Option<String>,
    pub column_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<YougileDeadline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_tracking: Option<YougileTimeTracking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checklists: Option<Vec<YougileChecklist>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopwatch: Option<YougileStopwatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timer: Option<YougileTimer>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateYougileTask {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtasks: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<YougileDeadline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_tracking: Option<YougileTimeTracking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stickers: Option<HashMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checklists: Option<Vec<YougileChecklist>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopwatch: Option<YougileStopwatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timer: Option<YougileTimer>,
}

// ── Local account record ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileAccount {
    pub id: String,
    pub email: String,
    pub company_id: String,
    pub company_name: String,
    pub api_key: String,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::{
        Company, UpdateYougileTask, YougileDeadline, YougileProject, YougileStopwatch, YougileTask,
    };

    #[test]
    fn company_name_alias_deserializes_into_title() {
        let company: Company = serde_json::from_value(serde_json::json!({
            "id": "company-1",
            "name": "Acme",
            "isAdmin": true
        }))
        .expect("company payload should deserialize");

        assert_eq!(company.id, "company-1");
        assert_eq!(company.title, "Acme");
        assert!(company.is_admin);
    }

    #[test]
    fn stopwatch_aliases_deserialize_from_example_payload() {
        let stopwatch: YougileStopwatch = serde_json::from_value(serde_json::json!({
            "running": true,
            "time": 200,
            "timestamp": 1653029146646i64
        }))
        .expect("stopwatch payload should deserialize");

        assert!(stopwatch.running);
        assert_eq!(stopwatch.seconds, 200);
        assert_eq!(stopwatch.at_moment, Some(1653029146646));
    }

    #[test]
    fn deadline_update_serializes_with_camel_case_arrays() {
        let payload = UpdateYougileTask {
            title: None,
            description: None,
            color: None,
            column_id: None,
            completed: None,
            archived: None,
            deleted: None,
            assigned: None,
            subtasks: None,
            deadline: Some(YougileDeadline {
                deadline: None,
                start_date: None,
                with_time: None,
                history: Vec::new(),
                blocked_points: Vec::new(),
                links: Vec::new(),
                deleted: Some(true),
                empty: None,
            }),
            time_tracking: None,
            stickers: None,
            checklists: None,
            stopwatch: None,
            timer: None,
        };

        let json = serde_json::to_value(payload).expect("payload should serialize");

        assert_eq!(json["deadline"]["deleted"], true);
        assert_eq!(json["deadline"]["blockedPoints"], serde_json::json!([]));
        assert_eq!(json["deadline"]["links"], serde_json::json!([]));
    }

    #[test]
    fn nullable_deleted_flags_deserialize_as_false() {
        let project: YougileProject = serde_json::from_value(serde_json::json!({
            "id": "project-1",
            "title": "Main",
            "deleted": null
        }))
        .expect("project payload should deserialize");

        let task: YougileTask = serde_json::from_value(serde_json::json!({
            "id": "task-1",
            "title": "Ship it",
            "completed": null,
            "archived": null,
            "deleted": null
        }))
        .expect("task payload should deserialize");

        assert!(!project.deleted);
        assert!(!task.completed);
        assert!(!task.archived);
        assert!(!task.deleted);
    }

    #[test]
    fn task_deserializes_flexible_relation_and_sticker_values() {
        let task: YougileTask = serde_json::from_value(serde_json::json!({
            "id": "task-1",
            "title": "Ship it",
            "timestamp": 1773391841717i64,
            "assigned": [
                "user-1",
                { "id": "user-2" }
            ],
            "subtasks": [
                { "id": "subtask-1" }
            ],
            "createdBy": { "id": "user-1" },
            "deadline": {
                "deadline": 1773398647150i64,
                "blockedPoints": [{ "id": "start" }],
                "links": [{ "id": "task-2" }]
            },
            "stickers": {
                "custom-sticker": {
                    "id": "state-1",
                    "title": "Ready"
                }
            }
        }))
        .expect("task payload should deserialize");

        assert_eq!(task.assigned, vec!["user-1", "user-2"]);
        assert_eq!(task.subtasks, vec!["subtask-1"]);
        assert_eq!(task.created_by.as_deref(), Some("user-1"));
        assert_eq!(
            task.deadline.expect("deadline should exist").links,
            vec!["task-2"]
        );
        assert!(matches!(
            task.stickers
                .expect("stickers should exist")
                .get("custom-sticker"),
            Some(serde_json::Value::Object(_))
        ));
    }
}
