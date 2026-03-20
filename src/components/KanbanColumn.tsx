import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical, Trash2 } from 'lucide-react';
import { Task, KanbanColumn as KanbanColumnType } from '@/types';
import { KanbanTaskCard } from './KanbanTaskCard';
import { useTaskStore } from '@/store/use-task-store';

interface ColumnProps {
  column: KanbanColumnType;
  tasks: Task[];
}

export function KanbanColumn({ column, tasks }: ColumnProps) {
  const { updateColumn, deleteColumn } = useTaskStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(column.name);
  const renameRef = useRef<HTMLInputElement>(null);

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'Column', column },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  useEffect(() => {
    if (isRenaming) renameRef.current?.focus();
  }, [isRenaming]);

  // Reset rename value if column name changes externally
  useEffect(() => {
    setRenameValue(column.name);
  }, [column.name]);

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== column.name) {
      void updateColumn({ id: column.id, name: trimmed });
    } else {
      setRenameValue(column.name);
    }
    setIsRenaming(false);
  };

  const handleDelete = () => {
    if (tasks.length > 0) return; // shouldn't be callable, but guard anyway
    void deleteColumn(column.id);
  };

  const taskIds = tasks.map((t) => t.id);

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
      {/* Header */}
      <div className="group/header flex h-8 items-center gap-1 border-b border-zinc-800/30 px-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          type="button"
          className="shrink-0 cursor-grab p-0.5 text-zinc-700 hover:text-zinc-500 active:cursor-grabbing transition-colors"
        >
          <GripVertical className="h-3 w-3" />
        </button>

        {/* Column name — double-click to rename */}
        {isRenaming ? (
          <input
            ref={renameRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setRenameValue(column.name); setIsRenaming(false); }
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-300 outline-none focus:ring-1 focus:ring-cyan-500/30 rounded px-1"
          />
        ) : (
          <span
            onDoubleClick={() => setIsRenaming(true)}
            title="Double-click to rename"
            className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600 cursor-default select-none"
          >
            {column.name}
          </span>
        )}

        {/* Task count */}
        <span className="shrink-0 font-mono text-[10px] text-zinc-700">{tasks.length}</span>

        {/* Delete (only shown when column is empty) */}
        {tasks.length === 0 && (
          <button
            type="button"
            onClick={handleDelete}
            title="Delete column"
            className="shrink-0 rounded p-0.5 text-zinc-700 opacity-0 group-hover/header:opacity-100 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-px overflow-y-auto p-1">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanTaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex h-16 items-center justify-center">
            <span className="font-mono text-[10px] text-zinc-800">empty</span>
          </div>
        )}
      </div>
    </div>
  );
}
