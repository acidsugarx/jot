import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isTauriAvailable } from '@/lib/tauri';
import type {
  CreateTaskTemplateInput,
  TaskTemplate,
  UpdateTaskTemplateInput,
  YougileChecklist,
} from '@/types/yougile';

interface TaskTemplateRecord extends Omit<TaskTemplate, 'checklists' | 'stickers'> {
  checklists: string;
  stickers: string;
}

interface TemplateState {
  templates: TaskTemplate[];
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  fetchTemplates: () => Promise<void>;
  createTemplate: (input: CreateTaskTemplateInput) => Promise<TaskTemplate | null>;
  updateTemplate: (input: UpdateTaskTemplateInput) => Promise<TaskTemplate | null>;
  deleteTemplate: (id: string) => Promise<void>;
}

function parseChecklists(value: string): YougileChecklist[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as YougileChecklist[] : [];
  } catch {
    return [];
  }
}

function parseStickers(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, stickerValue]) => {
        if (typeof stickerValue === 'string') {
          acc[key] = stickerValue;
        }
        return acc;
      },
      {},
    );
  } catch {
    return {};
  }
}

function toTemplate(record: TaskTemplateRecord): TaskTemplate {
  return {
    ...record,
    checklists: parseChecklists(record.checklists),
    stickers: parseStickers(record.stickers),
  };
}

function serializeChecklists(checklists: YougileChecklist[] | undefined | null): string | undefined {
  if (checklists === undefined) return undefined;
  return JSON.stringify(checklists ?? []);
}

function serializeStickers(
  stickers: Record<string, string> | undefined | null
): string | undefined {
  if (stickers === undefined) return undefined;
  return JSON.stringify(stickers ?? {});
}

function toOptionalCreateText(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function toOptionalUpdateText(value: string | null | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ?? '';
}

export const useTemplateStore = create<TemplateState>((set) => ({
  templates: [],
  isLoading: false,
  error: null,

  clearError: () => set({ error: null }),

  fetchTemplates: async () => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      const templates = await invoke<TaskTemplateRecord[]>('get_task_templates');
      set({
        templates: templates.map(toTemplate),
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch task templates',
        isLoading: false,
      });
    }
  },

  createTemplate: async (input) => {
    if (!isTauriAvailable()) return null;
    set({ isLoading: true, error: null });
    try {
      const created = await invoke<TaskTemplateRecord>('create_task_template', {
        input: {
          title: input.title,
          description: toOptionalCreateText(input.description),
          color: toOptionalCreateText(input.color),
          checklists: serializeChecklists(input.checklists),
          stickers: serializeStickers(input.stickers),
          columnId: toOptionalCreateText(input.columnId),
        },
      });
      const template = toTemplate(created);
      set((state) => ({
        templates: [template, ...state.templates],
        isLoading: false,
      }));
      return template;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create task template',
        isLoading: false,
      });
      return null;
    }
  },

  updateTemplate: async (input) => {
    if (!isTauriAvailable()) return null;
    set({ isLoading: true, error: null });
    try {
      const updated = await invoke<TaskTemplateRecord>('update_task_template', {
        input: {
          id: input.id,
          title: input.title,
          description: toOptionalUpdateText(input.description),
          color: toOptionalUpdateText(input.color),
          checklists: serializeChecklists(input.checklists),
          stickers: serializeStickers(input.stickers),
          columnId: toOptionalUpdateText(input.columnId),
        },
      });
      const template = toTemplate(updated);
      set((state) => ({
        templates: state.templates.map((item) => (item.id === template.id ? template : item)),
        isLoading: false,
      }));
      return template;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update task template',
        isLoading: false,
      });
      return null;
    }
  },

  deleteTemplate: async (id) => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_task_template', { id });
      set((state) => ({
        templates: state.templates.filter((template) => template.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete task template',
        isLoading: false,
      });
    }
  },
}));
