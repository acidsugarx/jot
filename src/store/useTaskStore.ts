import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, CreateTaskInput, Task, UpdateTaskStatusInput } from '../types';

interface TaskState {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
  settings: AppSettings | null;
  selectedTaskId: string | null;

  // Actions
  fetchTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task>;
  updateTaskStatus: (input: UpdateTaskStatusInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  openLinkedNote: (path: string) => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateSettings: (vaultDir: string | null) => Promise<void>;
  selectTask: (id: string | null) => void;
  clearError: () => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  isLoading: false,
  error: null,
  settings: null,
  selectedTaskId: null,

  fetchTasks: async () => {
    // Check if Tauri is available
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const tasks = await invoke<Task[]>('get_tasks');
      set({ tasks, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch tasks',
        isLoading: false,
      });
    }
  },

  createTask: async (input) => {
    // Check if Tauri is available
    if (!('__TAURI_INTERNALS__' in window)) {
      throw new Error('Tauri not available');
    }

    set({ isLoading: true, error: null });
    try {
      const task = await invoke<Task>('create_task', { input });
      set((state) => ({
        tasks: [task, ...state.tasks],
        isLoading: false,
      }));
      return task;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create task',
        isLoading: false,
      });
      throw error;
    }
  },

  updateTaskStatus: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const updatedTask = await invoke<Task>('update_task_status', { input });
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === updatedTask.id ? updatedTask : task
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update task',
        isLoading: false,
      });
      throw error;
    }
  },

  deleteTask: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_task', { id });
      set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id),
        selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete task',
        isLoading: false,
      });
      throw error;
    }
  },

  openLinkedNote: async (path) => {
    try {
      await invoke('open_linked_note', { path });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to open linked note',
      });
      throw error;
    }
  },

  fetchSettings: async () => {
    // Check if Tauri is available
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }

    try {
      const settings = await invoke<AppSettings>('get_settings');
      set({ settings });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch settings',
      });
    }
  },

  updateSettings: async (vaultDir) => {
    set({ isLoading: true, error: null });
    try {
      const settings = await invoke<AppSettings>('update_settings', {
        input: { vault_dir: vaultDir },
      });
      set({ settings, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update settings',
        isLoading: false,
      });
      throw error;
    }
  },

  selectTask: (id) => {
    set({ selectedTaskId: id });
  },

  clearError: () => {
    set({ error: null });
  },
}));
