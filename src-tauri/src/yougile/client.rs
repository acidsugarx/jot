use reqwest::{Client, StatusCode};
use super::models::*;

const BASE_URL: &str = "https://yougile.com/api-v2";

pub struct YougileClient {
    http: Client,
    api_key: String,
}

impl YougileClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http: Client::new(),
            api_key,
        }
    }

    // --- Auth (no key needed) ---

    pub async fn get_companies(login: &str, password: &str) -> Result<Vec<Company>, String> {
        let http = Client::new();
        let resp = http
            .post(format!("{BASE_URL}/auth/companies"))
            .json(&serde_json::json!({ "login": login, "password": password }))
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    pub async fn create_api_key(login: &str, password: &str, company_id: &str) -> Result<String, String> {
        let http = Client::new();
        let resp = http
            .post(format!("{BASE_URL}/auth/keys"))
            .json(&serde_json::json!({
                "login": login,
                "password": password,
                "companyId": company_id,
            }))
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        let key_resp: AuthKeyResponse = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        Ok(key_resp.key)
    }

    // --- Projects ---

    pub async fn get_projects(&self) -> Result<Vec<YougileProject>, String> {
        self.get_list("/projects").await
    }

    // --- Boards ---

    pub async fn get_boards(&self, project_id: &str) -> Result<Vec<YougileBoard>, String> {
        self.get_list_with_param("/boards", "projectId", project_id).await
    }

    // --- Columns ---

    pub async fn get_columns(&self, board_id: &str) -> Result<Vec<YougileColumn>, String> {
        self.get_list_with_param("/columns", "boardId", board_id).await
    }

    // --- Tasks ---

    pub async fn get_tasks(&self, column_id: &str) -> Result<Vec<YougileTask>, String> {
        self.get_list_with_param("/tasks", "columnId", column_id).await
    }

    pub async fn get_task(&self, task_id: &str) -> Result<YougileTask, String> {
        self.get(&format!("/tasks/{task_id}")).await
    }

    pub async fn create_task(&self, payload: &CreateYougileTask) -> Result<YougileTask, String> {
        self.post("/tasks", payload).await
    }

    pub async fn update_task(&self, task_id: &str, payload: &UpdateYougileTask) -> Result<YougileTask, String> {
        self.put(&format!("/tasks/{task_id}"), payload).await
    }

    pub async fn delete_task(&self, task_id: &str) -> Result<(), String> {
        let payload = UpdateYougileTask {
            deleted: Some(true),
            title: None,
            description: None,
            column_id: None,
            completed: None,
            archived: None,
            assigned: None,
            deadline: None,
            time_tracking: None,
            stickers: None,
            color: None,
            checklists: None,
        };
        self.put::<_, serde_json::Value>(&format!("/tasks/{task_id}"), &payload).await?;
        Ok(())
    }

    pub async fn move_task(&self, task_id: &str, column_id: &str) -> Result<YougileTask, String> {
        let payload = UpdateYougileTask {
            column_id: Some(column_id.to_string()),
            title: None,
            description: None,
            completed: None,
            archived: None,
            deleted: None,
            assigned: None,
            deadline: None,
            time_tracking: None,
            stickers: None,
            color: None,
            checklists: None,
        };
        self.put(&format!("/tasks/{task_id}"), &payload).await
    }

    // --- Users ---

    pub async fn get_users(&self, project_id: &str) -> Result<Vec<YougileUser>, String> {
        self.get_list_with_param("/users", "projectId", project_id).await
    }

    // --- Chat Subscribers ---

    pub async fn get_task_chat_subscribers(&self, task_id: &str) -> Result<Vec<String>, String> {
        let resp = self
            .authed_request(reqwest::Method::GET, &format!("/tasks/{task_id}/chat-subscribers"))
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        let body: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        Ok(body
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default())
    }

    // --- Generic Helpers ---

    async fn get_list<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<Vec<T>, String> {
        let mut all = Vec::new();
        let mut offset = 0;
        let limit: i64 = 100;
        loop {
            let resp = self
                .authed_request(reqwest::Method::GET, path)
                .query(&[("limit", limit.to_string()), ("offset", offset.to_string())])
                .send()
                .await
                .map_err(|e| format!("Network error: {e}"))?;
            Self::check_status(&resp)?;
            let page: YougileListResponse<T> = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
            let count = page.content.len();
            all.extend(page.content);
            if count < limit as usize {
                break;
            }
            offset += limit;
        }
        Ok(all)
    }

    async fn get_list_with_param<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        param_name: &str,
        param_value: &str,
    ) -> Result<Vec<T>, String> {
        let mut all = Vec::new();
        let mut offset = 0;
        let limit: i64 = 100;
        loop {
            let resp = self
                .authed_request(reqwest::Method::GET, path)
                .query(&[
                    (param_name, param_value.to_string()),
                    ("limit", limit.to_string()),
                    ("offset", offset.to_string()),
                ])
                .send()
                .await
                .map_err(|e| format!("Network error: {e}"))?;
            Self::check_status(&resp)?;
            let page: YougileListResponse<T> = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
            let count = page.content.len();
            all.extend(page.content);
            if count < limit as usize {
                break;
            }
            offset += limit;
        }
        Ok(all)
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self
            .authed_request(reqwest::Method::GET, path)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    async fn post<B: serde::Serialize, T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, String> {
        let resp = self
            .authed_request(reqwest::Method::POST, path)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    async fn put<B: serde::Serialize, T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, String> {
        let resp = self
            .authed_request(reqwest::Method::PUT, path)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        Self::check_status(&resp)?;
        resp.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    fn authed_request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{BASE_URL}{path}"))
            .bearer_auth(&self.api_key)
    }

    fn check_status(resp: &reqwest::Response) -> Result<(), String> {
        match resp.status() {
            s if s.is_success() => Ok(()),
            StatusCode::UNAUTHORIZED => Err(
                "Unauthorized — API key may be invalid or revoked. Re-authenticate in Settings."
                    .to_string(),
            ),
            StatusCode::FORBIDDEN => {
                Err("Forbidden — insufficient permissions for this action.".to_string())
            }
            StatusCode::NOT_FOUND => {
                Err("Not found — the resource may have been deleted.".to_string())
            }
            StatusCode::TOO_MANY_REQUESTS => {
                Err("Rate limited by Yougile — try again in a moment.".to_string())
            }
            s => Err(format!("Yougile API error: {s}")),
        }
    }
}
