# Performance & Lint Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical, important, and suggestion-level issues from the full codebase review — security, performance, lints, and code health across Rust backend and TypeScript frontend.

**Architecture:** Security fixes first (path traversal, SSRF, XSS), then stability (async IO, timeouts, listener leaks), then performance (store selectors, memoization), then code health (deduplication, file splits, dead code cleanup).

**Tech Stack:** Rust (Tauri, reqwest, rusqlite, tokio), TypeScript/React (Zustand, Tauri API), DOMPurify (new dependency)

---

### Task 1: Security — Validate download URL and save path (C4, C5)

**Files:**
- Modify: `src-tauri/src/yougile/commands.rs:178-184`
- Modify: `src-tauri/src/yougile/client.rs:298-315`

- [ ] **Step 1: Add URL validation to `download_file` in client.rs**

Replace the `download_file` static method to validate scheme and domain:

```rust
pub async fn download_file(url: &str) -> Result<Vec<u8>, String> {
    // Validate URL: must be HTTPS and a known Yougile domain
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "https" => {}
        other => return Err(format!("Unsupported URL scheme: {other}")),
    }
    let host = parsed.host_str().unwrap_or("");
    if !host.ends_with("yougile.com") {
        return Err(format!("Download restricted to yougile.com, got: {host}"));
    }

    let http = Client::new();
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
```

- [ ] **Step 2: Add path validation to `yougile_download_file` command**

Replace the command in `commands.rs`:

```rust
#[tauri::command]
pub async fn yougile_download_file(url: String, save_path: String) -> Result<(), String> {
    // Validate save_path: reject path traversal
    let path = std::path::Path::new(&save_path);
    let canonical_parent = path
        .parent()
        .ok_or_else(|| "Invalid save path: no parent directory".to_string())?
        .canonicalize()
        .map_err(|e| format!("Invalid save path: {e}"))?;
    if save_path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    let final_path = canonical_parent.join(
        path.file_name()
            .ok_or_else(|| "Invalid save path: no file name".to_string())?,
    );

    let bytes = super::client::YougileClient::download_file(&url).await?;
    tokio::fs::write(&final_path, &bytes)
        .await
        .map_err(|e| format!("Failed to write file to '{}': {e}", final_path.display()))
}
```

- [ ] **Step 3: Add `fs` feature to tokio in Cargo.toml**

Change:
```toml
tokio = { version = "1", features = ["macros"] }
```
To:
```toml
tokio = { version = "1", features = ["macros", "fs"] }
```

- [ ] **Step 4: Run `cargo check` and `cargo test`**

Run: `cd src-tauri && cargo check && cargo test`
Expected: All pass, no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/yougile/commands.rs src-tauri/src/yougile/client.rs src-tauri/Cargo.toml
git commit -m "security: validate download URL domain and save path against traversal"
```

---

### Task 2: Security — Sanitize HTML in frontend (C6)

**Files:**
- Modify: `package.json` (add dompurify)
- Create: `src/lib/sanitize.ts`
- Modify: `src/components/YougileTaskEditor.tsx:1054-1067`
- Modify: `src/components/TaskEditorPane.tsx:427-433`
- Modify: `src/components/HighlightedInput.tsx:20-53`

- [ ] **Step 1: Install DOMPurify**

Run: `npm install dompurify && npm install -D @types/dompurify`

- [ ] **Step 2: Create sanitize utility**

Create `src/lib/sanitize.ts`:

```typescript
import DOMPurify from 'dompurify';

const purify = DOMPurify(window);

// Allow images, links, basic formatting — strip scripts/events
purify.setConfig({
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'em', 'strong', 'a', 'img', 'ul', 'ol', 'li',
    'code', 'pre', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'target', 'rel', 'class', 'style',
    'width', 'height',
  ],
  ALLOW_DATA_ATTR: false,
});

export function sanitizeHtml(dirty: string): string {
  return purify.sanitize(dirty);
}
```

- [ ] **Step 3: Sanitize chat HTML in YougileTaskEditor.tsx**

Add import at top of `YougileTaskEditor.tsx`:
```typescript
import { sanitizeHtml } from '@/lib/sanitize';
```

Find the line where `html` is set after `normalizeChatHtml`:
```typescript
html = normalizeChatHtml(html);
```
Change to:
```typescript
html = sanitizeHtml(normalizeChatHtml(html));
```

- [ ] **Step 4: Fix `inlineFormat` in TaskEditorPane.tsx to reject javascript: URLs**

Replace the link regex in `inlineFormat`:
```typescript
function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\(((https?:\/\/)[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
```

The key change: `(.+?)` → `((https?:\/\/)[^\)]+)` for the URL part — only allows `http://` and `https://` URLs.

- [ ] **Step 5: HTML-escape value in HighlightedInput before regex**

In `HighlightedInput.tsx`, at the start of `highlightedHTML` useMemo, escape the value:

```typescript
const highlightedHTML = useMemo(() => {
  if (!value) {
    return `<span class="text-mist/26">${placeholder}</span>`;
  }

  // Escape HTML entities before applying highlight regexes
  let html = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Highlight tags (#tag)
  html = html.replace(/(^|\s)(#[\w-]+)/g, '$1<span class="text-cyan/80 font-mono">$2</span>');
  // ... rest unchanged
```

- [ ] **Step 6: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sanitize.ts src/components/YougileTaskEditor.tsx src/components/TaskEditorPane.tsx src/components/HighlightedInput.tsx package.json package-lock.json
git commit -m "security: sanitize all dangerouslySetInnerHTML with DOMPurify, reject javascript: URLs"
```

---

### Task 3: Security — Sanitize `open_linked_note` path (I6)

**Files:**
- Modify: `src-tauri/src/db.rs:474-506`

- [ ] **Step 1: Add path canonicalization and validation**

Replace the `open_linked_note` function:

```rust
#[tauri::command]
pub fn open_linked_note(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Linked note path cannot be empty.".to_string());
    }

    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Linked note does not exist: {path}"));
    }

    // Canonicalize to resolve symlinks and reject traversal
    let canonical = path_buf
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e}"))?;

    // Ensure it's a file, not a directory
    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }

    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| "Path contains invalid UTF-8".to_string())?;

    let status = if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(canonical_str)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    } else if cfg!(target_os = "windows") {
        Command::new("explorer")
            .arg(canonical_str)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    } else {
        Command::new("xdg-open")
            .arg(canonical_str)
            .status()
            .map_err(|error| format!("Failed to open linked note: {error}"))?
    };

    if !status.success() {
        return Err(format!("Opening linked note failed with status: {status}"));
    }

    Ok(())
}
```

Key changes: canonicalize path, check `is_file()`, use `explorer` instead of `cmd /C start` on Windows.

- [ ] **Step 2: Run `cargo check && cargo test`**

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "security: canonicalize path and use explorer on Windows in open_linked_note"
```

---

### Task 4: Stability — Async file I/O and HTTP timeouts (C1, C2)

**Files:**
- Modify: `src-tauri/src/yougile/commands.rs:157-174` (upload_file_path)
- Modify: `src-tauri/src/yougile/client.rs:12-16` (constructor + static methods)

- [ ] **Step 1: Use `tokio::fs::read` in `yougile_upload_file_path`**

Replace the blocking read in `yougile_upload_file_path`:

```rust
#[tauri::command]
pub async fn yougile_upload_file_path(
    account_id: String,
    file_path: String,
    state: State<'_, DatabaseState>,
) -> Result<FileUploadResponse, String> {
    let client = auth::client_for_account(&state, &account_id)?;
    let path = std::path::Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file path: {file_path}"))?
        .to_string();
    let file_bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("Failed to read file at '{file_path}': {error}"))?;
    let mime_type = mime_type_from_file_name(&file_name);

    client.upload_file(file_name, file_bytes, mime_type).await
}
```

- [ ] **Step 2: Add 30-second timeout to all HTTP clients in `client.rs`**

Add at top of file:
```rust
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
```

Update `YougileClient::new`:
```rust
pub fn new(api_key: String) -> Self {
    Self {
        http: Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("Failed to build HTTP client"),
        api_key,
    }
}
```

Update `get_companies`:
```rust
let http = Client::builder()
    .timeout(HTTP_TIMEOUT)
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
```

Update `create_api_key`:
```rust
let http = Client::builder()
    .timeout(HTTP_TIMEOUT)
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
```

Update `download_file`:
```rust
let http = Client::builder()
    .timeout(HTTP_TIMEOUT)
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
```

- [ ] **Step 3: Run `cargo check && cargo test`**

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/yougile/commands.rs src-tauri/src/yougile/client.rs
git commit -m "fix: use async file I/O and add 30s HTTP timeout to all requests"
```

---

### Task 5: Stability — Fix listener leak in main.tsx (C7)

**Files:**
- Modify: `src/main.tsx:24-29`

- [ ] **Step 1: Store and clean up listener return values**

Replace lines 24-29:

```typescript
// Only init Yougile sync for windows that need it (not settings)
if (label !== 'settings') {
  void useYougileStore.getState().hydrateSyncState();
  const unlistenSync = useYougileStore.getState().listenForSyncUpdates();
  const unlistenTasks = useYougileStore.getState().listenForTaskUpdates();

  // Clean up on HMR (Vite dev server)
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unlistenSync();
      unlistenTasks();
    });
  }
}
```

- [ ] **Step 2: Add `.catch()` to listener promise chains in `use-yougile-store.ts`**

In `listenForSyncUpdates` (line 750):
```typescript
return () => {
  unlisten.then((fn) => fn()).catch(() => {});
};
```

In `listenForTaskUpdates` (line 777):
```typescript
return () => {
  unlisten.then((fn) => fn()).catch(() => {});
};
```

- [ ] **Step 3: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx src/store/use-yougile-store.ts
git commit -m "fix: clean up Tauri event listeners on HMR, add .catch() to unlisten promises"
```

---

### Task 6: Performance — Zustand store selectors (I10)

**Files:**
- Modify: `src/Dashboard.tsx:116-129`
- Modify: `src/components/KanbanTaskCard.tsx:29-38`
- Modify: `src/components/SourceSwitcher.tsx:6-18`

- [ ] **Step 1: Fix Dashboard.tsx — use individual selectors**

Replace lines 116-129:

```typescript
const yougileEnabled = useYougileStore((s) => s.yougileEnabled);
const yougileActiveSource = useYougileStore((s) => s.activeSource);
const yougileContext = useYougileStore((s) => s.yougileContext);
const yougileColumns = useYougileStore((s) => s.columns);
const yougileTasks = useYougileStore((s) => s.tasks);
const yougileError = useYougileStore((s) => s.error);
const setYougileEnabled = useYougileStore((s) => s.setYougileEnabled);
const hydrateYougileSyncState = useYougileStore((s) => s.hydrateSyncState);
const fetchYougileProjects = useYougileStore((s) => s.fetchProjects);
const fetchYougileBoards = useYougileStore((s) => s.fetchBoards);
const fetchYougileUsers = useYougileStore((s) => s.fetchUsers);
const fetchYougileColumns = useYougileStore((s) => s.fetchColumns);
const fetchYougileTasks = useYougileStore((s) => s.fetchTasks);
const fetchYougileAccounts = useYougileStore((s) => s.fetchAccounts);
const clearYougileError = useYougileStore((s) => s.clearError);

const yougileAccountId = yougileContext.accountId;
const yougileProjectId = yougileContext.projectId;
const isYougile = yougileEnabled && yougileActiveSource === 'yougile';

const yougileVisibleTasks = useMemo(
  () => yougileTasks.filter((task) => !task.deleted && !task.archived),
  [yougileTasks]
);
```

Then update all references from `yougileStore.xxx` to the local variables. Key replacements throughout Dashboard.tsx:
- `yougileStore.yougileEnabled` → `yougileEnabled`
- `yougileStore.activeSource` → `yougileActiveSource`
- `yougileStore.yougileContext.boardId` → `yougileContext.boardId`
- `yougileStore.yougileContext.projectId` → `yougileContext.projectId`
- `yougileStore.columns` → `yougileColumns`
- `yougileStore.tasks` → `yougileTasks`
- `yougileStore.fetchColumns(boardId)` → `fetchYougileColumns(boardId)`
- `yougileStore.fetchTasks()` → `fetchYougileTasks()`
- `yougileStore.fetchUsers(...)` → `fetchYougileUsers(...)`
- `yougileStore.clearError()` → `clearYougileError()`
- `yougileStore.fetchTasks` → `fetchYougileTasks`

- [ ] **Step 2: Fix KanbanTaskCard.tsx — use selectors**

Replace lines 30-38:

```typescript
export function KanbanTaskCard({ task, isOverlay }: TaskCardProps) {
  const selectLocalTask = useTaskStore((s) => s.selectTask);
  const localSelectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setIsEditorOpen = useTaskStore((s) => s.setIsEditorOpen);
  const selectYougileTask = useYougileStore((s) => s.selectTask);
  const yougileSelectedTaskId = useYougileStore((s) => s.selectedTaskId);
```

- [ ] **Step 3: Fix SourceSwitcher.tsx — use selectors**

Replace lines 7-18:

```typescript
export function SourceSwitcher() {
  const activeSource = useYougileStore((s) => s.activeSource);
  const setActiveSource = useYougileStore((s) => s.setActiveSource);
  const yougileEnabled = useYougileStore((s) => s.yougileEnabled);
  const fetchAccounts = useYougileStore((s) => s.fetchAccounts);
  const accounts = useYougileStore((s) => s.accounts);
  const yougileContext = useYougileStore((s) => s.yougileContext);
  const setYougileContext = useYougileStore((s) => s.setYougileContext);
  const fetchProjects = useYougileStore((s) => s.fetchProjects);
  const error = useYougileStore((s) => s.error);
  const isLoading = useYougileStore((s) => s.isLoading);
```

- [ ] **Step 4: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/Dashboard.tsx src/components/KanbanTaskCard.tsx src/components/SourceSwitcher.tsx
git commit -m "perf: use Zustand selectors to prevent unnecessary re-renders"
```

---

### Task 7: Performance — Memoize sidebar filter counts (I11)

**Files:**
- Modify: `src/Dashboard.tsx:760-765`

- [ ] **Step 1: Extract filter counts into a useMemo above the JSX**

Add before the return statement in Dashboard (around line ~400):

```typescript
const sidebarCounts = useMemo(() => {
  const active = tasks.filter((t) => t.status !== 'archived');
  const todayKey = todayDateKey();
  return {
    inbox: active.length,
    today: active.filter((t) => {
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayKey;
    }).length,
    archived: tasks.filter((t) => t.status === 'archived').length,
  };
}, [tasks]);
```

- [ ] **Step 2: Replace inline computations in the sidebar JSX**

Replace lines 762-764:

```typescript
{ id: 'inbox' as SidebarFilter, label: 'Inbox', Icon: Inbox, count: sidebarCounts.inbox },
{ id: 'today' as SidebarFilter, label: 'Today', Icon: Sun, count: sidebarCounts.today },
{ id: 'archived' as SidebarFilter, label: 'Archived', Icon: Archive, count: sidebarCounts.archived },
```

- [ ] **Step 3: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/Dashboard.tsx
git commit -m "perf: memoize sidebar filter counts to avoid recomputation on every render"
```

---

### Task 8: Performance — Fix Dashboard useEffect deps (I12)

**Files:**
- Modify: `src/Dashboard.tsx:193-201`

- [ ] **Step 1: Fix the effect to use the individual selectors from Task 6**

After Task 6 is applied, replace the effect at lines 193-201:

```typescript
useEffect(() => {
  if (yougileActiveSource === 'yougile' && yougileContext.boardId) {
    fetchYougileColumns(yougileContext.boardId).then(() => {
      void fetchYougileTasks();
    });
  }
}, [yougileActiveSource, yougileContext.boardId, fetchYougileColumns, fetchYougileTasks]);
```

All deps are now in the array because they come from selectors (stable references from Zustand).

- [ ] **Step 2: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/Dashboard.tsx
git commit -m "fix: add missing deps to useEffect for Yougile column/task fetch"
```

---

### Task 9: Performance — Fix ErrorBanner auto-dismiss timer (I16)

**Files:**
- Modify: `src/components/ui/error-banner.tsx:10-15`

- [ ] **Step 1: Only re-run timer when `error` changes, not `onDismiss`**

Replace the useEffect:

```typescript
export function ErrorBanner({ error, onRetry, onDismiss }: ErrorBannerProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => onDismissRef.current(), 10000);
    return () => clearTimeout(timer);
  }, [error]);
```

Add `useRef` to the import:

```typescript
import { useEffect, useRef } from 'react';
```

- [ ] **Step 2: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/error-banner.tsx
git commit -m "fix: stabilize ErrorBanner timer by using ref for onDismiss callback"
```

---

### Task 10: Rust — HTTP client reuse + Default derive (I3, I4, S3)

**Files:**
- Modify: `src-tauri/src/yougile/client.rs:6-17, 101-122, 130-138`
- Modify: `src-tauri/src/yougile/models.rs:372-405`

- [ ] **Step 1: Derive Default on UpdateYougileTask**

In `src-tauri/src/yougile/models.rs`, add `Default` to the derive:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateYougileTask {
```

- [ ] **Step 2: Simplify `delete_task` in client.rs**

Replace lines 101-122:

```rust
pub async fn delete_task(&self, task_id: &str) -> Result<(), String> {
    let payload = UpdateYougileTask {
        deleted: Some(true),
        ..Default::default()
    };
    self.put::<_, WithIdResponse>(&format!("/tasks/{task_id}"), &payload)
        .await?;
    Ok(())
}
```

- [ ] **Step 3: Make YougileClient cloneable and reuse in `get_board_tasks`**

Add `Clone` derive and wrap `http` in `Arc` — actually the simpler fix is to just share the api_key and create one client:

```rust
pub async fn get_board_tasks(&self, board_id: &str) -> Result<Vec<YougileTask>, String> {
    let columns = self.get_columns(board_id).await?;
    let active_columns: Vec<_> = columns.into_iter().filter(|c| !c.deleted).collect();

    // Create one shared HTTP client for all parallel requests
    let shared_http = self.http.clone();
    let api_key = self.api_key.clone();

    let mut join_set = tokio::task::JoinSet::new();
    for col in &active_columns {
        let col_id = col.id.clone();
        let http = shared_http.clone();
        let key = api_key.clone();
        join_set.spawn(async move {
            let client = YougileClient { http, api_key: key };
            client.get_tasks(&col_id).await
        });
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
```

- [ ] **Step 4: Run `cargo check && cargo test`**

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/yougile/client.rs src-tauri/src/yougile/models.rs
git commit -m "refactor: derive Default on UpdateYougileTask, reuse HTTP client in board tasks"
```

---

### Task 11: Rust — Unify pagination helpers (S2)

**Files:**
- Modify: `src-tauri/src/yougile/client.rs:325-410`

- [ ] **Step 1: Replace `get_list` and `get_list_with_param` with a single method**

Replace both methods with:

```rust
async fn get_list_with_params<T: serde::de::DeserializeOwned>(
    &self,
    path: &str,
    extra_params: &[(&str, String)],
) -> Result<Vec<T>, String> {
    let mut all = Vec::new();
    let mut offset: i64 = 0;
    let limit: i64 = 100;
    loop {
        let mut params = extra_params.to_vec();
        params.push(("limit", limit.to_string()));
        params.push(("offset", offset.to_string()));

        let resp = self
            .authed_request(reqwest::Method::GET, path)
            .query(&params)
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

async fn get_list<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<Vec<T>, String> {
    self.get_list_with_params(path, &[]).await
}

async fn get_list_with_param<T: serde::de::DeserializeOwned>(
    &self,
    path: &str,
    param_name: &str,
    param_value: &str,
) -> Result<Vec<T>, String> {
    self.get_list_with_params(path, &[(param_name, param_value.to_string())])
        .await
}
```

- [ ] **Step 2: Run `cargo check && cargo test`**

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/yougile/client.rs
git commit -m "refactor: unify pagination into single get_list_with_params method"
```

---

### Task 12: Rust — Fix silent error drop in accounts query (I5)

**Files:**
- Modify: `src-tauri/src/db.rs:1695-1697`

- [ ] **Step 1: Replace `filter_map` with proper error propagation**

Replace:
```rust
.filter_map(|r| r.ok())
.collect();
```

With:
```rust
.collect::<Result<Vec<_>, _>>()
.map_err(|e| e.to_string())?;
```

- [ ] **Step 2: Run `cargo check && cargo test`**

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "fix: propagate deserialization errors in get_yougile_accounts instead of silently dropping"
```

---

### Task 13: Rust — Batch sync state queries (S5)

**Files:**
- Modify: `src-tauri/src/db.rs:1150-1220`

- [ ] **Step 1: Replace 6 separate queries with a single `WHERE key IN` query**

Replace `load_yougile_sync_state`:

```rust
fn load_yougile_sync_state(connection: &Connection) -> Result<YougileSyncState, String> {
    let mut stmt = connection
        .prepare(
            "SELECT key, value FROM settings WHERE key IN (
                'yougile_active_source', 'yougile_account_id', 'yougile_project_id',
                'yougile_project_name', 'yougile_board_id', 'yougile_board_name'
            )"
        )
        .map_err(|e| format!("Failed to prepare Yougile sync state query: {e}"))?;

    let mut values: std::collections::HashMap<String, Option<String>> = std::collections::HashMap::new();
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| format!("Failed to query Yougile sync state: {e}"))?;

    for row in rows {
        let (key, value) = row.map_err(|e| format!("Failed to read sync state row: {e}"))?;
        values.insert(key, value);
    }

    Ok(YougileSyncState {
        active_source: values
            .remove("yougile_active_source")
            .flatten()
            .unwrap_or_else(|| "local".to_string()),
        account_id: values.remove("yougile_account_id").flatten(),
        project_id: values.remove("yougile_project_id").flatten(),
        project_name: values.remove("yougile_project_name").flatten(),
        board_id: values.remove("yougile_board_id").flatten(),
        board_name: values.remove("yougile_board_name").flatten(),
    })
}
```

- [ ] **Step 2: Run `cargo check && cargo test`**

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "perf: batch 6 sync state queries into single WHERE IN query"
```

---

### Task 14: Rust — Remove blanket `#![allow(dead_code)]` (I8)

**Files:**
- Modify: `src-tauri/src/yougile/models.rs:1`

- [ ] **Step 1: Remove line 1**

Delete:
```rust
#![allow(dead_code)]
```

- [ ] **Step 2: Run `cargo check 2>&1` and review warnings**

Add `#[allow(dead_code)]` only to items that produce warnings and are intentionally kept for future use. Items that are genuinely unused should be deleted.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/yougile/models.rs
git commit -m "lint: remove blanket allow(dead_code), add targeted suppressions"
```

---

### Task 15: Frontend — Deduplicate `isYougileTask` and `priorityDot` (S11, S12)

**Files:**
- Modify: `src/lib/yougile.ts`
- Modify: `src/App.tsx:42-44`
- Modify: `src/components/KanbanTaskCard.tsx:13-15, 22-27`
- Modify: `src/components/CalendarView.tsx:9-14`
- Modify: `src/Dashboard.tsx:36-43`

- [ ] **Step 1: Add shared utilities to `src/lib/yougile.ts`**

Add to the end of `src/lib/yougile.ts`:

```typescript
import type { Task, TaskPriority } from '@/types';
import type { YougileTask } from '@/types/yougile';

export function isYougileTask(task: Task | YougileTask): task is YougileTask {
  return 'columnId' in task;
}

export const PRIORITY_DOT_CLASS: Record<TaskPriority, string | null> = {
  urgent: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-yellow-400',
  low: 'bg-blue-400',
  none: null,
};
```

- [ ] **Step 2: Replace duplicates in App.tsx**

Remove the local `isYougileTask` function and add import:
```typescript
import { isYougileTask } from '@/lib/yougile';
```

- [ ] **Step 3: Replace duplicates in KanbanTaskCard.tsx**

Remove local `isYougileTask` and `priorityDot`, add import:
```typescript
import { getYougileTaskColorValue, isYougileTask, PRIORITY_DOT_CLASS } from '@/lib/yougile';
```

Replace `priorityDot[task.priority]` with `PRIORITY_DOT_CLASS[task.priority as TaskPriority]`.

- [ ] **Step 4: Replace duplicate in CalendarView.tsx**

Remove local `priorityDot`, add import:
```typescript
import { PRIORITY_DOT_CLASS } from '@/lib/yougile';
```

Replace `priorityDot[task.priority as TaskPriority]` with `PRIORITY_DOT_CLASS[task.priority as TaskPriority]`.

- [ ] **Step 5: Replace duplicate in Dashboard.tsx**

Remove local `priorityDot` function, add import:
```typescript
import { PRIORITY_DOT_CLASS } from '@/lib/yougile';
```

Replace `priorityDot(t.priority)` with `PRIORITY_DOT_CLASS[t.priority]`.

- [ ] **Step 6: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/yougile.ts src/App.tsx src/components/KanbanTaskCard.tsx src/components/CalendarView.tsx src/Dashboard.tsx
git commit -m "refactor: deduplicate isYougileTask and priorityDot into shared utilities"
```

---

### Task 16: Frontend — Use `structuredClone` instead of JSON round-trip (S16)

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx` (2 locations)

- [ ] **Step 1: Find and replace JSON.parse(JSON.stringify(...))**

Search for `JSON.parse(JSON.stringify(` and replace with `structuredClone(`:

Line ~210:
```typescript
task.checklists ? structuredClone(task.checklists) : []
```

Line ~254 (if present):
```typescript
structuredClone(task.checklists)
```

- [ ] **Step 2: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/YougileTaskEditor.tsx
git commit -m "refactor: use structuredClone instead of JSON round-trip for deep copy"
```

---

### Task 17: Frontend — Guard module-level Tauri call in main.tsx (S17)

**Files:**
- Modify: `src/main.tsx:13`

- [ ] **Step 1: Wrap getCurrentWindow().label in try-catch**

Replace line 13:

```typescript
const label = '__TAURI_INTERNALS__' in window
  ? getCurrentWindow().label
  : 'main';
```

- [ ] **Step 2: Run `npx tsc --noEmit`**

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "fix: guard getCurrentWindow() call for non-Tauri environments"
```

---

### Task 18: Frontend — Remove unused UI components (I15)

**Files:**
- Delete: `src/components/ui/badge.tsx`
- Delete: `src/components/ui/button.tsx`
- Delete: `src/components/ui/scroll-area.tsx`
- Delete: `src/components/ui/tabs.tsx`

- [ ] **Step 1: Verify these components are not imported anywhere**

Run: `grep -r "badge\|button\|scroll-area\|tabs" src/ --include="*.tsx" --include="*.ts" -l`

Exclude the files themselves. If any imports are found, do NOT delete that file.

- [ ] **Step 2: Delete confirmed unused files**

```bash
rm src/components/ui/badge.tsx src/components/ui/button.tsx src/components/ui/scroll-area.tsx src/components/ui/tabs.tsx
```

- [ ] **Step 3: Remove unused `@radix-ui/react-tabs` dependency if tabs.tsx was deleted**

Run: `npm uninstall @radix-ui/react-tabs`

- [ ] **Step 4: Run `npx tsc --noEmit && npm run build`**

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/ui/ package.json package-lock.json
git commit -m "chore: remove unused UI components (badge, button, scroll-area, tabs)"
```

---

### Task 19: Final verification

- [ ] **Step 1: Run full Rust check + tests**

```bash
cd src-tauri && cargo clippy -- -W clippy::all 2>&1 | head -50
cargo test
```

- [ ] **Step 2: Run full frontend check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Verify no regressions**

Expected: All checks pass, no warnings, clean build.
