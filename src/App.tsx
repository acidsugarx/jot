import { useEffect, useState, useRef, useMemo } from 'react';
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
} from 'lucide-react';
import { Command } from 'cmdk';
import { useTaskStore } from '@/store/use-task-store';
import type { TaskPriority, TaskStatus } from '@/types';

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

function App() {
  const [query, setQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
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
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        void fetchTasks();
      } else if (!isDialogOpenRef.current) {
        void invoke('hide_window');
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [fetchTasks]);

  // Dynamic window sizing based on actual content
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;

    let contentHeight: number;

    if (hasQuery) {
      // "Create task" item
      contentHeight = GROUP_HEADER_HEIGHT + ACTION_ITEM_HEIGHT;
    } else {
      const taskCount = Math.min(tasks.length, MAX_VISIBLE_TASKS);
      const tasksHeight = taskCount > 0 ? GROUP_HEADER_HEIGHT + taskCount * ITEM_HEIGHT : 0;
      const actionsHeight = GROUP_HEADER_HEIGHT + 2 * ACTION_ITEM_HEIGHT;
      contentHeight = tasksHeight + actionsHeight;
    }

    const statusHeight = (statusMessage || error) ? 24 : 0;
    const totalHeight = INPUT_AREA_HEIGHT + statusHeight + contentHeight + FOOTER_HEIGHT + WINDOW_CHROME;
    const clampedHeight = Math.max(totalHeight, 200);

    void getCurrentWindow().setSize(new LogicalSize(680, clampedHeight));
  }, [hasQuery, tasks.length, statusMessage, error]);

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

  const getPriorityLabel = (priority: TaskPriority) => {
    switch (priority) {
      case 'urgent': return { text: '!!!', color: 'text-red-400' };
      case 'high': return { text: '!!', color: 'text-orange-400' };
      case 'medium': return { text: '!', color: 'text-yellow-400' };
      case 'low': return { text: '~', color: 'text-blue-400' };
      default: return null;
    }
  };

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
                  const priority = getPriorityLabel(task.priority);
                  return (
                    <Command.Item
                      key={task.id}
                      value={task.id}
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
                        {priority && (
                          <span className={`font-mono text-[10px] font-bold ${priority.color}`}>{priority.text}</span>
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
              <span>↵ create</span>
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
