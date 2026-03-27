#![allow(dead_code)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthKeyResponse {
    pub key: String,
}

// ── Core entities ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileProject {
    pub id: String,
    pub title: String,
    pub color: Option<String>,
    pub users: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileBoard {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileColumn {
    pub id: String,
    pub title: String,
    pub board_id: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileUser {
    pub id: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

// ── Task sub-types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileChecklistItem {
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileChecklist {
    pub id: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub items: Vec<YougileChecklistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileDeadline {
    pub deadline: Option<i64>,
    pub start_date: Option<i64>,
    #[serde(default)]
    pub with_time: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTimeTracking {
    pub plan: Option<i64>,
    pub work: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileStopwatch {
    #[serde(default)]
    pub is_running: bool,
    pub start_time: Option<i64>,
    pub time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougileTimer {
    #[serde(default)]
    pub is_running: bool,
    pub start_time: Option<i64>,
    pub time: Option<i64>,
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
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub assigned: Vec<String>,
    #[serde(default)]
    pub subtasks: Vec<String>,
    pub checklists: Option<Vec<YougileChecklist>>,
    pub stickers: Option<HashMap<String, String>>,
    pub deadline: Option<YougileDeadline>,
    pub time_tracking: Option<YougileTimeTracking>,
    pub stopwatch: Option<YougileStopwatch>,
    pub timer: Option<YougileTimer>,
    pub created_by: Option<String>,
    pub timestamp: Option<i64>,
}

// ── API response wrapper ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YougilePaging {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub total: Option<i64>,
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
    pub checklists: Option<Vec<YougileChecklist>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub assigned: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<YougileDeadline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checklists: Option<Vec<YougileChecklist>>,
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
