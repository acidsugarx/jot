import { useTaskStore } from '@/store/use-task-store';
import { Calendar, FileText, Hash, Link as LinkIcon, Network, Save, X } from 'lucide-react';
import { TaskStatus } from '@/types';

export function TaskEditorPane() {
  const { tasks, selectedTaskId, setIsEditorOpen, updateTaskStatus, openLinkedNote } = useTaskStore();

  const task = tasks.find((t) => t.id === selectedTaskId);

  if (!task) {
    return null;
  }

  return (
    <div className="flex h-full w-[400px] shrink-0 flex-col border-l border-zinc-800 bg-[#161616] shadow-2xl transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 p-5">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-100 uppercase">
          Task Details
        </h2>
        <button
          onClick={() => setIsEditorOpen(false)}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        
        {/* Title Editor */}
        <div>
          <label className="text-xs font-medium text-zinc-500 mb-2 block uppercase">Title</label>
          <textarea
            className="w-full resize-none rounded-md bg-zinc-900 border border-zinc-800 p-3 text-sm text-zinc-100 focus:border-cyan-500/50 focus:outline-none transition-colors"
            rows={3}
            value={task.title}
            readOnly
            // Future: Implement title edit dispatch
          />
        </div>

        {/* Action Panel */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-zinc-800/60 bg-[#1e1e20] p-3">
            <div className="text-[10px] font-medium text-zinc-500 uppercase mb-1 flex items-center gap-1.5">
              <Hash className="h-3 w-3" /> Status
            </div>
            <select
                value={task.status}
                onChange={(e) => updateTaskStatus({ id: task.id, status: e.target.value as TaskStatus })}
                className="w-full bg-transparent text-sm font-medium text-zinc-200 focus:outline-none"
            >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
            </select>
          </div>

          <div className="rounded-md border border-zinc-800/60 bg-[#1e1e20] p-3">
            <div className="text-[10px] font-medium text-zinc-500 uppercase mb-1 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> Due Date
            </div>
            <div className="text-sm font-medium text-zinc-200">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'None'}
            </div>
          </div>
        </div>

        {/* Zettelkasten Link */}
        {task.linkedNotePath && (
            <div 
                onClick={() => openLinkedNote(task.linkedNotePath!)}
                className="rounded-lg border border-cyan-900/40 bg-cyan-950/20 p-4 cursor-pointer hover:bg-cyan-900/30 transition shadow-inner group"
            >
                <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-cyan-400" />
                    <h3 className="text-sm font-medium text-cyan-50">Zettelkasten Note</h3>
                </div>
                <div className="flex items-center gap-2 mt-2">
                    <LinkIcon className="h-3 w-3 text-cyan-600 group-hover:text-cyan-400" />
                    <span className="text-xs text-cyan-600/80 font-mono truncate group-hover:text-cyan-400/80">
                        {task.linkedNotePath}
                    </span>
                </div>
            </div>
        )}

        {/* Advanced Logic Placeholder */}
        <div className="pt-4 border-t border-zinc-800/60">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                <Network className="h-4 w-4" /> Relations
            </h3>
            
            <div className="rounded border border-dashed border-zinc-700 p-4 text-center">
                <p className="text-xs text-zinc-500">Parent/Child Subtask mapping not yet wired to SQLite.</p>
            </div>
        </div>
      </div>
      
      {/* Footer */}
      <div className="border-t border-zinc-800/60 p-4 bg-[#111111] flex items-center justify-between">
          <span className="text-[10px] font-mono text-zinc-600">ID: {task.id.slice(0,8)}</span>
          <button className="flex items-center gap-2 rounded bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition">
              <Save className="h-3 w-3" /> Save Changes
          </button>
      </div>

    </div>
  );
}
