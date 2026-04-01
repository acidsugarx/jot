import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  LayoutList,
  Columns,
  Calendar as CalendarIcon,
  Check,
  FileText,
  Trash2,
  ArrowRightLeft,
  PenLine,
  Search,
  Inbox,
  Sun,
  Tag,
  Archive,
  Plus,
  Users,
} from 'lucide-react';
import { KanbanBoard } from '@/components/KanbanBoard';
import { CalendarView } from '@/components/CalendarView';
import { TaskEditorPane } from '@/components/TaskEditorPane';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { YougileBreadcrumbBar } from '@/components/YougileBreadcrumbBar';
import { YougileTaskEditor } from '@/components/YougileTaskEditor';
import { HotkeyCheatSheet } from '@/components/HotkeyCheatSheet';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { useTaskStore } from '@/store/use-task-store';
import { useYougileStore } from '@/store/use-yougile-store';
import { Task, KanbanColumn } from '@/types';
import { CardTask } from '@/components/KanbanTaskCard';
import type { YougileTask } from '@/types/yougile';
import { PRIORITY_DOT_CLASS } from '@/lib/yougile';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { focusEngine } from '@/lib/focus-engine';
import { useFocusEngineStore } from '@/hooks/use-focus-engine';

// Local type definitions (previously from use-vim-bindings)
export type ViewMode = 'list' | 'kanban' | 'calendar';

export interface DeleteRequest {
  taskId: string;
  taskTitle: string;
  source: 'local' | 'yougile';
  nextTaskId: string | null;
}

const statusMeta = (s: string, label?: string) => {
  const text = (label ?? s).slice(0, 4).toLowerCase();
  switch (s) {
    case 'in_progress': return { text: 'wip', color: 'text-yellow-500/70' };
    case 'done': return { text: 'done', color: 'text-zinc-600' };
    case 'archived': return { text: 'arch', color: 'text-zinc-700' };
    default: return { text, color: 'text-zinc-700' };
  }
};




type Tab = 'list' | 'kanban' | 'calendar';
const tabDefs: { id: Tab; label: string; icon: typeof LayoutList }[] = [
  { id: 'list', label: 'List', icon: LayoutList },
  { id: 'kanban', label: 'Board', icon: Columns },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
];

// Context menu state
interface ContextMenu {
  x: number;
  y: number;
  taskId: string;
}

type DeleteDialogState = DeleteRequest;

type SidebarFilter = 'inbox' | 'today' | 'archived' | `tag:${string}`;

function todayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('inbox');
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const [quickAddValue, setQuickAddValue] = useState('');

  // Pane focus state for visual highlights
  const activePane = useFocusEngineStore((s) => s.activePane);
  const isSidebarFocused = activePane === 'sidebar';
  const isTaskViewFocused = activePane === 'task-view';
  const isEditorFocused = activePane === 'editor';

  const {
    tasks,
    columns,
    settings,
    error: localError,
    isLoading,
    fetchTasks,
    fetchColumns,
    fetchSettings,
    listenForUpdates,
    updateTaskStatus,
    deleteTask,
    clearError: clearLocalError,
    isEditorOpen,
    setIsEditorOpen,
    isQuickAddOpen,
    setIsQuickAddOpen,
    createTask,
    openLinkedNote,
    selectedTaskId: localSelectedTaskId,
    selectTask: selectLocalTask,
  } = useTaskStore();

  const yougileStore = useYougileStore();
  const setYougileEnabled = yougileStore.setYougileEnabled;
  const hydrateYougileSyncState = yougileStore.hydrateSyncState;
  const yougileActiveSource = yougileStore.activeSource;
  const yougileAccountId = yougileStore.yougileContext.accountId;
  const yougileProjectId = yougileStore.yougileContext.projectId;
  const fetchYougileProjects = yougileStore.fetchProjects;
  const fetchYougileBoards = yougileStore.fetchBoards;
  const fetchYougileUsers = yougileStore.fetchUsers;
  const isYougile = yougileStore.yougileEnabled && yougileStore.activeSource === 'yougile';
  const yougileVisibleTasks = useMemo(
    () => yougileStore.tasks.filter((task) => !task.deleted && !task.archived),
    [yougileStore.tasks]
  );

  const syncYougileState = useCallback(async () => {
    if (!yougileStore.yougileEnabled) return;
    await hydrateYougileSyncState();
    await useYougileStore.getState().fetchAccounts();
  }, [hydrateYougileSyncState, yougileStore.yougileEnabled]);

  // Map Yougile columns to the KanbanColumn shape used by KanbanBoard
  const yougileColumnsAsKanban = useMemo((): KanbanColumn[] => {
    if (!isYougile) return [];
    return yougileStore.columns.map((col, idx) => ({
      id: col.id,
      name: col.title,
      statusKey: col.id,
      position: idx,
    }));
  }, [isYougile, yougileStore.columns]);

  // Map Yougile tasks grouped by columnId for KanbanBoard
  const yougileTasksByColumn = useMemo((): Map<string, CardTask[]> => {
    if (!isYougile) return new Map();
    const map = new Map<string, CardTask[]>();
    for (const col of yougileStore.columns) {
      map.set(col.id, []);
    }
    for (const task of yougileVisibleTasks) {
      if (!task.columnId) continue;
      const existing = map.get(task.columnId);
      if (existing) existing.push(task);
      else map.set(task.columnId, [task]);
    }
    return map;
  }, [isYougile, yougileStore.columns, yougileVisibleTasks]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings) {
      setYougileEnabled(settings.yougileEnabled);
    }
  }, [settings, setYougileEnabled]);

  useEffect(() => {
    if (yougileStore.yougileEnabled) {
      void syncYougileState();
    }
  }, [syncYougileState, yougileStore.yougileEnabled]);

  useEffect(() => {
    if (yougileActiveSource !== 'yougile' || !yougileAccountId) return;
    void fetchYougileProjects();
  }, [fetchYougileProjects, yougileActiveSource, yougileAccountId]);

  useEffect(() => {
    if (yougileActiveSource !== 'yougile' || !yougileProjectId) return;
    void Promise.all([
      fetchYougileBoards(yougileProjectId),
      fetchYougileUsers(yougileProjectId),
    ]);
  }, [fetchYougileBoards, fetchYougileUsers, yougileActiveSource, yougileProjectId]);

  // Fetch Yougile columns + tasks when board selection changes
  useEffect(() => {
    const boardId = yougileStore.yougileContext.boardId;
    if (yougileStore.activeSource === 'yougile' && boardId) {
      yougileStore.fetchColumns(boardId).then(() => {
        void yougileStore.fetchTasks();
      });
    }
  }, [yougileStore.activeSource, yougileStore.yougileContext.boardId]);

  useEffect(() => {
    if (isYougile && yougileStore.yougileContext.projectId) {
      void yougileStore.fetchUsers(yougileStore.yougileContext.projectId);
    }
  }, [isYougile, yougileStore.yougileContext.projectId, yougileStore.fetchUsers]);

  // Cycle to next column's statusKey, wrapping around
  const getNextStatus = (currentStatus: string): string => {
    const nonArchived = columns.filter((c) => c.statusKey !== 'archived');
    if (nonArchived.length === 0) return currentStatus;
    const idx = nonArchived.findIndex((c) => c.statusKey === currentStatus);
    const next = nonArchived[(idx + 1) % nonArchived.length];
    return next?.statusKey ?? currentStatus;
  };

  const requestDelete = useCallback((request: DeleteRequest) => {
    setContextMenu(null);
    setDeleteDialog(request);
  }, []);

  const buildDeleteRequest = useCallback((task: Task | YougileTask): DeleteDialogState => {
    const source = 'columnId' in task ? 'yougile' : 'local';
    const ordered = source === 'yougile'
      ? yougileVisibleTasks
      : tasks;
    const idx = ordered.findIndex((item) => item.id === task.id);
    const nextTask = ordered[idx + 1] || ordered[idx - 1] || null;

    return {
      taskId: task.id,
      taskTitle: task.title,
      source,
      nextTaskId: nextTask?.id ?? null,
    };
  }, [tasks, yougileVisibleTasks]);

  // Register panes with focus engine
  useEffect(() => {
    const engine = focusEngine.getState();

    // Determine regions based on current view and mode
    const getTaskViewRegions = () => {
      if (activeTab === 'kanban') {
        // For kanban, regions are column-0, column-1, etc.
        const colCount = isYougile ? yougileStore.columns.length : columns.length;
        return Array.from({ length: colCount }, (_, i) => `column-${i}`);
      }
      // For list and calendar, single region
      return ['list'];
    };

    const taskViewRegions = getTaskViewRegions();
    const hasEditor = isEditorOpen && ((isYougile && yougileStore.selectedTaskId) || (!isYougile && localSelectedTaskId));

    // Register sidebar (only for list view, local mode)
    if (activeTab === 'list' && !isYougile) {
      engine.registerPane('sidebar', { regions: ['sidebar'], order: 0 });
    } else {
      engine.unregisterPane('sidebar');
    }

    // Register task view
    engine.registerPane('task-view', { regions: taskViewRegions, order: 1 });

    // Register editor if open
    if (hasEditor) {
      engine.registerPane('editor', { regions: ['editor'], order: 2 });
    } else {
      engine.unregisterPane('editor');
    }

    return () => {
      engine.unregisterPane('sidebar');
      engine.unregisterPane('task-view');
      engine.unregisterPane('editor');
    };
  }, [activeTab, isYougile, yougileStore.columns.length, columns.length, isEditorOpen, yougileStore.selectedTaskId, localSelectedTaskId]);

  // Register action callbacks on window for FocusProvider
  useEffect(() => {
    const selectedTask = isYougile
      ? yougileStore.tasks.find(t => t.id === yougileStore.selectedTaskId)
      : tasks.find(t => t.id === localSelectedTaskId);

    window.__jotActions = {
      onSourceToggle: () => yougileStore.setActiveSource(yougileStore.activeSource === 'local' ? 'yougile' : 'local'),
      onSwitchView: (view: 'list' | 'kanban' | 'calendar') => setActiveTab(view),
      onNewItem: () => setIsQuickAddOpen(true),
      onToggleDone: () => {
        if (!selectedTask) return;
        if (isYougile) {
          const yt = selectedTask as YougileTask;
          void yougileStore.updateTask(yt.id, { completed: !yt.completed });
        } else {
          const lt = selectedTask as Task;
          void updateTaskStatus({ id: lt.id, status: lt.status === 'done' ? 'todo' : 'done' });
        }
      },
      onDelete: () => {
        if (!selectedTask) return;
        requestDelete(buildDeleteRequest(selectedTask));
      },
      onOpenItem: () => {
        if (!selectedTask) return;
        setIsEditorOpen(true);
      },
      onMoveNext: () => {
        if (!selectedTask || isYougile) return;
        const task = selectedTask as Task;
        void updateTaskStatus({ id: task.id, status: getNextStatus(task.status) });
      },
      onRefresh: () => {
        if (isYougile) {
          void yougileStore.fetchTasks();
        } else {
          void fetchTasks();
        }
      },
      onToggleHelp: () => setShowHelp(v => !v),
      onEscape: () => {
        // Deselect current task
        if (isYougile) {
          yougileStore.selectTask('');
        } else {
          selectLocalTask('');
        }
      },
    };
  }, [
    isYougile,
    yougileStore.activeSource,
    yougileStore.setActiveSource,
    yougileStore.selectedTaskId,
    yougileStore.tasks,
    localSelectedTaskId,
    tasks,
    requestDelete,
    buildDeleteRequest,
    updateTaskStatus,
    yougileStore.updateTask,
    yougileStore.fetchTasks,
    fetchTasks,
    openLinkedNote,
    setIsEditorOpen,
    setIsQuickAddOpen,
  ]);

  // Focus quick-add input when opened
  useEffect(() => {
    if (isQuickAddOpen) {
      requestAnimationFrame(() => quickAddRef.current?.focus());
    }
  }, [isQuickAddOpen]);

  useEffect(() => {
    void fetchTasks();
    void fetchColumns();
  }, [fetchTasks, fetchColumns]);

  // Re-fetch when other windows mutate tasks
  useEffect(() => {
    return listenForUpdates();
  }, [listenForUpdates]);

  useEffect(() => {
    if (!isYougile || !yougileStore.yougileContext.boardId) return;

    const intervalId = window.setInterval(() => {
      const state = useYougileStore.getState();
      if (document.visibilityState !== 'visible') return;
      if (state.columns.length === 0) {
        void state.fetchColumns(state.yougileContext.boardId!).then(() => {
          void state.fetchTasks();
        });
        return;
      }
      void state.fetchTasks();
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [isYougile, yougileStore.yougileContext.boardId]);

  const lastDashFocusRef = useRef(0);
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && yougileStore.yougileEnabled) {
        const now = Date.now();
        if (now - lastDashFocusRef.current > 2000) {
          lastDashFocusRef.current = now;
          void syncYougileState();
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [syncYougileState, yougileStore.yougileEnabled]);

  // Close context menu on any click
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // Close context menu on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && contextMenu) {
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [contextMenu]);

  const selectedTask = tasks.find((t) => t.id === localSelectedTaskId);
  const selectedYougileTask = yougileVisibleTasks.find(
    (task) => task.id === yougileStore.selectedTaskId
  );

  // All unique tags across active tasks
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.status !== 'archived') t.tags.forEach((tag) => set.add(tag));
    }
    return [...set].sort();
  }, [tasks]);

  // Apply sidebar filter first, then search query
  const sidebarFiltered = useMemo(() => {
    if (isYougile) return [];
    if (sidebarFilter === 'inbox') {
      return tasks.filter((t) => t.status !== 'archived');
    }
    if (sidebarFilter === 'today') {
      const key = todayDateKey();
      return tasks.filter((t) => {
        if (t.status === 'archived') return false;
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return dKey === key;
      });
    }
    if (sidebarFilter === 'archived') {
      return tasks.filter((t) => t.status === 'archived');
    }
    const tag = sidebarFilter.slice(4); // strip "tag:"
    return tasks.filter((t) => t.status !== 'archived' && t.tags.includes(tag));
  }, [isYougile, tasks, sidebarFilter]);

  const filtered = searchQuery.trim()
    ? sidebarFiltered.filter((t) => {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          t.status.includes(q)
        );
      })
    : sidebarFiltered;

  const filteredYougile = useMemo(() => {
    if (!isYougile) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return yougileVisibleTasks;
    return yougileVisibleTasks.filter((task) =>
      task.title.toLowerCase().includes(q) ||
      (task.description ?? '').toLowerCase().includes(q)
    );
  }, [isYougile, searchQuery, yougileVisibleTasks]);

  // Group for list view — ordered by column position, archived tasks last
  const groupedByColumn = useMemo(() => {
    return columns.map((col) => ({
      col,
      items: filtered.filter((t) => t.status === col.statusKey),
    }));
  }, [columns, filtered]);

  const groupedYougileByColumn = useMemo(() => {
    if (!isYougile) return [];
    return yougileStore.columns.map((col) => ({
      col,
      items: filteredYougile.filter((task) => task.columnId === col.id),
    }));
  }, [isYougile, yougileStore.columns, filteredYougile]);

  const confirmDelete = useCallback(async () => {
    if (!deleteDialog) return;

    try {
      if (deleteDialog.source === 'yougile') {
        await yougileStore.deleteTask(deleteDialog.taskId);
        yougileStore.selectTask(deleteDialog.nextTaskId);
      } else {
        await deleteTask(deleteDialog.taskId);
        selectLocalTask(deleteDialog.nextTaskId);
      }
      setIsEditorOpen(false);
    } catch (error) {
      console.error(error);
    } finally {
      setDeleteDialog(null);
    }
  }, [deleteDialog, deleteTask, selectLocalTask, setIsEditorOpen, yougileStore]);

  useEffect(() => {
    if (!deleteDialog) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'y' || event.key === 'Enter') {
        event.preventDefault();
        void confirmDelete();
        return;
      }
      if (event.key === 'n' || event.key === 'Escape') {
        event.preventDefault();
        setDeleteDialog(null);
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [confirmDelete, deleteDialog]);

  const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    selectLocalTask(taskId);
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  }, [selectLocalTask]);

  const contextTask = contextMenu ? tasks.find((t) => t.id === contextMenu.taskId) : null;

  const renderTaskRow = (t: Task) => {
    const isSelected = localSelectedTaskId === t.id;
    const isDone = t.status === 'done';
    const dot = PRIORITY_DOT_CLASS[t.priority] ?? null;
    const colName = columns.find((c) => c.statusKey === t.status)?.name ?? t.status;
    const sl = statusMeta(t.status, colName);

    return (
      <div
        key={t.id}
        data-task-selected={isSelected ? 'true' : undefined}
        onClick={() => selectLocalTask(t.id)}
        onDoubleClick={() => setIsEditorOpen(true)}
        onContextMenu={(e) => handleContextMenu(e, t.id)}
        className={`group flex h-9 cursor-pointer items-center gap-2.5 border-l-2 px-4 transition-colors ${
          isSelected
            ? 'border-l-cyan-500 bg-cyan-500/[0.03]'
            : 'border-l-transparent hover:bg-zinc-900/40'
        }`}
      >
        {/* Checkbox */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void updateTaskStatus({ id: t.id, status: isDone ? 'todo' : 'done' });
          }}
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            isDone
              ? 'border-cyan-500/40 bg-cyan-500/20'
              : 'border-zinc-700 hover:border-zinc-500'
          }`}
        >
          {isDone && <Check className="h-2.5 w-2.5 text-cyan-400" strokeWidth={3} />}
        </button>

        {/* Priority dot */}
        {dot ? (
          <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        ) : (
          <div className="w-1.5 shrink-0" />
        )}

        {/* Title */}
        <span className={`min-w-0 flex-1 truncate text-sm ${
          isDone ? 'text-zinc-600 line-through' : 'text-zinc-200'
        }`}>
          {t.title}
        </span>

        {/* Hover actions (visible when selected or hovered) */}
        <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {/* Cycle status */}
          <button
            type="button"
            title={`Move to ${columns.find((c) => c.statusKey === getNextStatus(t.status))?.name ?? getNextStatus(t.status)}`}
            onClick={(e) => {
              e.stopPropagation();
              void updateTaskStatus({ id: t.id, status: getNextStatus(t.status) });
            }}
            className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
          >
            <ArrowRightLeft className="h-3 w-3" />
          </button>
          {/* Edit */}
          <button
            type="button"
            title="Edit (e)"
            onClick={(e) => {
              e.stopPropagation();
              selectLocalTask(t.id);
              setIsEditorOpen(true);
            }}
            className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
          >
            <PenLine className="h-3 w-3" />
          </button>
          {/* Delete */}
          <button
            type="button"
            title="Delete (d)"
            onClick={(e) => {
              e.stopPropagation();
              requestDelete(buildDeleteRequest(t));
            }}
            className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>

        {/* Right metadata (hidden when hover actions show) */}
        <div className={`flex shrink-0 items-center gap-2 ${isSelected ? 'hidden' : 'group-hover:hidden'}`}>
          {t.linkedNotePath && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void openLinkedNote(t.linkedNotePath!); }}
              className="text-cyan-600/40 hover:text-cyan-400 transition-colors"
            >
              <FileText className="h-3 w-3" />
            </button>
          )}
          {t.tags.map((tag) => (
            <span key={tag} className="font-mono text-[10px] text-zinc-600">#{tag}</span>
          ))}
          {t.dueDate && (
            <span className="font-mono text-[10px] text-zinc-600">
              {new Date(t.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          <span className={`w-8 text-right font-mono text-[10px] ${sl.color}`}>
            {sl.text}
          </span>
        </div>
      </div>
    );
  };

  const renderSection = (label: string, items: Task[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="flex h-7 items-center px-4">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            {label}
          </span>
          <span className="ml-1.5 font-mono text-[10px] text-zinc-700">{items.length}</span>
        </div>
        {items.map(renderTaskRow)}
      </div>
    );
  };

  const renderYougileTaskRow = (task: YougileTask) => {
    const isSelected = yougileStore.selectedTaskId === task.id;
    const isDone = task.completed;
    const deadline = task.deadline?.deadline
      ? new Date(task.deadline.deadline).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
      : null;

    return (
      <div
        key={task.id}
        data-task-selected={isSelected ? 'true' : undefined}
        onClick={() => yougileStore.selectTask(task.id)}
        onDoubleClick={() => setIsEditorOpen(true)}
        className={`group flex h-9 cursor-pointer items-center gap-2.5 border-l-2 px-4 transition-colors ${
          isSelected
            ? 'border-l-cyan-500 bg-cyan-500/[0.03]'
            : 'border-l-transparent hover:bg-zinc-900/40'
        }`}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void yougileStore.updateTask(task.id, { completed: !task.completed });
          }}
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            isDone
              ? 'border-cyan-500/40 bg-cyan-500/20'
              : 'border-zinc-700 hover:border-zinc-500'
          }`}
        >
          {isDone && <Check className="h-2.5 w-2.5 text-cyan-400" strokeWidth={3} />}
        </button>

        <span className={`min-w-0 flex-1 truncate text-sm ${
          isDone ? 'text-zinc-600 line-through' : 'text-zinc-200'
        }`}>
          {task.title}
        </span>

        <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <button
            type="button"
            title="Edit (e)"
            onClick={(event) => {
              event.stopPropagation();
              yougileStore.selectTask(task.id);
              setIsEditorOpen(true);
            }}
            className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
          >
            <PenLine className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Delete (d)"
            onClick={(event) => {
              event.stopPropagation();
              requestDelete(buildDeleteRequest(task));
            }}
            className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>

        <div className={`flex shrink-0 items-center gap-2 ${isSelected ? 'hidden' : 'group-hover:hidden'}`}>
          {deadline && (
            <span className="font-mono text-[10px] text-zinc-600">{deadline}</span>
          )}
          {task.assigned.length > 0 && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-600">
              <Users className="h-2.5 w-2.5" />
              {task.assigned.length}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderYougileSection = (label: string, items: YougileTask[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="flex h-7 items-center px-4">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            {label}
          </span>
          <span className="ml-1.5 font-mono text-[10px] text-zinc-700">{items.length}</span>
        </div>
        {items.map(renderYougileTaskRow)}
      </div>
    );
  };

  const visibleCount = isYougile ? filteredYougile.length : filtered.length;
  const totalCount = isYougile ? yougileVisibleTasks.length : tasks.length;

  return (
    <div className="flex h-screen w-screen flex-col bg-[#111111] font-sans text-zinc-100 selection:bg-cyan-500/30">

      {/* Header */}
      <div
        data-tauri-drag-region
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
            void getCurrentWindow().startDragging();
          }
        }}
        className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800/60 bg-[#161616]/80 px-4 backdrop-blur-md pl-[80px]"
      >
        <div data-tauri-drag-region className="flex items-center gap-1 pointer-events-none">
          {tabDefs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pointer-events-auto flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className={`h-3 w-3 ${isActive ? 'text-cyan-400' : ''}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Source switcher */}
        <SourceSwitcher />

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-800/60 bg-[#111111] px-2">
            <Search className="h-3 w-3 text-zinc-600" />
            <input
              ref={searchRef}
              data-search-input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Filter…"
              className="h-7 w-28 bg-transparent text-xs text-zinc-300 placeholder:text-zinc-700 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); searchRef.current?.blur(); }}
                className="text-zinc-600 hover:text-zinc-400"
              >
                <span className="text-[10px]">×</span>
              </button>
            )}
            <kbd className="font-mono text-[9px] text-zinc-700">/</kbd>
          </div>

          <span className="font-mono text-[10px] text-zinc-600">
            {visibleCount}{searchQuery ? `/${totalCount}` : ''} {totalCount === 1 ? 'task' : 'tasks'}
          </span>
        </div>
      </div>

      <YougileBreadcrumbBar />

      {/* Error banner */}
      <ErrorBanner
        error={isYougile ? yougileStore.error : localError}
        onRetry={isYougile ? () => { void yougileStore.fetchTasks(); } : () => { void fetchTasks(); }}
        onDismiss={isYougile ? () => yougileStore.clearError() : clearLocalError}
      />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — list view only */}
        {activeTab === 'list' && !isYougile && (
          <div className={`flex w-40 shrink-0 flex-col border-r border-zinc-800/40 py-2 transition-shadow duration-150 ${isSidebarFocused ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
            {/* Fixed filters */}
            {(
              [
                { id: 'inbox' as SidebarFilter, label: 'Inbox', Icon: Inbox, count: tasks.filter((t) => t.status !== 'archived').length },
                { id: 'today' as SidebarFilter, label: 'Today', Icon: Sun, count: tasks.filter((t) => t.status !== 'archived' && !!t.dueDate && (() => { const d = new Date(t.dueDate!); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === todayDateKey(); })()).length },
                { id: 'archived' as SidebarFilter, label: 'Archived', Icon: Archive, count: tasks.filter((t) => t.status === 'archived').length },
              ] as const
            ).map(({ id, label, Icon, count }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSidebarFilter(id)}
                className={`flex h-8 w-full items-center gap-2 px-3 text-left transition-colors ${
                  sidebarFilter === id
                    ? 'bg-zinc-800/60 text-zinc-200'
                    : 'text-zinc-500 hover:bg-zinc-900/40 hover:text-zinc-300'
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate text-xs">{label}</span>
                {count > 0 && (
                  <span className="font-mono text-[10px] text-zinc-600">{count}</span>
                )}
              </button>
            ))}

            {/* Tags section */}
            {allTags.length > 0 && (
              <>
                <div className="mt-2 flex h-6 items-center px-3">
                  <span className="font-mono text-[9px] font-medium uppercase tracking-wider text-zinc-700">Tags</span>
                </div>
                {allTags.map((tag) => {
                  const filterId: SidebarFilter = `tag:${tag}`;
                  const count = tasks.filter((t) => t.status !== 'archived' && t.tags.includes(tag)).length;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSidebarFilter(filterId)}
                      className={`flex h-7 w-full items-center gap-2 px-3 text-left transition-colors ${
                        sidebarFilter === filterId
                          ? 'bg-zinc-800/60 text-zinc-200'
                          : 'text-zinc-500 hover:bg-zinc-900/40 hover:text-zinc-300'
                      }`}
                    >
                      <Tag className="h-2.5 w-2.5 shrink-0" />
                      <span className="flex-1 truncate font-mono text-[10px]">#{tag}</span>
                      {count > 0 && (
                        <span className="font-mono text-[10px] text-zinc-600">{count}</span>
                      )}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Main content */}
        <div className={`flex-1 overflow-y-auto transition-shadow duration-150 ${isTaskViewFocused ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
          {activeTab === 'list' && (
            <div className="mx-auto w-full max-w-3xl py-2">
              {/* Loading skeletons — first load only */}
              {((isYougile && yougileStore.isLoading && yougileVisibleTasks.length === 0) ||
                (!isYougile && isLoading && tasks.length === 0)) ? (
                <div className="space-y-1 px-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : isYougile && !yougileStore.yougileContext.boardId ? (
                <div className="flex h-48 flex-col items-center justify-center gap-1">
                  <span className="text-sm text-zinc-600">Select a Yougile board</span>
                  <span className="font-mono text-[10px] text-zinc-700">
                    choose org / project / board above
                  </span>
                </div>
              ) : isYougile && yougileVisibleTasks.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-1">
                  <span className="text-sm text-zinc-600">No Yougile tasks</span>
                  <span className="font-mono text-[10px] text-zinc-700">
                    press <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px">Opt+Space</kbd> to capture
                  </span>
                </div>
              ) : !isYougile && tasks.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-1">
                  <span className="text-sm text-zinc-600">No tasks</span>
                  <span className="font-mono text-[10px] text-zinc-700">
                    press <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px">Opt+Space</kbd> to capture
                  </span>
                </div>
              ) : (isYougile ? filteredYougile.length : filtered.length) === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-1">
                  <span className="text-sm text-zinc-600">No matches</span>
                  <span className="font-mono text-[10px] text-zinc-700">
                    press <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px">esc</kbd> to clear
                  </span>
                </div>
              ) : !isYougile && sidebarFilter === 'archived' ? (
                <div className="space-y-2">
                  {renderSection('Archived', filtered)}
                </div>
              ) : isYougile ? (
                <div className="space-y-2">
                  {groupedYougileByColumn.map(({ col, items }) =>
                    renderYougileSection(col.title, items)
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {groupedByColumn.map(({ col, items }) =>
                    renderSection(col.name, items)
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'kanban' && (
            <div className="h-full w-full">
              {isYougile && yougileStore.isLoading && yougileStore.tasks.length === 0 && (
                <div className="flex gap-4 p-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex-1 space-y-2">
                      <div className="h-8 bg-zinc-800 rounded animate-pulse" />
                      <div className="h-20 bg-zinc-800 rounded animate-pulse" />
                      <div className="h-20 bg-zinc-800 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              )}
              {isYougile ? (
                <KanbanBoard
                  yougileColumns={yougileColumnsAsKanban}
                  yougileTasksByColumn={yougileTasksByColumn}
                />
              ) : (
                <KanbanBoard />
              )}
            </div>
          )}

          {activeTab === 'calendar' && (
            <div className="h-full w-full">
              {isYougile ? (
                <CalendarView
                  tasks={[]}
                  yougileMode
                  yougileTasksRaw={yougileStore.tasks}
                  onSelectTask={yougileStore.selectTask}
                  onOpenEditor={() => setIsEditorOpen(true)}
                />
              ) : (
                <CalendarView tasks={tasks} />
              )}
            </div>
          )}
        </div>

        {/* Editor pane — local tasks */}
        {!isYougile && localSelectedTaskId && isEditorOpen && selectedTask && (
          <div className={`transition-shadow duration-150 ${isEditorFocused ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
            <TaskEditorPane />
          </div>
        )}

        {/* Editor pane — Yougile tasks */}
        {isYougile && isEditorOpen && selectedYougileTask && (
          <div className={`transition-shadow duration-150 ${isEditorFocused ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
            <YougileTaskEditor
              task={selectedYougileTask}
              onClose={() => setIsEditorOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Quick-add bar */}
      {isQuickAddOpen && (
        <div className="flex-shrink-0 border-t border-zinc-800/40 px-4 py-2">
          <div className="flex items-center gap-2">
            <Plus className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
            <input
              ref={quickAddRef}
              type="text"
              value={quickAddValue}
              onChange={(e) => setQuickAddValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && quickAddValue.trim()) {
                  e.preventDefault();
                  if (isYougile) {
                    if (!yougileStore.yougileContext.boardId) {
                      return;
                    }

                    let firstColumn = yougileStore.columns[0];
                    if (!firstColumn) {
                      await yougileStore.fetchColumns(yougileStore.yougileContext.boardId);
                      firstColumn = useYougileStore.getState().columns[0];
                    }

                    if (firstColumn) {
                      await yougileStore.createTask({
                        title: quickAddValue.trim(),
                        rawInput: quickAddValue.trim(),
                        columnId: firstColumn.id,
                      });
                    }
                  } else {
                    await createTask({ rawInput: quickAddValue.trim() });
                  }
                  setQuickAddValue('');
                  setIsQuickAddOpen(false);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setQuickAddValue('');
                  setIsQuickAddOpen(false);
                }
              }}
              placeholder={
                isYougile && !yougileStore.yougileContext.boardId
                  ? 'Select a Yougile board first'
                  : 'Type a task… #tag !priority @zettel'
              }
              className="h-7 flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            <kbd className="shrink-0 font-mono text-[9px] text-zinc-700">enter create · esc cancel</kbd>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-zinc-800/40 px-4 py-1">
        <div className="flex items-center justify-center gap-3 font-mono text-[10px] text-zinc-700">
          <span>j/k navigate</span>
          <span className="text-zinc-800">·</span>
          <span>e edit</span>
          <span className="text-zinc-800">·</span>
          <span>x done</span>
          <span className="text-zinc-800">·</span>
          <span>n new</span>
          {!isYougile && (
            <>
              <span className="text-zinc-800">·</span>
              <span>s cycle</span>
              <span className="text-zinc-800">·</span>
              <span>a archive</span>
              <span className="text-zinc-800">·</span>
              <span>o note</span>
            </>
          )}
          <span className="text-zinc-800">·</span>
          <span>d delete</span>
          <span className="text-zinc-800">·</span>
          <span>/ search</span>
        </div>
      </div>

      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-[#171717] p-4 shadow-2xl">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-red-400/80">
              Confirm Delete
            </div>
            <div className="text-sm text-zinc-200">
              Delete <span className="text-zinc-100">"{deleteDialog.taskTitle}"</span>?
            </div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">
              This cannot be undone.
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/20"
              >
                Yes
              </button>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2 font-mono text-[10px] text-zinc-700">
              <span>y yes</span>
              <span className="text-zinc-800">·</span>
              <span>n no</span>
            </div>
          </div>
        </div>
      )}

      {/* Hotkey Cheat Sheet */}
      <HotkeyCheatSheet open={showHelp} onClose={() => setShowHelp(false)} isYougile={isYougile} />

      {/* Context Menu */}
      {contextMenu && contextTask && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border border-zinc-800/60 bg-[#1a1a1a] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => { setIsEditorOpen(true); setContextMenu(null); }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800/60"
          >
            <PenLine className="h-3 w-3 text-zinc-500" />
            Edit
            <kbd className="ml-auto font-mono text-[10px] text-zinc-700">e</kbd>
          </button>

          <button
            type="button"
            onClick={() => {
              void updateTaskStatus({ id: contextTask.id, status: getNextStatus(contextTask.status) });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800/60"
          >
            <ArrowRightLeft className="h-3 w-3 text-zinc-500" />
            Move to {columns.find((c) => c.statusKey === getNextStatus(contextTask.status))?.name ?? getNextStatus(contextTask.status)}
            <kbd className="ml-auto font-mono text-[10px] text-zinc-700">s</kbd>
          </button>

          <button
            type="button"
            onClick={() => {
              void updateTaskStatus({ id: contextTask.id, status: contextTask.status === 'done' ? 'todo' : 'done' });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800/60"
          >
            <Check className="h-3 w-3 text-zinc-500" />
            {contextTask.status === 'done' ? 'Mark undone' : 'Mark done'}
            <kbd className="ml-auto font-mono text-[10px] text-zinc-700">x</kbd>
          </button>

          {contextTask.linkedNotePath && (
            <button
              type="button"
              onClick={() => {
                void openLinkedNote(contextTask.linkedNotePath!);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800/60"
            >
              <FileText className="h-3 w-3 text-cyan-500/60" />
              Open note
              <kbd className="ml-auto font-mono text-[10px] text-zinc-700">o</kbd>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              void updateTaskStatus({ id: contextTask.id, status: contextTask.status === 'archived' ? 'todo' : 'archived' });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800/60"
          >
            <Archive className="h-3 w-3 text-zinc-500" />
            {contextTask.status === 'archived' ? 'Unarchive' : 'Archive'}
            <kbd className="ml-auto font-mono text-[10px] text-zinc-700">a</kbd>
          </button>

          <div className="my-1 border-t border-zinc-800/40" />

          <button
            type="button"
            onClick={() => {
              requestDelete(buildDeleteRequest(contextTask));
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-red-400/80 hover:bg-zinc-800/60"
          >
            <Trash2 className="h-3 w-3" />
            Delete
            <kbd className="ml-auto font-mono text-[10px] text-zinc-700">d</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
