import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInvoke,
  mockEmit,
  mockWindowApi,
  useTaskStoreMock,
  useYougileStoreMock,
  useTemplateStoreMock,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockEmit: vi.fn(),
  mockWindowApi: {
    label: 'main',
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
    setSize: vi.fn(),
    setPosition: vi.fn(),
    setFocus: vi.fn(),
  },
  useTaskStoreMock: vi.fn(),
  useYougileStoreMock: Object.assign(vi.fn(), { getState: vi.fn() }),
  useTemplateStoreMock: Object.assign(vi.fn(), { getState: vi.fn() }),
}));

const taskStoreState = {
  tasks: [],
  settings: { vaultDir: null, theme: 'dark', yougileEnabled: true },
  error: null as string | null,
  fetchTasks: vi.fn(),
  fetchSettings: vi.fn(),
  createTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  openLinkedNote: vi.fn(),
  clearError: vi.fn(),
  listenForUpdates: vi.fn(() => () => {}),
};

const yougileStoreState = {
  yougileEnabled: true,
  activeSource: 'yougile' as const,
  setActiveSource: vi.fn(),
  setYougileEnabled: vi.fn(),
  yougileContext: {
    accountId: 'account-1',
    projectId: 'project-1',
    projectName: 'Core',
    boardId: 'board-1',
    boardName: 'Board A',
  },
  accounts: [{ id: 'account-1', companyName: 'Acme', email: 'a@acme.test' }],
  projects: [],
  boards: [],
  columns: [
    { id: 'column-1', title: 'Inbox', deleted: false },
    { id: 'column-template', title: 'QA', deleted: false },
  ],
  tasks: [],
  fetchAccounts: vi.fn(),
  fetchProjects: vi.fn(),
  fetchBoards: vi.fn(),
  fetchColumns: vi.fn(),
  fetchTasks: vi.fn(),
  fetchUsers: vi.fn(),
  hydrateSyncState: vi.fn(),
  setYougileContext: vi.fn(),
  selectTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  error: null as string | null,
  clearError: vi.fn(),
};

const templateStoreState = {
  templates: [
    {
      id: 'template-1',
      title: 'Bug Report',
      description: '<p>Template body</p>',
      color: 'task-red',
      checklists: [
        {
          title: 'Triage',
          items: [{ title: 'Repro', completed: false }],
        },
      ],
      stickers: { 'sticker-1': 'state-high' },
      columnId: 'column-template',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  isLoading: false,
  error: null as string | null,
  clearError: vi.fn(),
  fetchTemplates: vi.fn(),
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: mockEmit,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockWindowApi,
}));

vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
  LogicalPosition: class LogicalPosition {
    constructor(public x: number, public y: number) {}
  },
}));

vi.mock('@/store/use-task-store', () => ({
  useTaskStore: useTaskStoreMock,
}));

vi.mock('@/store/use-yougile-store', () => ({
  useYougileStore: useYougileStoreMock,
}));

vi.mock('@/store/use-template-store', () => ({
  useTemplateStore: useTemplateStoreMock,
}));

import App from './App';

describe('App', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    window.localStorage.clear();
    useTaskStoreMock.mockImplementation(() => taskStoreState);
    useYougileStoreMock.mockImplementation(() => yougileStoreState);
    useYougileStoreMock.getState.mockImplementation(() => yougileStoreState);
    useTemplateStoreMock.mockImplementation(() => templateStoreState);
    useTemplateStoreMock.getState.mockImplementation(() => templateStoreState);
    mockInvoke.mockReset();
    mockEmit.mockReset();
    mockWindowApi.onFocusChanged.mockClear();
    mockWindowApi.setSize.mockClear();
    mockWindowApi.setPosition.mockClear();
    taskStoreState.fetchTasks.mockReset();
    taskStoreState.fetchTasks.mockResolvedValue(undefined);
    taskStoreState.fetchSettings.mockReset();
    taskStoreState.fetchSettings.mockResolvedValue(undefined);
    taskStoreState.clearError.mockReset();
    taskStoreState.listenForUpdates.mockReturnValue(() => () => {});
    yougileStoreState.fetchAccounts.mockReset();
    yougileStoreState.fetchAccounts.mockResolvedValue(undefined);
    yougileStoreState.fetchColumns.mockReset();
    yougileStoreState.fetchColumns.mockResolvedValue(undefined);
    yougileStoreState.fetchTasks.mockReset();
    yougileStoreState.fetchTasks.mockResolvedValue(undefined);
    yougileStoreState.fetchUsers.mockReset();
    yougileStoreState.fetchUsers.mockResolvedValue(undefined);
    yougileStoreState.fetchProjects.mockReset();
    yougileStoreState.fetchProjects.mockResolvedValue(undefined);
    yougileStoreState.fetchBoards.mockReset();
    yougileStoreState.fetchBoards.mockResolvedValue(undefined);
    yougileStoreState.hydrateSyncState.mockReset();
    yougileStoreState.hydrateSyncState.mockResolvedValue(undefined);
    yougileStoreState.createTask.mockReset();
    templateStoreState.fetchTemplates.mockReset();
    templateStoreState.fetchTemplates.mockResolvedValue(undefined);
    yougileStoreState.createTask.mockResolvedValue({
      id: 'task-1',
      title: 'Bug Report',
      description: '<p>Template body</p>',
      columnId: 'column-template',
      completed: false,
      archived: false,
      deleted: false,
      assigned: [],
      subtasks: [],
      checklists: [],
      stickers: {},
    });
  });

  it('renders the popup shell', () => {
    render(<App />);

    expect(screen.getByPlaceholderText(/type a task/i)).toBeInTheDocument();
  });

  it('creates a Yougile task from a selected template', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('Create from Template…'));
    fireEvent.click(screen.getByText('Bug Report'));

    expect(screen.getByText('TEMPLATE')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText(/type a task/i), { key: 'Enter' });

    await waitFor(() => {
      expect(yougileStoreState.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bug Report',
          rawInput: 'Bug Report',
          columnId: 'column-template',
          description: '<p>Template body</p>',
          color: 'task-red',
          stickers: { 'sticker-1': 'state-high' },
          checklists: [
            expect.objectContaining({
              title: 'Triage',
            }),
          ],
        }),
      );
    });
  });

  it('opens the dashboard templates tab from the New Template action', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('New Template…'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_window');
      expect(mockInvoke).toHaveBeenCalledWith('open_dashboard_window');
    });
  });

  it('sends the current capture draft into template creation flow', async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText(/type a task/i), {
      target: { value: 'Incident Review' },
    });

    fireEvent.click(screen.getByText('Save As Template…'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_window');
      expect(mockInvoke).toHaveBeenCalledWith('open_dashboard_window');
    });

    expect(JSON.parse(window.localStorage.getItem('jot:settings:template-intent') ?? '{}')).toEqual(
      expect.objectContaining({
        mode: 'new',
        draft: expect.objectContaining({
          title: 'Incident Review',
        }),
      }),
    );
  });

  it('opens template management from the template picker', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('Create from Template…'));
    fireEvent.click(screen.getByText('Manage Templates…'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_window');
      expect(mockInvoke).toHaveBeenCalledWith('open_dashboard_window');
    });
  });
});
