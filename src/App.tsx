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
import { resolveNormalKeyActions, useRegisteredNormalKeyActions } from '@/lib/focus-actions';
import { useTaskStore } from '@/store/use-task-store';
import { useTemplateStore } from '@/store/use-template-store';
import { useYougileStore } from '@/store/use-yougile-store';
import { todayDateInput, tokenize, toDateInputValue } from '@/lib/formatting';
import { isTauriAvailable } from '@/lib/tauri';
import { priorityOptions, priorityColor } from '@/lib/constants';
import { getYougileTaskColorValue } from '@/lib/yougile';
import {
  captureShortcutLabel,
  dashboardShortcutLabel,
  settingsShortcutLabel,
} from '@/lib/shortcuts';
import {
  persistTemplateIntent,
  type TemplateNavigationDraft,
} from '@/lib/settings-navigation';
import type { KanbanColumn, Task, TaskPriority, TaskStatus } from '@/types';
import type { YougileColumn, YougileTask } from '@/types/yougile';

type CaptureMode = 'insert' | 'normal';
type PickerMode = 'none' | 'org' | 'project' | 'board' | 'template' | 'columns';

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
                  const today = todayDateInput();
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
  const [hiddenColumnIds, setHiddenColumnIds] = useState<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  // Confirmation state for destructive actions (x=toggle, d=delete)
  const [pendingConfirm, setPendingConfirm] = useState<{ action: 'toggle' | 'delete'; taskId: string; taskTitle: string } | null>(null);
  const pendingConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDialogOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listViewportRef = useRef<HTMLDivElement>(null);
  const suppressNextBlurHideRef = useRef(false);
  const preserveModeOnNextFocusRef = useRef(false);

  const {
    tasks,
    columns,
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
    templates,
    fetchTemplates,
    error: templateError,
    clearError: clearTemplateError,
  } = useTemplateStore();
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
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );
  const activeTasks = useMemo(() => {
    const list = isYougile ? visibleYougileTasks : tasks;
    return list.filter((task) => {
      if (isYougileTask(task)) return !task.completed && !hiddenColumnIds.has(task.columnId ?? '');
      return task.status !== 'done' && !hiddenColumnIds.has(task.status);
    });
  }, [isYougile, visibleYougileTasks, tasks, hiddenColumnIds]);
  const createDraftTitle = query.trim() || activeTemplate?.title.trim() || '';
  const hasCreateDraft = createDraftTitle.length > 0;
  const visibleError = templateError ?? (
    pickerMode !== 'none' || isYougile
      ? (yougileError ?? localError)
      : localError
  );
  const clearSourceError = useCallback(() => {
    clearLocalError();
    clearYougileError();
    clearTemplateError();
  }, [clearLocalError, clearTemplateError, clearYougileError]);

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
        shortcut: dashboardShortcutLabel(),
        Icon: LayoutDashboard,
        iconWrapClass: 'bg-cyan-500/10',
        iconClass: 'text-cyan-400',
      },
      {
        id: '__settings',
        label: 'Settings',
        shortcut: settingsShortcutLabel(),
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
          id: '__use-template',
          label: 'Create from Template…',
          Icon: FileText,
          iconWrapClass: 'bg-zinc-800',
          iconClass: 'text-zinc-400',
        },
        {
          id: '__new-template',
          label: 'New Template…',
          Icon: Plus,
          iconWrapClass: 'bg-zinc-800',
          iconClass: 'text-zinc-400',
        },
        {
          id: '__switch-board',
          label: 'Switch Board…',
          Icon: ChevronRight,
          iconWrapClass: 'bg-zinc-800',
          iconClass: 'text-zinc-400',
        }
      );
    }

    const allColumns = isYougile ? yougileColumns : columns;
    const hasHiddenColumns = hiddenColumnIds.size > 0;
    const visibleColumnCount = allColumns.length - hiddenColumnIds.size;

    items.push({
      id: '__filter-columns',
      label: hasHiddenColumns
        ? `Columns (${visibleColumnCount}/${allColumns.length})`
        : 'Filter Columns…',
      Icon: ArrowUpDown,
      iconWrapClass: hasHiddenColumns ? 'bg-cyan-500/10' : 'bg-zinc-800',
      iconClass: hasHiddenColumns ? 'text-cyan-400' : 'text-zinc-400',
    });

    return items;
  }, [isYougile, yougileEnabled, hiddenColumnIds, yougileColumns, columns]);

  const normalModeItems = useMemo(() => {
    if (hasCreateDraft) {
      return [
        { id: '__create', label: `Create "${createDraftTitle}"` },
        ...(isYougile ? [{ id: '__save-template', label: `Save "${createDraftTitle}" as template` }] : []),
      ];
    }
    return [...activeTasks.map((task) => ({ id: task.id, label: task.title })), ...actionItems];
  }, [actionItems, activeTasks, createDraftTitle, hasCreateDraft, isYougile]);

  // Picker items for vim navigation inside org/project/board pickers
  const pickerItems = useMemo((): Array<{ id: string }> => {
    if (pickerMode === 'org') return accounts;
    if (pickerMode === 'project') return projects;
    if (pickerMode === 'board') return boards;
    if (pickerMode === 'template') {
      return [
        ...templates.map((template) => ({ id: template.id })),
        { id: '__manage-templates' },
      ];
    }
    if (pickerMode === 'columns') {
      const allColumns = isYougile ? yougileColumns : columns;
      return allColumns.map((col) => ({ id: col.id }));
    }
    return [];
  }, [pickerMode, accounts, projects, boards, templates, isYougile, yougileColumns, columns]);

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

  useEffect(() => {
    if (!yougileEnabled) {
      setSelectedTemplateId(null);
      return;
    }
    void fetchTemplates();
  }, [fetchTemplates, yougileEnabled]);

  useEffect(() => {
    if (selectedTemplateId && !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(null);
    }
  }, [selectedTemplateId, templates]);

  const syncYougileState = useCallback(async () => {
    if (!yougileEnabled) return;
    await hydrateSyncState();
    await fetchAccounts();
  }, [fetchAccounts, hydrateSyncState, yougileEnabled]);

  // Enter insert mode + focus input when window gains focus
  useEffect(() => {
    if (!isTauriAvailable()) return;
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
    if (!isTauriAvailable()) return;
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
            void fetchTemplates();
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
        hideTimer = setTimeout(() => {
          if (!document.hasFocus()) {
            void invoke('hide_window');
          }
        }, 180);
      }
    });
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      unlisten.then((fn) => fn());
    };
  }, [fetchTasks, fetchTemplates, syncYougileState, yougileEnabled]);

  // Dynamic window sizing based on actual content, clamped to screen
  useEffect(() => {
    if (!isTauriAvailable()) return;

    let contentHeight: number;

    if (editingTask) {
      // For Yougile tasks, use as much screen space as possible so the editor
      // has room to scroll.  Local tasks use the compact EDITOR_HEIGHT.
      if (editingYougileTask) {
        const maxScreenHeight = Math.floor(window.screen.availHeight * 0.8);
        contentHeight = maxScreenHeight - FOOTER_HEIGHT - WINDOW_CHROME;
      } else {
        contentHeight = EDITOR_HEIGHT;
      }
    } else if (hasCreateDraft) {
      // "Create task" item
      contentHeight = GROUP_HEADER_HEIGHT + ACTION_ITEM_HEIGHT;
    } else {
      const taskCount = Math.min(activeTasks.length, MAX_VISIBLE_TASKS);
      const tasksHeight = taskCount > 0 ? GROUP_HEADER_HEIGHT + taskCount * ITEM_HEIGHT : 0;
      const actionsHeight = GROUP_HEADER_HEIGHT + actionItems.length * ACTION_ITEM_HEIGHT;
      contentHeight = tasksHeight + actionsHeight;
    }

    const templateHeight = activeTemplate ? 24 : 0;
    const statusHeight = (statusMessage || visibleError) ? 24 : 0;
    const inputHeight = editingTask ? 0 : INPUT_AREA_HEIGHT;
    const totalHeight = inputHeight + templateHeight + statusHeight + contentHeight + FOOTER_HEIGHT + WINDOW_CHROME;
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
    activeTemplate,
    activeTasks.length,
    editingTask,
    editingYougileTask,
    hasCreateDraft,
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
    setSelectedTemplateId(null);
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
    setSelectedTemplateId(null);
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
    setSelectedTemplateId(null);
    await fetchYougileColumns(board.id);
    await fetchYougileTasks();
    setPickerMode('none');
  }, [boards, fetchYougileColumns, fetchYougileTasks, setActiveSource, setYougileContext]);

  const handleSelectTemplate = useCallback((templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;

    setSelectedTemplateId(templateId);
    setQuery(template.title);
    setPickerMode('none');
    setMode('insert');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [templates]);

  const buildTemplateDraftFromCapture = useCallback((): TemplateNavigationDraft | null => {
    const title = createDraftTitle.trim();
    if (!title) return null;

    return {
      title,
      description: activeTemplate?.description ?? null,
      color: activeTemplate?.color ?? null,
      checklists: activeTemplate?.checklists ? structuredClone(activeTemplate.checklists) : [],
      stickers: activeTemplate?.stickers ? { ...activeTemplate.stickers } : {},
      columnId: activeTemplate?.columnId ?? null,
    };
  }, [activeTemplate, createDraftTitle]);

  const openTemplatesSettings = useCallback(async (draft?: TemplateNavigationDraft) => {
    if (draft) {
      persistTemplateIntent({
        mode: 'new',
        draft,
      });
    }
    await invoke('hide_window');
    await invoke('open_dashboard_window');
  }, []);

  const handleCreateTask = useCallback(async () => {
    if (!createDraftTitle) return;
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
          const templateColumnId = activeTemplate?.columnId && yougileColumns.some(
            (column) => column.id === activeTemplate.columnId
          )
            ? activeTemplate.columnId
            : null;
          const task = await yougileStore.createTask({
            title: createDraftTitle,
            rawInput: query.trim() || undefined,
            columnId: templateColumnId ?? firstColumn.id,
            description: activeTemplate?.description ?? undefined,
            color: activeTemplate?.color ?? undefined,
            stickers: activeTemplate && Object.keys(activeTemplate.stickers).length > 0
              ? activeTemplate.stickers
              : undefined,
            checklists: activeTemplate && activeTemplate.checklists.length > 0
              ? activeTemplate.checklists
              : undefined,
          });
          if (task) {
            setQuery('');
            setSelectedTemplateId(null);
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
          setSelectedTemplateId(null);
          setMode('insert');
          setStatusMessage(`Created: ${task.title}`);
          setTimeout(() => setStatusMessage(''), 2000);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [
    activeTemplate,
    createDraftTitle,
    createTask,
    fetchYougileColumns,
    isYougile,
    query,
    yougileColumns,
    yougileContext.boardId,
    yougileStore,
  ]);

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
      case '__new-template':
        await openTemplatesSettings();
        return;
      case '__save-template': {
        const draft = buildTemplateDraftFromCapture();
        if (!draft) {
          setStatusMessage('Type a task title first');
          setTimeout(() => setStatusMessage(''), 2000);
          return;
        }
        await openTemplatesSettings(draft);
        return;
      }
      case '__toggle-source':
        if (isYougile) {
          selectYougileTask(null);
          setEditingTaskId(null);
          setSelectedTemplateId(null);
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
      case '__use-template':
        if (templates.length === 0) {
          await fetchTemplates();
        }
        setPickerMode('template');
        return;
      case '__manage-templates':
        await openTemplatesSettings();
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
      case '__filter-columns':
        setPickerMode('columns');
        return;
      default:
        return;
    }
  }, [
    buildTemplateDraftFromCapture,
    fetchAccounts,
    fetchTemplates,
    fetchProjects,
    isYougile,
    openTemplatesSettings,
    projects.length,
    selectYougileTask,
    setActiveSource,
    templates.length,
    yougileContext.accountId,
  ]);

  const clearPendingConfirm = useCallback(() => {
    setPendingConfirm(null);
    if (pendingConfirmTimerRef.current) {
      clearTimeout(pendingConfirmTimerRef.current);
      pendingConfirmTimerRef.current = null;
    }
  }, []);

  const triggerPendingConfirm = useCallback((action: 'toggle' | 'delete', taskId: string, taskTitle: string) => {
    if (pendingConfirmTimerRef.current) clearTimeout(pendingConfirmTimerRef.current);
    setPendingConfirm({ action, taskId, taskTitle });
    pendingConfirmTimerRef.current = setTimeout(() => {
      setPendingConfirm(null);
      pendingConfirmTimerRef.current = null;
    }, 3000);
  }, []);

  useRegisteredNormalKeyActions('app:capture', {
    onEscape: () => {
      const engineMode = focusEngine.getState().mode;
      if (engineMode === 'INSERT') {
        return;
      }
      if (editingTask) {
        setEditingTaskId(null);
      } else {
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
        if (task) {
          // Require double-press to confirm
          if (pendingConfirm?.action === 'toggle' && pendingConfirm.taskId === task.id) {
            clearPendingConfirm();
            void handleToggleStatus(task);
          } else {
            triggerPendingConfirm('toggle', task.id, task.title ?? (isYougileTask(task) ? '' : task.title));
          }
        }
      }
    },
    onDelete: () => {
      const item = normalModeItems[selectedIndex];
      if (item && !item.id.startsWith('__')) {
        // Require double-press to confirm
        if (pendingConfirm?.action === 'delete' && pendingConfirm.taskId === item.id) {
          clearPendingConfirm();
          void handleDeleteTask(item.id);
        } else {
          const task = activeTasks.find((t) => t.id === item.id);
          triggerPendingConfirm('delete', item.id, task ? (task.title ?? (isYougileTask(task) ? '' : task.title)) : '');
        }
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
  });

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
            if (pickerMode === 'columns') setPickerMode('none');
            else if (pickerMode === 'board') setPickerMode('project');
            else if (pickerMode === 'project') setPickerMode('org');
            else setPickerMode('none');
            return;
          }
          if (hasQuery) {
            // Clear query first, stay in insert mode
            setQuery('');
          } else if (activeTemplate) {
            setSelectedTemplateId(null);
          } else {
            // Empty input — switch to NORMAL mode
            // The focus engine dispatch handles the mode change
            const result = dispatchFocusKey(focusEngine, e, resolveNormalKeyActions());
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

      // NORMAL mode — picker takes priority over main navigation
      if (pickerMode !== 'none') {
        // Handle picker navigation locally
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
            else if (pickerMode === 'template') {
              if (pick.id === '__manage-templates') void handleAction('__manage-templates');
              else handleSelectTemplate(pick.id);
            } else if (pickerMode === 'columns') {
              setHiddenColumnIds((prev) => {
                const next = new Set(prev);
                if (next.has(pick.id)) next.delete(pick.id);
                else next.add(pick.id);
                return next;
              });
            }
            return;
          }
          case 'x':
            if (pickerMode === 'columns') {
              e.preventDefault();
              const pick = pickerItems[selectedIndex];
              if (!pick) return;
              setHiddenColumnIds((prev) => {
                const next = new Set(prev);
                if (next.has(pick.id)) next.delete(pick.id);
                else next.add(pick.id);
                return next;
              });
              return;
            }
            break;
          case 'Escape':
            e.preventDefault();
            if (pickerMode === 'columns') setPickerMode('none');
            else if (pickerMode === 'board') setPickerMode('project');
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

      // NORMAL mode (no picker) — handle navigation locally, delegate actions to focus engine
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          clearPendingConfirm();
          setSelectedIndex((i) => Math.min(i + 1, normalModeItems.length - 1));
          return;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          clearPendingConfirm();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        case 'g':
          e.preventDefault();
          clearPendingConfirm();
          setSelectedIndex(0);
          return;
        case 'G':
          e.preventDefault();
          clearPendingConfirm();
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
        case 'c':
          e.preventDefault();
          setPickerMode('columns');
          setSelectedIndex(0);
          return;
      }

      // Delegate remaining action keys (x/d/n/o/m/r/?/space/1/2/3) to focus engine
      const result = dispatchFocusKey(focusEngine, e, resolveNormalKeyActions());
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
    handleSelectTemplate,
    activeTemplate,
    hasQuery,
    hiddenColumnIds,
    mode,
    normalModeItems,
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
      const el = listViewportRef.current?.querySelector<HTMLElement>(
        `[data-capture-index="${selectedIndex}"]`
      );
      el?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }, [selectedIndex, mode]);

  const syncSelectionToViewport = useCallback(() => {
    if (mode !== 'normal') return;
    const viewport = listViewportRef.current;
    if (!viewport) return;

    const items = Array.from(
      viewport.querySelectorAll<HTMLElement>('[data-capture-index]')
    );
    if (items.length === 0) return;

    const viewportRect = viewport.getBoundingClientRect();
    const next = items.find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > viewportRect.top + 2 && rect.top < viewportRect.bottom - 2;
    });
    if (!next) return;

    const rawIndex = next.dataset.captureIndex;
    if (!rawIndex) return;
    const nextIndex = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(nextIndex)) return;
    if (nextIndex !== selectedIndex) {
      setSelectedIndex(nextIndex);
    }
  }, [mode, selectedIndex]);

  // ── Editing mode ────────────────────────────────────────────────────────────

  if (editingTask) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-transparent">
        <div className="flex h-full max-h-full w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/95 shadow-[0_0_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
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
        className="flex h-full max-h-full w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/95 shadow-[0_0_60px_rgba(0,0,0,0.6)] backdrop-blur-xl"
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
                  if (e.key === 'Enter' && hasCreateDraft) { e.preventDefault(); void handleCreateTask(); }
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
              {captureShortcutLabel()}
            </kbd>
          </div>

          {activeTemplate && (
            <div className="mt-2 flex items-center gap-2 pl-10 text-[10px] font-mono">
              <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-400">
                TEMPLATE
              </span>
              <span className="truncate text-zinc-500">{activeTemplate.title}</span>
              <button
                type="button"
                onClick={() => setSelectedTemplateId(null)}
                className="text-zinc-600 transition-colors hover:text-zinc-300"
              >
                clear
              </button>
            </div>
          )}

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
          ref={listViewportRef}
          className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onWheelCapture={() => {
            requestAnimationFrame(syncSelectionToViewport);
          }}
        >
          <Command.List className="py-1">
            {/* Picker Mode — replaces task list when active */}
            {pickerMode !== 'none' && (
              <Command.Group
                heading={
                  pickerMode === 'org'
                    ? 'Select Organization'
                    : pickerMode === 'project'
                      ? 'Select Project'
                      : pickerMode === 'board'
                        ? 'Select Board'
                        : 'Select Template'
                }
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {pickerMode === 'org' && accounts.map((account, idx) => (
                  <Command.Item
                    key={account.id}
                    value={`org-${account.id}`}
                    data-capture-index={idx}
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
                    data-capture-index={idx}
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
                    data-capture-index={idx}
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
                {pickerMode === 'template' && templates.map((template, idx) => {
                  const templateColor = getYougileTaskColorValue(template.color);
                  const checklistCount = template.checklists.reduce(
                    (count, checklist) => count + checklist.items.length,
                    0,
                  );
                  const stickerCount = Object.keys(template.stickers).length;
                  const subtitle = [
                    checklistCount > 0 ? `${checklistCount} checklist item${checklistCount === 1 ? '' : 's'}` : null,
                    stickerCount > 0 ? `${stickerCount} sticker${stickerCount === 1 ? '' : 's'}` : null,
                    template.description ? 'description' : null,
                  ].filter(Boolean).join(' · ');

                  return (
                    <Command.Item
                      key={template.id}
                      value={`template-${template.id}`}
                      data-capture-index={idx}
                      onSelect={() => handleSelectTemplate(template.id)}
                      className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-zinc-300 outline-none transition-colors ${
                        mode === 'normal' && selectedIndex === idx
                          ? 'bg-zinc-900/80'
                          : 'data-[selected=true]:bg-zinc-900/80'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {templateColor && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full border border-zinc-700/80"
                              style={{ backgroundColor: templateColor }}
                            />
                          )}
                          <span className="truncate text-zinc-200">{template.title}</span>
                        </div>
                        {subtitle && (
                          <div className="truncate pt-0.5 text-[11px] text-zinc-500">
                            {subtitle}
                          </div>
                        )}
                      </div>
                      {selectedTemplateId === template.id && <Check className="h-3 w-3 text-cyan-400" />}
                    </Command.Item>
                  );
                })}
                {pickerMode === 'template' && (
                  <Command.Item
                    value="manage-templates"
                    data-capture-index={templates.length}
                    onSelect={() => void handleAction('__manage-templates')}
                    className={`flex h-10 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                      mode === 'normal' && selectedIndex === templates.length
                        ? 'bg-zinc-900/80'
                        : 'data-[selected=true]:bg-zinc-900/80'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Settings className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-zinc-200">Manage Templates…</span>
                    </div>
                    <kbd className="font-mono text-[10px] text-zinc-600">⌘,</kbd>
                  </Command.Item>
                )}
                {pickerMode === 'template' && templates.length === 0 && !visibleError && (
                  <div className="px-3 py-3 text-xs text-zinc-500">
                    No task templates found yet. Create one in Settings.
                  </div>
                )}
              </Command.Group>
            )}

            {pickerMode === 'columns' && (
              <Command.Group
                heading="Toggle Columns"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {(isYougile ? yougileColumns : columns).map((col, idx) => {
                  const colName = isYougile ? (col as YougileColumn).title : (col as KanbanColumn).name;
                  const isHidden = hiddenColumnIds.has(col.id);
                  return (
                    <Command.Item
                      key={col.id}
                      value={`column-${col.id}`}
                      data-capture-index={idx}
                      onSelect={() => {
                        setHiddenColumnIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(col.id)) next.delete(col.id);
                          else next.add(col.id);
                          return next;
                        });
                      }}
                      className={`flex h-9 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                        mode === 'normal' && selectedIndex === idx
                          ? 'bg-zinc-900/80'
                          : 'data-[selected=true]:bg-zinc-900/80'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border transition-colors ${
                          isHidden
                            ? 'border-zinc-700'
                            : 'border-cyan-500/40 bg-cyan-500/20'
                        }`}>
                          {!isHidden && <Check className="h-2.5 w-2.5 text-cyan-400" strokeWidth={3} />}
                        </div>
                        <span className={isHidden ? 'text-zinc-500 line-through' : 'text-zinc-200'}>
                          {colName}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-zinc-600">
                        {isHidden ? 'hidden' : 'visible'}
                      </span>
                    </Command.Item>
                  );
                })}
                <div className="px-3 py-2 text-[10px] text-zinc-600">
                  Press <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 font-mono">x</kbd> or <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 font-mono">↵</kbd> to toggle · <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 font-mono">esc</kbd> to close
                </div>
              </Command.Group>
            )}

            {pickerMode === 'none' && !hasCreateDraft && activeTasks.length > 0 && (
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

            {pickerMode === 'none' && (!hasCreateDraft ? (
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
                    <span className="text-zinc-200 truncate">Create "<span className="text-cyan-400">{createDraftTitle}</span>"</span>
                  </div>
                  <kbd className="shrink-0 font-mono text-[10px] text-cyan-500/60">↵</kbd>
                </Command.Item>
                {isYougile && (
                  <Command.Item
                    value="save-template"
                    data-capture-index={1}
                    onSelect={() => void handleAction('__save-template')}
                    className={`group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                      mode === 'normal' && selectedIndex === 1
                        ? 'bg-zinc-900/80'
                        : 'data-[selected=true]:bg-zinc-900/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800">
                        <FileText className="h-3.5 w-3.5 text-zinc-400" />
                      </div>
                      <span className="text-zinc-200 truncate">Save As Template…</span>
                    </div>
                    <kbd className="shrink-0 font-mono text-[10px] text-zinc-600">↵</kbd>
                  </Command.Item>
                )}
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
                  <span>↵ {hasCreateDraft ? 'create' : 'edit'}</span>
                  <span className="text-zinc-800">·</span>
                  <span>⌘, settings</span>
                  <span className="text-zinc-800">·</span>
                  <span>esc {hasQuery || activeTemplate ? 'clear' : 'navigate'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ArrowUpDown className="h-2.5 w-2.5" />
                  <span>navigate</span>
                </div>
              </>
            ) : pendingConfirm ? (
              <>
                <div className="flex items-center gap-2 text-amber-400">
                  <span className="rounded bg-amber-500/20 px-1 font-mono text-amber-300">
                    {pendingConfirm.action === 'toggle' ? 'x' : 'd'}
                  </span>
                  <span>
                    Press <strong>{pendingConfirm.action === 'toggle' ? 'x' : 'd'}</strong> again to confirm {pendingConfirm.action === 'toggle' ? 'toggle' : 'delete'}:
                  </span>
                  <span className="truncate text-zinc-400" style={{ maxWidth: 200 }}>
                    {pendingConfirm.taskTitle}
                  </span>
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
                <div className="flex items-center gap-2">
                  <span>c columns</span>
                  <span className="text-zinc-800">·</span>
                  <span>d delete</span>
                </div>
              </>
            )}
          </div>
        </div>
      </Command>
    </div>
  );
}

export default App;
