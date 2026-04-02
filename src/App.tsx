import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ArrowUpDown,
  Check,
  FileText,
  Plus,
  Settings,
  Trash2,
  X,
  LayoutDashboard,
  ChevronLeft,
  Calendar,
  Globe,
  HardDrive,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Command } from 'cmdk';
import { YougileTaskEditor } from '@/components/YougileTaskEditor';
import { dispatchFocusKey, focusEngine } from '@/lib/focus-engine';
import { useTaskStore } from '@/store/use-task-store';
import { useYougileStore } from '@/store/use-yougile-store';
import { tokenize, toDateInputValue } from '@/lib/formatting';
import { priorityOptions, priorityColor } from '@/lib/constants';
import type { Task, TaskPriority, TaskStatus } from '@/types';
import type { YougileTask } from '@/types/yougile';

type CaptureMode = 'insert' | 'normal';
type PickerMode = 'none' | 'org' | 'project' | 'board';

const ITEM_HEIGHT = 36;
const GROUP_HEADER_HEIGHT = 28;
const INPUT_AREA_HEIGHT = 72;
const FOOTER_HEIGHT = 36;
const WINDOW_CHROME = 16;
const ACTION_ITEM_HEIGHT = 44;
const MAX_VISIBLE_TASKS = 6;
const EDITOR_HEIGHT = 340;

function isYougileTask(task: Task | YougileTask): task is YougileTask {
  return 'columnId' in task && (task as YougileTask).columnId !== undefined;
}

// ── Inline Task Editor ────────────────────────────────────────────────────────

function InlineTaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask, columns, fetchColumns } = useTaskStore();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ? toDateInputValue(task.dueDate) : '');
  const [tags, setTags] = useState<string[]>([...task.tags]);
  const [tagInput, setTagInput] = useState('');

  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const priorityRef = useRef<HTMLSelectElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Ordered list of focusable field refs for Tab cycling
  const fieldRefs = useMemo(() => [
    titleRef, descriptionRef, statusRef, priorityRef, dueDateRef, tagInputRef,
  ], []);

  useEffect(() => {
    void fetchColumns();
    titleRef.current?.focus();
  }, [fetchColumns]);

  // Listen for Escape and Tab field cycling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;

      // Tab / Shift+Tab — cycle between editor fields instead of browser tab behavior
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const refs = fieldRefs.map((r) => r.current).filter(Boolean) as HTMLElement[];
        const currentIdx = refs.findIndex((el) => el === document.activeElement);
        if (e.shiftKey) {
          const prev = currentIdx <= 0 ? refs.length - 1 : currentIdx - 1;
          refs[prev]?.focus();
        } else {
          const next = currentIdx >= refs.length - 1 ? 0 : currentIdx + 1;
          refs[next]?.focus();
        }
        return;
      }

      // Escape — blur first if in a field, then close editor
      if (e.key === 'Escape') {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          (document.activeElement as HTMLElement).blur();
          e.stopPropagation();
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, fieldRefs]);

  const save = useCallback((patch: Record<string, unknown>) => {
    void updateTask({ id: task.id, ...patch });
  }, [updateTask, task.id]);

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      save({ title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  const handleDescriptionBlur = () => {
    const val = description.trim();
    const current = task.description || '';
    if (val !== current) {
      save({ description: val || null });
    }
  };

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    save({ status: newStatus });
  };

  const handlePriorityChange = (newPriority: TaskPriority) => {
    setPriority(newPriority);
    save({ priority: newPriority });
  };

  const handleDueDateChange = (value: string) => {
    setDueDate(value);
    save({ dueDate: value ? new Date(value + 'T00:00:00').toISOString() : null });
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().replace(/^#/, '').trim();
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      setTagInput('');
      save({ tags: newTags });
    }
  };

  const handleRemoveTag = (tag: string) => {
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    save({ tags: newTags });
  };

  return (
    <div className="flex flex-col">
      {/* Editor header */}
      <div className="flex h-8 items-center gap-2 border-b border-zinc-800/40 px-3">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          <span className="font-mono text-[10px] uppercase tracking-wider">Back</span>
        </button>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-zinc-700">{task.id.slice(0, 8)}</span>
      </div>

      {/* Title */}
      <div className="border-b border-zinc-800/30 px-4 py-2">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="w-full bg-transparent text-sm font-medium text-zinc-200 outline-none placeholder:text-zinc-600 selection:bg-cyan-500/30"
          placeholder="Task title…"
        />
      </div>

      {/* Description */}
      <div className="border-b border-zinc-800/30 px-4 py-2">
        <textarea
          ref={descriptionRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={handleDescriptionBlur}
          rows={2}
          className="w-full resize-none bg-transparent text-xs leading-relaxed text-zinc-400 outline-none placeholder:text-zinc-700 selection:bg-cyan-500/30"
          placeholder="Description…"
        />
      </div>

      {/* Fields */}
      <div className="border-b border-zinc-800/30">
        {/* Status */}
        <div className="flex h-8 items-center justify-between px-4">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Status</span>
          <select
            ref={statusRef}
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="bg-transparent text-right text-xs text-zinc-300 focus:outline-none cursor-pointer"
          >
            {columns.map((col) => (
              <option key={col.id} value={col.statusKey}>{col.name}</option>
            ))}
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Priority */}
        <div className="flex h-8 items-center justify-between px-4">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Priority</span>
          <select
            ref={priorityRef}
            value={priority}
            onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
            className={`bg-transparent text-right text-xs focus:outline-none cursor-pointer ${priorityColor[priority] || 'text-zinc-600'}`}
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Due Date */}
        <div className="flex h-8 items-center justify-between px-4">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Due</span>
          <div className="flex items-center gap-1.5">
            {dueDate ? (
              <div className="flex items-center gap-1">
                <input
                  ref={dueDateRef}
                  type="date"
                  value={dueDate}
                  onChange={(e) => handleDueDateChange(e.target.value)}
                  className="bg-transparent font-mono text-xs text-zinc-400 focus:outline-none cursor-pointer [color-scheme:dark]"
                />
                <button
                  type="button"
                  onClick={() => handleDueDateChange('')}
                  className="rounded p-0.5 text-zinc-700 hover:text-zinc-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0] ?? '';
                  handleDueDateChange(today);
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
              >
                <Calendar className="h-3 w-3" />
                <span className="font-mono text-[10px]">Set date</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="px-4 py-2">
        <div className="mb-1.5">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Tags</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="group/tag flex items-center gap-0.5 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
            >
              #{tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-0.5 opacity-0 group-hover/tag:opacity-100 text-zinc-600 hover:text-zinc-300 transition-opacity"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            ref={tagInputRef}
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); }
              if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                handleRemoveTag(tags[tags.length - 1]!);
              }
            }}
            onBlur={() => { if (tagInput.trim()) handleAddTag(); }}
            placeholder="add tag"
            className="h-5 w-16 bg-transparent font-mono text-[10px] text-zinc-500 placeholder:text-zinc-700 outline-none"
          />
          {tagInput.trim() && (
            <button
              type="button"
              onClick={handleAddTag}
              className="rounded p-0.5 text-zinc-700 hover:text-cyan-400 transition-colors"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

function App() {
  const [query, setQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode>('insert');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pickerMode, setPickerMode] = useState<PickerMode>('none');
  const isDialogOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressNextBlurHideRef = useRef(false);
  const preserveModeOnNextFocusRef = useRef(false);

  const {
    tasks,
    settings,
    error: localError,
    fetchTasks,
    fetchSettings,
    createTask,
    updateTaskStatus,
    deleteTask,
    openLinkedNote,
    clearError: clearLocalError,
    listenForUpdates,
  } = useTaskStore();

  const yougileStore = useYougileStore();
  const {
    yougileEnabled,
    activeSource,
    setActiveSource,
    setYougileEnabled,
    yougileContext,
    accounts,
    projects,
    boards,
    columns: yougileColumns,
    tasks: yougileTasks,
    fetchAccounts,
    fetchProjects,
    fetchBoards,
    fetchColumns: fetchYougileColumns,
    fetchTasks: fetchYougileTasks,
    fetchUsers,
    hydrateSyncState,
    setYougileContext,
    selectTask: selectYougileTask,
    error: yougileError,
    clearError: clearYougileError,
  } = yougileStore;

  const isYougile = yougileEnabled && activeSource === 'yougile';
  const activeAccount = accounts.find((account) => account.id === yougileContext.accountId);
  const visibleYougileTasks = useMemo(
    () => yougileTasks.filter((task) => !task.deleted && !task.archived),
    [yougileTasks]
  );
  const activeTasks = useMemo(() => {
    const list = isYougile ? visibleYougileTasks : tasks;
    return list.filter((task) => {
      if (isYougileTask(task)) return !task.completed;
      return task.status !== 'done';
    });
  }, [isYougile, visibleYougileTasks, tasks]);
  const visibleError = pickerMode !== 'none' || isYougile
    ? (yougileError ?? localError)
    : localError;
  const clearSourceError = useCallback(() => {
    clearLocalError();
    clearYougileError();
  }, [clearLocalError, clearYougileError]);

  const hasQuery = query.trim().length > 0;
  const tokens = useMemo(() => tokenize(query), [query]);
  const hasHighlights = tokens.some((t) => t.color !== null);
  const editingLocalTask = !isYougile && editingTaskId
    ? tasks.find((task) => task.id === editingTaskId)
    : null;
  const editingYougileTask = isYougile && editingTaskId
    ? visibleYougileTasks.find((task) => task.id === editingTaskId)
    : null;
  const editingTask = editingLocalTask ?? editingYougileTask;

  // ── Focus engine integration ──────────────────────────────────────────────

  // Bidirectional sync: captureMode <-> focus engine mode
  useEffect(() => {
    const engine = focusEngine.getState();
    engine.setMode(mode === 'insert' ? 'INSERT' : 'NORMAL');
  }, [mode]);

  useEffect(() => {
    const unsub = focusEngine.subscribe((state) => {
      const newMode: CaptureMode = state.mode === 'INSERT' ? 'insert' : 'normal';
      setMode((prev) => (prev !== newMode ? newMode : prev));
    });
    return unsub;
  }, []);

  // Register capture-bar pane with focus engine
  useEffect(() => {
    const engine = focusEngine.getState();
    engine.registerPane('capture-bar', { regions: ['input', 'picker'], order: 0 });
    return () => {
      engine.unregisterPane('capture-bar');
    };
  }, []);

  // Items visible in normal mode (tasks + actions)
  const actionItems = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      shortcut?: string;
      Icon: typeof LayoutDashboard;
      iconWrapClass: string;
      iconClass: string;
    }> = [
      {
        id: '__dashboard',
        label: 'Dashboard',
        shortcut: '⌘⇧Space',
        Icon: LayoutDashboard,
        iconWrapClass: 'bg-cyan-500/10',
        iconClass: 'text-cyan-400',
      },
      {
        id: '__settings',
        label: 'Settings',
        shortcut: '⌘,',
        Icon: Settings,
        iconWrapClass: 'bg-zinc-800',
        iconClass: 'text-zinc-400',
      },
    ];

    if (!yougileEnabled) {
      return items;
    }

    items.push({
      id: '__toggle-source',
      label: isYougile ? 'Switch to Local' : 'Switch to Yougile',
      Icon: isYougile ? HardDrive : Globe,
      iconWrapClass: 'bg-zinc-800',
      iconClass: 'text-zinc-400',
    });

    items.push({
      id: '__switch-org',
      label: 'Switch Org…',
      Icon: Globe,
      iconWrapClass: 'bg-zinc-800',
      iconClass: 'text-zinc-400',
    });

    if (isYougile) {
      items.push(
        {
          id: '__switch-board',
          label: 'Switch Board…',
          Icon: ChevronRight,
          iconWrapClass: 'bg-zinc-800',
          iconClass: 'text-zinc-400',
        }
      );
    }

    return items;
  }, [isYougile, yougileEnabled]);

  const normalModeItems = useMemo(() => {
    if (hasQuery) return [{ id: '__create', label: `Create "${query}"` }];
    return [...activeTasks.map((task) => ({ id: task.id, label: task.title })), ...actionItems];
  }, [activeTasks, hasQuery, query, actionItems]);

  // Picker items for vim navigation inside org/project/board pickers
  const pickerItems = useMemo((): { id: string }[] => {
    if (pickerMode === 'org') return accounts;
    if (pickerMode === 'project') return projects;
    if (pickerMode === 'board') return boards;
    return [];
  }, [pickerMode, accounts, projects, boards]);

  // Reset selection when picker mode or its items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [pickerMode]);

  // Clamp selectedIndex when items change
  useEffect(() => {
    const items = pickerMode !== 'none' ? pickerItems : normalModeItems;
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
  }, [normalModeItems, pickerItems, pickerMode, selectedIndex]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings) {
      setYougileEnabled(settings.yougileEnabled);
    }
  }, [settings, setYougileEnabled]);

  const syncYougileState = useCallback(async () => {
    if (!yougileEnabled) return;
    await hydrateSyncState();
    await fetchAccounts();
  }, [fetchAccounts, hydrateSyncState, yougileEnabled]);

  // Enter insert mode + focus input when window gains focus
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void fetchTasks();
    if (yougileEnabled) {
      void syncYougileState();
    }
  }, [fetchTasks, syncYougileState, yougileEnabled]);

  useEffect(() => {
    if (activeSource !== 'yougile' || !yougileContext.accountId) return;
    void fetchProjects();
  }, [activeSource, fetchProjects, yougileContext.accountId]);

  useEffect(() => {
    if (activeSource !== 'yougile' || !yougileContext.projectId) return;
    void Promise.all([
      fetchBoards(yougileContext.projectId),
      fetchUsers(yougileContext.projectId),
    ]);
  }, [activeSource, fetchBoards, fetchUsers, yougileContext.projectId]);

  useEffect(() => {
    if (activeSource !== 'yougile' || !yougileContext.boardId) return;
    void fetchYougileColumns(yougileContext.boardId).then(() => {
      void fetchYougileTasks();
    });
  }, [activeSource, fetchYougileColumns, fetchYougileTasks, yougileContext.boardId]);

  useEffect(() => {
    return listenForUpdates();
  }, [listenForUpdates]);

  const lastFocusFetchRef = useRef(0);
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (focused) {
        suppressNextBlurHideRef.current = false;
        // Debounce: skip re-fetch if focused within 2s
        const now = Date.now();
        if (now - lastFocusFetchRef.current > 2000) {
          lastFocusFetchRef.current = now;
          void fetchTasks();
          if (yougileEnabled) {
            void syncYougileState();
          }
        }
        if (preserveModeOnNextFocusRef.current) {
          preserveModeOnNextFocusRef.current = false;
        } else {
          // Reset to insert mode when window appears
          setMode('insert');
          setSelectedIndex(0);
        }
        requestAnimationFrame(() => inputRef.current?.focus());
      } else if (suppressNextBlurHideRef.current) {
        suppressNextBlurHideRef.current = false;
        preserveModeOnNextFocusRef.current = true;
        void invoke('show_window');
      } else if (!isDialogOpenRef.current) {
        hideTimer = setTimeout(() => void invoke('hide_window'), 50);
      }
    });
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      unlisten.then((fn) => fn());
    };
  }, [fetchTasks, syncYougileState, yougileEnabled]);

  // Dynamic window sizing based on actual content, clamped to screen
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;

    let contentHeight: number;

    if (editingTask) {
      contentHeight = editingYougileTask ? 620 : EDITOR_HEIGHT;
    } else if (hasQuery) {
      // "Create task" item
      contentHeight = GROUP_HEADER_HEIGHT + ACTION_ITEM_HEIGHT;
    } else {
      const taskCount = Math.min(activeTasks.length, MAX_VISIBLE_TASKS);
      const tasksHeight = taskCount > 0 ? GROUP_HEADER_HEIGHT + taskCount * ITEM_HEIGHT : 0;
      const actionsHeight = GROUP_HEADER_HEIGHT + actionItems.length * ACTION_ITEM_HEIGHT;
      contentHeight = tasksHeight + actionsHeight;
    }

    const statusHeight = (statusMessage || visibleError) ? 24 : 0;
    const inputHeight = editingTask ? 0 : INPUT_AREA_HEIGHT;
    const totalHeight = inputHeight + statusHeight + contentHeight + FOOTER_HEIGHT + WINDOW_CHROME;
    // Clamp to 80% of screen height to avoid overflowing off-screen
    const maxScreenHeight = Math.floor(window.screen.availHeight * 0.8);
    const clampedHeight = Math.max(Math.min(totalHeight, maxScreenHeight), 200);

    const win = getCurrentWindow();
    void win.setSize(new LogicalSize(680, clampedHeight));
    // Position near top-center (like Spotlight) so content doesn't overflow bottom
    void win.setPosition(new LogicalPosition(
      Math.floor((window.screen.availWidth - 680) / 2),
      Math.floor(window.screen.availHeight * 0.1),
    ));
  }, [
    actionItems.length,
    activeTasks.length,
    editingTask,
    editingYougileTask,
    hasQuery,
    visibleError,
    statusMessage,
  ]);

  // Close editor if task disappears (e.g. deleted from another window)
  useEffect(() => {
    if (editingTaskId && !activeTasks.find((task) => task.id === editingTaskId)) {
      setEditingTaskId(null);
    }
  }, [activeTasks, editingTaskId]);

  const handleSelectAccount = useCallback(async (accountId: string) => {
    setYougileContext({
      accountId,
      projectId: null,
      projectName: null,
      boardId: null,
      boardName: null,
    });
    setEditingTaskId(null);
    await fetchProjects();
    const nextState = useYougileStore.getState();
    if (!nextState.error && nextState.projects.length === 0) {
      setStatusMessage('No projects found in this organization');
    } else {
      setStatusMessage('');
    }
    setPickerMode('project');
  }, [fetchProjects, setYougileContext]);

  const handleSelectProject = useCallback(async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    setYougileContext({
      projectId,
      projectName: project.title,
      boardId: null,
      boardName: null,
    });
    setEditingTaskId(null);
    await Promise.all([fetchBoards(projectId), fetchUsers(projectId)]);
    const nextState = useYougileStore.getState();
    if (!nextState.error && nextState.boards.length === 0) {
      setStatusMessage('No boards found in this project');
    } else {
      setStatusMessage('');
    }
    setPickerMode('board');
  }, [fetchBoards, fetchUsers, projects, setYougileContext]);

  const handleSelectBoard = useCallback(async (boardId: string) => {
    const board = boards.find((item) => item.id === boardId);
    if (!board) return;

    setYougileContext({ boardId: board.id, boardName: board.title });
    setActiveSource('yougile');
    setEditingTaskId(null);
    await fetchYougileColumns(board.id);
    await fetchYougileTasks();
    setPickerMode('none');
  }, [boards, fetchYougileColumns, fetchYougileTasks, setActiveSource, setYougileContext]);

  const handleCreateTask = useCallback(async () => {
    if (!query.trim()) return;
    try {
      if (isYougile) {
        if (!yougileContext.boardId) {
          setStatusMessage('Select a Yougile board first');
          setTimeout(() => setStatusMessage(''), 2000);
          return;
        }

        let firstColumn = yougileColumns[0];
        if (!firstColumn) {
          await fetchYougileColumns(yougileContext.boardId);
          firstColumn = useYougileStore.getState().columns[0];
        }
        if (firstColumn) {
          const task = await yougileStore.createTask({
            title: query.trim(),
            rawInput: query.trim(),
            columnId: firstColumn.id,
          });
          if (task) {
            setQuery('');
            setMode('insert');
            setStatusMessage(`Created in Yougile: ${task.title}`);
            setTimeout(() => setStatusMessage(''), 2000);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }
      } else {
        const task = await createTask({ rawInput: query.trim() });
        if (task) {
          setQuery('');
          setMode('insert');
          setStatusMessage(`Created: ${task.title}`);
          setTimeout(() => setStatusMessage(''), 2000);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [query, createTask, fetchYougileColumns, isYougile, yougileContext.boardId, yougileColumns, yougileStore]);

  const handleToggleStatus = useCallback(async (task: Task | YougileTask) => {
    try {
      if (isYougileTask(task)) {
        await yougileStore.updateTask(task.id, { completed: !task.completed });
      } else {
        const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
        await updateTaskStatus({ id: task.id, status: newStatus });
      }
    } catch (err) {
      console.error(err);
    }
  }, [updateTaskStatus, yougileStore]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      if (isYougile) {
        await yougileStore.deleteTask(taskId);
      } else {
        await deleteTask(taskId);
      }
    } catch (err) {
      console.error(err);
    }
  }, [deleteTask, isYougile, yougileStore]);

  const handleOpenNote = useCallback(async (path: string) => {
    try { await openLinkedNote(path); } catch (err) { console.error(err); }
  }, [openLinkedNote]);

  const getPriorityLabel = (p: TaskPriority) => {
    switch (p) {
      case 'urgent': return { text: '!!!', color: 'text-red-400' };
      case 'high': return { text: '!!', color: 'text-orange-400' };
      case 'medium': return { text: '!', color: 'text-yellow-400' };
      case 'low': return { text: '~', color: 'text-blue-400' };
      default: return null;
    }
  };

  const handleCloseEditor = useCallback(() => {
    setEditingTaskId(null);
  }, []);

  const handleAction = useCallback(async (actionId: string) => {
    switch (actionId) {
      case '__dashboard':
        await invoke('hide_window');
        await invoke('open_dashboard_window');
        return;
      case '__settings':
        await invoke('hide_window');
        await invoke('open_settings_window');
        return;
      case '__toggle-source':
        if (isYougile) {
          selectYougileTask(null);
          setEditingTaskId(null);
          setActiveSource('local');
          return;
        }
        await fetchAccounts();
        if (useYougileStore.getState().accounts.length === 0) {
          await invoke('open_settings_window');
          return;
        }
        setPickerMode('org');
        return;
      case '__switch-org':
        await fetchAccounts();
        if (useYougileStore.getState().accounts.length === 0) {
          await invoke('open_settings_window');
          return;
        }
        setPickerMode('org');
        return;
      case '__switch-board':
        if (!yougileContext.accountId) {
          await fetchAccounts();
          setPickerMode('org');
          return;
        }
        if (projects.length === 0) {
          await fetchProjects();
        }
        setPickerMode('project');
        return;
      default:
        return;
    }
  }, [
    fetchAccounts,
    fetchProjects,
    isYougile,
    projects.length,
    selectYougileTask,
    setActiveSource,
    yougileContext.accountId,
  ]);

  // Register capture-bar actions for FocusProvider dispatch
  useEffect(() => {
    window.__jotActions = {
      onEscape: () => {
        const engineMode = focusEngine.getState().mode;
        if (engineMode === 'NORMAL') {
          void invoke('hide_window');
        }
      },
      onNewItem: () => {
        setQuery('');
        setMode('insert');
        requestAnimationFrame(() => inputRef.current?.focus());
      },
      onToggleDone: () => {
        const item = normalModeItems[selectedIndex];
        if (item && !item.id.startsWith('__')) {
          const task = activeTasks.find((t) => t.id === item.id);
          if (task) void handleToggleStatus(task);
        }
      },
      onDelete: () => {
        const item = normalModeItems[selectedIndex];
        if (item && !item.id.startsWith('__')) {
          void handleDeleteTask(item.id);
        }
      },
      onOpenItem: () => {
        const item = normalModeItems[selectedIndex];
        if (!item) return;
        if (item.id === '__create') {
          void handleCreateTask();
        } else if (item.id.startsWith('__')) {
          void handleAction(item.id);
        } else {
          setEditingTaskId(item.id);
        }
      },
    };
    return () => {
      if (window.__jotActions) {
        delete window.__jotActions;
      }
    };
  }, [normalModeItems, selectedIndex, activeTasks, handleToggleStatus, handleDeleteTask, handleCreateTask, handleAction]);

  // Single focus-engine keydown handler — replaces old inline handlers
  useEffect(() => {
    if (editingTask) return;

    const handler = (e: KeyboardEvent) => {
      // Skip if focus is in a textarea/select (editor fields)
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;

      // In INSERT mode, only handle Escape specially.
      // All other keys pass through to the input's native handlers.
      if (mode === 'insert') {
        if (e.key === 'Escape') {
          e.preventDefault();
          // Picker back-navigation in INSERT mode
          if (pickerMode !== 'none') {
            if (pickerMode === 'board') setPickerMode('project');
            else if (pickerMode === 'project') setPickerMode('org');
            else setPickerMode('none');
            return;
          }
          if (hasQuery) {
            // Clear query first, stay in insert mode
            setQuery('');
          } else {
            // Empty input — switch to NORMAL mode
            // The focus engine dispatch handles the mode change
            const result = dispatchFocusKey(focusEngine, e, window.__jotActions);
            if (result.stopPropagation) e.stopPropagation();
            // Sync capture mode with engine
            if (focusEngine.getState().mode === 'NORMAL') {
              suppressNextBlurHideRef.current = true;
              preserveModeOnNextFocusRef.current = true;
              setMode('normal');
              setSelectedIndex(0);
              requestAnimationFrame(() => inputRef.current?.focus());
            }
          }
          return;
        }
        // Let other keys pass through to input's onKeyDown
        return;
      }

      // NORMAL mode (no picker) — handle navigation locally, delegate actions to focus engine
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, normalModeItems.length - 1));
          return;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        case 'g':
          e.preventDefault();
          setSelectedIndex(0);
          return;
        case 'G':
          e.preventDefault();
          setSelectedIndex(normalModeItems.length - 1);
          return;
        case 'i':
          e.preventDefault();
          setMode('insert');
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        case 'Enter':
        case 'e': {
          e.preventDefault();
          const item = normalModeItems[selectedIndex];
          if (!item) return;
          if (item.id === '__create') {
            void handleCreateTask();
          } else if (item.id.startsWith('__')) {
            void handleAction(item.id);
          } else {
            setEditingTaskId(item.id);
          }
          return;
        }
        case 'Escape':
          e.preventDefault();
          void invoke('hide_window');
          return;
      }

      // Delegate remaining action keys (x/d/n/o/m/r/?/space/1/2/3) to focus engine
      if (pickerMode !== 'none') {
        // Handle picker navigation locally (same as before)
        switch (e.key) {
          case 'j':
          case 'ArrowDown':
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, pickerItems.length - 1));
            return;
          case 'k':
          case 'ArrowUp':
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
            return;
          case 'g':
            e.preventDefault();
            setSelectedIndex(0);
            return;
          case 'G':
            e.preventDefault();
            setSelectedIndex(pickerItems.length - 1);
            return;
          case 'Enter':
          case 'e': {
            e.preventDefault();
            const pick = pickerItems[selectedIndex];
            if (!pick) return;
            if (pickerMode === 'org') void handleSelectAccount(pick.id);
            else if (pickerMode === 'project') void handleSelectProject(pick.id);
            else if (pickerMode === 'board') void handleSelectBoard(pick.id);
            return;
          }
          case 'Escape':
            e.preventDefault();
            if (pickerMode === 'board') setPickerMode('project');
            else if (pickerMode === 'project') setPickerMode('org');
            else setPickerMode('none');
            return;
          case 'i':
            e.preventDefault();
            setMode('insert');
            requestAnimationFrame(() => inputRef.current?.focus());
            return;
          default:
            if (!e.metaKey && !e.ctrlKey) e.preventDefault();
            return;
        }
      }

      // Normal mode (no picker) — let focus engine dispatch
      const result = dispatchFocusKey(focusEngine, e, window.__jotActions);
      if (result.handled) {
        if (result.stopPropagation) e.stopPropagation();
      }
      // 'i' and '/' switch to insert — handled by engine setting mode
      // We subscribe to engine mode changes above to sync captureMode
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    editingTask,
    handleAction,
    handleCreateTask,
    handleSelectAccount,
    handleSelectBoard,
    handleSelectProject,
    hasQuery,
    mode,
    pickerItems,
    pickerMode,
    selectedIndex,
  ]);

  const sourceBadgeLabel = useMemo(() => {
    if (!isYougile) {
      return 'LOCAL';
    }

    const segments = [activeAccount?.companyName, yougileContext.boardName].filter(Boolean);
    return segments.join(' / ') || 'YOUGILE';
  }, [activeAccount?.companyName, isYougile, yougileContext.boardName]);

  const sourceBadgeTitle = useMemo(() => {
    if (!isYougile) {
      return 'Local tasks';
    }

    const segments = [
      activeAccount?.companyName,
      yougileContext.projectName,
      yougileContext.boardName,
    ].filter(Boolean);
    return segments.join(' / ') || 'Yougile';
  }, [
    activeAccount?.companyName,
    isYougile,
    yougileContext.boardName,
    yougileContext.projectName,
  ]);

  // Scroll selected item into view in normal mode
  useEffect(() => {
    if (mode !== 'normal') return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-capture-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [selectedIndex, mode]);

  // ── Editing mode ────────────────────────────────────────────────────────────

  if (editingTask) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-transparent">
        <div className="flex w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/95 shadow-[0_0_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {editingLocalTask ? (
            <InlineTaskEditor task={editingLocalTask} onClose={handleCloseEditor} />
          ) : editingYougileTask ? (
            <YougileTaskEditor
              task={editingYougileTask}
              embedded
              onClose={handleCloseEditor}
            />
          ) : null}

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-zinc-800/40 px-3 py-1.5">
            <div className="flex items-center justify-between font-mono text-[10px] text-zinc-600">
              <div className="flex items-center gap-2">
                <span>esc back</span>
                <span className="text-zinc-800">·</span>
                <span>tab next field</span>
              </div>
              <span>auto-saves on blur</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Default: command palette mode ───────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent">
      <Command
        shouldFilter={false}
        className="flex w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/95 shadow-[0_0_60px_rgba(0,0,0,0.6)] backdrop-blur-xl"
      >
        {/* Input Area */}
        <div className="flex-shrink-0 border-b border-zinc-800/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 font-mono text-xs font-bold text-cyan-400">
              J
            </div>
            <div className="relative min-w-0 flex-1">
              {/* Highlighted overlay — rendered behind the input */}
              {hasHighlights && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex h-7 items-center overflow-hidden whitespace-pre text-base"
                >
                  {tokens.map((t, i) => (
                    <span key={i} style={t.color ? { color: t.color } : { color: 'rgb(228 228 231)' }}>
                      {t.text}
                    </span>
                  ))}
                </div>
              )}
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={(val) => {
                  setQuery(val);
                  // Typing anything switches back to insert mode
                  if (mode !== 'insert') setMode('insert');
                }}
                onKeyDown={(e) => {
                  // Tab — suppress browser tab behavior
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    // Escape is handled by the window-level focus engine handler.
                    // We just preventDefault here to stop default browser behavior.
                    // The window handler will fire next and handle mode switching.
                    return;
                  }
                  // In normal mode, intercept keys before they reach the input
                  if (mode === 'normal') {
                    if (e.key === 'i' || e.key === '/') {
                      // These switch back to insert mode — handled by focus engine
                      // but we need to prevent the character from being typed
                      e.preventDefault();
                    } else if (!e.metaKey && !e.ctrlKey) {
                      // Block all other characters from reaching the input
                      e.preventDefault();
                    }
                    return;
                  }
                  if (e.key === 'Enter' && hasQuery) { e.preventDefault(); void handleCreateTask(); }
                  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                    e.preventDefault();
                    void invoke('hide_window');
                    void invoke('open_settings_window');
                  }
                }}
                placeholder="Type a task… #tag !priority @zettel"
                className={`h-7 w-full border-0 bg-transparent text-base placeholder:text-zinc-600 outline-none ${
                  hasHighlights ? 'text-transparent caret-zinc-100' : 'text-zinc-100'
                }`}
              />
            </div>
            {yougileEnabled && (
              <div className="flex shrink-0 items-stretch">
                <button
                  type="button"
                  className={`rounded-l border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    isYougile
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:bg-zinc-800'
                  } rounded-r-none border-r-0`}
                  onClick={() => void handleAction(isYougile ? '__switch-board' : '__toggle-source')}
                  title={sourceBadgeTitle}
                >
                  {sourceBadgeLabel}
                </button>
                <button
                  type="button"
                  className={`rounded-r border px-1 py-0.5 transition-colors ${
                    isYougile
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400/70 hover:bg-cyan-500/20 hover:text-cyan-400'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                  onClick={() => void handleAction('__switch-org')}
                  title="Choose Yougile organization"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            )}
            <kbd className="shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              Opt+Space
            </kbd>
          </div>

          {(statusMessage || visibleError) && (
            <div className="mt-1.5 flex items-center gap-2 pl-10 text-[11px]">
              <span className={visibleError ? 'text-red-400' : 'text-zinc-500'}>
                {visibleError || statusMessage}
              </span>
              {visibleError && (
                <button type="button" onClick={clearSourceError} className="text-zinc-500 hover:text-zinc-300">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Scrollable List */}
        <div
          className="hide-scrollbar min-h-0 flex-1 overflow-y-auto"
          style={{
            maxHeight:
              MAX_VISIBLE_TASKS * ITEM_HEIGHT +
              GROUP_HEADER_HEIGHT * 2 +
              actionItems.length * ACTION_ITEM_HEIGHT +
              8,
          }}
        >
          <Command.List className="py-1">
            {/* Picker Mode — replaces task list when active */}
            {pickerMode !== 'none' && (
              <Command.Group
                heading={pickerMode === 'org' ? 'Select Organization' : pickerMode === 'project' ? 'Select Project' : 'Select Board'}
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {pickerMode === 'org' && accounts.map((account, idx) => (
                  <Command.Item
                    key={account.id}
                    value={`org-${account.id}`}
                    onSelect={() => void handleSelectAccount(account.id)}
                    className={`flex h-9 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                      mode === 'normal' && selectedIndex === idx
                        ? 'bg-zinc-900/80'
                        : 'data-[selected=true]:bg-zinc-900/80'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Globe className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-zinc-200">{account.companyName}</span>
                    </div>
                    {yougileContext.accountId === account.id && <Check className="h-3 w-3 text-cyan-400" />}
                  </Command.Item>
                ))}
                {pickerMode === 'org' && accounts.length > 0 && (
                  <div className="px-3 py-2 text-[10px] text-zinc-600">
                    Showing saved organizations. Add more in Settings.
                  </div>
                )}
                {pickerMode === 'org' && accounts.length === 0 && (
                  <div className="px-3 py-3 text-xs text-zinc-500">
                    No connected Yougile accounts. Open Settings and add one first.
                  </div>
                )}
                {pickerMode === 'project' && projects.map((project, idx) => (
                  <Command.Item
                    key={project.id}
                    value={`project-${project.id}`}
                    onSelect={() => void handleSelectProject(project.id)}
                    className={`flex h-9 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                      mode === 'normal' && selectedIndex === idx
                        ? 'bg-zinc-900/80'
                        : 'data-[selected=true]:bg-zinc-900/80'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-zinc-200">{project.title}</span>
                    </div>
                    {yougileContext.projectId === project.id && <Check className="h-3 w-3 text-cyan-400" />}
                  </Command.Item>
                ))}
                {pickerMode === 'project' && projects.length === 0 && !visibleError && (
                  <div className="px-3 py-3 text-xs text-zinc-500">
                    No projects found in this organization.
                  </div>
                )}
                {pickerMode === 'board' && boards.map((board, idx) => (
                  <Command.Item
                    key={board.id}
                    value={`board-${board.id}`}
                    onSelect={() => void handleSelectBoard(board.id)}
                    className={`flex h-9 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                      mode === 'normal' && selectedIndex === idx
                        ? 'bg-zinc-900/80'
                        : 'data-[selected=true]:bg-zinc-900/80'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-zinc-200">{board.title}</span>
                    </div>
                    {yougileContext.boardId === board.id && <Check className="h-3 w-3 text-cyan-400" />}
                  </Command.Item>
                ))}
                {pickerMode === 'board' && boards.length === 0 && !visibleError && (
                  <div className="px-3 py-3 text-xs text-zinc-500">
                    No boards found in this project.
                  </div>
                )}
              </Command.Group>
            )}

            {pickerMode === 'none' && !hasQuery && activeTasks.length > 0 && (
              <Command.Group
                heading={isYougile ? 'Yougile Tasks' : 'Tasks'}
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {activeTasks.map((task, taskIdx) => {
                  const isNormalSelected = mode === 'normal' && selectedIndex === taskIdx;
                  const isRemoteTask = isYougileTask(task);
                  const isDone = isRemoteTask ? task.completed : task.status === 'done';
                  const pri = !isRemoteTask ? getPriorityLabel(task.priority) : null;
                  const deadline = isRemoteTask && task.deadline?.deadline
                    ? new Date(task.deadline.deadline).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : null;
                  return (
                    <Command.Item
                      key={task.id}
                      value={task.id}
                      data-capture-index={taskIdx}
                      onSelect={() => setEditingTaskId(task.id)}
                      className={`group flex h-9 cursor-pointer items-center gap-2.5 border-l-2 px-3 text-sm text-zinc-300 outline-none transition-colors ${
                        isNormalSelected
                          ? 'border-l-cyan-500 bg-zinc-900/80'
                          : 'border-transparent data-[selected=true]:border-l-cyan-500 data-[selected=true]:bg-zinc-900/80'
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        type="button"
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                          isDone
                            ? 'border-cyan-500/40 bg-cyan-500/20'
                            : 'border-zinc-700 hover:border-zinc-500'
                        }`}
                        onClick={(e) => { e.stopPropagation(); void handleToggleStatus(task); }}
                      >
                        {isDone && <Check className="h-2.5 w-2.5 text-cyan-400" strokeWidth={3} />}
                      </button>

                      {/* Title */}
                      <span className={`min-w-0 flex-1 truncate ${
                        isDone ? 'text-zinc-600 line-through' : 'text-zinc-200'
                      }`}>
                        {task.title}
                      </span>

                      {/* Inline metadata — right side */}
                      <div className="flex shrink-0 items-center gap-1.5">
                        {!isRemoteTask && task.linkedNotePath && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleOpenNote(task.linkedNotePath!); }}
                            className="text-cyan-500/60 hover:text-cyan-400 transition-colors"
                          >
                            <FileText className="h-3 w-3" />
                          </button>
                        )}
                        {!isRemoteTask && task.tags.map((tag) => (
                          <span key={tag} className="font-mono text-[10px] text-zinc-600">#{tag}</span>
                        ))}
                        {pri && (
                          <span className={`font-mono text-[10px] font-bold ${pri.color}`}>{pri.text}</span>
                        )}
                        {!isRemoteTask && task.dueDate && (
                          <span className="font-mono text-[10px] text-zinc-600">
                            {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        {isRemoteTask && deadline && (
                          <span className="font-mono text-[10px] text-zinc-600">{deadline}</span>
                        )}
                        {isRemoteTask && task.assigned.length > 0 && (
                          <span className="font-mono text-[10px] text-zinc-600">
                            @{task.assigned.length}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteTask(task.id); }}
                          className="ml-0.5 rounded p-0.5 text-zinc-700 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {pickerMode === 'none' && (!hasQuery ? (
              <Command.Group
                heading="Actions"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {actionItems.map((action, actionIdx) => {
                  const Icon = action.Icon;
                  const itemIndex = activeTasks.length + actionIdx;

                  return (
                    <Command.Item
                      key={action.id}
                      value={action.id}
                      data-capture-index={itemIndex}
                      onSelect={() => void handleAction(action.id)}
                      className={`group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                        mode === 'normal' && selectedIndex === itemIndex
                          ? 'bg-zinc-900/80'
                          : 'data-[selected=true]:bg-zinc-900/80'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${action.iconWrapClass}`}>
                          <Icon className={`h-3.5 w-3.5 ${action.iconClass}`} />
                        </div>
                        <span className="text-zinc-200">{action.label}</span>
                      </div>
                      {action.shortcut && (
                        <kbd className="font-mono text-[10px] text-zinc-600">{action.shortcut}</kbd>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ) : (
              <Command.Group
                heading="Create"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                <Command.Item
                  value="create-task"
                  data-capture-index={0}
                  onSelect={() => void handleCreateTask()}
                  className={`group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                    mode === 'normal' && selectedIndex === 0
                      ? 'bg-zinc-900/80'
                      : 'data-[selected=true]:bg-zinc-900/80'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-500/10">
                      <Plus className="h-3.5 w-3.5 text-cyan-400" />
                    </div>
                    <span className="text-zinc-200 truncate">Create "<span className="text-cyan-400">{query}</span>"</span>
                  </div>
                  <kbd className="shrink-0 font-mono text-[10px] text-cyan-500/60">↵</kbd>
                </Command.Item>
              </Command.Group>
            ))}
          </Command.List>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-zinc-800/40 px-3 py-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-zinc-600">
            {mode === 'insert' ? (
              <>
                <div className="flex items-center gap-2">
                  <span>↵ {hasQuery ? 'create' : 'edit'}</span>
                  <span className="text-zinc-800">·</span>
                  <span>⌘, settings</span>
                  <span className="text-zinc-800">·</span>
                  <span>esc {hasQuery ? 'clear' : 'navigate'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ArrowUpDown className="h-2.5 w-2.5" />
                  <span>navigate</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-cyan-500/10 px-1 text-cyan-400">NAV</span>
                  <span>j/k move</span>
                  <span className="text-zinc-800">·</span>
                  <span>↵ select</span>
                  <span className="text-zinc-800">·</span>
                  <span>i type</span>
                  <span className="text-zinc-800">·</span>
                  <span>x toggle</span>
                  <span className="text-zinc-800">·</span>
                  <span>esc dismiss</span>
                </div>
                <span>d delete</span>
              </>
            )}
          </div>
        </div>
      </Command>
    </div>
  );
}

export default App;
