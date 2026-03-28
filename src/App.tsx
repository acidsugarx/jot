import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
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
  ChevronRight,
} from 'lucide-react';
import { Command } from 'cmdk';
import { useTaskStore } from '@/store/use-task-store';
import { useYougileStore } from '@/store/use-yougile-store';
import type { Task, TaskPriority, TaskStatus } from '@/types';

type CaptureMode = 'insert' | 'normal';
type PickerMode = 'none' | 'org' | 'project' | 'board';

/** Tokenize input string into colored segments for syntax highlighting */
interface Token {
  text: string;
  color: string | null; // null = default text color
}

function tokenize(input: string): Token[] {
  if (!input) return [];

  const tokens: Token[] = [];
  // Match #tags, !priority, @zettel
  const regex = /(#\w+|!(?:low|medium|high|urgent)\b|@zettel\b)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      tokens.push({ text: input.slice(lastIndex, match.index), color: null });
    }

    const token = match[0];
    let color: string;

    if (token.startsWith('#')) {
      color = 'rgb(34 211 238)'; // cyan-400
    } else if (token.startsWith('@')) {
      color = 'rgb(167 139 250)'; // violet-400
    } else if (token.startsWith('!')) {
      const level = token.slice(1).toLowerCase();
      if (level === 'urgent') color = 'rgb(248 113 113)'; // red-400
      else if (level === 'high') color = 'rgb(251 146 60)'; // orange-400
      else if (level === 'medium') color = 'rgb(250 204 21)'; // yellow-400
      else color = 'rgb(96 165 250)'; // blue-400
    } else {
      color = 'rgb(34 211 238)';
    }

    tokens.push({ text: token, color });
    lastIndex = regex.lastIndex;
  }

  // Remaining text
  if (lastIndex < input.length) {
    tokens.push({ text: input.slice(lastIndex), color: null });
  }

  return tokens;
}

const ITEM_HEIGHT = 36;
const GROUP_HEADER_HEIGHT = 28;
const INPUT_AREA_HEIGHT = 72;
const FOOTER_HEIGHT = 36;
const WINDOW_CHROME = 16;
const ACTION_ITEM_HEIGHT = 44;
const MAX_VISIBLE_TASKS = 8;
const EDITOR_HEIGHT = 340;

const priorityOptions: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'none', label: 'None', color: 'text-zinc-600' },
  { value: 'low', label: 'Low', color: 'text-blue-400' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-400' },
  { value: 'high', label: 'High', color: 'text-orange-400' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-400' },
];

const priorityColor: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

function toDateInputValue(isoString: string): string {
  try {
    const d = new Date(isoString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
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
    error,
    fetchTasks,
    createTask,
    updateTaskStatus,
    deleteTask,
    openLinkedNote,
    clearError,
    listenForUpdates,
  } = useTaskStore();

  const yougileStore = useYougileStore();
  const {
    yougileEnabled,
    activeSource,
    setActiveSource,
    yougileContext,
    accounts,
    projects,
    boards,
    columns: yougileColumns,
    fetchAccounts,
    fetchProjects,
    fetchBoards,
    fetchColumns: fetchYougileColumns,
    setYougileContext,
  } = yougileStore;

  const isYougile = yougileEnabled && activeSource === 'yougile';

  const hasQuery = query.trim().length > 0;
  const tokens = useMemo(() => tokenize(query), [query]);
  const hasHighlights = tokens.some((t) => t.color !== null);
  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;

  // Items visible in normal mode (tasks + actions)
  const actionItems = useMemo(() => [
    { id: '__dashboard', label: 'Dashboard' },
    { id: '__settings', label: 'Settings' },
  ], []);

  const normalModeItems = useMemo(() => {
    if (hasQuery) return [{ id: '__create', label: `Create "${query}"` }];
    return [...tasks.map((t) => ({ id: t.id, label: t.title })), ...actionItems];
  }, [tasks, hasQuery, query, actionItems]);

  // Clamp selectedIndex when items change
  useEffect(() => {
    if (selectedIndex >= normalModeItems.length) {
      setSelectedIndex(Math.max(0, normalModeItems.length - 1));
    }
  }, [normalModeItems.length, selectedIndex]);

  // Enter insert mode + focus input when window gains focus
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    return listenForUpdates();
  }, [listenForUpdates]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (focused) {
        suppressNextBlurHideRef.current = false;
        void fetchTasks();
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
  }, [fetchTasks]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingTask || mode !== 'insert') return;
      if (e.key !== 'Escape') return;
      if (query.trim().length > 0) return;
      if (document.activeElement !== inputRef.current) return;

      suppressNextBlurHideRef.current = true;
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editingTask, mode, query]);

  // Dynamic window sizing based on actual content
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;

    let contentHeight: number;

    if (editingTask) {
      contentHeight = EDITOR_HEIGHT;
    } else if (hasQuery) {
      // "Create task" item
      contentHeight = GROUP_HEADER_HEIGHT + ACTION_ITEM_HEIGHT;
    } else {
      const taskCount = Math.min(tasks.length, MAX_VISIBLE_TASKS);
      const tasksHeight = taskCount > 0 ? GROUP_HEADER_HEIGHT + taskCount * ITEM_HEIGHT : 0;
      const actionsHeight = GROUP_HEADER_HEIGHT + 2 * ACTION_ITEM_HEIGHT;
      contentHeight = tasksHeight + actionsHeight;
    }

    const statusHeight = (statusMessage || error) ? 24 : 0;
    const inputHeight = editingTask ? 0 : INPUT_AREA_HEIGHT;
    const totalHeight = inputHeight + statusHeight + contentHeight + FOOTER_HEIGHT + WINDOW_CHROME;
    const clampedHeight = Math.max(totalHeight, 200);

    void getCurrentWindow().setSize(new LogicalSize(680, clampedHeight));
  }, [hasQuery, tasks.length, statusMessage, error, editingTask]);

  // Close editor if task disappears (e.g. deleted from another window)
  useEffect(() => {
    if (editingTaskId && !tasks.find((t) => t.id === editingTaskId)) {
      setEditingTaskId(null);
    }
  }, [tasks, editingTaskId]);

  const handleCreateTask = useCallback(async () => {
    if (!query.trim()) return;
    try {
      if (isYougile && yougileContext.boardId) {
        const firstColumn = yougileColumns[0];
        if (firstColumn) {
          const task = await yougileStore.createTask({ title: query.trim(), columnId: firstColumn.id });
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
        setQuery('');
        setMode('insert');
        setStatusMessage(`Created: ${task.title}`);
        setTimeout(() => setStatusMessage(''), 2000);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } catch (err) {
      console.error(err);
    }
  }, [query, createTask, isYougile, yougileContext.boardId, yougileColumns, yougileStore]);

  const handleToggleStatus = useCallback(async (task: { id: string; status: TaskStatus }) => {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    try { await updateTaskStatus({ id: task.id, status: newStatus }); } catch (err) { console.error(err); }
  }, [updateTaskStatus]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    try { await deleteTask(taskId); } catch (err) { console.error(err); }
  }, [deleteTask]);

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

  // ── Normal mode keyboard handler ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'normal' || editingTask) return;

    const handler = (e: KeyboardEvent) => {
      // In normal mode the input stays focused (to keep the NSPanel alive),
      // so we don't bail on INPUT — the input's onKeyDown already prevents
      // characters from being typed. Only bail on TEXTAREA/SELECT (editor fields).
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;

      const item = normalModeItems[selectedIndex];

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          void invoke('hide_window');
          return;

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

        case '/':
          e.preventDefault();
          setMode('insert');
          setQuery('');
          requestAnimationFrame(() => inputRef.current?.focus());
          return;

        case 'Enter':
        case 'e':
          e.preventDefault();
          if (!item) return;
          if (item.id === '__dashboard') {
            void invoke('hide_window');
            void invoke('open_dashboard_window');
          } else if (item.id === '__settings') {
            void invoke('hide_window');
            void invoke('open_settings_window');
          } else if (item.id === '__create') {
            void handleCreateTask();
          } else {
            setEditingTaskId(item.id);
          }
          return;

        case 'x':
          if (item && !item.id.startsWith('__')) {
            const task = tasks.find((t) => t.id === item.id);
            if (task) void handleToggleStatus(task);
          }
          return;

        case 'd':
          if (item && !item.id.startsWith('__')) {
            void handleDeleteTask(item.id);
          }
          return;

        case 'o':
          if (item && !item.id.startsWith('__')) {
            const task = tasks.find((t) => t.id === item.id);
            if (task?.linkedNotePath) void handleOpenNote(task.linkedNotePath);
          }
          return;

        case 'Tab':
          e.preventDefault();
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, editingTask, normalModeItems, selectedIndex, tasks, handleCreateTask, handleDeleteTask, handleToggleStatus, handleOpenNote]);

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
          <InlineTaskEditor task={editingTask} onClose={handleCloseEditor} />

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
                    // In picker mode, go back one level
                    if (pickerMode !== 'none') {
                      if (pickerMode === 'board') setPickerMode('project');
                      else if (pickerMode === 'project') setPickerMode('org');
                      else setPickerMode('none');
                      return;
                    }
                    if (mode === 'normal') {
                      void invoke('hide_window');
                      return;
                    }
                    if (hasQuery) {
                      // Clear query first, stay in insert mode
                      setQuery('');
                    } else {
                      // Empty input — enter normal mode
                      suppressNextBlurHideRef.current = true;
                      preserveModeOnNextFocusRef.current = true;
                      setMode('normal');
                      setSelectedIndex(0);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }
                    return;
                  }
                  // In normal mode, intercept keys before they reach the input
                  if (mode === 'normal') {
                    if (e.key === 'i' || e.key === '/') {
                      // These switch back to insert mode — handled by normal mode effect
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
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] cursor-pointer transition-colors ${
                  isYougile
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:bg-zinc-800'
                }`}
                onClick={() => setPickerMode('org')}
                title={isYougile ? (yougileContext.boardName ?? 'Yougile') : 'LOCAL'}
              >
                {isYougile ? (yougileContext.boardName ?? 'YOUGILE') : 'LOCAL'}
              </span>
            )}
            <kbd className="shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              Opt+Space
            </kbd>
          </div>

          {(statusMessage || error) && (
            <div className="mt-1.5 flex items-center gap-2 pl-10 text-[11px]">
              <span className={error ? 'text-red-400' : 'text-zinc-500'}>
                {error || statusMessage}
              </span>
              {error && (
                <button type="button" onClick={() => clearError()} className="text-zinc-500 hover:text-zinc-300">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Scrollable List */}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ maxHeight: MAX_VISIBLE_TASKS * ITEM_HEIGHT + GROUP_HEADER_HEIGHT * 2 + 2 * ACTION_ITEM_HEIGHT + 8 }}
        >
          <Command.List className="py-1">
            {/* Picker Mode — replaces task list when active */}
            {pickerMode !== 'none' && (
              <Command.Group
                heading={pickerMode === 'org' ? 'Select Account' : pickerMode === 'project' ? 'Select Project' : 'Select Board'}
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {pickerMode === 'org' && accounts.map((account) => (
                  <Command.Item
                    key={account.id}
                    value={`org-${account.id}`}
                    onSelect={() => {
                      setYougileContext({ accountId: account.id });
                      void fetchProjects();
                      setPickerMode('project');
                    }}
                    className="flex h-9 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
                  >
                    <div className="flex items-center gap-2.5">
                      <Globe className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-zinc-200">{account.companyName}</span>
                    </div>
                    {yougileContext.accountId === account.id && <Check className="h-3 w-3 text-cyan-400" />}
                  </Command.Item>
                ))}
                {pickerMode === 'project' && projects.map((project) => (
                  <Command.Item
                    key={project.id}
                    value={`project-${project.id}`}
                    onSelect={() => {
                      setYougileContext({ projectId: project.id, projectName: project.title });
                      void fetchBoards(project.id);
                      setPickerMode('board');
                    }}
                    className="flex h-9 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
                  >
                    <div className="flex items-center gap-2.5">
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-zinc-200">{project.title}</span>
                    </div>
                    {yougileContext.projectId === project.id && <Check className="h-3 w-3 text-cyan-400" />}
                  </Command.Item>
                ))}
                {pickerMode === 'board' && boards.map((board) => (
                  <Command.Item
                    key={board.id}
                    value={`board-${board.id}`}
                    onSelect={() => {
                      setYougileContext({ boardId: board.id, boardName: board.name });
                      void fetchYougileColumns(board.id);
                      setActiveSource('yougile');
                      setPickerMode('none');
                    }}
                    className="flex h-9 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
                  >
                    <div className="flex items-center gap-2.5">
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-zinc-200">{board.name}</span>
                    </div>
                    {yougileContext.boardId === board.id && <Check className="h-3 w-3 text-cyan-400" />}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {pickerMode === 'none' && !hasQuery && tasks.length > 0 && (
              <Command.Group
                heading="Tasks"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {tasks.map((task, taskIdx) => {
                  const pri = getPriorityLabel(task.priority);
                  const isNormalSelected = mode === 'normal' && selectedIndex === taskIdx;
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
                          task.status === 'done'
                            ? 'border-cyan-500/40 bg-cyan-500/20'
                            : 'border-zinc-700 hover:border-zinc-500'
                        }`}
                        onClick={(e) => { e.stopPropagation(); void handleToggleStatus(task); }}
                      >
                        {task.status === 'done' && <Check className="h-2.5 w-2.5 text-cyan-400" strokeWidth={3} />}
                      </button>

                      {/* Title */}
                      <span className={`min-w-0 flex-1 truncate ${
                        task.status === 'done' ? 'text-zinc-600 line-through' : 'text-zinc-200'
                      }`}>
                        {task.title}
                      </span>

                      {/* Inline metadata — right side */}
                      <div className="flex shrink-0 items-center gap-1.5">
                        {task.linkedNotePath && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleOpenNote(task.linkedNotePath!); }}
                            className="text-cyan-500/60 hover:text-cyan-400 transition-colors"
                          >
                            <FileText className="h-3 w-3" />
                          </button>
                        )}
                        {task.tags.map((tag) => (
                          <span key={tag} className="font-mono text-[10px] text-zinc-600">#{tag}</span>
                        ))}
                        {pri && (
                          <span className={`font-mono text-[10px] font-bold ${pri.color}`}>{pri.text}</span>
                        )}
                        {task.dueDate && (
                          <span className="font-mono text-[10px] text-zinc-600">
                            {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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
                <Command.Item
                  value="open-dashboard"
                  data-capture-index={tasks.length}
                  onSelect={() => { void invoke('hide_window'); void invoke('open_dashboard_window'); }}
                  className={`group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                    mode === 'normal' && selectedIndex === tasks.length
                      ? 'bg-zinc-900/80'
                      : 'data-[selected=true]:bg-zinc-900/80'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-500/10">
                      <LayoutDashboard className="h-3.5 w-3.5 text-cyan-400" />
                    </div>
                    <span className="text-zinc-200">Dashboard</span>
                  </div>
                  <kbd className="font-mono text-[10px] text-zinc-600">⌘⇧Space</kbd>
                </Command.Item>

                <Command.Item
                  value="open-settings"
                  data-capture-index={tasks.length + 1}
                  onSelect={() => { void invoke('hide_window'); void invoke('open_settings_window'); }}
                  className={`group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors ${
                    mode === 'normal' && selectedIndex === tasks.length + 1
                      ? 'bg-zinc-900/80'
                      : 'data-[selected=true]:bg-zinc-900/80'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800">
                      <Settings className="h-3.5 w-3.5 text-zinc-400" />
                    </div>
                    <span className="text-zinc-200">Settings</span>
                  </div>
                  <kbd className="font-mono text-[10px] text-zinc-600">⌘,</kbd>
                </Command.Item>

                {yougileEnabled && (
                  <>
                    <Command.Item
                      value="toggle-source"
                      onSelect={() => {
                        if (isYougile) {
                          setActiveSource('local');
                        } else {
                          void fetchAccounts();
                          setPickerMode('org');
                        }
                      }}
                      className="flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800">
                          {isYougile ? <HardDrive className="h-3.5 w-3.5 text-zinc-400" /> : <Globe className="h-3.5 w-3.5 text-zinc-400" />}
                        </div>
                        <span className="text-zinc-200">{isYougile ? 'Switch to Local' : 'Switch to Yougile'}</span>
                      </div>
                    </Command.Item>

                    {isYougile && (
                      <>
                        <Command.Item
                          value="switch-org"
                          onSelect={() => {
                            void fetchAccounts();
                            setPickerMode('org');
                          }}
                          className="flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800">
                              <Globe className="h-3.5 w-3.5 text-zinc-400" />
                            </div>
                            <span className="text-zinc-200">Switch Org…</span>
                          </div>
                        </Command.Item>

                        <Command.Item
                          value="switch-board"
                          onSelect={() => {
                            if (yougileContext.accountId) {
                              void fetchProjects();
                            } else {
                              void fetchAccounts();
                              setPickerMode('org');
                              return;
                            }
                            setPickerMode('project');
                          }}
                          className="flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800">
                              <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                            </div>
                            <span className="text-zinc-200">Switch Board…</span>
                          </div>
                        </Command.Item>
                      </>
                    )}
                  </>
                )}
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
