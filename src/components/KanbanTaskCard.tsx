import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { YougileTask } from '@/types/yougile';
import { FileText, Users } from 'lucide-react';
import { getYougileTaskColorValue } from '@/lib/yougile';
import { useTaskStore } from '@/store/use-task-store';
import { useYougileStore } from '@/store/use-yougile-store';

// Unified card item — either a local Task or a YougileTask
export type CardTask = Task | YougileTask;

function isYougileTask(task: CardTask): task is YougileTask {
  return 'columnId' in task;
}

interface TaskCardProps {
  task: CardTask;
  isOverlay?: boolean;
}

const priorityDot: Record<string, string> = {
  urgent: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-yellow-400',
  low: 'bg-blue-400',
};

export function KanbanTaskCard({ task, isOverlay }: TaskCardProps) {
  const {
    selectTask: selectLocalTask,
    selectedTaskId: localSelectedTaskId,
    setIsEditorOpen,
  } = useTaskStore();
  const {
    selectTask: selectYougileTask,
    selectedTaskId: yougileSelectedTaskId,
  } = useYougileStore();
  const isYougile = isYougileTask(task);
  const isSelected = task.id === (isYougile ? yougileSelectedTaskId : localSelectedTaskId);
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

  if (isYougile) {
    // Yougile task rendering
    const deadlineTs = task.deadline?.deadline;
    const deadlineStr = deadlineTs
      ? new Date(deadlineTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : null;
    const isDone = task.completed;
    const colorStripe = getYougileTaskColorValue(task.color);

    return (
      <div
        ref={setNodeRef}
        style={style}
        onClick={() => selectYougileTask(task.id)}
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
        {/* Color stripe */}
        {colorStripe && !isSelected && (
          <div
            className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l"
            style={{ backgroundColor: colorStripe }}
          />
        )}

        <div className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-sm ${isDone ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>
            {task.title}
          </span>
        </div>

        {(deadlineStr || task.assigned.length > 0) && (
          <div className="flex items-center gap-1.5">
            {deadlineStr && (
              <span className="font-mono text-[10px] text-zinc-700">{deadlineStr}</span>
            )}
            {task.assigned.length > 0 && (
              <span className="flex items-center gap-0.5 font-mono text-[10px] text-zinc-700">
                <Users className="h-2.5 w-2.5" />
                {task.assigned.length}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // Local task rendering (original)
  const hasMeta = task.priority !== 'none' || task.tags.length > 0 || task.dueDate;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => selectLocalTask(task.id)}
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
