import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TemplateState = ReturnType<typeof createTemplateState>;
type YougileState = ReturnType<typeof createYougileState>;

const { useTemplateStoreMock, useYougileStoreMock } = vi.hoisted(() => ({
  useTemplateStoreMock: Object.assign(vi.fn(), { getState: vi.fn() }),
  useYougileStoreMock: Object.assign(vi.fn(), { getState: vi.fn() }),
}));

let templateState: TemplateState;
let yougileState: YougileState;

function createTemplateState() {
  return {
    templates: [] as Array<{
      id: string;
      title: string;
      description: string | null;
      color: string | null;
      checklists: Array<{ id?: string; title: string; items: Array<{ id?: string; title: string; completed: boolean }> }>;
      stickers: Record<string, string>;
      columnId: string | null;
      createdAt: string;
      updatedAt: string;
    }>,
    isLoading: false,
    error: null as string | null,
    clearError: vi.fn(),
    fetchTemplates: vi.fn().mockResolvedValue(undefined),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn().mockResolvedValue(undefined),
  };
}

function createYougileState() {
  return {
    yougileContext: {
      accountId: 'account-1',
      projectId: 'project-1',
      projectName: 'Core',
      boardId: 'board-1',
      boardName: 'Board A',
    },
    columns: [
      { id: 'column-1', title: 'Inbox', deleted: false },
      { id: 'column-2', title: 'QA', deleted: false },
    ],
    stringStickers: [
      {
        id: 'sticker-1',
        name: 'Priority',
        deleted: false,
        states: [
          { id: 'state-high', name: 'High', color: '#ef4444', deleted: false },
        ],
      },
    ],
    sprintStickers: [],
    hydrateSyncState: vi.fn().mockResolvedValue(undefined),
    fetchColumns: vi.fn().mockResolvedValue(undefined),
    fetchStringStickers: vi.fn().mockResolvedValue(undefined),
    fetchSprintStickers: vi.fn().mockResolvedValue(undefined),
    error: null as string | null,
    clearError: vi.fn(),
  };
}

vi.mock('@/store/use-template-store', () => ({
  useTemplateStore: useTemplateStoreMock,
}));

vi.mock('@/store/use-yougile-store', () => ({
  useYougileStore: useYougileStoreMock,
}));

import { TaskTemplatesSettings } from '@/components/TaskTemplatesSettings';

describe('TaskTemplatesSettings', () => {
  beforeEach(() => {
    templateState = createTemplateState();
    yougileState = createYougileState();
    useTemplateStoreMock.mockImplementation(() => templateState);
    useTemplateStoreMock.getState.mockImplementation(() => templateState);
    useYougileStoreMock.mockImplementation(() => yougileState);
    useYougileStoreMock.getState.mockImplementation(() => yougileState);
  });

  it('creates a new template from the settings form', async () => {
    templateState.createTemplate.mockImplementation(async (input) => ({
      id: 'template-1',
      title: input.title,
      description: input.description ?? null,
      color: input.color ?? null,
      checklists: input.checklists ?? [],
      stickers: input.stickers ?? {},
      columnId: input.columnId ?? null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }));

    render(<TaskTemplatesSettings />);

    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    fireEvent.change(screen.getByPlaceholderText(/bug report/i), {
      target: { value: 'Incident Template' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create template/i }));

    await waitFor(() => {
      expect(templateState.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Incident Template',
          columnId: 'column-1',
          checklists: [],
          stickers: {},
        }),
      );
    });
  });

  it('updates the selected template', async () => {
    templateState.templates = [
      {
        id: 'template-1',
        title: 'Bug Report',
        description: null,
        color: 'task-red',
        checklists: [],
        stickers: { 'sticker-1': 'state-high' },
        columnId: 'column-2',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    templateState.updateTemplate.mockImplementation(async (input) => ({
      ...templateState.templates[0]!,
      ...input,
      description: input.description ?? null,
      color: input.color ?? null,
      checklists: input.checklists ?? [],
      stickers: input.stickers ?? {},
      columnId: input.columnId ?? null,
      title: input.title ?? templateState.templates[0]!.title,
    }));

    render(<TaskTemplatesSettings />);

    const titleInput = screen.getByDisplayValue('Bug Report');
    fireEvent.change(titleInput, { target: { value: 'Bug Report v2' } });
    fireEvent.click(screen.getByRole('button', { name: /update template/i }));

    await waitFor(() => {
      expect(templateState.updateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'template-1',
          title: 'Bug Report v2',
          columnId: 'column-2',
          stickers: { 'sticker-1': 'state-high' },
        }),
      );
    });
  });
});
