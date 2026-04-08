import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { escapeHtml } from '@/lib/formatting';
import { isTauriAvailable } from '@/lib/tauri';
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
const UPLOAD_TIMEOUT_MS = 90_000;
const CHAT_FETCH_LIMIT = 1_000;
const IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|heic|heif|avif)$/i;

function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('image/') || IMAGE_FILE_RE.test(file.name);
}

function isImageFileName(fileName: string): boolean {
  return IMAGE_FILE_RE.test(fileName);
}

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

const FETCH_DEBOUNCE_MS = 2_000;

export type ActiveSource = 'local' | 'yougile';
const YOUGILE_SYNC_UPDATED_EVENT = 'yougile-sync-updated';
const YOUGILE_TASKS_UPDATED_EVENT = 'yougile-tasks-updated';

const initialContext: YougileContext = {
  accountId: null,
  projectId: null,
  projectName: null,
  boardId: null,
  boardName: null,
};

interface YougileState {
  // Feature flag (persisted from settings)
  yougileEnabled: boolean;
  setYougileEnabled: (enabled: boolean) => void;

  // Source switching
  activeSource: ActiveSource;
  setActiveSource: (source: ActiveSource) => void;

  // Navigation context
  yougileContext: YougileContext;
  setYougileContext: (ctx: Partial<YougileContext>) => void;

  // Yougile data (in-memory only, no persistence)
  accounts: YougileAccount[];
  projects: YougileProject[];
  boards: YougileBoard[];
  columns: YougileColumn[];
  tasks: YougileTask[];
  users: YougileUser[];
  stringStickers: YougileStringSticker[];
  sprintStickers: YougileSprintSticker[];
  lastSyncHydratedAt: number;

  // Loading & error state
  isLoading: boolean;
  error: string | null;
  clearError: () => void;

  // Selection state (mirrors local task store for vim navigation)
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;

  // Auth actions
  fetchAccounts: () => Promise<void>;
  login: (email: string, password: string) => Promise<YougileCompany[]>;
  addAccount: (email: string, password: string, companyId: string, companyName: string) => Promise<YougileAccount>;
  removeAccount: (accountId: string) => Promise<void>;

  // Navigation actions
  fetchProjects: () => Promise<void>;
  fetchBoards: (projectId: string) => Promise<void>;
  fetchColumns: (boardId: string) => Promise<void>;
  fetchUsers: (projectId: string) => Promise<void>;
  fetchStringStickers: (boardId: string) => Promise<void>;
  fetchSprintStickers: (boardId: string) => Promise<void>;

  // Task actions
  fetchTasks: () => Promise<void>;
  createTask: (payload: CreateYougileTask) => Promise<YougileTask | null>;
  updateTask: (taskId: string, payload: UpdateYougileTask) => Promise<YougileTask | null>;
  moveTask: (taskId: string, columnId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;

  // Subtask actions
  createSubtask: (parentTaskId: string, title: string) => Promise<YougileTask | null>;
  removeSubtask: (parentTaskId: string, subtaskId: string) => Promise<void>;
  toggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  fetchSubtaskTasks: (subtaskIds: string[]) => Promise<YougileTask[]>;

  // Chat
  chatMessages: YougileChatMessage[];
  chatLoading: boolean;
  companyUsers: YougileUser[];
  fetchChatMessages: (taskId: string) => Promise<void>;
  sendChatMessage: (taskId: string, text: string) => Promise<boolean>;
  sendChatWithAttachments: (taskId: string, text: string, files: Array<File | string>) => Promise<boolean>;
  fetchCompanyUsers: () => Promise<void>;

  // Cross-window sync
  hydrateSyncState: () => Promise<void>;
  persistSyncState: () => Promise<void>;
  listenForSyncUpdates: () => () => void;
  listenForTaskUpdates: () => () => void;
}

interface YougileTasksUpdatedPayload {
  boardId: string | null;
  sourceWindowLabel?: string;
}

interface YougileChatMessageIdResponse {
  id: number;
}

function sortChatMessages(messages: YougileChatMessage[]): YougileChatMessage[] {
  return [...messages].sort((a, b) => a.id - b.id);
}

function nextOptimisticMessageId(messages: YougileChatMessage[]): number {
  const currentLastId = messages[messages.length - 1]?.id ?? 0;
  return Math.max(Date.now(), currentLastId + 1);
}

function buildOptimisticChatMessage(
  state: Pick<YougileState, 'accounts' | 'chatMessages' | 'yougileContext'>,
  text: string,
  textHtml?: string,
): YougileChatMessage {
  const sender = state.accounts.find((account) => account.id === state.yougileContext.accountId)?.email
    ?? 'you';

  return {
    id: nextOptimisticMessageId(state.chatMessages),
    fromUserId: sender,
    text,
    textHtml,
    deleted: false,
  };
}

function toSyncState(activeSource: ActiveSource, yougileContext: YougileContext): YougileSyncState {
  return {
    activeSource,
    accountId: yougileContext.accountId,
    projectId: yougileContext.projectId,
    projectName: yougileContext.projectName,
    boardId: yougileContext.boardId,
    boardName: yougileContext.boardName,
  };
}

function applySyncState(
  state: Pick<
    YougileState,
    'activeSource'
    | 'yougileContext'
    | 'projects'
    | 'boards'
    | 'columns'
    | 'tasks'
    | 'users'
    | 'stringStickers'
    | 'sprintStickers'
    | 'selectedTaskId'
  >,
  syncState: YougileSyncState
) {
  const nextContext: YougileContext = {
    accountId: syncState.accountId,
    projectId: syncState.projectId,
    projectName: syncState.projectName,
    boardId: syncState.boardId,
    boardName: syncState.boardName,
  };

  const accountChanged = state.yougileContext.accountId !== nextContext.accountId;
  const projectChanged = state.yougileContext.projectId !== nextContext.projectId;
  const boardChanged = state.yougileContext.boardId !== nextContext.boardId;

  return {
    activeSource: syncState.activeSource,
    yougileContext: nextContext,
    projects: accountChanged ? [] : state.projects,
    boards: accountChanged || projectChanged ? [] : state.boards,
    columns: accountChanged || projectChanged || boardChanged ? [] : state.columns,
    tasks: accountChanged || projectChanged || boardChanged ? [] : state.tasks,
    users: accountChanged || projectChanged ? [] : state.users,
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

async function emitYougileTasksUpdated(boardId: string | null) {
  if (!isTauriAvailable()) return;
  await emit(YOUGILE_TASKS_UPDATED_EVENT, {
    boardId,
    sourceWindowLabel: getCurrentWindow().label,
  } satisfies YougileTasksUpdatedPayload);
}

export const useYougileStore = create<YougileState>((set, get) => ({
  yougileEnabled: false,
  setYougileEnabled: (enabled) => {
    set((state) =>
      enabled
        ? { yougileEnabled: true }
        : {
            ...state,
            yougileEnabled: false,
            activeSource: 'local',
            yougileContext: initialContext,
            projects: [],
            boards: [],
            columns: [],
            tasks: [],
            users: [],
            stringStickers: [],
            sprintStickers: [],
            selectedTaskId: null,
            error: null,
            isLoading: false,
          }
    );
    scheduleSyncPersist(get);
  },

  activeSource: 'local',
  setActiveSource: (source) => {
    set((state) => ({
      activeSource: state.yougileEnabled ? source : 'local',
    }));
    scheduleSyncPersist(get);
  },

  yougileContext: initialContext,
  setYougileContext: (ctx) => {
    set((state) => {
      const nextContext: YougileContext = {
        ...state.yougileContext,
        ...ctx,
      };
      const accountChanged = state.yougileContext.accountId !== nextContext.accountId;
      const projectChanged = state.yougileContext.projectId !== nextContext.projectId;
      const boardChanged = state.yougileContext.boardId !== nextContext.boardId;

      return {
        yougileContext: nextContext,
        projects: accountChanged ? [] : state.projects,
        boards: accountChanged || projectChanged ? [] : state.boards,
        columns: accountChanged || projectChanged || boardChanged ? [] : state.columns,
        tasks: accountChanged || projectChanged || boardChanged ? [] : state.tasks,
        users: accountChanged || projectChanged ? [] : state.users,
        stringStickers: accountChanged || projectChanged || boardChanged ? [] : state.stringStickers,
        sprintStickers: accountChanged || projectChanged || boardChanged ? [] : state.sprintStickers,
        selectedTaskId: accountChanged || projectChanged || boardChanged ? null : state.selectedTaskId,
      };
    });
    scheduleSyncPersist(get);
  },

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
  clearError: () => set({ error: null }),

  selectedTaskId: null,
  selectTask: (id) => set({ selectedTaskId: id }),

  // --- Auth ---

  fetchAccounts: async () => {
    if (!isTauriAvailable()) return;
    try {
      const accounts = await invoke<YougileAccount[]>('yougile_get_accounts');
      let resetContext = false;
      set((state) => {
        const selectedAccountId = state.yougileContext.accountId;
        const hasSelectedAccount = selectedAccountId
          ? accounts.some((account) => account.id === selectedAccountId)
          : true;

        if (hasSelectedAccount) {
          return { accounts };
        }

        resetContext = true;
        return {
          activeSource: 'local' as ActiveSource,
          accounts,
          yougileContext: initialContext,
          projects: [],
          boards: [],
          columns: [],
          tasks: [],
          users: [],
          stringStickers: [],
          sprintStickers: [],
          chatMessages: [],
          chatLoading: false,
          companyUsers: [],
          selectedTaskId: null,
        };
      });
      if (resetContext) {
        scheduleSyncPersist(get);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  login: async (email, password) => {
    if (!isTauriAvailable()) return [];
    try {
      return await invoke<YougileCompany[]>('yougile_login', { login: email, password });
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },

  addAccount: async (email, password, companyId, companyName) => {
    if (!isTauriAvailable()) throw new Error('Tauri not available');
    const account = await invoke<YougileAccount>('yougile_add_account', {
      login: email,
      password,
      companyId,
      companyName,
    });
    set((state) => ({
      accounts: [
        account,
        ...state.accounts.filter((existing) => (
          existing.id !== account.id
          && !(
            existing.companyId === account.companyId
            && existing.email.toLowerCase() === account.email.toLowerCase()
          )
        )),
      ],
    }));
    return account;
  },

  removeAccount: async (accountId) => {
    if (!isTauriAvailable()) return;
    await invoke('yougile_remove_account', { accountId });
    set((state) => {
      const removedSelectedAccount = state.yougileContext.accountId === accountId;
      return {
        accounts: state.accounts.filter((a) => a.id !== accountId),
        ...(removedSelectedAccount
          ? {
              activeSource: 'local' as ActiveSource,
              yougileContext: initialContext,
              projects: [],
              boards: [],
              columns: [],
              tasks: [],
              users: [],
              stringStickers: [],
              sprintStickers: [],
              selectedTaskId: null,
            }
          : {}),
      };
    });
    scheduleSyncPersist(get);
  },

  // --- Navigation ---

  fetchProjects: async () => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ isLoading: true, error: null });
    try {
      const projects = await withTimeout(
        invoke<YougileProject[]>('yougile_get_projects', {
          accountId: yougileContext.accountId,
        })
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
        })
      );
      set({ boards: boards.filter((b) => !b.deleted), isLoading: false });
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
        })
      );
      set({ columns: columns.filter((c) => !c.deleted), isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  fetchUsers: async (projectId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    try {
      const users = await invoke<YougileUser[]>('yougile_get_users', {
        accountId: yougileContext.accountId,
        projectId,
      });
      set({ users });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchStringStickers: async (boardId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    try {
      const stringStickers = await invoke<YougileStringSticker[]>('yougile_get_string_stickers', {
        accountId: yougileContext.accountId,
        boardId,
      });
      set({ stringStickers: stringStickers.filter((sticker) => !sticker.deleted) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchSprintStickers: async (boardId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    try {
      const sprintStickers = await invoke<YougileSprintSticker[]>('yougile_get_sprint_stickers', {
        accountId: yougileContext.accountId,
        boardId,
      });
      set({ sprintStickers: sprintStickers.filter((sticker) => !sticker.deleted) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // --- Tasks ---

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
        })
      );
      set({ tasks: tasks.filter((t) => !t.deleted), isLoading: false });
    } catch (e) {
      // On error, keep existing tasks visible (stale data > no data)
      set({ error: String(e), isLoading: false });
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
      await emitYougileTasksUpdated(yougileContext.boardId);
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
      await emitYougileTasksUpdated(yougileContext.boardId);
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
    const previousTasks = get().tasks;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, columnId } : t
      ),
    }));
    try {
      await invoke('yougile_move_task', {
        accountId: yougileContext.accountId,
        taskId,
        columnId,
      });
      await emitYougileTasksUpdated(yougileContext.boardId);
    } catch (e) {
      set({ error: String(e), tasks: previousTasks });
    }
  },

  deleteTask: async (taskId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    // Optimistic update
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
      selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
    }));
    try {
      await invoke('yougile_delete_task', {
        accountId: yougileContext.accountId,
        taskId,
      });
      await emitYougileTasksUpdated(yougileContext.boardId);
    } catch (e) {
      set({ error: String(e) });
      void get().fetchTasks();
    }
  },

  // --- Subtasks ---

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

  fetchSubtaskTasks: async (subtaskIds) => {
    if (!isTauriAvailable() || subtaskIds.length === 0) return [];
    const { yougileContext } = get();
    if (!yougileContext.accountId) return [];

    const results: YougileTask[] = [];
    const { tasks: existingTasks } = get();

    for (const id of subtaskIds) {
      // Check if we already have this task in the store
      const existing = existingTasks.find((t) => t.id === id);
      if (existing) {
        results.push(existing);
        continue;
      }
      try {
        const task = await invoke<YougileTask>('yougile_get_task', {
          accountId: yougileContext.accountId,
          taskId: id,
        });
        if (task && !task.deleted) {
          results.push(task);
        }
      } catch {
        // Skip tasks that can't be fetched (deleted, no access, etc.)
      }
    }

    // Add fetched tasks to store so they're available for future lookups
    if (results.length > 0) {
      set((state) => {
        const existingIds = new Set(state.tasks.map((t) => t.id));
        const toAdd = results.filter((t) => !existingIds.has(t.id));
        if (toAdd.length === 0) return state;
        return { tasks: [...state.tasks, ...toAdd] };
      });
    }

    return results;
  },

  chatMessages: [],
  chatLoading: false,
  companyUsers: [],

  fetchCompanyUsers: async () => {
    if (!isTauriAvailable()) return;
    const { yougileContext, companyUsers } = get();
    if (!yougileContext.accountId || companyUsers.length > 0) return;
    try {
      const users = await withTimeout(
        invoke<YougileUser[]>('yougile_get_all_users', {
          accountId: yougileContext.accountId,
        })
      );
      set({ companyUsers: users });
    } catch {
      // non-critical, fall back to project users
    }
  },

  fetchChatMessages: async (taskId) => {
    if (!isTauriAvailable()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ chatLoading: true });
    try {
      const messages = await withTimeout(
        invoke<YougileChatMessage[]>('yougile_get_chat_messages', {
          accountId: yougileContext.accountId,
          taskId,
          limit: CHAT_FETCH_LIMIT,
          offset: 0,
        })
      );
      set({
        chatMessages: sortChatMessages(messages.filter((m) => !m.deleted)),
        chatLoading: false,
      });
    } catch (e) {
      set({ error: String(e), chatLoading: false });
    }
  },

  sendChatMessage: async (taskId, text) => {
    if (!isTauriAvailable()) return false;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return false;
    const optimistic = buildOptimisticChatMessage(
      get(),
      text,
      text.trim() ? `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` : undefined,
    );

    set((state) => ({
      chatMessages: sortChatMessages([...state.chatMessages, optimistic]),
    }));

    try {
      await withTimeout(
        invoke<YougileChatMessageIdResponse>('yougile_send_chat_message', {
          accountId: yougileContext.accountId,
          taskId,
          text,
          textHtml: undefined,
        })
      );
      return true;
    } catch (e) {
      set((state) => ({
        error: String(e),
        chatMessages: state.chatMessages.filter((message) => message.id !== optimistic.id),
      }));
      return false;
    }
  },

  sendChatWithAttachments: async (taskId, text, files) => {
    if (!isTauriAvailable()) return false;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return false;
    let optimisticMessageId: number | null = null;
    try {
      const uploadedFiles: Array<{ url: string; name: string; image: boolean }> = [];
      for (const entry of files) {
        if (typeof entry === 'string') {
          const fileName = fileNameFromPath(entry);
          const upload = await withTimeout(
            invoke<YougileFileUploadResponse>('yougile_upload_file_path', {
              accountId: yougileContext.accountId,
              filePath: entry,
            }),
            UPLOAD_TIMEOUT_MS,
          );
          uploadedFiles.push({
            url: upload.url,
            name: fileName,
            image: isImageFileName(fileName),
          });
          continue;
        }

        const bytes = await entry.arrayBuffer();
        const upload = await withTimeout(
          invoke<YougileFileUploadResponse>('yougile_upload_file', {
            accountId: yougileContext.accountId,
            fileName: entry.name,
            fileBytes: new Uint8Array(bytes),
            mimeType: entry.type || 'application/octet-stream',
          }),
          UPLOAD_TIMEOUT_MS,
        );
        uploadedFiles.push({
          url: upload.url,
          name: entry.name,
          image: isImageFile(entry),
        });
      }

      const attachmentHtml = uploadedFiles
        .map((file) => (
          file.image
            ? `<img src="${file.url}" />`
            : `<p><a href="${file.url}" target="_blank" rel="noreferrer">${escapeHtml(file.name)}</a></p>`
        ))
        .join('');
      const escapedText = escapeHtml(text).replace(/\n/g, '<br>');
      const html = text
        ? `<p>${escapedText}</p>${attachmentHtml}`
        : attachmentHtml;
      const plainText = [text.trim(), ...uploadedFiles.map((file) => file.url)]
        .filter(Boolean)
        .join(' ');
      const optimistic = buildOptimisticChatMessage(get(), plainText, html);
      optimisticMessageId = optimistic.id;

      set((state) => ({
        chatMessages: sortChatMessages([...state.chatMessages, optimistic]),
      }));

      await withTimeout(
        invoke<YougileChatMessageIdResponse>('yougile_send_chat_message', {
          accountId: yougileContext.accountId,
          taskId,
          text: plainText,
          textHtml: html,
        }),
        UPLOAD_TIMEOUT_MS,
      );
      return true;
    } catch (e) {
      set((state) => ({
        error: `Failed to upload attachment: ${String(e)}`,
        chatMessages: optimisticMessageId == null
          ? state.chatMessages
          : state.chatMessages.filter((message) => message.id !== optimisticMessageId),
      }));
      return false;
    }
  },

  hydrateSyncState: async () => {
    if (!isTauriAvailable()) return;
    const now = Date.now();
    if (now - get().lastSyncHydratedAt < FETCH_DEBOUNCE_MS) return;
    set({ lastSyncHydratedAt: now });
    try {
      const syncState = await withTimeout(
        invoke<YougileSyncState>('get_yougile_sync_state')
      );
      set((state) => applySyncState(state, syncState));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  persistSyncState: async () => {
    if (!isTauriAvailable()) return;
    const state = get();
    const syncState = toSyncState(
      state.yougileEnabled ? state.activeSource : 'local',
      state.yougileEnabled ? state.yougileContext : initialContext
    );
    try {
      const saved = await invoke<YougileSyncState>('update_yougile_sync_state', {
        state: syncState,
      });
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

  listenForTaskUpdates: () => {
    if (!isTauriAvailable()) return () => {};
    const unlisten = listen<YougileTasksUpdatedPayload>(YOUGILE_TASKS_UPDATED_EVENT, (event) => {
      const { activeSource, yougileContext, columns } = get();
      const payloadBoardId = event.payload.boardId;

      if (event.payload.sourceWindowLabel === getCurrentWindow().label) {
        return;
      }

      if (activeSource !== 'yougile' || !yougileContext.accountId || !yougileContext.boardId) {
        return;
      }
      if (payloadBoardId && payloadBoardId !== yougileContext.boardId) {
        return;
      }

      if (columns.length === 0) {
        void get().fetchColumns(yougileContext.boardId).then(() => {
          void get().fetchTasks();
        });
        return;
      }

      void get().fetchTasks();
    });
    return () => {
      void unlisten.then((fn) => { if (typeof fn === 'function') fn(); });
    };
  },
}));
