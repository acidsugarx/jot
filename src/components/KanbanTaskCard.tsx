import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { FileText } from 'lucide-react';
import { useTaskStore } from '@/store/use-task-store';

interface TaskCardProps {
  task: Task;
  isOverlay?: boolean;
}

const priorityDot: Record<string, string> = {
  urgent: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-yellow-400',
  low: 'bg-blue-400',
};

export function KanbanTaskCard({ task, isOverlay }: TaskCardProps) {
  const { selectTask, selectedTaskId, setIsEditorOpen } = useTaskStore();
  const isSelected = task.id === selectedTaskId;
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'Task', task },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  if (isDragging && !isOverlay) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="h-[44px] w-full rounded border border-cyan-500/20 bg-zinc-900/20"
      />
    );
  }

  const hasMeta = task.priority !== 'none' || task.tags.length > 0 || task.dueDate;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => selectTask(task.id)}
      onDoubleClick={() => setIsEditorOpen(true)}
      {...attributes}
      {...listeners}
      className={`relative flex cursor-grab flex-col gap-1 rounded px-2.5 py-2 transition-colors active:cursor-grabbing ${
        isOverlay
          ? 'rotate-1 scale-[1.02] border border-cyan-500/40 bg-[#1e1e22] shadow-xl cursor-grabbing'
          : isSelected
            ? 'border-l-2 border-l-cyan-500 bg-cyan-500/[0.03]'
            : 'hover:bg-zinc-900/40'
      }`}
    >
      <div className="flex items-center gap-2">
        {task.priority !== 'none' && priorityDot[task.priority] && (
          <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${priorityDot[task.priority]}`} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
          {task.title}
        </span>
        {task.linkedNotePath && (
          <FileText className="h-3 w-3 shrink-0 text-cyan-600/40" />
        )}
      </div>

      {hasMeta && (
        <div className="flex items-center gap-1.5 pl-[14px]">
          {task.tags.map(tag => (
            <span key={tag} className="font-mono text-[10px] text-zinc-700">#{tag}</span>
          ))}
          {task.dueDate && (
            <span className="font-mono text-[10px] text-zinc-700">
              {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
