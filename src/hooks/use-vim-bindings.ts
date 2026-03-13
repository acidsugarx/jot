import { useEffect } from 'react';
import { useTaskStore } from '@/store/use-task-store';

export type ViewMode = 'list' | 'kanban' | 'calendar';

export function useVimBindings(viewMode: ViewMode) {
  const { tasks, selectedTaskId, selectTask, updateTaskStatus, deleteTask, openLinkedNote, isEditorOpen, setIsEditorOpen } = useTaskStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }

      if (!tasks.length) return;

      const currentIndex = tasks.findIndex((t) => t.id === selectedTaskId);
      const currentTask = currentIndex >= 0 ? tasks[currentIndex] : null;

      // Unselect
      if (e.key === 'Escape') {
        if (isEditorOpen) {
          setIsEditorOpen(false);
        } else {
          selectTask(null);
        }
        return;
      }

      // Initial Selection Strategy
      if (!currentTask && (e.key === 'j' || e.key === 'k' || e.key === 'h' || e.key === 'l' || e.key === 'Enter')) {
        if (viewMode === 'list') {
            const firstT = tasks[0];
            if (firstT) selectTask(firstT.id);
        } else if (viewMode === 'kanban') {
            const firstTodo = tasks.find(t => t.status === 'todo');
            const firstTask = firstTodo || tasks[0];
            if (firstTask) selectTask(firstTask.id);
        }
        return;
      }

      if (!currentTask) return;

      if (viewMode === 'list') {
        if (e.key === 'j') {
          const nextIndex = Math.min(currentIndex + 1, tasks.length - 1);
          const t = tasks[nextIndex];
          if (t) selectTask(t.id);
        } else if (e.key === 'k') {
          const prevIndex = Math.max(currentIndex - 1, 0);
          const t = tasks[prevIndex];
          if (t) selectTask(t.id);
        }
      } else if (viewMode === 'kanban') {
        const columns: string[] = ['todo', 'in_progress', 'done'];
        const currentStatus = currentTask.status;
        const colIndex = columns.indexOf(currentStatus);
        
        const tasksInStatus = tasks.filter((t) => t.status === currentStatus);
        const indexInStatus = tasksInStatus.findIndex((t) => t.id === currentTask.id);

        if (e.key === 'j') {
          const nextIndex = Math.min(indexInStatus + 1, tasksInStatus.length - 1);
          selectTask(tasksInStatus[nextIndex]?.id || currentTask.id);
        } else if (e.key === 'k') {
          const prevIndex = Math.max(indexInStatus - 1, 0);
          selectTask(tasksInStatus[prevIndex]?.id || currentTask.id);
        } else if (e.key === 'h' && colIndex > 0) {
          const targetStatus = columns[colIndex - 1];
          const tasksInTarget = tasks.filter((t) => t.status === targetStatus);
          const targetTask = tasksInTarget[Math.min(indexInStatus, Math.max(0, tasksInTarget.length - 1))];
          if (targetTask) selectTask(targetTask.id);
        } else if (e.key === 'l' && colIndex < columns.length - 1) {
          const targetStatus = columns[colIndex + 1];
          const tasksInTarget = tasks.filter((t) => t.status === targetStatus);
          const targetTask = tasksInTarget[Math.min(indexInStatus, Math.max(0, tasksInTarget.length - 1))];
          if (targetTask) selectTask(targetTask.id);
        }
      }

      // Actions on current selected task
      if (e.key === 'e') {
        setIsEditorOpen(true);
      } else if (e.key === 'x') {
        const newStatus = currentTask.status === 'done' ? 'todo' : 'done';
        void updateTaskStatus({ id: currentTask.id, status: newStatus });
      } else if (e.key === 'd') { 
        void deleteTask(currentTask.id);
      } else if (e.key === 'o' && currentTask.linkedNotePath) {
        void openLinkedNote(currentTask.linkedNotePath);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tasks, selectedTaskId, selectTask, updateTaskStatus, deleteTask, openLinkedNote, viewMode, isEditorOpen, setIsEditorOpen]);
}
