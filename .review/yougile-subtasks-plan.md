# Yougile Subtasks Implementation Plan

**Date**: 2026-04-08
**Status**: Ready for implementation
**Scope**: Add subtask support for Yougile tasks in the `YougileTaskEditor`

## How Yougile Subtasks Work

In the Yougile API, subtasks are **regular tasks** (same `YougileTask` type) linked to a parent via the parent's `subtasks: string[]` field. There is no dedicated subtask endpoint. The workflow is:

1. **Create**: Create a regular task (same column as parent), then update the parent's `subtasks` array to include the new task ID
2. **View**: The parent task has `subtasks: string[]` (child task IDs). Resolve those IDs from the board's task list
3. **Remove**: Update the parent's `subtasks` array to exclude the child task ID
4. **Toggle**: Update the child task's `completed` field directly via `updateTask`

### Existing State

| Layer | Local Tasks | Yougile Tasks |
|-------|-------------|---------------|
| Types | `Task` with `parentId` field | `YougileTask` with `subtasks: string[]` (IDs only) |
| Backend | SQLite `get_subtasks` command, `createTask({ parentId })` | No dedicated subtask commands (uses existing `create_task` + `update_task`) |
| Store | `useTaskStore.getSubtasks()`, `createTask({ parentId })` | No subtask actions in `useYougileStore` |
| UI | `SubtaskList` component (local only), used in `TaskEditorPane` | No subtask UI in `YougileTaskEditor` |

### Key Files

- `src/types/yougile.ts` — `YougileTask.subtasks: string[]`, `UpdateYougileTask.subtasks?: string[]`
- `src/store/use-yougile-store.ts` — Zustand store, needs new subtask actions
- `src/components/YougileTaskEditor.tsx` — Editor, needs subtask section
- `src/components/SubtaskList.tsx` — Existing local-task subtask list (reference only)
- `src-tauri/src/yougile/models.rs` — `YougileTask.subtasks`, `UpdateYougileTask.subtasks`
- `src-tauri/src/yougile/commands.rs` — Existing `yougile_create_task`, `yougile_update_task`

---

## Implementation Steps

### Step 1: Add subtask actions to the Yougile store

**File**: `src/store/use-yougile-store.ts`

Add three new action signatures to the `YougileState` interface:

```typescript
// Inside YougileState interface, after deleteTask:
createSubtask: (parentTaskId: string, title: string) => Promise<YougileTask | null>;
removeSubtask: (parentTaskId: string, subtaskId: string) => Promise<void>;
toggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
```

Add implementations in the store body (after `deleteTask`):

```typescript
createSubtask: async (parentTaskId, title) => {
  if (!isTauriAvailable()) return null;
  const { yougileContext, tasks } = get();
  if (!yougileContext.accountId) return null;

  const parentTask = tasks.find((t) => t.id === parentTaskId);
  if (!parentTask) return null;

  try {
    // Create the child task in the same column as the parent
    const childTask = await invoke<YougileTask>('yougile_create_task', {
      accountId: yougileContext.accountId,
      payload: {
        title,
        columnId: parentTask.columnId ?? '',
      },
    });

    // Update the parent's subtasks array
    const currentSubtasks = parentTask.subtasks ?? [];
    const updatedSubtasks = [...currentSubtasks, childTask.id];
    await invoke<YougileTask>('yougile_update_task', {
      accountId: yougileContext.accountId,
      taskId: parentTaskId,
      payload: { subtasks: updatedSubtasks },
    });

    // Update local state: add child task + update parent's subtasks
    set((state) => ({
      tasks: [
        childTask,
        ...state.tasks.map((t) =>
          t.id === parentTaskId ? { ...t, subtasks: updatedSubtasks } : t
        ),
      ],
    }));

    await emitYougileTasksUpdated(yougileContext.boardId);
    return childTask;
  } catch (e) {
    set({ error: String(e) });
    return null;
  }
},

removeSubtask: async (parentTaskId, subtaskId) => {
  if (!isTauriAvailable()) return;
  const { yougileContext, tasks } = get();
  if (!yougileContext.accountId) return;

  const parentTask = tasks.find((t) => t.id === parentTaskId);
  if (!parentTask) return;

  const updatedSubtasks = (parentTask.subtasks ?? []).filter((id) => id !== subtaskId);

  try {
    await invoke<YougileTask>('yougile_update_task', {
      accountId: yougileContext.accountId,
      taskId: parentTaskId,
      payload: { subtasks: updatedSubtasks },
    });

    // Delete the child task
    await invoke('yougile_delete_task', {
      accountId: yougileContext.accountId,
      taskId: subtaskId,
    });

    set((state) => ({
      tasks: state.tasks
        .map((t) =>
          t.id === parentTaskId ? { ...t, subtasks: updatedSubtasks } : t
        )
        .filter((t) => t.id !== subtaskId),
    }));

    await emitYougileTasksUpdated(yougileContext.boardId);
  } catch (e) {
    set({ error: String(e) });
  }
},

toggleSubtask: async (subtaskId, completed) => {
  if (!isTauriAvailable()) return;
  const { yougileContext } = get();
  if (!yougileContext.accountId) return;

  // Optimistic update
  set((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === subtaskId ? { ...t, completed } : t
    ),
  }));

  try {
    await invoke<YougileTask>('yougile_update_task', {
      accountId: yougileContext.accountId,
      taskId: subtaskId,
      payload: { completed },
    });
    await emitYougileTasksUpdated(yougileContext.boardId);
  } catch (e) {
    set({ error: String(e) });
    // Revert on failure
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === subtaskId ? { ...t, completed: !completed } : t
      ),
    }));
  }
},
```

### Step 2: Create `YougileSubtaskList` component

**File**: `src/components/YougileSubtaskList.tsx` (new file)

```tsx
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';
import type { YougileTask } from '@/types/yougile';

interface YougileSubtaskListProps {
  parentTask: YougileTask;
  /** Resolved subtask objects (looked up from store.tasks by parent.subtasks IDs) */
  subtaskTasks: YougileTask[];
  onUpdate: () => void;
  onSelect: (taskId: string) => void;
}

export function YougileSubtaskList({
  parentTask,
  subtaskTasks,
  onUpdate,
  onSelect,
}: YougileSubtaskListProps) {
  const { createSubtask, removeSubtask, toggleSubtask } = useYougileStore();
  const [newTitle, setNewTitle] = useState('');

  const doneCount = subtaskTasks.filter((t) => t.completed).length;

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const result = await createSubtask(parentTask.id, title);
    if (result) {
      setNewTitle('');
      onUpdate();
    }
  };

  const handleToggle = async (task: YougileTask) => {
    await toggleSubtask(task.id, !task.completed);
    onUpdate();
  };

  const handleRemove = async (subtaskId: string) => {
    await removeSubtask(parentTask.id, subtaskId);
    onUpdate();
  };

  return (
    <div className="space-y-1">
      {/* Progress */}
      {subtaskTasks.length > 0 && (
        <div className="mb-1.5 font-mono text-[10px] text-zinc-600">
          {doneCount}/{subtaskTasks.length} done
        </div>
      )}

      {/* Subtask items */}
      {subtaskTasks.map((task) => (
        <div
          key={task.id}
          className="group/sub flex items-center gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/40"
        >
          <input
            type="checkbox"
            checked={task.completed}
            onChange={() => void handleToggle(task)}
            className="h-3 w-3 cursor-pointer rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
          />
          <button
            type="button"
            onClick={() => onSelect(task.id)}
            className={`flex-1 text-left text-xs ${
              task.completed ? 'text-zinc-600 line-through' : 'text-zinc-300'
            } hover:text-cyan-400 transition-colors`}
          >
            {task.title}
          </button>
          <button
            type="button"
            onClick={() => void handleRemove(task.id)}
            className="rounded p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover/sub:opacity-100"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}

      {/* Add subtask input */}
      <div className="flex items-center gap-1.5 px-1">
        <Plus className="h-3 w-3 text-zinc-700" />
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="Add subtask..."
          className="h-5 flex-1 bg-transparent text-xs text-zinc-400 placeholder:text-zinc-600 outline-none"
        />
      </div>
    </div>
  );
}
```

### Step 3: Integrate into `YougileTaskEditor`

**File**: `src/components/YougileTaskEditor.tsx`

**3a. Add import** (near line 13):

```typescript
import { YougileSubtaskList } from '@/components/YougileSubtaskList';
```

**3b. Resolve subtask objects from store** (inside the component, after the `stickerDefinitionLookup` memo, around line 822):

```typescript
// Resolve subtask IDs to full task objects
const subtaskTasks = useMemo(() => {
  const ids = task.subtasks ?? [];
  return ids
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is YougileTask => t !== undefined);
}, [task.subtasks, tasks]);
```

Note: `tasks` is already available from `useYougileStore()` — need to destructure it:

**3c. Add `tasks` to the store destructuring** (line 209-227):

Add `tasks` to the destructured values from `useYougileStore()`:

```typescript
const {
  updateTask,
  moveTask,
  columns,
  tasks,    // <-- add this
  users,
  // ... rest
} = useYougileStore();
```

**3d. Add the subtask section JSX** (after the Checklists section, before Time Tracking, around line 1363):

```tsx
{/* Subtasks */}
{(task.subtasks?.length ?? 0) > 0 && (
  <div className="border-b border-zinc-800/30 px-4 py-3">
    <div className="mb-2">
      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
        Subtasks
      </span>
    </div>
    <YougileSubtaskList
      parentTask={task}
      subtaskTasks={subtaskTasks}
      onUpdate={() => void fetchTasks()}
      onSelect={(id) => {
        selectTask(id);
      }}
    />
  </div>
)}
```

Note: `fetchTasks` and `selectTask` need to be available. `fetchTasks` is already in the store. `selectTask` is also already in the store as `selectTask`. Add both to the destructuring:

```typescript
const {
  updateTask,
  moveTask,
  columns,
  tasks,
  users,
  stringStickers,
  sprintStickers,
  fetchUsers,
  fetchStringStickers,
  fetchSprintStickers,
  yougileContext,
  chatMessages,
  chatLoading,
  companyUsers,
  fetchChatMessages,
  sendChatMessage,
  sendChatWithAttachments,
  fetchCompanyUsers,
  fetchTasks,      // <-- add this
  selectTask,      // <-- add this
} = useYougileStore();
```

### Step 4: Add subtask count indicator to `KanbanTaskCard`

**File**: `src/components/KanbanTaskCard.tsx`

In the Yougile card rendering section (around line 121-133), add a subtask count indicator alongside the deadline and assignee indicators:

```tsx
{(deadlineStr || task.assigned.length > 0 || task.subtasks.length > 0) && (
  <div className="flex items-center gap-1.5">
    {deadlineStr && (
      <span className="font-mono text-[10px] text-zinc-700">{deadlineStr}</span>
    )}
    {task.subtasks.length > 0 && (
      <span className="font-mono text-[10px] text-zinc-700">
        {task.subtasks.length} sub
      </span>
    )}
    {task.assigned.length > 0 && (
      <span className="flex items-center gap-0.5 font-mono text-[10px] text-zinc-700">
        <Users className="h-2.5 w-2.5" />
        {task.assigned.length}
      </span>
    )}
  </div>
)}
```

### Step 5: Validation

Run the full CI pipeline:

```bash
make ci
```

This runs:
1. `cargo fmt --check`
2. `cargo clippy --all-targets --all-features -- -D warnings`
3. `cargo test`
4. `npm run lint`
5. `npm run typecheck`
6. `npm run test -- --run`
7. `npm run build`

---

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/store/use-yougile-store.ts` | Modify | Add `createSubtask`, `removeSubtask`, `toggleSubtask` actions |
| `src/components/YougileSubtaskList.tsx` | Create | New component for Yougile subtask list UI |
| `src/components/YougileTaskEditor.tsx` | Modify | Import `YougileSubtaskList`, resolve subtask objects, add subtask section |
| `src/components/KanbanTaskCard.tsx` | Modify | Add subtask count indicator on Yougile task cards |

## Notes

- No Rust backend changes needed — the existing `yougile_create_task` and `yougile_update_task` commands handle everything
- No new TypeScript types needed — `YougileTask.subtasks: string[]` and `UpdateYougileTask.subtasks?: string[]` already exist
- The subtask section in the editor only shows when `task.subtasks.length > 0` (avoids clutter for tasks without subtasks)
- Consider adding an "Add subtask" button in the editor header/footer for tasks without subtasks yet (follow-up)
