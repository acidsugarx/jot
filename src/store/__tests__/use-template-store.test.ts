import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

import { useTemplateStore } from '@/store/use-template-store';

describe('useTemplateStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    useTemplateStore.setState({
      templates: [],
      isLoading: false,
      error: null,
    });
  });

  it('parses template records from the backend into typed frontend state', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        id: 'template-1',
        title: 'Bug report',
        description: '<p>Body</p>',
        color: 'task-red',
        checklists: '[{"title":"Triage","items":[{"title":"Repro","completed":false}]}]',
        stickers: '{"sticker-1":"state-1"}',
        columnId: 'column-1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    await useTemplateStore.getState().fetchTemplates();

    expect(useTemplateStore.getState().templates).toEqual([
      expect.objectContaining({
        id: 'template-1',
        title: 'Bug report',
        checklists: [
          expect.objectContaining({
            title: 'Triage',
            items: [expect.objectContaining({ title: 'Repro', completed: false })],
          }),
        ],
        stickers: { 'sticker-1': 'state-1' },
      }),
    ]);
  });

  it('serializes checklist and sticker payloads when creating a template', async () => {
    mockInvoke.mockResolvedValueOnce({
      id: 'template-2',
      title: 'Incident',
      description: null,
      color: null,
      checklists: '[{"title":"Ops","items":[{"title":"Page team","completed":true}]}]',
      stickers: '{"sticker-1":"state-2"}',
      columnId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await useTemplateStore.getState().createTemplate({
      title: 'Incident',
      checklists: [
        {
          title: 'Ops',
          items: [{ title: 'Page team', completed: true }],
        },
      ],
      stickers: {
        'sticker-1': 'state-2',
      },
    });

    expect(mockInvoke).toHaveBeenCalledWith('create_task_template', {
      input: expect.objectContaining({
        title: 'Incident',
        checklists: '[{"title":"Ops","items":[{"title":"Page team","completed":true}]}]',
        stickers: '{"sticker-1":"state-2"}',
      }),
    });
    expect(useTemplateStore.getState().templates[0]).toEqual(
      expect.objectContaining({
        title: 'Incident',
        stickers: { 'sticker-1': 'state-2' },
      }),
    );
  });
});
