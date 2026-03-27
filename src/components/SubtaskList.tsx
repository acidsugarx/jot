import { useState } from 'react';
import { useTaskStore } from '@/store/use-task-store';
import { Plus, Trash2 } from 'lucide-react';
import type { Task } from '@/types';

interface SubtaskListProps {
  parentId: string;
  subtasks: Task[];
  onUpdate: () => void;
  onSelect: (taskId: string) => void;
}

export function SubtaskList({ parentId, subtasks, onUpdate, onSelect }: SubtaskListProps) {
  const { createTask, updateTaskStatus, deleteTask } = useTaskStore();
  const [newTitle, setNewTitle] = useState('');

  const doneCount = subtasks.filter((t) => t.status === 'done').length;

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await createTask({ title, parentId });
    setNewTitle('');
    onUpdate();
  };

  const handleToggle = async (task: Task) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    await updateTaskStatus({ id: task.id, status: newStatus });
    onUpdate();
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    onUpdate();
  };

  return (
    <div className="space-y-1">
      {/* Progress */}
      {subtasks.length > 0 && (
        <div className="mb-1.5 font-mono text-[10px] text-zinc-600">
          {doneCount}/{subtasks.length} done
        </div>
      )}

      {/* Subtask items */}
      {subtasks.map((task) => (
        <div
          key={task.id}
          className="group/sub flex items-center gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/40"
        >
          <input
            type="checkbox"
            checked={task.status === 'done'}
            onChange={() => void handleToggle(task)}
            className="h-3 w-3 cursor-pointer rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
          />
          <button
            type="button"
            onClick={() => onSelect(task.id)}
            className={`flex-1 text-left text-xs ${task.status === 'done' ? 'text-zinc-600 line-through' : 'text-zinc-300'} hover:text-cyan-400 transition-colors`}
          >
            {task.title}
          </button>
          <button
            type="button"
            onClick={() => void handleDelete(task.id)}
            className="rounded p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover/sub:opacity-100"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}

      {/* Add subtask input */}
      <div className="flex items-center gap-1.5 px-1">
        <Plus className="h-3 w-3 text-zinc-700" />
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="Add subtask..."
          className="h-5 flex-1 bg-transparent text-xs text-zinc-400 placeholder:text-zinc-600 outline-none"
        />
      </div>
    </div>
  );
}
