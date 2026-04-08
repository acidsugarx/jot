import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAvailable } from '@/lib/tauri';
import type {
  AppSettings,
  Checklist,
  ChecklistItem,
  CreateTaskInput,
  KanbanColumn,
  Tag,
  Task,
  UpdateColumnInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from '@/types';

const TASKS_UPDATED_EVENT = 'tasks-updated';
const THEME_CHANGED_EVENT = 'theme-changed';
const SETTINGS_UPDATED_EVENT = 'settings-updated';

interface TasksUpdatedPayload {
  sourceWindowLabel?: string;
}

function notifyTasksChanged() {
  if (isTauriAvailable()) {
    void emit(TASKS_UPDATED_EVENT, {
      sourceWindowLabel: getCurrentWindow().label,
    } satisfies TasksUpdatedPayload);
  }
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
  if (isTauriAvailable()) {
    void getCurrentWindow().setTheme(theme === 'light' ? 'light' : 'dark');
  }
}

interface TaskState {
  tasks: Task[];
  columns: KanbanColumn[];
  isLoading: boolean;
  error: string | null;
  settings: AppSettings | null;
  selectedTaskId: string | null;
  isEditorOpen: boolean;
  isQuickAddOpen: boolean;

  fetchTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task | null>;
  updateTask: (input: UpdateTaskInput) => Promise<Task | null>;
  updateTaskStatus: (input: UpdateTaskStatusInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  openLinkedNote: (path: string) => Promise<void>;

  fetchColumns: () => Promise<void>;
  createColumn: (name: string) => Promise<KanbanColumn | null>;
  updateColumn: (input: UpdateColumnInput) => Promise<KanbanColumn | null>;
  deleteColumn: (id: string) => Promise<void>;
  reorderColumns: (ids: string[]) => Promise<void>;

  fetchSettings: () => Promise<void>;
  updateSettings: (vaultDir: string | null) => Promise<void>;
  updateTheme: (theme: string) => Promise<void>;

  tags: Tag[];
  // Checklist methods
  getChecklists: (taskId: string) => Promise<Checklist[] | null>;
  createChecklist: (taskId: string, title: string) => Promise<Checklist | null>;
  addChecklistItem: (checklistId: string, text: string) => Promise<ChecklistItem | null>;
  updateChecklistItem: (id: string, text?: string, completed?: boolean) => Promise<void>;
  deleteChecklist: (id: string) => Promise<void>;
  deleteChecklistItem: (id: string) => Promise<void>;
  // Tag methods
  fetchTags: () => Promise<void>;
  createTag: (name: string, color?: string) => Promise<Tag | null>;
  updateTag: (id: string, name?: string, color?: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  getTaskTags: (taskId: string) => Promise<Tag[] | null>;
  setTaskTags: (taskId: string, tagIds: string[]) => Promise<void>;
  // Subtask methods
  getSubtasks: (parentId: string) => Promise<Task[] | null>;

  selectTask: (id: string | null) => void;
  setIsEditorOpen: (isOpen: boolean) => void;
  setIsQuickAddOpen: (isOpen: boolean) => void;
  clearError: () => void;
  listenForUpdates: () => () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  columns: [],
  isLoading: false,
  error: null,
  settings: null,
  selectedTaskId: null,
  isEditorOpen: false,
  isQuickAddOpen: false,
  tags: [],

  fetchTasks: async () => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      const tasks = await invoke<Task[]>('get_tasks');
      set({ tasks, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch tasks', isLoading: false });
    }
  },

  createTask: async (input) => {
    if (!isTauriAvailable()) return null;
    set({ isLoading: true, error: null });
    try {
      const task = await invoke<Task>('create_task', { input });
      set((state) => ({ tasks: [task, ...state.tasks], isLoading: false }));
      notifyTasksChanged();
      return task;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create task', isLoading: false });
      return null;
    }
  },

  updateTask: async (input) => {
    if (!isTauriAvailable()) return null;
    try {
      const updatedTask = await invoke<Task>('update_task', { input });
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
      }));
      notifyTasksChanged();
      return updatedTask;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update task' });
      return null;
    }
  },

  updateTaskStatus: async (input) => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      const updatedTask = await invoke<Task>('update_task_status', { input });
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
        isLoading: false,
      }));
      notifyTasksChanged();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update task', isLoading: false });
    }
  },

  deleteTask: async (id) => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_task', { id });
      set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id),
        selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
        isEditorOpen: state.selectedTaskId === id ? false : state.isEditorOpen,
        isLoading: false,
      }));
      notifyTasksChanged();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete task', isLoading: false });
    }
  },

  openLinkedNote: async (path) => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('open_linked_note', { path });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to open linked note' });
    }
  },

  // ── Column actions ───────────────────────────────────────────────────────

  fetchColumns: async () => {
    if (!isTauriAvailable()) return;
    try {
      const columns = await invoke<KanbanColumn[]>('get_columns');
      set({ columns });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch columns' });
    }
  },

  createColumn: async (name) => {
    if (!isTauriAvailable()) return null;
    try {
      const column = await invoke<KanbanColumn>('create_column', { input: { name } });
      set((state) => ({ columns: [...state.columns, column] }));
      return column;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create column' });
      return null;
    }
  },

  updateColumn: async (input) => {
    if (!isTauriAvailable()) return null;
    try {
      const updated = await invoke<KanbanColumn>('update_column', { input });
      set((state) => ({
        columns: state.columns.map((c) => (c.id === updated.id ? updated : c)),
      }));
      return updated;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update column' });
      return null;
    }
  },

  deleteColumn: async (id) => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('delete_column', { id });
      set((state) => ({ columns: state.columns.filter((c) => c.id !== id) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete column' });
    }
  },

  reorderColumns: async (ids) => {
    if (!isTauriAvailable()) return;
    try {
      const columns = await invoke<KanbanColumn[]>('reorder_columns', { input: { ids } });
      set({ columns });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to reorder columns' });
    }
  },

  // ── Settings ─────────────────────────────────────────────────────────────

  fetchSettings: async () => {
    if (!isTauriAvailable()) return;
    try {
      const settings = await invoke<AppSettings>('get_settings');
      set({ settings });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch settings' });
    }
  },

  updateSettings: async (vaultDir) => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      const settings = await invoke<AppSettings>('update_settings', { input: { vaultDir } });
      set({ settings, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update settings', isLoading: false });
    }
  },

  updateTheme: async (theme) => {
    if (!isTauriAvailable()) return;
    try {
      const settings = await invoke<AppSettings>('update_theme', { theme });
      set({ settings });
      applyTheme(settings.theme);
      void emit('theme-changed', settings.theme);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update theme' });
    }
  },

  // ── Checklist actions ─────────────────────────────────────────────────────

  getChecklists: async (taskId) => {
    if (!isTauriAvailable()) return null;
    try {
      return await invoke<Checklist[]>('get_checklists', { taskId });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to get checklists' });
      return null;
    }
  },

  createChecklist: async (taskId, title) => {
    if (!isTauriAvailable()) return null;
    try {
      return await invoke<Checklist>('create_checklist', { taskId, title });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create checklist' });
      return null;
    }
  },

  addChecklistItem: async (checklistId, text) => {
    if (!isTauriAvailable()) return null;
    try {
      return await invoke<ChecklistItem>('add_checklist_item', { checklistId, text });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to add checklist item' });
      return null;
    }
  },

  updateChecklistItem: async (id, text, completed) => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('update_checklist_item', { id, text, completed });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update checklist item' });
    }
  },

  deleteChecklist: async (id) => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('delete_checklist', { id });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete checklist' });
    }
  },

  deleteChecklistItem: async (id) => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('delete_checklist_item', { id });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete checklist item' });
    }
  },

  // ── Tag actions ───────────────────────────────────────────────────────────

  fetchTags: async () => {
    if (!isTauriAvailable()) return;
    try {
      const tags = await invoke<Tag[]>('get_tags');
      set({ tags });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch tags' });
    }
  },

  createTag: async (name, color) => {
    if (!isTauriAvailable()) return null;
    try {
      const tag = await invoke<Tag>('create_tag', { name, color });
      set((state) => ({ tags: [...state.tags, tag] }));
      return tag;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create tag' });
      return null;
    }
  },

  updateTag: async (id, name, color) => {
    if (!isTauriAvailable()) return;
    try {
      const updated = await invoke<Tag>('update_tag', { id, name, color });
      set((state) => ({ tags: state.tags.map((t) => (t.id === updated.id ? updated : t)) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update tag' });
    }
  },

  deleteTag: async (id) => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('delete_tag', { id });
      set((state) => ({ tags: state.tags.filter((t) => t.id !== id) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete tag' });
    }
  },

  getTaskTags: async (taskId) => {
    if (!isTauriAvailable()) return null;
    try {
      return await invoke<Tag[]>('get_task_tags', { taskId });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to get task tags' });
      return null;
    }
  },

  setTaskTags: async (taskId, tagIds) => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('set_task_tags', { taskId, tagIds });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to set task tags' });
    }
  },

  // ── Subtask actions ───────────────────────────────────────────────────────

  getSubtasks: async (parentId) => {
    if (!isTauriAvailable()) return null;
    try {
      return await invoke<Task[]>('get_subtasks', { parentId });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to get subtasks' });
      return null;
    }
  },

  selectTask: (id) => set({ selectedTaskId: id }),
  setIsEditorOpen: (isOpen) => set({ isEditorOpen: isOpen }),
  setIsQuickAddOpen: (isOpen) => set({ isQuickAddOpen: isOpen }),
  clearError: () => set({ error: null }),

  listenForUpdates: () => {
    if (!isTauriAvailable()) return () => {};
    const unlistenTasks = listen<TasksUpdatedPayload>(TASKS_UPDATED_EVENT, (event) => {
      if (event.payload?.sourceWindowLabel === getCurrentWindow().label) {
        return;
      }
      void get().fetchTasks();
    });
    const unlistenTheme = listen<string>(THEME_CHANGED_EVENT, (event) => { applyTheme(event.payload); });
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, () => { void get().fetchSettings(); });
    return () => {
      unlistenTasks.then((fn) => fn());
      unlistenTheme.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
  },
}));
