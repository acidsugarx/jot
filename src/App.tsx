import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
import { Badge } from '@/components/ui/badge';
import { useTaskStore } from '@/store/use-task-store';
import type { TaskPriority, TaskStatus } from '@/types';

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
  } = useTaskStore();

  const hasQuery = query.trim().length > 0;

  // Initialize data
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }

    void fetchTasks();
  }, [fetchTasks]);

  // Sync settings across windows
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }

    const unlisten = listen('settings-updated', () => {
      void fetchTasks(); // Sync backend tasks in case configs modified rendering
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchTasks]);

  // Hide on blur unless a dialog is explicitly open
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }

    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && !isDialogOpenRef.current) {
        void invoke('hide_window');
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Dynamic window sizing
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return;
    }

    const baseHeight = 180;
    const listHeight = hasQuery ? 120 : Math.min(tasks.length * 60 + 40, 200);
    const height = baseHeight + listHeight;

    void getCurrentWindow().setSize(new LogicalSize(900, Math.max(height, 300)));
  }, [hasQuery, tasks.length]);

  const handleCreateTask = async () => {
    if (!query.trim()) {
      return;
    }

    try {
      const task = await createTask({
        rawInput: query.trim(),
      });
      setQuery('');
      setStatusMessage(`Created: ${task.title}`);
      setTimeout(() => setStatusMessage(''), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleStatus = async (task: { id: string; status: TaskStatus }) => {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    try {
      await updateTaskStatus({ id: task.id, status: newStatus });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenNote = async (path: string) => {
    try {
      await openLinkedNote(path);
    } catch (err) {
      console.error(err);
    }
  };

  const getPriorityColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'high':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'low':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default:
        return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent">
      <Command 
        shouldFilter={false} 
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/90 shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      >
        {/* Fixed Input Area */}
        <div className="flex-shrink-0 border-b border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10 font-mono text-sm font-semibold text-cyan-400">
              J
            </div>

            {/* Command Input */}
            <div className="min-w-0 flex-1">
              <Command.Input
                value={query}
                onValueChange={setQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    void invoke('hide_window');
                  }
                  if (e.key === 'Enter' && hasQuery) {
                    e.preventDefault();
                    void handleCreateTask();
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                    e.preventDefault();
                    void invoke('hide_window');
                    void invoke('open_settings_window');
                  }
                }}
                placeholder="Capture task... #tag !priority tomorrow @zettel"
                className="h-10 w-full border-0 bg-transparent px-0 text-xl font-medium text-zinc-100 placeholder:text-zinc-600 outline-none"
              />

              {/* Status Message */}
              {(statusMessage || error) && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className={error ? 'text-red-400' : 'text-zinc-500'}>
                    {error || statusMessage}
                  </span>
                  {error && (
                    <button
                      type="button"
                      onClick={() => clearError()}
                      className="text-zinc-400 hover:text-zinc-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void invoke('hide_window');
                  void invoke('open_settings_window');
                }}
                className="rounded-md border border-zinc-700/50 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
              >
                Cmd+,
              </button>
              <div className="rounded-md border border-zinc-700/50 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-400">
                Opt+Space
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Results Area */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Command.List className="p-2">
            {!hasQuery && tasks.length > 0 && (
              <Command.Group 
                heading="TASKS" 
                className="mb-4 [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-items]]:space-y-1"
              >
                  {tasks.map((task) => (
                    <Command.Item
                      key={task.id}
                      value={task.id}
                      className="group relative flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-zinc-400 outline-none transition-colors hover:border-zinc-700 hover:bg-zinc-900 data-[selected=true]:border-cyan-500/30 data-[selected=true]:bg-zinc-900"
                    >
                      {/* Checkbox */}
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          task.status === 'done'
                            ? 'border-cyan-500/30 bg-cyan-500/20'
                            : 'border-zinc-600 bg-transparent'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleToggleStatus(task);
                        }}
                      >
                        {task.status === 'done' && (
                          <Check className="h-3 w-3 text-cyan-400" strokeWidth={3} />
                        )}
                      </div>

                      {/* Task Content */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-medium transition-colors ${
                            task.status === 'done'
                              ? 'text-zinc-600 line-through'
                              : 'text-zinc-200'
                          }`}
                        >
                          {task.title}
                        </p>

                        {/* Metadata */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {/* Tags */}
                          {task.tags.map((tag) => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className="border-zinc-700 bg-zinc-900 text-zinc-400 text-[10px] font-medium uppercase"
                            >
                              {tag}
                            </Badge>
                          ))}

                          {/* Priority */}
                          {task.priority !== 'none' && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-medium uppercase ${getPriorityColor(task.priority)}`}
                            >
                              {task.priority}
                            </Badge>
                          )}

                          {/* Due Date */}
                          {task.dueDate && (
                            <Badge
                              variant="outline"
                              className="border-zinc-700 bg-zinc-900 text-zinc-400 text-[10px] font-medium"
                            >
                              {new Date(task.dueDate).toLocaleDateString()}
                            </Badge>
                          )}

                          {/* Linked Note */}
                          {task.linkedNotePath && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleOpenNote(task.linkedNotePath!);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400 transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/15"
                            >
                              <FileText className="h-2.5 w-2.5" />
                              Note
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteTask(task.id);
                          }}
                          className="rounded p-1 text-zinc-500 transition-colors hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </Command.Item>
                  ))}
              </Command.Group>
            )}

            {/* Commands */}
            {!hasQuery ? (
              <Command.Group 
                heading="ACTIONS" 
                className="[&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-items]]:space-y-1"
              >
                    <Command.Item
                      value="open-dashboard"
                      onSelect={() => {
                        void invoke('hide_window');
                        void invoke('open_dashboard_window');
                      }}
                      className="group flex cursor-pointer items-center justify-between rounded-md border border-transparent px-3 py-2.5 text-zinc-400 outline-none transition-colors hover:border-zinc-700 hover:bg-zinc-900 data-[selected=true]:border-cyan-500/30 data-[selected=true]:bg-zinc-900"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10">
                          <LayoutDashboard className="h-4 w-4 text-cyan-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-zinc-200">Dashboard</p>
                          <p className="text-xs text-zinc-500">Open multi-view workspace</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-zinc-700 bg-zinc-900 text-zinc-500">
                        Cmd+Shift+Space
                      </Badge>
                    </Command.Item>

                    <Command.Item
                      value="open-settings"
                      onSelect={() => {
                        void invoke('hide_window');
                        void invoke('open_settings_window');
                      }}
                      className="group flex cursor-pointer items-center justify-between rounded-md border border-transparent px-3 py-2.5 text-zinc-400 outline-none transition-colors hover:border-zinc-700 hover:bg-zinc-900 data-[selected=true]:border-cyan-500/30 data-[selected=true]:bg-zinc-900"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700/50 bg-zinc-900">
                          <Settings className="h-4 w-4 text-zinc-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-zinc-200">Settings</p>
                          <p className="text-xs text-zinc-500">Configure vault path</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-zinc-700 bg-zinc-900 text-zinc-500">
                        Cmd+,
                      </Badge>
                    </Command.Item>
              </Command.Group>
            ) : (
              <Command.Group 
                heading="CREATE TASK" 
                className="[&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-items]]:space-y-1"
              >
                  <Command.Item
                    value="create-task"
                    onSelect={() => void handleCreateTask()}
                    className="group flex cursor-pointer items-center justify-between rounded-md border border-transparent px-3 py-2.5 text-zinc-400 outline-none transition-colors hover:border-zinc-700 hover:bg-zinc-900 data-[selected=true]:border-cyan-500/30 data-[selected=true]:bg-zinc-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10">
                        <Plus className="h-4 w-4 text-cyan-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-200">
                          Create "{query}"
                        </p>
                        <p className="text-xs text-zinc-500">
                          Parse #tags, !priority, dates, @zettel
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 border-cyan-500/20 bg-cyan-500/10 text-cyan-400">
                      Enter
                    </Badge>
                  </Command.Item>
              </Command.Group>
            )}
          </Command.List>
        </div>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 border-t border-zinc-800 px-4 py-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
            <div className="flex items-center gap-3">
              <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5">
                ENTER create
              </span>
              <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5">
                CMD+, settings
              </span>
              <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5">
                ESC dismiss
              </span>
            </div>
            <div className="flex items-center gap-1">
              <ArrowUpDown className="h-3 w-3" />
              <span>navigate</span>
            </div>
          </div>
        </div>
      </Command>
    </div>
  );
}

export default App;
