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
} from 'lucide-react';
import { Command } from 'cmdk';
import { useTaskStore } from '@/store/use-task-store';
import type { Task, TaskPriority, TaskStatus } from '@/types';

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

  useEffect(() => {
    void fetchColumns();
    titleRef.current?.focus();
  }, [fetchColumns]);

  // Listen for Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept Escape when in an input — let blur happen first
      const tag = document.activeElement?.tagName;
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
  }, [onClose]);

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
  const isDialogOpenRef = useRef(false);

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

  const hasQuery = query.trim().length > 0;
  const tokens = useMemo(() => tokenize(query), [query]);
  const hasHighlights = tokens.some((t) => t.color !== null);
  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void fetchTasks();
  }, [fetchTasks]);

  // Re-fetch when other windows mutate tasks
  useEffect(() => {
    return listenForUpdates();
  }, [listenForUpdates]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (focused) {
        void fetchTasks();
      } else if (!isDialogOpenRef.current) {
        // Small delay to avoid hiding during NSPanel focus transitions
        hideTimer = setTimeout(() => void invoke('hide_window'), 50);
      }
    });
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      unlisten.then((fn) => fn());
    };
  }, [fetchTasks]);

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

  const handleCreateTask = async () => {
    if (!query.trim()) return;
    try {
      const task = await createTask({ rawInput: query.trim() });
      setQuery('');
      setStatusMessage(`Created: ${task.title}`);
      setTimeout(() => setStatusMessage(''), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleStatus = async (task: { id: string; status: TaskStatus }) => {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    try { await updateTaskStatus({ id: task.id, status: newStatus }); } catch (err) { console.error(err); }
  };

  const handleDeleteTask = async (taskId: string) => {
    try { await deleteTask(taskId); } catch (err) { console.error(err); }
  };

  const handleOpenNote = async (path: string) => {
    try { await openLinkedNote(path); } catch (err) { console.error(err); }
  };

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
                value={query}
                onValueChange={setQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') void invoke('hide_window');
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Command.List className="py-1">
            {!hasQuery && tasks.length > 0 && (
              <Command.Group
                heading="Tasks"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                {tasks.map((task) => {
                  const pri = getPriorityLabel(task.priority);
                  return (
                    <Command.Item
                      key={task.id}
                      value={task.id}
                      onSelect={() => setEditingTaskId(task.id)}
                      className="group flex h-9 cursor-pointer items-center gap-2.5 border-l-2 border-transparent px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:border-l-cyan-500 data-[selected=true]:bg-zinc-900/80"
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

            {!hasQuery ? (
              <Command.Group
                heading="Actions"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                <Command.Item
                  value="open-dashboard"
                  onSelect={() => { void invoke('hide_window'); void invoke('open_dashboard_window'); }}
                  className="group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
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
                  onSelect={() => { void invoke('hide_window'); void invoke('open_settings_window'); }}
                  className="group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800">
                      <Settings className="h-3.5 w-3.5 text-zinc-400" />
                    </div>
                    <span className="text-zinc-200">Settings</span>
                  </div>
                  <kbd className="font-mono text-[10px] text-zinc-600">⌘,</kbd>
                </Command.Item>
              </Command.Group>
            ) : (
              <Command.Group
                heading="Create"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600"
              >
                <Command.Item
                  value="create-task"
                  onSelect={() => void handleCreateTask()}
                  className="group flex h-11 cursor-pointer items-center justify-between px-3 text-sm text-zinc-300 outline-none transition-colors data-[selected=true]:bg-zinc-900/80"
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
            )}
          </Command.List>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-zinc-800/40 px-3 py-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-zinc-600">
            <div className="flex items-center gap-2">
              <span>↵ {hasQuery ? 'create' : 'edit'}</span>
              <span className="text-zinc-800">·</span>
              <span>⌘, settings</span>
              <span className="text-zinc-800">·</span>
              <span>esc dismiss</span>
            </div>
            <div className="flex items-center gap-1">
              <ArrowUpDown className="h-2.5 w-2.5" />
              <span>navigate</span>
            </div>
          </div>
        </div>
      </Command>
    </div>
  );
}

export default App;
