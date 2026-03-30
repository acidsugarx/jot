import { useState, useMemo, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { KanbanColumn } from './KanbanColumn';
import { KanbanTaskCard, CardTask } from './KanbanTaskCard';
import { Task, KanbanColumn as KanbanColumnType } from '@/types';
import { useTaskStore } from '@/store/use-task-store';
import { useYougileStore } from '@/store/use-yougile-store';

interface KanbanBoardProps {
  // When provided, board operates in Yougile mode (read-only columns, external move)
  yougileColumns?: KanbanColumnType[];
  yougileTasksByColumn?: Map<string, CardTask[]>;
}

export function KanbanBoard({ yougileColumns, yougileTasksByColumn }: KanbanBoardProps = {}) {
  const { tasks, columns, fetchColumns, updateTaskStatus, createColumn, reorderColumns } = useTaskStore();
  const yougileStore = useYougileStore();

  const isYougile = !!(yougileColumns && yougileTasksByColumn);

  // Local column order for optimistic drag-to-reorder (local mode only)
  const [localColumns, setLocalColumns] = useState<KanbanColumnType[]>([]);
  const [activeTask, setActiveTask] = useState<CardTask | null>(null);
  const [activeColumn, setActiveColumn] = useState<KanbanColumnType | null>(null);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isYougile) {
      void fetchColumns();
    }
  }, [fetchColumns, isYougile]);

  // Keep local order in sync when store updates (but not during drag)
  useEffect(() => {
    if (!isYougile && !activeColumn && !activeTask) {
      setLocalColumns(columns);
    }
  }, [columns, activeColumn, activeTask, isYougile]);

  // Sync Yougile columns into localColumns
  useEffect(() => {
    if (isYougile && yougileColumns) {
      setLocalColumns(yougileColumns);
    }
  }, [isYougile, yougileColumns]);

  useEffect(() => {
    if (isAddingColumn) {
      addInputRef.current?.focus();
    }
  }, [isAddingColumn]);

  const columnIds = useMemo(() => localColumns.map((c) => c.id), [localColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === 'Task') {
      setActiveTask(active.data.current.task as CardTask);
    } else if (active.data.current?.type === 'Column') {
      setActiveColumn(active.data.current.column as KanbanColumnType);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    setActiveColumn(null);

    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const isActiveColumn = active.data.current?.type === 'Column';
    const isActiveTask = active.data.current?.type === 'Task';
    const isOverColumn = over.data.current?.type === 'Column';

    // Column reorder — only in local mode
    if (!isYougile && isActiveColumn && isOverColumn) {
      const from = localColumns.findIndex((c) => c.id === activeId);
      const to = localColumns.findIndex((c) => c.id === overId);
      const reordered = arrayMove(localColumns, from, to);
      setLocalColumns(reordered);
      void reorderColumns(reordered.map((c) => c.id));
      return;
    }

    // Task dropped onto a column header
    if (isActiveTask && isOverColumn) {
      const draggedTask = active.data.current?.task as CardTask;
      const targetCol = localColumns.find((c) => c.id === overId);
      if (!targetCol) return;

      if (isYougile) {
        void yougileStore.moveTask(draggedTask.id, targetCol.id);
      } else {
        const localTask = draggedTask as Task;
        if (localTask.status !== targetCol.statusKey) {
          void updateTaskStatus({ id: localTask.id, status: targetCol.statusKey });
        }
      }
    }
  };

  const handleAddColumn = async () => {
    const name = newColumnName.trim();
    if (name) {
      await createColumn(name);
    }
    setNewColumnName('');
    setIsAddingColumn(false);
  };

  if (localColumns.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center">
        <span className="font-mono text-[10px] text-zinc-700">Loading columns…</span>
      </div>
    );
  }

  // Show a subtle loading indicator at the top of the board when Yougile tasks are being fetched
  const showYougileLoadingBar = isYougile && yougileStore.isLoading;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {showYougileLoadingBar && (
        <div className="h-0.5 w-full bg-zinc-800 shrink-0">
          <div className="h-full bg-cyan-500/40 animate-pulse" style={{ width: '60%' }} />
        </div>
      )}
    <div className="flex flex-1 overflow-x-auto overflow-y-hidden px-6 py-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3">
          <SortableContext items={columnIds}>
            {localColumns.map((col, colIdx) => {
              const colTasks: CardTask[] = isYougile
                ? (yougileTasksByColumn!.get(col.id) ?? [])
                : tasks.filter((t) => t.status === col.statusKey);

              return (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  columnIndex={colIdx}
                  tasks={colTasks}
                  readOnly={isYougile}
                />
              );
            })}
          </SortableContext>

          {/* Add column — local mode only */}
          {!isYougile && (
            isAddingColumn ? (
              <div className="flex w-[260px] shrink-0 flex-col rounded-md border border-zinc-700/40 bg-[#141414] p-2">
                <input
                  ref={addInputRef}
                  type="text"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { void handleAddColumn(); }
                    if (e.key === 'Escape') { setIsAddingColumn(false); setNewColumnName(''); }
                  }}
                  onBlur={() => void handleAddColumn()}
                  placeholder="Column name…"
                  className="rounded bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-700 outline-none focus:ring-1 focus:ring-cyan-500/30"
                />
                <div className="mt-1.5 flex gap-1">
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); void handleAddColumn(); }}
                    className="rounded px-2 py-1 text-xs text-cyan-400 hover:bg-zinc-800 transition-colors"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsAddingColumn(false); setNewColumnName(''); }}
                    className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingColumn(true)}
                className="flex h-9 w-[260px] shrink-0 items-center gap-2 rounded-md border border-dashed border-zinc-800 px-3 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-sm">Add column</span>
              </button>
            )
          )}
        </div>

        <DragOverlay>
          {activeTask && <KanbanTaskCard task={activeTask} isOverlay columnIndex={0} taskIndex={0} />}
          {activeColumn && (
            <div className="w-[260px] rounded-md border border-cyan-500/30 bg-[#141414] opacity-80">
              <div className="flex h-8 items-center px-3">
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  {activeColumn.name}
                </span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
    </div>
  );
}
