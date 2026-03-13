import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { KanbanTaskCard } from './KanbanTaskCard';

interface ColumnProps {
  column: { id: string; title: string };
  tasks: Task[];
}

export function KanbanColumn({ column, tasks }: ColumnProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'Column', column },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  if (isDragging) {
    return (
      <div 
        ref={setNodeRef} 
        style={style} 
        className="flex w-[350px] flex-col rounded-lg border-2 border-cyan-500/50 bg-zinc-900/40 opacity-40 shrink-0" 
      />
    );
  }

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className="flex w-[350px] flex-col rounded-xl border border-zinc-700/50 bg-[#18181A] shrink-0 self-start max-h-full"
    >
      <div 
        {...attributes}
        {...listeners}
        className="flex h-[50px] items-center justify-between rounded-t-xl border-b border-zinc-700/50 bg-zinc-800/20 px-4 font-medium text-zinc-100 cursor-grab active:cursor-grabbing hover:bg-zinc-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>{column.title}</span>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-400">
            {tasks.length}
          </span>
        </div>
      </div>
      
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {tasks.map((task) => (
          <KanbanTaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
