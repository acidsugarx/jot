import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  YougileAccount,
  YougileProject,
  YougileBoard,
  YougileColumn,
  YougileTask,
  YougileUser,
  YougileContext,
  YougileCompany,
  CreateYougileTask,
  UpdateYougileTask,
} from '@/types/yougile';

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export type ActiveSource = 'local' | 'yougile';

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

  // Loading & error state
  loading: boolean;
  isLoading: boolean; // kept in sync with loading
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

  // Task actions
  fetchTasks: () => Promise<void>;
  createTask: (payload: CreateYougileTask) => Promise<YougileTask | null>;
  updateTask: (taskId: string, payload: UpdateYougileTask) => Promise<YougileTask | null>;
  moveTask: (taskId: string, columnId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
}

export const useYougileStore = create<YougileState>((set, get) => ({
  yougileEnabled: false,
  setYougileEnabled: (enabled) => set({ yougileEnabled: enabled }),

  activeSource: 'local',
  setActiveSource: (source) => set({ activeSource: source }),

  yougileContext: {
    accountId: null,
    projectId: null,
    projectName: null,
    boardId: null,
    boardName: null,
  },
  setYougileContext: (ctx) =>
    set((state) => ({
      yougileContext: { ...state.yougileContext, ...ctx },
    })),

  accounts: [],
  projects: [],
  boards: [],
  columns: [],
  tasks: [],
  users: [],

  loading: false,
  isLoading: false,
  error: null,
  clearError: () => set({ error: null }),

  selectedTaskId: null,
  selectTask: (id) => set({ selectedTaskId: id }),

  // --- Auth ---

  fetchAccounts: async () => {
    if (!isTauri()) return;
    try {
      const accounts = await invoke<YougileAccount[]>('yougile_get_accounts');
      set({ accounts });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  login: async (email, password) => {
    if (!isTauri()) return [];
    try {
      return await invoke<YougileCompany[]>('yougile_login', { login: email, password });
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },

  addAccount: async (email, password, companyId, companyName) => {
    if (!isTauri()) throw new Error('Tauri not available');
    const account = await invoke<YougileAccount>('yougile_add_account', {
      login: email,
      password,
      companyId,
      companyName,
    });
    set((state) => ({ accounts: [...state.accounts, account] }));
    return account;
  },

  removeAccount: async (accountId) => {
    if (!isTauri()) return;
    await invoke('yougile_remove_account', { accountId });
    set((state) => ({
      accounts: state.accounts.filter((a) => a.id !== accountId),
    }));
  },

  // --- Navigation ---

  fetchProjects: async () => {
    if (!isTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ loading: true, isLoading: true, error: null });
    try {
      const projects = await invoke<YougileProject[]>('yougile_get_projects', {
        accountId: yougileContext.accountId,
      });
      set({ projects, loading: false, isLoading: false });
    } catch (e) {
      set({ error: String(e), loading: false, isLoading: false });
    }
  },

  fetchBoards: async (projectId) => {
    if (!isTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ loading: true, isLoading: true, error: null });
    try {
      const boards = await invoke<YougileBoard[]>('yougile_get_boards', {
        accountId: yougileContext.accountId,
        projectId,
      });
      set({ boards: boards.filter((b) => !b.deleted), loading: false, isLoading: false });
    } catch (e) {
      set({ error: String(e), loading: false, isLoading: false });
    }
  },

  fetchColumns: async (boardId) => {
    if (!isTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    set({ loading: true, isLoading: true, error: null });
    try {
      const columns = await invoke<YougileColumn[]>('yougile_get_columns', {
        accountId: yougileContext.accountId,
        boardId,
      });
      set({ columns: columns.filter((c) => !c.deleted), loading: false, isLoading: false });
    } catch (e) {
      set({ error: String(e), loading: false, isLoading: false });
    }
  },

  fetchUsers: async (projectId) => {
    if (!isTauri()) return;
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

  // --- Tasks ---

  fetchTasks: async () => {
    if (!isTauri()) return;
    const { yougileContext, columns } = get();
    if (!yougileContext.accountId) return;
    if (columns.length === 0) return;

    set({ loading: true, isLoading: true, error: null });
    try {
      const allTasks: YougileTask[] = [];
      for (const col of columns) {
        const tasks = await invoke<YougileTask[]>('yougile_get_tasks', {
          accountId: yougileContext.accountId,
          columnId: col.id,
        });
        allTasks.push(...tasks);
      }
      set({ tasks: allTasks.filter((t) => !t.deleted), loading: false, isLoading: false });
    } catch (e) {
      set({ error: String(e), loading: false, isLoading: false });
    }
  },

  createTask: async (payload) => {
    if (!isTauri()) return null;
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
    if (!isTauri()) return null;
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
    if (!isTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    // Optimistic update
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
    } catch (e) {
      set({ error: String(e) });
      // Revert optimistic update by re-fetching
      void get().fetchTasks();
    }
  },

  deleteTask: async (taskId) => {
    if (!isTauri()) return;
    const { yougileContext } = get();
    if (!yougileContext.accountId) return;
    // Optimistic update
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }));
    try {
      await invoke('yougile_delete_task', {
        accountId: yougileContext.accountId,
        taskId,
      });
    } catch (e) {
      set({ error: String(e) });
      void get().fetchTasks();
    }
  },
}));
