import { useState, useMemo } from 'react';
import { 
  DndContext, 
  DragOverlay, 
  closestCorners, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KanbanColumn } from './KanbanColumn';
import { KanbanTaskCard } from './KanbanTaskCard';
import { Task } from '@/types';
import { useTaskStore } from '@/store/use-task-store';

const defaultCols = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'done', title: 'Done' }
];

export function KanbanBoard() {
  const { tasks, updateTaskStatus } = useTaskStore();
  const [columns] = useState(defaultCols);
  
  // Local state for smooth generic dragging before SQLite commits
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const columnsId = useMemo(() => columns.map(c => c.id), [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === 'Task') {
      setActiveTask(active.data.current.task);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) return;
    
    // Smooth transition logic will go here
    // For Kanban, we usually swap the visual state immediately if moving columns
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const isActiveTask = active.data.current?.type === 'Task';
    const isOverColumn = over.data.current?.type === 'Column';
    
    // Dropping a task into a completely new column
    if (isActiveTask && isOverColumn) {
      const draggedTask = active.data.current?.task as Task;
      if (draggedTask.status !== overId) {
         void updateTaskStatus({ id: draggedTask.id, status: overId as 'todo' | 'in_progress' | 'done' });
      }
    }
  };

  return (
    <div className="flex w-full overflow-x-auto overflow-y-hidden px-12 py-8 min-h-[500px]">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-6">
          <SortableContext items={columnsId}>
            {columns.map(col => (
               <KanbanColumn 
                  key={col.id} 
                  column={col} 
                  tasks={tasks.filter(t => t.status === col.id)} 
               />
            ))}
          </SortableContext>
        </div>
        
        <DragOverlay>
           {activeTask && <KanbanTaskCard task={activeTask} isOverlay />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
