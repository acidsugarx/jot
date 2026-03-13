import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { Calendar } from 'lucide-react';
import { useTaskStore } from '@/store/use-task-store';

interface TaskCardProps {
  task: Task;
  isOverlay?: boolean;
}

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
        className="h-[100px] w-full rounded-md border-2 border-cyan-500/50 bg-zinc-900/40 opacity-40"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => selectTask(task.id)}
      onDoubleClick={() => setIsEditorOpen(true)}
      {...attributes}
      {...listeners}
      className={`relative flex cursor-grab flex-col gap-3 rounded-lg border p-3.5 hover:border-zinc-500 active:cursor-grabbing transition-all ${
        isOverlay ? 'scale-105 border-cyan-500 bg-[#2e2e33] shadow-2xl rotate-2 cursor-grabbing' : 
        isSelected ? 'border-cyan-500/50 bg-[#1e1e1a] shadow-md' : 'border-zinc-700/60 bg-[#27272A] shadow-md hover:shadow-lg'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-zinc-100">
          {task.title}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {task.priority !== 'none' && (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
            {task.priority.toUpperCase()}
          </span>
        )}
        
        {task.dueDate && (
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Calendar className="h-3 w-3" />
            <span>{new Date(task.dueDate).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Tags Flow */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex gap-1.5">
          {task.tags.map(tag => (
            <span key={tag} className="text-[10px] font-mono text-zinc-500">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
