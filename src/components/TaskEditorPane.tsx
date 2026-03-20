import { useTaskStore } from '@/store/use-task-store';
import { FileText, Link as LinkIcon, X } from 'lucide-react';
import { TaskStatus } from '@/types';

const priorityColor: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

export function TaskEditorPane() {
  const { tasks, selectedTaskId, setIsEditorOpen, updateTaskStatus, openLinkedNote } = useTaskStore();
  const task = tasks.find((t) => t.id === selectedTaskId);

  if (!task) return null;

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-zinc-800/40 bg-[#141414]">
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-zinc-800/40 px-4">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Details
        </span>
        <button
          onClick={() => setIsEditorOpen(false)}
          className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Title */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
          <p className="text-sm font-medium leading-relaxed text-zinc-200">
            {task.title}
          </p>
        </div>

        {/* Fields — flat rows */}
        <div className="border-b border-zinc-800/30">
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Status</span>
            <select
              value={task.status}
              onChange={(e) => void updateTaskStatus({ id: task.id, status: e.target.value as TaskStatus })}
              className="bg-transparent text-right text-sm text-zinc-300 focus:outline-none cursor-pointer"
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Priority</span>
            <span className={`text-sm ${priorityColor[task.priority] || 'text-zinc-600'}`}>
              {task.priority === 'none' ? '—' : task.priority}
            </span>
          </div>

          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Due</span>
            <span className="font-mono text-sm text-zinc-400">
              {task.dueDate
                ? new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                : '—'}
            </span>
          </div>
        </div>

        {/* Tags */}
        {task.tags.length > 0 && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Tags</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Linked Note */}
        {task.linkedNotePath && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Linked Note</span>
            </div>
            <button
              type="button"
              onClick={() => void openLinkedNote(task.linkedNotePath!)}
              className="group flex w-full items-center gap-2 rounded-md border border-zinc-800/40 bg-[#111111] px-3 py-2 text-left transition-colors hover:border-cyan-500/30"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-500/60 group-hover:text-cyan-400" />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] text-zinc-500 group-hover:text-zinc-300">
                  {task.linkedNotePath.split('/').pop()}
                </span>
              </div>
              <LinkIcon className="h-3 w-3 shrink-0 text-zinc-700 group-hover:text-cyan-500/60" />
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800/40 px-4 py-1.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-700">
          <span>{task.id.slice(0, 8)}</span>
          <span>{new Date(task.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      </div>
    </div>
  );
}
