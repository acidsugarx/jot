# Yougile Re-Architecture Plan

**Status:** 🏗️ Phase 1 ✅, Phase 2 ✅, Phase 3 ✅, Phase 4 ✅, Phase 5 ✅, Phase 6 ✅ — All phases complete. Code is ready. Frontend still uses legacy 21 Yougile commands (old store wrapper).
**Created:** 2026-06-04
**Initiator:** User pain with Yougile API + architectural debt
**Entry point:** `AGENTS.md` → `plans/yougile-rearchitecture.md`
**Agent workflow:** Follow phases sequentially. Update this file and `AGENTS.md` when state changes.

---

## 1. Why This Exists

Jot изначально проектировался как **локальный** таск-менеджер с Zettelkasten bridge. Yougile интеграция была прикручена позже как болт-он, и это чувствуется везде:

- **Два типа задач** — `Task` (local) и `YougileTask` (remote) несовместимы
- **Два Zustand store** — `use-task-store` и `use-yougile-store` дублируют CRUD
- **YougileTaskEditor — 1843 строки** — монстр, который делает всё
- **21 Tauri команда для Yougile** — лавина boilerplate
- **ContentEditable + execCommand** — deprecated, хрупко
- **Вся sync-логика на JS** — Rust просто HTTP обёртка
- **Yougile API сам по себе кривой** — много костылей в `models.rs`

---

## 2. Анализ Болевых Точек

### 2.1 Yougile API (оправдание — API плохой)

| # | Боль | Где живёт | Серьёзность |
|---|------|-----------|-------------|
| 1 | Offset-пагинация с глючным `paging.next` | `client.rs:get_list_with_params()` | 🟡 |
| 2 | Поля-хамелеоны: `assigned`/`subtasks`/`createdBy` — то string, то `{"id":…}` | `models.rs` — 4 хелпера десериализации | 🟡 |
| 3 | Nullable booleans (`deleted`, `completed`) приходят как `null` | `models.rs` — `deserialize_nullable_bool` на каждом поле | 🟡 |
| 4 | Chat messages — ascending IDs, но `paging.count` не total. Двухстраничный fetch | `client.rs:get_chat_messages()` | 🟠 |
| 5 | File upload — отдельный multipart endpoint | `client.rs:upload_file()` | 🟢 |
| 6 | Stickers — два типа с вложенными states + free text | `models.rs` + `YougileTaskEditor.tsx` | 🟠 |
| 7 | Deadline — монстр-структура (6 полей). При апдейте надо всё слать | `client.rs`, `YougileTaskEditor.tsx` | 🟠 |
| 8 | Rate limit 429 — handled, no retry | `client.rs:check_status()` | 🟢 |
| 9 | Нет webhooks — только polling (30s из браузера) | `use-yougile-store.ts` | 🟠 |
| 10 | Subtasks — двухшаговая операция (create + update parent) | `use-yougile-store.ts:createSubtask()` | 🟠 |
| 11 | Create vs Update — разные DTO с дублированием полей | `models.rs` | 🟢 |

### 2.2 Архитектурные Проблемы Jot

| # | Боль | Файл(ы) | Серьёзность |
|---|------|---------|-------------|
| 1 | Два несовместимых типа задач (`Task` vs `YougileTask`) | `src/types.ts`, `src/types/yougile.ts` | 🔴 |
| 2 | Два Zustand store с дублирующейся логикой | `src/store/use-task-store.ts`, `src/store/use-yougile-store.ts` | 🔴 |
| 3 | Rust — тупая HTTP обёртка. Бизнес-логика на JS | `src-tauri/src/yougile/`, `src/store/use-yougile-store.ts` | 🔴 |
| 4 | YougileTaskEditor — 1843 строки, делает всё | `src/components/YougileTaskEditor.tsx` | 🔴 |
| 5 | 21 Tauri команда для Yougile | `lib.rs` invoke_handler | 🟠 |
| 6 | contentEditable + document.execCommand (deprecated) | `src/hooks/use-rich-text-editor.tsx` | 🟠 |
| 7 | Keyring recovery — поиск API ключа в других аккаунтах | `src-tauri/src/db/yougile_accounts.rs` | 🟠 |
| 8 | Optimistic updates с ревертом на фронтенде — рассинхрон | `use-yougile-store.ts` (moveTask, deleteTask) | 🟠 |
| 9 | Sync state — SQLite + Tauri events, race conditions между окнами | `use-yougile-store.ts:hydrateSyncState()` | 🟠 |
| 10 | Чат в том же компоненте что и редактор таска | `YougileTaskEditor.tsx` (30% кода — чат) | 🟠 |

---

## 3. Цель Реинкорнирования

Сделать Jot **provider-agnostic** таск-менеджером, где:

- **Один тип Task** на фронтенде — локальные и Yougile задачи выглядят одинаково
- **Один store** — `use-task-store` делегирует активному провайдеру
- **Sync-логика на Rust** — polling, diff-merge, кеш — в бэкенде
- **Provider trait** — можно добавить Linear, GitHub Issues, Jira
- **Компоненты — маленькие и переиспользуемые**
- **Yougile-специфичный код — изолирован** за провайдером

---

## 4. Стратегия: Provider Pattern + Incremental Migration

### 4.1 Целевая Архитектура

```
┌──────────────────────────────────────────────┐
│  Фронтенд (React)                             │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ TaskEditor  │  │  useTaskProvider()    │   │
│  │ KanbanBoard │  │  ┌────────────────┐  │   │
│  │ ListView    │  │  │ invoke(...)    │  │   │
│  │ Capture     │  │  └────────────────┘  │   │
│  └─────────────┘  └──────────────────────┘   │
│         ▲ IPC (единый invoke API)              │
├─────────┼────────────────────────────────────┤
│  Rust   │                                     │
│  ┌──────┴────────────────────────────────┐   │
│  │  TaskEngine                            │   │
│  │  ┌──────────────────────────────┐     │   │
│  │  │ provider/mod.rs              │     │   │
│  │  │  trait TaskProvider { ... }  │     │   │
│  │  └──────────────────────────────┘     │   │
│  │  ┌──────────────────────────────┐     │   │
│  │  │ provider/local.rs            │     │   │
│  │  │  SQLite-backed provider      │     │   │
│  │  └──────────────────────────────┘     │   │
│  │  ┌──────────────────────────────┐     │   │
│  │  │ provider/yougile.rs          │     │   │
│  │  │  API client + sync engine    │     │   │
│  │  │  (normalizes YougileTask     │     │   │
│  │  │   → internal Task)           │     │   │
│  │  └──────────────────────────────┘     │   │
│  └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

### 4.2 Provider Trait (Rust)

```rust
#[async_trait]
pub trait TaskProvider: Send + Sync {
    /// Unique provider id: "local", "yougile", "linear", ...
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &str;

    /// CRUD
    async fn list_tasks(&self, filter: TaskFilter) -> Result<Vec<Task>, ProviderError>;
    async fn get_task(&self, id: &str) -> Result<Task, ProviderError>;
    async fn create_task(&self, input: CreateTaskInput) -> Result<Task, ProviderError>;
    async fn update_task(&self, id: &str, patch: UpdateTaskInput) -> Result<Task, ProviderError>;
    async fn delete_task(&self, id: &str) -> Result<(), ProviderError>;

    /// Sync — polling or push-based
    async fn sync(&self) -> Result<SyncResult, ProviderError>;

    /// Optional capabilities
    fn capabilities(&self) -> ProviderCapabilities;
}
```

### 4.3 Unified Task Type (TypeScript)

```typescript
interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done' | 'archived';
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  tags: string[];
  dueDate?: string;
  columnId?: string;
  color?: string;
  // Meta — кто владеет задачей
  provider: 'local' | 'yougile' | 'linear';
  providerUrl?: string; // ссылка на оригинал в Yougile
  // Локальные расширения
  linkedNotePath?: string;
  checklists?: Checklist[];
  subtasks?: string[];
}
```

### 4.4 Unified Store (TypeScript)

```typescript
interface TaskState {
  activeProvider: 'local' | 'yougile';
  tasks: Task[];
  columns: Column[];
  providers: ProviderStatus[];
  // Единый CRUD
  fetchTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<void>;
  updateTask: (id: string, patch: UpdateTaskInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  sync: () => Promise<void>;
}
```

---

## 5. Фазы Миграции

### Фаза 0: Анализ ✅ (текущая)
- [x] Прочитать весь код (Rust + TS)
- [x] Документировать болевые точки
- [x] Написать этот план
- [x] Обновить AGENTS.md

### Фаза 1: Фундамент — Provider Trait в Rust ✅

**Цель:** Создать `TaskProvider` trait и мигрировать существующую Yougile CRUD за него.

Созданные файлы:
- `src-tauri/src/provider/mod.rs` — **NEW**: TaskProvider trait, UnifiedTask, ProviderError, TaskEngine, нормалайзеры
- `src-tauri/src/provider/local.rs` — **NEW**: `DbBoundLocalProvider` — обёртка над `db::tasks` через `DatabaseState::with_connection()`
- `src-tauri/src/provider/yougile.rs` — **NEW**: `DbBoundYougileProvider` — обёртка над `yougile::client` через `DatabaseState` + account_id

Изменённые файлы:
- `src-tauri/src/lib.rs` — добавлены 5 новых команд (`task_provider_list`, `task_provider_list_tasks`, `task_provider_create_task`, `task_provider_update_task`, `task_provider_delete_task`), старые 21 Yougile команда **оставлены** для обратной совместимости
- `src-tauri/src/db/mod.rs` — добавлен `pub fn with_connection()` в `DatabaseState`, добавлен `get_yougile_sync_state_impl()`, модули `tasks`, `utils`, `tags`, `checklists`, `yougile_accounts` сделаны `pub(crate)`
- `src-tauri/Cargo.toml` — добавлена зависимость `async-trait = "0.1"`

**Критерий готовности:** ✅ `cargo check` — без ошибок, ✅ `cargo test` — 43 теста проходят, ✅ новые команды зарегистрированы в invoke_handler рядом со старыми.

⚠️ Старые Yougile команды НЕ удалены — фронтенд пока использует их.

### Фаза 2: Rust Sync Engine ✅

**Цель:** Перенести polling и sync-логику с фронтенда на Rust.

Созданные файлы:
- `src-tauri/src/provider/sync.rs` — **NEW**: `SyncManager` с `start_yougile()`, `stop()`, `is_running()`, `stop_all()`. Использует `tokio::spawn` для фонового пуллинга. Эмитит события `provider-tasks-updated` и `provider-sync-state`.

Изменённые файлы:
- `src-tauri/src/db/mod.rs` — `DatabaseState.connection` обёрнут в `Arc<Mutex<Connection>>` для Clone
- `src-tauri/src/yougile/commands.rs` — добавлен `pub async fn fetch_board_tasks_inner()` для переиспользования
- `src-tauri/src/lib.rs` — добавлены команды `start_provider_sync`, `stop_provider_sync`, `is_provider_sync_running`; `SyncManager` зарегистрирован в Tauri state
- `src/store/use-yougile-store.ts` — добавлены `startSync()`, `stopSync()`, `listenForProviderSync()` методы
- `src/Dashboard.tsx` — `setInterval` polling удалён, заменён на `startSync()` / `stopSync()` + `listenForProviderSync()`

**Критерий готовности:** ✅ Rust пуллит Yougile раз в 30с, шлёт `provider-tasks-updated` event. Фронтенд только подписывается — `setInterval` в Dashboard.tsx заменён.

### Фаза 3: Унификация Типов на Фронтенде ✅

**Цель:** Один `Task`, один `use-task-store`.

**Phase 3a — Типы + Store foundation ✅**
- ✅ `src/types.ts` — `Task` расширен: добавлен `provider?: 'local' | 'yougile'`, Yougile-поля
- ✅ `src/store/use-task-store.ts` — добавлены `activeProvider`, `yougileEnabled`, `yougileContext`, `fetchYougileTasks()`, мапперы
- ✅ `src/store/use-yougile-store.ts` — переписан как тонкая обёртка, делегирует shared state в use-task-store

**Phase 3b — Component migration ✅**
- ✅ `lib/yougile.ts` — `isYougileTask()` обновлён с проверкой `provider`
- ✅ `App.tsx` — `isYougileTask()` обновлён
- ✅ `KanbanTaskCard.tsx` — `isYougile()` обновлён
- ✅ `use-yougile-store.ts` — proxy-свойства (`activeSource`, `yougileEnabled`, `yougileContext`) делегируют в use-task-store
- ✅ `use-yougile-store.ts` — почищены неиспользуемые функции/константы, 0 lint errors
- ✅ TypeScript — 0 ошибок
- ✅ Тесты — 92 проходят
- ✅ Lint — 0 errors

### Фаза 4: Разделение YougileTaskEditor (в процессе 🏗️)

**Цель:** Разбить 1843 строки на маленькие компоненты.

**Сделано (Phase 4):**
- ✅ `EditorField.tsx` — focusable wrapper
- ✅ `EditorHeader.tsx` — хедер с навигацией
- ✅ `EditorFields.tsx` — Column, Completed, Deadline, Color, Assignee
- ✅ `ChatPanel.tsx` — чат
- ✅ `ChecklistSection.tsx` — чеклисты
- ✅ `SubtaskSection.tsx` — подзадачи
- ✅ `StickerSection.tsx` — стикеры
- ✅ `TimeTrackingSection.tsx` — учёт времени
- ✅ `ImagePreviewOverlay.tsx` — просмотр изображений
- ✅ `YougileTaskEditor.tsx` уменьшен: **1843 → 782 строк** (-58%)
- ✅ TypeScript — 0 ошибок
- ✅ Тесты — 92 frontend + 43 Rust
- ✅ Lint — 0 errors

**Текущая структура:**
```
src/components/editors/
├── index.ts (barrel)
├── EditorField.tsx         — 37 строк
├── EditorHeader.tsx        — 51 строк
├── EditorFields.tsx        — 440 строк
├── ChatPanel.tsx           — 360 строк
├── ChecklistSection.tsx    — 140 строк
├── SubtaskSection.tsx      — 247 строк
├── StickerSection.tsx      — 195 строк
├── TimeTrackingSection.tsx — 55 строк
└── ImagePreviewOverlay.tsx — 33 строк
```

**Что остаётся:**
- Title + Description (rich text) остаются в YougileTaskEditor как контейнере
- После всех выносов < 800 строк (вместо 1843)

**Phase 4 завершена.**

### Фаза 5: ContentEditable → TipTap ✅
**Цель:** Выпилить `document.execCommand`.

**Сделано:**
- ✅ `@tiptap/react`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item` установлены
- ✅ `src/components/editors/TipTapEditor.tsx` (308 строк) — создан
  - ✅ Форматирование: bold, italic, underline, strikethrough, link, list, checklist, code
  - ✅ Link input popover
  - ✅ Keyboard shortcuts (Ctrl+B/I/U/K/Shift+S/Shift+C)
  - ✅ Checkbox support
  - ✅ `content` prop + `externalContentRef` для controlled режима (без save-loop)
  - ✅ `onSave` callback при blur
- ✅ `YougileTaskEditor.tsx` (Description) — заменён на `TipTapEditor`
- ✅ `TaskTemplatesSettings.tsx` (Description) — заменён на `TipTapEditor`
- ✅ `useRichTextEditor.tsx` — **удалён** (больше не нужен)
- ✅ TypeScript — 0 ошибок (`tsc -b --noEmit`)
- ✅ Тесты — 92/92 проходят
- ✅ Lint — 0 errors
- ✅ Rust tests — 43/43 проходят

### Фаза 6: Выпилить Лишнее ✅
- ✅ **Keyring recovery** — удалена `recover_yougile_api_key_from_related_accounts()`, только прямой keychain
- ✅ **Chat из редактора** — выпилен полностью: удалён `ChatPanel` из YougileTaskEditor, убрана кнопка Chat из футера
- ✅ **Stickers** — уже вынесены в StickerSection, оставлены (организационная фича досок Yougile)
- ✅ **Time tracking** — уже readonly в TimeTrackingSection

---

## 6. Что Останется Без Изменений

- **Focus Engine** — не трогать, отличная архитектура
- **Capture Bar (App.tsx)** — только адаптировать под новый store
- **NLP Parser (parser.rs)** — не трогать
- **Zettel Bridge** — не трогать
- **Dashboard views** (Kanban, List, Calendar) — адаптировать под новый тип Task
- **Settings** — только переименовать экраны

---

## 7. Риски и Решения

| Риск | Вероятность | Решение |
|------|-------------|---------|
| Миграция сломает существующих пользователей | 🟡 | Feature flag: `useNewArch` в settings. Старый и новый код параллельно. |
| Yougile изменит API | 🟢 | Provider trait изолирует изменения |
| TipTap слишком тяжёлый для Tauri | 🟠 | Просто markdown textarea как fallback |
| Потеряем Yougile-специфичные фичи (чаты) | 🟡 | Пользователь сам сказал что не нужно |
| Provider trait overengineering для одного провайдера | 🟠 | Но план — добавлять других (GitHub Issues) |

---

## 8. Quick Reference для Агента

**Агент, который подхватывает эту задачу:**

1. Прочитай `AGENTS.md` — контекст проекта
2. Прочитай `plans/yougile-rearchitecture.md` — этот план
3. Определи текущую фазу (секция 5)
4. Иди по чеклисту фазы
5. После каждой фазы запускай `make ci`
6. Обновляй статус в секции 5 и в AGENTS.md

**Ключевые принципы при реализации:**
- Никогда не делай `useYougileStore()` без selector
- Provider trait — `#[async_trait]`, ошибки через `ProviderError` enum
- Весь Yougile-specific код — в `src-tauri/src/provider/yougile.rs` или `src/components/yougile/`
- Никакого `any` — строгие типы
- `make ci` перед каждым коммитом
