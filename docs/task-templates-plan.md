# Task Templates — Implementation Plan

## Overview

Local task template system for Yougile tasks. Templates store pre-configured fields (title, description, checklists, stickers, color) in SQLite and apply them when creating tasks via the capture bar.

**Scope**: title, description, checklists, stickers, color. Deadline and assigned are set manually.

---

## Phase 1: Backend (Rust + SQLite)

### 1.1 Database migration — `src-tauri/src/db.rs`

Add `task_templates` table to `run_migrations()`:

```sql
CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT,
    checklists TEXT NOT NULL DEFAULT '[]',
    stickers TEXT NOT NULL DEFAULT '{}',
    column_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

- `checklists` — JSON array of `YougileChecklist` (same shape as Yougile API)
- `stickers` — JSON object `Record<string, string>` (sticker ID → state ID)
- `column_id` — optional, binds template to a specific Yougile column

### 1.2 Rust model — `src-tauri/src/models.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTemplate {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub checklists: String,  // JSON
    pub stickers: String,    // JSON
    pub column_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplateInput {
    pub title: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub checklists: Option<String>,  // JSON
    pub stickers: Option<String>,    // JSON
    pub column_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplateInput {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub checklists: Option<String>,
    pub stickers: Option<String>,
    pub column_id: Option<String>,
}
```

### 1.3 Tauri commands — `src-tauri/src/db.rs`

| Command | Signature | Description |
|--------|-----------|-------------|
| `get_task_templates` | `() -> Result<Vec<TaskTemplate>, String>` | List all templates |
| `create_task_template` | `(CreateTemplateInput) -> Result<TaskTemplate, String>` | Create template |
| `update_task_template` | `(UpdateTemplateInput) -> Result<TaskTemplate, String>` | Update template |
| `delete_task_template` | `(id: String) -> Result<(), String>` | Delete template |

### 1.4 Register commands — `src-tauri/src/lib.rs`

Add to `invoke_handler` macro:
```rust
get_task_templates,
create_task_template,
update_task_template,
delete_task_template,
```

---

## Phase 2: Frontend Types

### 2.1 TypeScript types — `src/types/yougile.ts`

Add to existing file:

```typescript
export interface TaskTemplate {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  checklists: YougileChecklist[];
  stickers: Record<string, string>;
  columnId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskTemplateInput {
  title: string;
  description?: string;
  color?: string;
  checklists?: YougileChecklist[];
  stickers?: Record<string, string>;
  columnId?: string;
}

export interface UpdateTaskTemplateInput {
  id: string;
  title?: string;
  description?: string;
  color?: string;
  checklists?: YougileChecklist[];
  stickers?: Record<string, string>;
  columnId?: string;
}
```

---

## Phase 3: Template Store

### 3.1 New store — `src/store/use-template-store.ts`

Lightweight Zustand store:

```
State:
  - templates: TaskTemplate[]
  - isLoading: boolean

Actions:
  - fetchTemplates() — invoke('get_task_templates')
  - createTemplate(input) — invoke('create_task_template', { input })
  - updateTemplate(input) — invoke('update_task_template', { input })
  - deleteTemplate(id) — invoke('delete_task_template', { id })
```

---

## Phase 4: Capture Bar Integration

### 4.1 Template picker — `src/App.tsx`

**PickerMode** extended:
```typescript
type PickerMode = 'none' | 'org' | 'project' | 'board' | 'template';
```

**New action item** (shown when `isYougile && templates.length > 0`):
```
{
  id: '__use-template',
  label: 'Create from Template…',
  Icon: FileText,  // from lucide-react
  iconWrapClass: 'bg-zinc-800',
  iconClass: 'text-zinc-400',
}
```

**Flow**:
1. User selects `__use-template` action → `setPickerMode('template')`
2. Picker shows templates list (title + preview of description/checklist count)
3. User selects template → template fields merge into `CreateYougileTask` payload
4. Title from template pre-fills input, user can edit, then Enter creates task

**handleCreateTask modification**:
```typescript
// When template is selected, merge template fields into payload:
const task = await yougileStore.createTask({
  title: query.trim() || template.title,
  rawInput: query.trim(),
  columnId: template.columnId || firstColumn.id,
  description: template.description,
  color: template.color,
  checklists: template.checklists,
  stickers: template.stickers,
});
```

### 4.2 Picker rendering

Follow existing picker pattern (org/project/board). Template picker items show:
- Template title
- Subtitle with checklist count + sticker count
- Color dot if template has color

---

## Phase 5: Template Management UI (Dashboard)

### 5.1 Settings tab or dedicated panel

In Settings or Dashboard, add a template management section:
- List templates with title, description preview
- Create/Edit form: title, description (rich text), checklists builder, sticker selector, color picker
- Delete with confirmation

This is lower priority — initial version can use just the capture bar with templates created via API/CLI.

---

## Implementation Order

1. **Phase 1** — Rust backend (migration + model + commands + registration)
2. **Phase 2** — TypeScript types
3. **Phase 3** — Template store
4. **Phase 4** — Capture bar template picker
5. **Phase 5** — Template management UI (deferred)

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/db.rs` | Migration + CRUD commands + helpers |
| `src-tauri/src/models.rs` | `TaskTemplate`, `CreateTemplateInput`, `UpdateTemplateInput` |
| `src-tauri/src/lib.rs` | Register 4 new commands |
| `src/types/yougile.ts` | `TaskTemplate`, `CreateTaskTemplateInput`, `UpdateTaskTemplateInput` |
| `src/store/use-template-store.ts` | **New file** — Zustand store |
| `src/App.tsx` | Template picker mode + action item + modified `handleCreateTask` |

## Key Design Decisions

- **Checklists stored as JSON** — Same shape as Yougile API (`{title, items: [{title, completed}]}`), no separate tables needed
- **Stickers stored as JSON** — `Record<stickerId, stateId>`, directly usable in `CreateYougileTask.stickers`
- **No deadline/assigned in templates** — Per user request, these are set manually
- **Column binding optional** — Template can target a specific column or use the board's first column
- **Template picker is a PickerMode** — Reuses existing vim navigation (j/k/Enter/Escape)
