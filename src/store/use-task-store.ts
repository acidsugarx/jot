import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  AppSettings,
  CreateTaskInput,
  KanbanColumn,
  Task,
  UpdateColumnInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from '@/types';

const TASKS_UPDATED_EVENT = 'tasks-updated';
const THEME_CHANGED_EVENT = 'theme-changed';

function notifyTasksChanged() {
  if ('__TAURI_INTERNALS__' in window) {
    void emit(TASKS_UPDATED_EVENT);
  }
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
  if ('__TAURI_INTERNALS__' in window) {
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
  createTask: (input: CreateTaskInput) => Promise<Task>;
  updateTask: (input: UpdateTaskInput) => Promise<Task>;
  updateTaskStatus: (input: UpdateTaskStatusInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  openLinkedNote: (path: string) => Promise<void>;

  fetchColumns: () => Promise<void>;
  createColumn: (name: string) => Promise<KanbanColumn>;
  updateColumn: (input: UpdateColumnInput) => Promise<KanbanColumn>;
  deleteColumn: (id: string) => Promise<void>;
  reorderColumns: (ids: string[]) => Promise<void>;

  fetchSettings: () => Promise<void>;
  updateSettings: (vaultDir: string | null) => Promise<void>;
  updateTheme: (theme: string) => Promise<void>;
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

  fetchTasks: async () => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    set({ isLoading: true, error: null });
    try {
      const tasks = await invoke<Task[]>('get_tasks');
      set({ tasks, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch tasks', isLoading: false });
    }
  },

  createTask: async (input) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    set({ isLoading: true, error: null });
    try {
      const task = await invoke<Task>('create_task', { input });
      set((state) => ({ tasks: [task, ...state.tasks], isLoading: false }));
      notifyTasksChanged();
      return task;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create task', isLoading: false });
      throw error;
    }
  },

  updateTask: async (input) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    try {
      const updatedTask = await invoke<Task>('update_task', { input });
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
      }));
      notifyTasksChanged();
      return updatedTask;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update task' });
      throw error;
    }
  },

  updateTaskStatus: async (input) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
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
      throw error;
    }
  },

  deleteTask: async (id) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
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
      throw error;
    }
  },

  openLinkedNote: async (path) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    try {
      await invoke('open_linked_note', { path });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to open linked note' });
      throw error;
    }
  },

  // ── Column actions ───────────────────────────────────────────────────────

  fetchColumns: async () => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    try {
      const columns = await invoke<KanbanColumn[]>('get_columns');
      set({ columns });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch columns' });
    }
  },

  createColumn: async (name) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    try {
      const column = await invoke<KanbanColumn>('create_column', { input: { name } });
      set((state) => ({ columns: [...state.columns, column] }));
      return column;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create column' });
      throw error;
    }
  },

  updateColumn: async (input) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    try {
      const updated = await invoke<KanbanColumn>('update_column', { input });
      set((state) => ({
        columns: state.columns.map((c) => (c.id === updated.id ? updated : c)),
      }));
      return updated;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update column' });
      throw error;
    }
  },

  deleteColumn: async (id) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    try {
      await invoke('delete_column', { id });
      set((state) => ({ columns: state.columns.filter((c) => c.id !== id) }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete column' });
      throw error;
    }
  },

  reorderColumns: async (ids) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    try {
      const columns = await invoke<KanbanColumn[]>('reorder_columns', { input: { ids } });
      set({ columns });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to reorder columns' });
      throw error;
    }
  },

  // ── Settings ─────────────────────────────────────────────────────────────

  fetchSettings: async () => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    try {
      const settings = await invoke<AppSettings>('get_settings');
      set({ settings });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch settings' });
    }
  },

  updateSettings: async (vaultDir) => {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Tauri not available');
    set({ isLoading: true, error: null });
    try {
      const settings = await invoke<AppSettings>('update_settings', { input: { vaultDir } });
      set({ settings, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update settings', isLoading: false });
      throw error;
    }
  },

  updateTheme: async (theme) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    try {
      const settings = await invoke<AppSettings>('update_theme', { theme });
      set({ settings });
      applyTheme(settings.theme);
      void emit('theme-changed', settings.theme);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update theme' });
    }
  },

  selectTask: (id) => set({ selectedTaskId: id }),
  setIsEditorOpen: (isOpen) => set({ isEditorOpen: isOpen }),
  setIsQuickAddOpen: (isOpen) => set({ isQuickAddOpen: isOpen }),
  clearError: () => set({ error: null }),

  listenForUpdates: () => {
    if (!('__TAURI_INTERNALS__' in window)) return () => {};
    const unlistenTasks = listen(TASKS_UPDATED_EVENT, () => { void get().fetchTasks(); });
    const unlistenTheme = listen<string>(THEME_CHANGED_EVENT, (event) => { applyTheme(event.payload); });
    return () => {
      unlistenTasks.then((fn) => fn());
      unlistenTheme.then((fn) => fn());
    };
  },
}));
