// ── Re-export wrapper for backward compatibility ──────────────────────────────
//
// Phase 3 migration: use-yougile-store is being phased out.
// New code should import from @/store/use-task-store instead.
// This file re-exports the shared state (activeProvider, yougileEnabled, etc.)
// and still owns Yougile-specific data (accounts, projects, boards, etc.).
//
// TODO(Phase 3b): Move remaining Yougile metadata into domain modules.
// ──────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { isTauriAvailable } from '@/lib/tauri';
import { useTaskStore } from '@/store/use-task-store';
import type {
  YougileAccount,
  YougileProject,
  YougileBoard,
  YougileColumn,
  YougileTask,
  YougileUser,
  YougileStringSticker,
  YougileSprintSticker,
  YougileContext,
  YougileCompany,
  YougileChatMessage,
  YougileFileUploadResponse,
  CreateYougileTask,
  UpdateYougileTask,
  YougileSyncState,
} from '@/types/yougile';

const FETCH_TIMEOUT_MS = 15_000;
const CHAT_FETCH_LIMIT = 1_000;

function fileNameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function withTimeout<T>(promise: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export type ActiveSource = 'local' | 'yougile';
const YOUGILE_SYNC_UPDATED_EVENT = 'yougile-sync-updated';

const initialContext: YougileContext = {
  accountId: null,
  projectId: null,
  projectName: null,
  boardId: null,
  boardName: null,
};

// ── State type ────────────────────────────────────────────────────────────────

export interface YougileState {
  // ── Provider-aware state (proxy → use-task-store) ─────────────────────
  /** @deprecated Use useTaskStore.getState().activeProvider instead */
  activeSource: 'local' | 'yougile';
  /** @deprecated Use useTaskStore.getState().setActiveProvider instead */
  setActiveSource: (source: 'local' | 'yougile') => void;
  /** @deprecated Use useTaskStore.getState().yougileEnabled instead */
  yougileEnabled: boolean;
  /** @deprecated Use useTaskStore.getState().setYougileEnabled instead */
  setYougileEnabled: (enabled: boolean) => void;
  /** @deprecated Use useTaskStore.getState().yougileContext instead */
  yougileContext: YougileContext;
  /** @deprecated Use useTaskStore.getState().setYougileContext instead */
  setYougileContext: (ctx: Partial<YougileContext>) => void;

  // Yougile metadata (domain-specific, not moved to use-task-store)
  accounts: YougileAccount[];
  projects: YougileProject[];
  boards: YougileBoard[];
  columns: YougileColumn[];
  tasks: YougileTask[];
  users: YougileUser[];
  stringStickers: YougileStringSticker[];
  sprintStickers: YougileSprintSticker[];
  lastSyncHydratedAt: number;

  isLoading: boolean;
  error: string | null;
  clearError: () => void;

  // Selection (Yougile-specific task list)
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;

  // Account management
  fetchAccounts: () => Promise<void>;
  login: (email: string, password: string) => Promise<YougileCompany[]>;
  addAccount: (email: string, password: string, companyId: string, companyName: string) => Promise<YougileAccount>;
  removeAccount: (accountId: string) => Promise<void>;

  // Hierarchy
  fetchProjects: () => Promise<void>;
  fetchBoards: (projectId: string) => Promise<void>;
  fetchColumns: (boardId: string) => Promise<void>;
  fetchUsers: (projectId: string) => Promise<void>;
  fetchStringStickers: (boardId: string) => Promise<void>;
  fetchSprintStickers: (boardId: string) => Promise<void>;

  // Tasks
  fetchTasks: () => Promise<void>;
  fetchSubtaskTasks: (subtaskIds: string[]) => Promise<YougileTask[]>;
  createTask: (payload: CreateYougileTask) => Promise<YougileTask | null>;
  updateTask: (taskId: string, payload: UpdateYougileTask) => Promise<YougileTask | null>;
  moveTask: (taskId: string, columnId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;

  // Subtasks
  createSubtask: (parentTaskId: string, title: string) => Promise<YougileTask | null>;
  removeSubtask: (parentTaskId: string, subtaskId: string) => Promise<void>;
  toggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;

  // Sync state
  persistSyncState: () => Promise<void>;
  hydrateSyncState: () => Promise<void>;
  listenForSyncUpdates: () => () => void;

  // Provider sync engine
  startSync: () => Promise<void>;
  stopSync: () => Promise<void>;
  listenForProviderSync: () => () => void;

  // Chat & file ops
  chatMessages: YougileChatMessage[];
  chatLoading: boolean;
  companyUsers: YougileUser[];
  sendChatMessage: (taskId: string, text: string) => Promise<YougileChatMessage | null>;
  fetchChatMessages: (taskId: string) => Promise<YougileChatMessage[]>;
  fetchCompanyUsers: () => Promise<void>;
  sendChatWithAttachments: (taskId: string, text: string, files: Array<File | string>) => Promise<boolean>;

  // File uploads
  uploadFile: (taskId: string, file: File) => Promise<YougileFileUploadResponse>;
  uploadFileByPath: (taskId: string, filePath: string) => Promise<YougileFileUploadResponse>;
  downloadFile: (url: string, savePath: string) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortChatMessages(messages: YougileChatMessage[]): YougileChatMessage[] {
  return [...messages].sort((a, b) => a.id - b.id);
}

function applySyncState(
  state: YougileState,
  syncState: YougileSyncState,
): YougileState {
  const accountChanged = state.yougileContext.accountId !== syncState.accountId;
  const projectChanged = accountChanged || state.yougileContext.projectId !== syncState.projectId;
  const boardChanged = projectChanged || state.yougileContext.boardId !== syncState.boardId;

  // Sync the shared provider-aware state in use-task-store
  useTaskStore.getState().setActiveProvider(syncState.activeSource);
  if (syncState.accountId || syncState.projectId || syncState.boardId) {
    useTaskStore.getState().setYougileContext(syncState);
  }

  return {
    ...state,
    lastSyncHydratedAt: Date.now(),
    activeSource: syncState.activeSource,
    yougileContext: {
      accountId: syncState.accountId,
      projectId: syncState.projectId,
      projectName: syncState.projectName,
      boardId: syncState.boardId,
      boardName: syncState.boardName,
    },
    projects: accountChanged ? [] : state.projects,
    boards: projectChanged ? [] : state.boards,
    columns: boardChanged ? [] : state.columns,
    tasks: boardChanged ? [] : state.tasks,
    users: projectChanged ? [] : state.users,
    stringStickers: accountChanged || projectChanged || boardChanged ? [] : state.stringStickers,
    sprintStickers: accountChanged || projectChanged || boardChanged ? [] : state.sprintStickers,
    selectedTaskId: accountChanged || projectChanged || boardChanged ? null : state.selectedTaskId,
  };
}

function scheduleSyncPersist(get: () => YougileState) {
  if (!isTauriAvailable()) return;
  queueMicrotask(() => {
    void get().persistSyncState();
  });
}

export const useYougileStore = create<YougileState>((set, get) => ({
  // ── Initial state (shared from use-task-store for convenience) ──────────

  // Proxy: activeSource, yougileEnabled, yougileContext read from use-task-store.
  // These are accessed via getter fns to stay fresh; stored state is overridden on sync.
  activeSource: useTaskStore.getState().activeProvider,
  yougileEnabled: useTaskStore.getState().yougileEnabled,
  yougileContext: { ...initialContext },

  setActiveSource: (source) => {
    useTaskStore.getState().setActiveProvider(source);
    set({ activeSource: source });
  },
  setYougileEnabled: (enabled) => {
    useTaskStore.getState().setYougileEnabled(enabled);
    set({ yougileEnabled: enabled });
  },
  setYougileContext: (ctx) => {
    useTaskStore.getState().setYougileContext(ctx);
    set((state) => ({ yougileContext: { ...state.yougileContext, ...ctx } }));
    scheduleSyncPersist(get);
  },

  // Yougile-specific state
  accounts: [],
  projects: [],
  boards: [],
  columns: [],
  tasks: [],
  users: [],
  stringStickers: [],
  sprintStickers: [],
  lastSyncHydratedAt: 0,
  isLoading: false,
  error: null,
  selectedTaskId: null,
  chatMessages: [],
  chatLoading: false,
  companyUsers: [],

  selectTask: (id) => set({ selectedTaskId: id }),

  clearError: () => set({ error: null }),

  // ── Account management ──────────────────────────────────────────────────

  fetchAccounts: async () => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      const accounts = await invoke<YougileAccount[]>('yougile_get_accounts');
      set({ accounts, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  login: async (email, password) => {
    if (!isTauriAvailable()) return [];
    set({ isLoading: true, error: null });
    try {
      return await invoke<YougileCompany[]>('yougile_login', { login: email, password });
    } catch (e) {
      set({ error: String(e), isLoading: false });
      return [];
    }
  },

  addAccount: async (email, password, companyId, companyName) => {
    if (!isTauriAvailable()) throw new Error('Not in Tauri environment');
    set({ isLoading: true, error: null });
    try {
      const account = await invoke<YougileAccount>('yougile_add_account', {
        email,
        password,
        companyId,
        companyName,
      });
      set((state) => ({ accounts: [...state.accounts, account], isLoading: false }));
      return account;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  removeAccount: async (accountId) => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      await invoke('yougile_remove_account', { accountId });
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== accountId),
        projects: state.projects.filter((p) => {
          const account = state.accounts.find((a) => a.id === accountId);
          return !account || p.id !== account.companyId;
        }),
        isLoading: false,
      }));
      scheduleSyncPersist(get);
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  // ── Hierarchy ───────────────────────────────────────────────────────────

  fetchProjects: async () => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ isLoading: true, error: null });
    try {
      const projects = await withTimeout(
        invoke<YougileProject[]>('yougile_get_projects', {
          accountId: yougileContext.accountId,
        }),
      );
      set({ projects, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchBoards: async (projectId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ isLoading: true, error: null });
    try {
      const boards = await withTimeout(
        invoke<YougileBoard[]>('yougile_get_boards', {
          accountId: yougileContext.accountId,
          projectId,
        }),
      );
      set({ boards, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchColumns: async (boardId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ isLoading: true, error: null });
    try {
      const columns = await withTimeout(
        invoke<YougileColumn[]>('yougile_get_columns', {
          accountId: yougileContext.accountId,
          boardId,
        }),
      );
      set({ columns, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchUsers: async (projectId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ isLoading: true, error: null });
    try {
      const users = await withTimeout(
        invoke<YougileUser[]>('yougile_get_users', {
          accountId: yougileContext.accountId,
          projectId,
        }),
      );
      set({ users, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchStringStickers: async (boardId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ isLoading: true, error: null });
    try {
      const stickers = await withTimeout(
        invoke<YougileStringSticker[]>('yougile_get_string_stickers', {
          accountId: yougileContext.accountId,
          boardId,
        }),
      );
      set({ stringStickers: stickers, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchSprintStickers: async (boardId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ isLoading: true, error: null });
    try {
      const stickers = await withTimeout(
        invoke<YougileSprintSticker[]>('yougile_get_sprint_stickers', {
          accountId: yougileContext.accountId,
          boardId,
        }),
      );
      set({ sprintStickers: stickers, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  // ── Tasks ───────────────────────────────────────────────────────────────

  fetchTasks: async () => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId || !yougileContext.boardId) return;
    set({ isLoading: true, error: null });
    try {
      const tasks = await withTimeout(
        invoke<YougileTask[]>('yougile_get_board_tasks', {
          accountId: yougileContext.accountId,
          boardId: yougileContext.boardId,
        }),
      );
      const filtered = tasks.filter((t) => !t.deleted);
      set({ tasks: filtered, isLoading: false });
      // Sync to unified store directly (no extra API call)
      void useTaskStore.getState().setYougileTasks(filtered);
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchSubtaskTasks: async (subtaskIds: string[]) => {
    if (!isTauriAvailable()) return [];
    const { yougileContext } = get();
    if (!yougileContext.accountId) return [];
    try {
      return await Promise.all(
        subtaskIds.map((id) =>
          invoke<YougileTask>('yougile_get_task', {
            accountId: yougileContext.accountId,
            taskId: id,
          }),
        ),
      );
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },

  createTask: async (payload) => {
    if (!isTauriAvailable()) return null;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return null;
    try {
      const task = await invoke<YougileTask>('yougile_create_task', {
        accountId: yougileContext.accountId,
        payload,
      });
      set((state) => ({ tasks: [task, ...state.tasks] }));
      return task;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  updateTask: async (taskId, payload) => {
    if (!isTauriAvailable()) return null;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return null;
    try {
      const updated = await invoke<YougileTask>('yougile_update_task', {
        accountId: yougileContext.accountId,
        taskId,
        payload,
      });
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
      return updated;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  moveTask: async (taskId, columnId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    try {
      const updated = await invoke<YougileTask>('yougile_update_task', {
        accountId: yougileContext.accountId,
        taskId,
        payload: { columnId },
      });
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteTask: async (taskId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    try {
      await invoke('yougile_delete_task', {
        accountId: yougileContext.accountId,
        taskId,
      });
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── Subtasks ────────────────────────────────────────────────────────────

  createSubtask: async (parentTaskId, title) => {
    if (!isTauriAvailable()) return null;
    const { yougileContext, tasks } = get();
    if (!yougileContext.accountId) return null;
    const parent = tasks.find((t) => t.id === parentTaskId);
    if (!parent) return null;
    const columnId = parent.columnId;
    if (!columnId) return null;

    try {
      // Create subtask as a new Yougile task linked to parent
      const subtask = await invoke<YougileTask>('yougile_create_task', {
        accountId: yougileContext.accountId,
        payload: { title, columnId, description: `subtask of ${parentTaskId}` },
      });

      // Link subtask to parent via subtasks array
      const updatedParent = await invoke<YougileTask>('yougile_update_task', {
        accountId: yougileContext.accountId,
        taskId: parentTaskId,
        payload: { subtasks: [...parent.subtasks, subtask.id] },
      });

      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === parentTaskId ? updatedParent : t.id === subtask.id ? subtask : t,
        ),
      }));
      return subtask;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  removeSubtask: async (parentTaskId, subtaskId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext, tasks } = get();
    if (!yougileContext.accountId) return;
    const parent = tasks.find((t) => t.id === parentTaskId);
    if (!parent) return;

    try {
      await invoke('yougile_delete_task', {
        accountId: yougileContext.accountId,
        taskId: subtaskId,
      });

      const updatedParent = await invoke<YougileTask>('yougile_update_task', {
        accountId: yougileContext.accountId,
        taskId: parentTaskId,
        payload: { subtasks: parent.subtasks.filter((id) => id !== subtaskId) },
      });

      set((state) => ({
        tasks: state.tasks
          .filter((t) => t.id !== subtaskId)
          .map((t) => (t.id === parentTaskId ? updatedParent : t)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleSubtask: async (subtaskId, completed) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    try {
      const updated = await invoke<YougileTask>('yougile_update_task', {
        accountId: yougileContext.accountId,
        taskId: subtaskId,
        payload: { completed },
      });
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === subtaskId ? updated : t)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── Sync state ──────────────────────────────────────────────────────────

  hydrateSyncState: async () => {
    if (!isTauriAvailable()) return;
    set({ isLoading: true, error: null });
    try {
      const syncState = await invoke<YougileSyncState>('get_yougile_sync_state');
      set((state) => {
        const newState = applySyncState(state, syncState);
        return { ...newState, isLoading: false };
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  persistSyncState: async () => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    const taskStore = useTaskStore.getState();
    const synced = {
      accountId: yougileContext.accountId,
      projectId: yougileContext.projectId,
      projectName: yougileContext.projectName,
      boardId: yougileContext.boardId,
      boardName: yougileContext.boardName,
      activeSource: taskStore.activeProvider,
    } satisfies YougileSyncState;

    try {
      const saved = await invoke<YougileSyncState>('update_yougile_sync_state', { state: synced });
      await emit(YOUGILE_SYNC_UPDATED_EVENT, saved);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  listenForSyncUpdates: () => {
    if (!isTauriAvailable()) return () => {};
    const unlisten = listen<YougileSyncState>(YOUGILE_SYNC_UPDATED_EVENT, (event) => {
      set((state) => applySyncState(state, event.payload));
    }).catch(() => {});
    return () => {
      void unlisten.then((fn) => { if (typeof fn === 'function') fn(); }).catch(() => {});
    };
  },

  // ── Provider sync engine ────────────────────────────────────────────────

  startSync: async () => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId || !yougileContext.boardId) return;
    try {
      await invoke('start_provider_sync', {
        providerId: 'yougile',
        accountId: yougileContext.accountId,
        boardId: yougileContext.boardId,
        intervalMs: 30_000,
      });
    } catch (e) {
      console.warn('Failed to start Yougile sync:', e);
    }
  },

  stopSync: async () => {
    if (!isTauriAvailable()) return;
    try {
      await invoke('stop_provider_sync', {
        providerId: 'yougile',
      });
    } catch (e) {
      console.warn('Failed to stop Yougile sync:', e);
    }
  },

  listenForProviderSync: () => {
    if (!isTauriAvailable()) return () => {};
    const unlisten = listen('provider-tasks-updated', (event) => {
      const payload = event.payload as { provider: string; tasks: YougileTask[] };
      if (payload.provider !== 'yougile') return;
      const taskStore = useTaskStore.getState();
      if (taskStore.activeProvider !== 'yougile') return;
      const filtered = payload.tasks.filter((t) => !t.deleted);
      // Update Yougile store tasks too for backward compat
      set({ tasks: filtered, isLoading: false, error: null });
      // Sync to unified store directly (no extra API call)
      taskStore.setYougileTasks(filtered);
    });
    return () => {
      void unlisten.then((fn) => { if (typeof fn === 'function') fn(); });
    };
  },

  // ── Chat & file ops ─────────────────────────────────────────────────────

  sendChatMessage: async (taskId, text) => {
    if (!isTauriAvailable()) return null;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return null;
    try {
      const msg = await invoke<YougileChatMessage>('yougile_send_chat_message', {
        accountId: yougileContext.accountId,
        taskId,
        text,
      });
      set((state) => ({ chatMessages: [...state.chatMessages, msg] }));
      return msg;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  fetchChatMessages: async (taskId) => {
    if (!isTauriAvailable()) return [];
    const { yougileContext } = get();
    if (!yougileContext.accountId) return [];
    set({ chatLoading: true });
    try {
      const messages = await invoke<YougileChatMessage[]>('yougile_get_chat_messages', {
        accountId: yougileContext.accountId,
        taskId,
        limit: CHAT_FETCH_LIMIT,
      });
      const sorted = sortChatMessages(messages);
      set({ chatMessages: sorted, chatLoading: false });
      return sorted;
    } catch (e) {
      set({ error: String(e), chatLoading: false });
      return [];
    }
  },

  sendChatWithAttachments: async (taskId, text, files) => {
    if (!isTauriAvailable()) return false;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return false;

    try {
      // Upload each file first, then send text with file URLs
      const urls: string[] = [];
      for (const file of files) {
        if (typeof file === 'string') {
          const response = await invoke<YougileFileUploadResponse>('yougile_upload_file_path', {
            accountId: yougileContext.accountId,
            taskId,
            filePath: file,
          });
          urls.push(response.fullUrl);
        } else {
          const response = await get().uploadFile(taskId, file);
          urls.push(response.fullUrl);
        }
      }

      const attachmentText = [text, ...urls.map((url) => `<a href="${url}">${fileNameFromPath(url)}</a>`)].join('\n');
      await get().sendChatMessage(taskId, attachmentText);
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  fetchCompanyUsers: async () => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId || !yougileContext.projectId) return;
    set({ isLoading: true, error: null });
    try {
      const users = await withTimeout(
        invoke<YougileUser[]>('yougile_get_all_users', {
          accountId: yougileContext.accountId,
        }),
      );
      set({ users, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  // ── File uploads ────────────────────────────────────────────────────────

  uploadFile: async (taskId, file) => {
    if (!isTauriAvailable()) throw new Error('Not in Tauri environment');
    const { yougileContext } = get();
    if (!yougileContext.accountId) throw new Error('No account selected');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      return await invoke<YougileFileUploadResponse>('yougile_upload_file', {
        accountId: yougileContext.accountId,
        taskId,
        fileName: file.name,
        fileData: Array.from(uint8Array),
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  uploadFileByPath: async (taskId, filePath) => {
    if (!isTauriAvailable()) throw new Error('Not in Tauri environment');
    const { yougileContext } = get();
    if (!yougileContext.accountId) throw new Error('No account selected');

    try {
      return await invoke<YougileFileUploadResponse>('yougile_upload_file_path', {
        accountId: yougileContext.accountId,
        taskId,
        filePath,
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  downloadFile: async (url, savePath) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;

    try {
      await invoke('yougile_download_file', { url, savePath });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
