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
        className="flex w-[260px] shrink-0 flex-col rounded-md border border-cyan-500/20 bg-zinc-900/10 opacity-30"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex w-[260px] shrink-0 flex-col self-start rounded-md border border-zinc-800/40 bg-[#141414]"
    >
      <div
        {...attributes}
        {...listeners}
        className="flex h-8 items-center justify-between border-b border-zinc-800/30 px-3 cursor-grab active:cursor-grabbing"
      >
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">{column.title}</span>
        <span className="font-mono text-[10px] text-zinc-700">{tasks.length}</span>
      </div>

      <div className="flex flex-col gap-px overflow-y-auto p-1">
        {tasks.map((task) => (
          <KanbanTaskCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <div className="flex h-16 items-center justify-center">
            <span className="font-mono text-[10px] text-zinc-800">empty</span>
          </div>
        )}
      </div>
    </div>
  );
}
