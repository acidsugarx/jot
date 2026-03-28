import { useEffect, useCallback } from 'react';
import { useTaskStore } from '@/store/use-task-store';
import { useYougileStore } from '@/store/use-yougile-store';

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
    selectedTaskId: localSelectedTaskId,
    selectTask: localSelectTask,
    updateTaskStatus,
    deleteTask: localDeleteTask,
    openLinkedNote,
    isEditorOpen,
    setIsEditorOpen,
    isQuickAddOpen,
    setIsQuickAddOpen,
  } = useTaskStore();

  const yougileStore = useYougileStore();
  const isYougile = yougileStore.activeSource === 'yougile';

  // Active task list and selection depend on current source
  const activeTasks = isYougile ? yougileStore.tasks : tasks;
  const selectedTaskId = isYougile ? yougileStore.selectedTaskId : localSelectedTaskId;
  const selectTask = isYougile ? yougileStore.selectTask : localSelectTask;

  const handleNav = useCallback(
    (direction: 'up' | 'down') => {
      if (viewMode === 'list') {
        const ordered = isYougile ? activeTasks : getOrderedTasks();
        if (!ordered.length) return;

        const currentIndex = ordered.findIndex((t) => t.id === selectedTaskId);

        if (currentIndex < 0) {
          selectTask(ordered[0]!.id);
        } else if (direction === 'down') {
          const next = Math.min(currentIndex + 1, ordered.length - 1);
          selectTask(ordered[next]!.id);
        } else {
          const prev = Math.max(currentIndex - 1, 0);
          selectTask(ordered[prev]!.id);
        }
        scrollSelectedIntoView();
      } else if (viewMode === 'kanban') {
        if (isYougile) {
          // Navigate within Yougile column
          const currentTask = yougileStore.tasks.find((t) => t.id === selectedTaskId);
          if (!currentTask) {
            const first = yougileStore.tasks[0];
            if (first) selectTask(first.id);
            scrollSelectedIntoView();
            return;
          }
          const tasksInCol = yougileStore.tasks.filter((t) => t.columnId === currentTask.columnId);
          const idx = tasksInCol.findIndex((t) => t.id === currentTask.id);
          if (direction === 'down') {
            const next = Math.min(idx + 1, tasksInCol.length - 1);
            selectTask(tasksInCol[next]?.id ?? currentTask.id);
          } else {
            const prev = Math.max(idx - 1, 0);
            selectTask(tasksInCol[prev]?.id ?? currentTask.id);
          }
          scrollSelectedIntoView();
        } else {
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
      }
    },
    [activeTasks, tasks, selectedTaskId, selectTask, viewMode, isYougile, yougileStore]
  );

  const handleColumnNav = useCallback(
    (direction: 'left' | 'right') => {
      if (viewMode !== 'kanban') return;

      if (isYougile) {
        const colIds = yougileStore.columns.map((c) => c.id);
        const currentTask = yougileStore.tasks.find((t) => t.id === selectedTaskId);
        if (!currentTask?.columnId) return;

        const colIdx = colIds.indexOf(currentTask.columnId);
        const tasksInCurrent = yougileStore.tasks.filter((t) => t.columnId === currentTask.columnId);
        const idxInCol = tasksInCurrent.findIndex((t) => t.id === currentTask.id);

        const targetColIdx = direction === 'left' ? colIdx - 1 : colIdx + 1;
        if (targetColIdx < 0 || targetColIdx >= colIds.length) return;

        const targetTasks = yougileStore.tasks.filter((t) => t.columnId === colIds[targetColIdx]);
        const targetTask = targetTasks[Math.min(idxInCol, Math.max(0, targetTasks.length - 1))];
        if (targetTask) selectTask(targetTask.id);
        scrollSelectedIntoView();
      } else {
        const { columns } = useTaskStore.getState();
        const colKeys = columns.map((c) => c.statusKey);
        const currentTask = tasks.find((t) => t.id === selectedTaskId);
        if (!currentTask) return;

        const colIdx = colKeys.indexOf(currentTask.status);
        const tasksInCurrent = tasks.filter((t) => t.status === currentTask.status);
        const idxInCol = tasksInCurrent.findIndex((t) => t.id === currentTask.id);

        const targetColIdx = direction === 'left' ? colIdx - 1 : colIdx + 1;
        if (targetColIdx < 0 || targetColIdx >= colKeys.length) return;

        const targetTasks = tasks.filter((t) => t.status === colKeys[targetColIdx]);
        const targetTask = targetTasks[Math.min(idxInCol, Math.max(0, targetTasks.length - 1))];
        if (targetTask) selectTask(targetTask.id);
        scrollSelectedIntoView();
      }
    },
    [tasks, selectedTaskId, selectTask, viewMode, isYougile, yougileStore]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const currentTask = activeTasks.find((t) => t.id === selectedTaskId);

      // Suppress browser Tab element cycling
      if (e.key === 'Tab') {
        e.preventDefault();
        return;
      }

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

      // n — new task quick-add (local mode only)
      if (e.key === 'n' && !isYougile) {
        e.preventDefault();
        setIsQuickAddOpen(true);
        return;
      }

      if (!activeTasks.length) return;

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
        const ordered = (isYougile || viewMode !== 'list') ? activeTasks : getOrderedTasks();
        if (ordered.length) selectTask(ordered[0]!.id);
        scrollSelectedIntoView();
        return;
      }

      // G — go to last
      if (e.key === 'G') {
        const ordered = (isYougile || viewMode !== 'list') ? activeTasks : getOrderedTasks();
        if (ordered.length) selectTask(ordered[ordered.length - 1]!.id);
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
        if (isYougile) {
          const yt = yougileStore.tasks.find((t) => t.id === currentTask.id);
          if (yt) void yougileStore.updateTask(yt.id, { completed: !yt.completed });
        } else {
          const lt = tasks.find((t) => t.id === currentTask.id);
          if (lt) {
            const newStatus = lt.status === 'done' ? 'todo' : 'done';
            void updateTaskStatus({ id: lt.id, status: newStatus });
          }
        }
        return;
      }

      // s — cycle status through columns (local mode only)
      if (e.key === 's' && !isYougile) {
        const { columns } = useTaskStore.getState();
        const lt = tasks.find((t) => t.id === currentTask.id);
        if (lt) {
          const colKeys = columns.map((c) => c.statusKey);
          if (colKeys.length > 0) {
            const idx = colKeys.indexOf(lt.status);
            const next = colKeys[(idx + 1) % colKeys.length] ?? colKeys[0] ?? 'todo';
            void updateTaskStatus({ id: lt.id, status: next });
          }
        }
        return;
      }

      // a — toggle archive (local mode only)
      if (e.key === 'a' && !isYougile) {
        const lt = tasks.find((t) => t.id === currentTask.id);
        if (lt) {
          const newStatus = lt.status === 'archived' ? 'todo' : 'archived';
          void updateTaskStatus({ id: lt.id, status: newStatus });
        }
        return;
      }

      if (e.key === 'd') {
        if (isYougile) {
          const ordered = activeTasks;
          const idx = ordered.findIndex((t) => t.id === currentTask.id);
          const nextTask = ordered[idx + 1] || ordered[idx - 1] || null;
          void yougileStore.deleteTask(currentTask.id);
          if (nextTask) selectTask(nextTask.id);
        } else {
          const ordered = viewMode === 'list' ? getOrderedTasks() : tasks;
          const idx = ordered.findIndex((t) => t.id === currentTask.id);
          const nextTask = ordered[idx + 1] || ordered[idx - 1] || null;
          void localDeleteTask(currentTask.id);
          if (nextTask) selectTask(nextTask.id);
        }
        return;
      }

      // o — open linked note (local mode only; Yougile tasks have no linked notes)
      if (e.key === 'o' && !isYougile) {
        const lt = tasks.find((t) => t.id === currentTask.id);
        if (lt?.linkedNotePath) void openLinkedNote(lt.linkedNotePath);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTasks,
    tasks,
    selectedTaskId,
    selectTask,
    updateTaskStatus,
    localDeleteTask,
    openLinkedNote,
    isEditorOpen,
    setIsEditorOpen,
    isQuickAddOpen,
    setIsQuickAddOpen,
    handleNav,
    handleColumnNav,
    viewMode,
    isYougile,
    yougileStore,
  ]);
}
