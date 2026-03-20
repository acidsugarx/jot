import { useEffect, useCallback } from 'react';
import { useTaskStore } from '@/store/use-task-store';

export type ViewMode = 'list' | 'kanban' | 'calendar';

/** Get the ordered task list as the user sees it (wip → todo → done) */
function getOrderedTasks() {
  const tasks = useTaskStore.getState().tasks;
  const wip = tasks.filter((t) => t.status === 'in_progress');
  const todo = tasks.filter((t) => t.status === 'todo');
  const done = tasks.filter((t) => t.status === 'done');
  return [...wip, ...todo, ...done];
}

function scrollSelectedIntoView() {
  requestAnimationFrame(() => {
    const el = document.querySelector('[data-task-selected="true"]');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

export function useVimBindings(viewMode: ViewMode) {
  const {
    tasks,
    selectedTaskId,
    selectTask,
    updateTaskStatus,
    deleteTask,
    openLinkedNote,
    isEditorOpen,
    setIsEditorOpen,
  } = useTaskStore();

  const handleNav = useCallback(
    (direction: 'up' | 'down') => {
      if (viewMode === 'list') {
        const ordered = getOrderedTasks();
        if (!ordered.length) return;

        const currentIndex = ordered.findIndex((t) => t.id === selectedTaskId);

        if (currentIndex < 0) {
          selectTask(ordered[0].id);
        } else if (direction === 'down') {
          const next = Math.min(currentIndex + 1, ordered.length - 1);
          selectTask(ordered[next].id);
        } else {
          const prev = Math.max(currentIndex - 1, 0);
          selectTask(ordered[prev].id);
        }
        scrollSelectedIntoView();
      } else if (viewMode === 'kanban') {
        const currentTask = tasks.find((t) => t.id === selectedTaskId);

        if (!currentTask) {
          const first = tasks.find((t) => t.status === 'todo') || tasks[0];
          if (first) selectTask(first.id);
          scrollSelectedIntoView();
          return;
        }

        const tasksInCol = tasks.filter((t) => t.status === currentTask.status);
        const idx = tasksInCol.findIndex((t) => t.id === currentTask.id);

        if (direction === 'down') {
          const next = Math.min(idx + 1, tasksInCol.length - 1);
          selectTask(tasksInCol[next]?.id || currentTask.id);
        } else {
          const prev = Math.max(idx - 1, 0);
          selectTask(tasksInCol[prev]?.id || currentTask.id);
        }
        scrollSelectedIntoView();
      }
    },
    [tasks, selectedTaskId, selectTask, viewMode]
  );

  const handleColumnNav = useCallback(
    (direction: 'left' | 'right') => {
      if (viewMode !== 'kanban') return;
      const columns = ['todo', 'in_progress', 'done'];
      const currentTask = tasks.find((t) => t.id === selectedTaskId);
      if (!currentTask) return;

      const colIdx = columns.indexOf(currentTask.status);
      const tasksInCurrent = tasks.filter((t) => t.status === currentTask.status);
      const idxInCol = tasksInCurrent.findIndex((t) => t.id === currentTask.id);

      const targetColIdx = direction === 'left' ? colIdx - 1 : colIdx + 1;
      if (targetColIdx < 0 || targetColIdx >= columns.length) return;

      const targetTasks = tasks.filter((t) => t.status === columns[targetColIdx]);
      const targetTask = targetTasks[Math.min(idxInCol, Math.max(0, targetTasks.length - 1))];
      if (targetTask) selectTask(targetTask.id);
      scrollSelectedIntoView();
    },
    [tasks, selectedTaskId, selectTask, viewMode]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!tasks.length) return;

      const currentTask = tasks.find((t) => t.id === selectedTaskId);

      // --- Global keys (work regardless of selection) ---

      // Escape
      if (e.key === 'Escape') {
        if (isEditorOpen) {
          setIsEditorOpen(false);
        } else {
          selectTask(null);
        }
        return;
      }

      // / — focus search
      if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null;
        searchInput?.focus();
        return;
      }

      // --- Navigation ---
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleNav('down');
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        handleNav('up');
        return;
      }
      if (e.key === 'h' || e.key === 'ArrowLeft') {
        handleColumnNav('left');
        return;
      }
      if (e.key === 'l' || e.key === 'ArrowRight') {
        handleColumnNav('right');
        return;
      }

      // g — go to first
      if (e.key === 'g') {
        const ordered = viewMode === 'list' ? getOrderedTasks() : tasks;
        if (ordered.length) selectTask(ordered[0].id);
        scrollSelectedIntoView();
        return;
      }

      // G — go to last
      if (e.key === 'G') {
        const ordered = viewMode === 'list' ? getOrderedTasks() : tasks;
        if (ordered.length) selectTask(ordered[ordered.length - 1].id);
        scrollSelectedIntoView();
        return;
      }

      // --- Actions (require selected task) ---
      if (!currentTask) return;

      if (e.key === 'e' || e.key === 'Enter') {
        e.preventDefault();
        setIsEditorOpen(true);
        return;
      }

      if (e.key === 'x') {
        const newStatus = currentTask.status === 'done' ? 'todo' : 'done';
        void updateTaskStatus({ id: currentTask.id, status: newStatus });
        return;
      }

      // s — cycle status: todo → in_progress → done → todo
      if (e.key === 's') {
        const cycle: Record<string, 'todo' | 'in_progress' | 'done'> = {
          todo: 'in_progress',
          in_progress: 'done',
          done: 'todo',
        };
        const next = cycle[currentTask.status] || 'todo';
        void updateTaskStatus({ id: currentTask.id, status: next });
        return;
      }

      if (e.key === 'd') {
        // Select next task before deleting
        const ordered = viewMode === 'list' ? getOrderedTasks() : tasks;
        const idx = ordered.findIndex((t) => t.id === currentTask.id);
        const nextTask = ordered[idx + 1] || ordered[idx - 1] || null;
        void deleteTask(currentTask.id);
        if (nextTask) selectTask(nextTask.id);
        return;
      }

      if (e.key === 'o' && currentTask.linkedNotePath) {
        void openLinkedNote(currentTask.linkedNotePath);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    tasks,
    selectedTaskId,
    selectTask,
    updateTaskStatus,
    deleteTask,
    openLinkedNote,
    isEditorOpen,
    setIsEditorOpen,
    handleNav,
    handleColumnNav,
    viewMode,
  ]);
}
