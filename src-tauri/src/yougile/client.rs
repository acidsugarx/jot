use super::models::*;
use reqwest::{Client, StatusCode};

const BASE_URL: &str = "https://yougile.com/api-v2";

#[derive(Clone)]
pub struct YougileClient {
    http: Client,
    api_key: String,
}

impl YougileClient {
    pub fn new(api_key: String) -> Self {
        let http = match Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                log::warn!("Failed to build reqwest client with timeout; falling back to default client: {error}");
                Client::new()
            }
        };
        Self { http, api_key }
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
        let resp = Self::check_status(resp).await?;
        let list: YougileListResponse<Company> = Self::parse_json(resp).await?;
        Ok(list.content)
    }

    pub async fn create_api_key(
        login: &str,
        password: &str,
        company_id: &str,
    ) -> Result<String, String> {
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
        let resp = Self::check_status(resp).await?;
        let key_resp: AuthKeyResponse = Self::parse_json(resp).await?;
        Ok(key_resp.key)
    }

    // --- Projects ---

    pub async fn get_projects(&self) -> Result<Vec<YougileProject>, String> {
        self.get_list("/projects").await
    }

    // --- Boards ---

    pub async fn get_boards(&self, project_id: &str) -> Result<Vec<YougileBoard>, String> {
        self.get_list_with_param("/boards", "projectId", project_id)
            .await
    }

    // --- Columns ---

    pub async fn get_columns(&self, board_id: &str) -> Result<Vec<YougileColumn>, String> {
        self.get_list_with_param("/columns", "boardId", board_id)
            .await
    }

    // --- Tasks ---

    pub async fn get_tasks(&self, column_id: &str) -> Result<Vec<YougileTask>, String> {
        self.get_list_with_param("/task-list", "columnId", column_id)
            .await
    }

    pub async fn get_task(&self, task_id: &str) -> Result<YougileTask, String> {
        self.get(&format!("/tasks/{task_id}")).await
    }

    pub async fn create_task(&self, payload: &CreateYougileTask) -> Result<YougileTask, String> {
        let created: WithIdResponse = self.post("/tasks", payload).await?;
        self.get_task(&created.id).await
    }

    pub async fn update_task(
        &self,
        task_id: &str,
        payload: &UpdateYougileTask,
    ) -> Result<YougileTask, String> {
        let updated: WithIdResponse = self.put(&format!("/tasks/{task_id}"), payload).await?;
        self.get_task(&updated.id).await
    }

    pub async fn delete_task(&self, task_id: &str) -> Result<(), String> {
        let payload = UpdateYougileTask {
            deleted: Some(true),
            ..Default::default()
        };
        self.put::<_, WithIdResponse>(&format!("/tasks/{task_id}"), &payload)
            .await?;
        Ok(())
    }

    /// Fetch all tasks across all (non-deleted) columns of a board in parallel.
    /// Eliminates the N+1 problem when loading an entire board.
    pub async fn get_board_tasks(&self, board_id: &str) -> Result<Vec<YougileTask>, String> {
        let columns = self.get_columns(board_id).await?;
        let active_columns: Vec<_> = columns.into_iter().filter(|c| !c.deleted).collect();

        let mut join_set = tokio::task::JoinSet::new();
        for col in &active_columns {
            let col_id = col.id.clone();
            let client = self.clone();
            join_set.spawn(async move { client.get_tasks(&col_id).await });
        }

        let mut all_tasks = Vec::new();
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(tasks)) => all_tasks.extend(tasks),
                Ok(Err(e)) => return Err(e),
                Err(e) => return Err(format!("Task join error: {e}")),
            }
        }
        Ok(all_tasks)
    }

    pub async fn move_task(&self, task_id: &str, column_id: &str) -> Result<YougileTask, String> {
        let payload = UpdateYougileTask {
            column_id: Some(column_id.to_string()),
            ..Default::default()
        };
        self.update_task(task_id, &payload).await
    }

    // --- Users ---

    pub async fn get_users(&self, project_id: &str) -> Result<Vec<YougileUser>, String> {
        self.get_list_with_param("/users", "projectId", project_id)
            .await
    }

    pub async fn get_all_users(&self) -> Result<Vec<YougileUser>, String> {
        self.get_list("/users").await
    }

    // --- Stickers ---

    pub async fn get_string_stickers(
        &self,
        board_id: &str,
    ) -> Result<Vec<YougileStringSticker>, String> {
        self.get_list_with_param("/string-stickers", "boardId", board_id)
            .await
    }

    pub async fn get_sprint_stickers(
        &self,
        board_id: &str,
    ) -> Result<Vec<YougileSprintSticker>, String> {
        self.get_list_with_param("/sprint-stickers", "boardId", board_id)
            .await
    }

    // --- Chat Messages ---

    pub async fn get_chat_messages(
        &self,
        chat_id: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<ChatMessage>, String> {
        let limit = limit.unwrap_or(50).clamp(1, 1000);
        let requested_offset = offset.unwrap_or(0);
        let first_page = self
            .get_chat_messages_page(chat_id, limit, requested_offset)
            .await?;

        if offset.is_some() {
            return Ok(first_page.content);
        }

        let appears_descending = first_page
            .content
            .first()
            .zip(first_page.content.last())
            .map(|(first, last)| first.id > last.id)
            .unwrap_or(false);

        let total_count = first_page
            .paging
            .as_ref()
            .and_then(|paging| paging.count)
            .unwrap_or(first_page.content.len() as i64);

        if appears_descending || total_count <= limit {
            return Ok(first_page.content);
        }

        let last_offset = (total_count - limit).max(0);
        if last_offset == requested_offset {
            return Ok(first_page.content);
        }

        let last_page = self
            .get_chat_messages_page(chat_id, limit, last_offset)
            .await?;
        Ok(last_page.content)
    }

    async fn get_chat_messages_page(
        &self,
        chat_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<YougileListResponse<ChatMessage>, String> {
        let resp = self
            .authed_request(reqwest::Method::GET, &format!("/chats/{chat_id}/messages"))
            .query(&[("limit", limit.to_string()), ("offset", offset.to_string())])
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    pub async fn send_chat_message(
        &self,
        chat_id: &str,
        payload: &CreateChatMessage,
    ) -> Result<ChatMessageIdResponse, String> {
        self.post(&format!("/chats/{chat_id}/messages"), payload)
            .await
    }

    // --- File Upload ---

    pub async fn upload_file(
        &self,
        file_name: String,
        file_bytes: Vec<u8>,
        mime_type: String,
    ) -> Result<FileUploadResponse, String> {
        let part = reqwest::multipart::Part::bytes(file_bytes)
            .file_name(file_name)
            .mime_str(&mime_type)
            .map_err(|e| format!("Invalid MIME type: {e}"))?;
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = self
            .http
            .post(format!("{BASE_URL}/upload-file"))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    // --- File Download ---

    pub async fn download_file(url: &str) -> Result<Vec<u8>, String> {
        // Validate URL: must be HTTPS and point to yougile.com
        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid download URL: {e}"))?;
        match parsed.scheme() {
            "https" => {}
            _ => return Err("Download URL must use HTTPS".to_string()),
        }
        let host = parsed.host_str().unwrap_or("");
        if !host.ends_with("yougile.com") {
            return Err("Download URL must point to yougile.com domain".to_string());
        }

        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
        let resp = http
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Download failed with status {}", resp.status()));
        }
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Failed to read response body: {e}"))
    }

    // --- Chat Subscribers ---

    #[allow(dead_code)]
    pub async fn get_task_chat_subscribers(&self, task_id: &str) -> Result<Vec<String>, String> {
        let resp = self
            .authed_request(
                reqwest::Method::GET,
                &format!("/tasks/{task_id}/chat-subscribers"),
            )
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        let resp = Self::check_status(resp).await?;
        let body: serde_json::Value = Self::parse_json(resp).await?;
        Ok(body
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default())
    }

    // --- Generic Helpers ---

    async fn get_list<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<Vec<T>, String> {
        self.get_list_with_params(path, &[]).await
    }

    async fn get_list_with_param<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        param_name: &str,
        param_value: &str,
    ) -> Result<Vec<T>, String> {
        self.get_list_with_params(path, &[(param_name, param_value)])
            .await
    }

    async fn get_list_with_params<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        extra_params: &[(&str, &str)],
    ) -> Result<Vec<T>, String> {
        let mut all = Vec::new();
        let mut offset = 0;
        let limit: i64 = 100;
        loop {
            let mut query: Vec<(String, String)> = extra_params
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                .collect();
            query.push(("limit".to_string(), limit.to_string()));
            query.push(("offset".to_string(), offset.to_string()));

            let resp = self
                .authed_request(reqwest::Method::GET, path)
                .query(&query)
                .send()
                .await
                .map_err(|e| format!("Network error: {e}"))?;
            let resp = Self::check_status(resp).await?;
            let page: YougileListResponse<T> = Self::parse_json(resp).await?;
            let count = page.content.len();
            all.extend(page.content);
            let has_next = page
                .paging
                .as_ref()
                .and_then(|paging| paging.next)
                .unwrap_or(count >= limit as usize);
            if !has_next || count == 0 {
                break;
            }
            offset += limit;
        }
        Ok(all)
    }

    #[allow(dead_code)]
    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self
            .authed_request(reqwest::Method::GET, path)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
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
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
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
        let resp = Self::check_status(resp).await?;
        Self::parse_json(resp).await
    }

    fn authed_request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{BASE_URL}{path}"))
            .bearer_auth(&self.api_key)
    }

    async fn check_status(resp: reqwest::Response) -> Result<reqwest::Response, String> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }

        let body = resp
            .text()
            .await
            .map(|text| Self::summarize_body(&text))
            .unwrap_or_else(|_| "<failed to read response body>".to_string());
        let suffix = if body.is_empty() {
            String::new()
        } else {
            format!(" Response body: {body}")
        };

        match status {
            StatusCode::UNAUTHORIZED => Err(format!(
                "Unauthorized — API key may be invalid or revoked. Re-authenticate in Settings.{suffix}"
            )),
            StatusCode::FORBIDDEN => Err(format!(
                "Forbidden — insufficient permissions for this action.{suffix}"
            )),
            StatusCode::NOT_FOUND => Err(format!(
                "Not found — the resource may have been deleted.{suffix}"
            )),
            StatusCode::TOO_MANY_REQUESTS => {
                Err(format!("Rate limited by Yougile — try again in a moment.{suffix}"))
            }
            s => Err(format!("Yougile API error: {s}.{suffix}")),
        }
    }

    async fn parse_json<T: serde::de::DeserializeOwned>(
        resp: reqwest::Response,
    ) -> Result<T, String> {
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {e}"))?;

        serde_json::from_str(&text).map_err(|e| {
            format!(
                "Parse error: {e}. Response body: {}",
                Self::summarize_body(&text)
            )
        })
    }

    fn summarize_body(body: &str) -> String {
        const LIMIT: usize = 400;
        let trimmed = body.trim();
        let mut chars = trimmed.chars();
        let summary: String = chars.by_ref().take(LIMIT).collect();
        if chars.next().is_none() {
            summary
        } else {
            format!("{summary}...")
        }
    }
}
