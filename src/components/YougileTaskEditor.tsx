import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MessageCircle } from 'lucide-react';
import { useRegisteredNormalKeyActions } from '@/lib/focus-actions';
import { getYougileTaskColorValue, YOUGILE_TASK_COLOR_OPTIONS } from '@/lib/yougile';
import { useYougileStore } from '@/store/use-yougile-store';
import { focusEngine } from '@/lib/focus-engine';
import {
  unixMsToDateInput,
  dateInputToUnixMs,
  normalizeStickerMap,
  cloneChecklists,
} from '@/lib/yougile-editor';
import { EditorField, EditorHeader, EditorFields, ChatPanel, StickerSection, TimeTrackingSection, ImagePreviewOverlay, ChecklistSection, SubtaskSection, TipTapEditor } from '@/components/editors';
import type { YougileTask, YougileChecklist } from '@/types/yougile';

// Alias for EditorField — used throughout this component for j/k navigation
const YougileEditorField = EditorField;

export interface YougileTaskEditorProps {
  task: YougileTask;
  onClose: () => void;
  embedded?: boolean;
}

// Navigation wrapper — manages parent↔subtask drill-down
export function YougileTaskEditor({ task, onClose, embedded }: YougileTaskEditorProps) {
  const [navStack, setNavStack] = useState<YougileTask[]>([]);
  const [navigatedTask, setNavigatedTask] = useState<YougileTask | null>(null);
  const { fetchSubtaskTasks, tasks: yougileTasks } = useYougileStore();

  const activeTask = navStack.length > 0 && navigatedTask ? navigatedTask : task;
  const parentTask = navStack.length > 0 ? navStack[navStack.length - 1] : null;

  const handleNavigateToSubtask = useCallback(async (subtaskId: string) => {
    // Try to find in store first
    let subtask = yougileTasks.find((t) => t.id === subtaskId) ?? null;
    if (!subtask) {
      const fetched = await fetchSubtaskTasks([subtaskId]);
      subtask = fetched[0] ?? null;
    }
    if (!subtask) return;

    setNavStack((prev) => [...prev, activeTask]);
    setNavigatedTask(subtask);
  }, [activeTask, fetchSubtaskTasks, yougileTasks]);

  const handleNavigateBack = useCallback(() => {
    setNavStack((prev) => {
      const next = prev.slice(0, -1);
      // If stack is now empty, clear navigated task so we show the original prop
      if (next.length === 0) {
        setNavigatedTask(null);
      } else {
        // Set the navigated task to the new top of stack
        setNavigatedTask(next[next.length - 1]!);
      }
      return next;
    });
  }, []);

  const handleClose = useCallback(() => {
    // If we're in a subtask, go back first; only close when at root
    if (navStack.length > 0) {
      handleNavigateBack();
    } else {
      onClose();
    }
  }, [handleNavigateBack, navStack.length, onClose]);

  return (
    <YougileTaskEditorInner
      key={activeTask.id}
      task={activeTask}
      onClose={handleClose}
      embedded={embedded}
      parentTask={parentTask}
      onNavigateBack={navStack.length > 0 ? handleNavigateBack : undefined}
      onNavigateToSubtask={handleNavigateToSubtask}
    />
  );
}

interface YougileTaskEditorInnerProps {
  task: YougileTask;
  onClose: () => void;
  embedded?: boolean;
  parentTask?: YougileTask | null;
  onNavigateBack?: () => void;
  onNavigateToSubtask: (subtaskId: string) => void;
}

function YougileTaskEditorInner({ task, onClose, embedded, parentTask, onNavigateBack, onNavigateToSubtask }: YougileTaskEditorInnerProps) {
  const {
    updateTask,
    moveTask,
    columns,
    users,
    stringStickers,
    sprintStickers,
    fetchUsers,
    fetchStringStickers,
    fetchSprintStickers,
    yougileContext,
    tasks: yougileTasks,
    fetchSubtaskTasks,
    createSubtask,
    removeSubtask,
    toggleSubtask,
  } = useYougileStore();

  const [title, setTitle] = useState(task.title);
  const tiptapEditorRef = useRef<import('@tiptap/react').Editor | null>(null);

  const [columnId, setColumnId] = useState(task.columnId ?? '');
  const [deadlineValue, setDeadlineValue] = useState(
    unixMsToDateInput(task.deadline?.deadline ?? null)
  );
  const [checklists, setChecklists] = useState<YougileChecklist[]>(() => cloneChecklists(task.checklists));
  const [color, setColor] = useState(task.color ?? 'task-primary');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(task.assigned);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [stickerValues, setStickerValues] = useState<Record<string, string>>(
    normalizeStickerMap(task.stickers)
  );

  // Chat toggle state (panel content lives in ChatPanel component)
  const [showChat, setShowChat] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const lastTaskChecklistsRef = useRef(task.checklists);
  const taskId = task.id;

  // Sync when task identity changes externally
  useEffect(() => {
    setTitle(task.title);
    setColumnId(task.columnId ?? '');
    setDeadlineValue(unixMsToDateInput(task.deadline?.deadline ?? null));
    setChecklists(cloneChecklists(task.checklists));
    lastTaskChecklistsRef.current = task.checklists;
    setColor(task.color ?? 'task-primary');
    setAssignedUserIds(task.assigned);
    setStickerValues(normalizeStickerMap(task.stickers));
    setShowAssigneePicker(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reset local editor state only when task identity changes
  }, [taskId]);

  useEffect(() => {
    if (lastTaskChecklistsRef.current === task.checklists) {
      return;
    }

    lastTaskChecklistsRef.current = task.checklists;
    setChecklists(cloneChecklists(task.checklists));
  }, [task.checklists]);

  useEffect(() => {
    if (yougileContext.projectId && users.length === 0) {
      void fetchUsers(yougileContext.projectId);
    }
    if (yougileContext.boardId) {
      if (stringStickers.length === 0) {
        void fetchStringStickers(yougileContext.boardId);
      }
      if (sprintStickers.length === 0) {
        void fetchSprintStickers(yougileContext.boardId);
      }
    }
  }, [
    fetchSprintStickers,
    fetchStringStickers,
    fetchUsers,
    sprintStickers.length,
    stringStickers.length,
    users.length,
    yougileContext.boardId,
    yougileContext.projectId,
  ]);

  // Auto-resize textareas
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  useEffect(() => { autoResize(titleRef.current); }, [title, autoResize]);

  // Focus editor pane in NORMAL mode on open — press Enter/e/i on a field to enter INSERT
  useEffect(() => {
    requestAnimationFrame(() => {
      const engine = focusEngine.getState();
      if (engine.panes.has('editor')) {
        engine.focusPane('editor');
        engine.setMode('NORMAL');
      }
    });
  }, []);

  useRegisteredNormalKeyActions(`yougile-editor:${task.id}`, {
    onEscape: () => {
      if (focusEngine.getState().mode === 'INSERT') {
        focusEngine.getState().setMode('NORMAL');
      } else {
        onClose();
      }
    },
    onChat: () => setShowChat((v) => !v),
    onNewItem: () => {
      const { activePane, activeRegion, activeIndex, nodes } = focusEngine.getState();
      if (!activePane || !activeRegion) return;
      const key = `${activePane}:${activeRegion}`;
      const nodeList = nodes.get(key) ?? [];
      const activeNode = nodeList[activeIndex];
      if (!activeNode) return;

      // Checklist: 'o' on a checklist item → add new item
      if (activeNode.id.startsWith('yougile-checklist-')) {
        const parts = activeNode.id.split('-');
        const clIdx = parseInt(parts[2] ?? '', 10);
        if (Number.isNaN(clIdx) || clIdx < 0 || clIdx >= checklists.length) return;

        const targetChecklist = checklists[clIdx];
        if (!targetChecklist) return;

        const updated = checklists.map((checklist, checklistIndex) => (
          checklistIndex === clIdx
            ? { ...checklist, items: [...checklist.items, { title: '', completed: false }] }
            : checklist
        ));
        setChecklists(updated);
        void updateTask(task.id, { checklists: updated });
        focusEngine.getState().setMode('INSERT');
      }
    },
    onToggleDone: () => {
      // Subtask x-toggle handled by SubtaskSection
    },
    onDelete: () => {
      // Subtask d-delete handled by SubtaskSection
    },
  });

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      void updateTask(task.id, { title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  // Description sync handled by TipTapEditor's internal content prop

  const handleColumnChange = (newColumnId: string) => {
    setColumnId(newColumnId);
    void moveTask(task.id, newColumnId);
  };

  const handleDeadlineChange = (value: string) => {
    setDeadlineValue(value);
    const ms = dateInputToUnixMs(value);
    void updateTask(task.id, {
      deadline: {
        deadline: ms,
        startDate: task.deadline?.startDate,
        withTime: task.deadline?.withTime ?? false,
        history: task.deadline?.history ?? [],
        blockedPoints: task.deadline?.blockedPoints ?? [],
        links: task.deadline?.links ?? [],
      },
    });
  };

  const handleClearDeadline = () => {
    setDeadlineValue('');
    void updateTask(task.id, {
      deadline: {
        deleted: true,
        history: task.deadline?.history ?? [],
        blockedPoints: task.deadline?.blockedPoints ?? [],
        links: task.deadline?.links ?? [],
      },
    });
  };

  const commitEditingItem = useCallback((clIdx: number, itemIdx: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      focusEngine.getState().setMode('NORMAL');
      return;
    }
    const updated = checklists.map((cl, ci) => {
      if (ci !== clIdx) return cl;
      return {
        ...cl,
        items: cl.items.map((item, ii) =>
          ii === itemIdx ? { ...item, title: trimmed } : item
        ),
      };
    });
    setChecklists(updated);
    void updateTask(task.id, { checklists: updated });
    focusEngine.getState().setMode('NORMAL');
  }, [checklists, task.id, updateTask]);

  const handleToggleChecklistItem = (
    clIdx: number,
    itemIdx: number,
    completed: boolean
  ) => {
    const updated = checklists.map((cl, ci) => {
      if (ci !== clIdx) return cl;
      return {
        ...cl,
        items: cl.items.map((item, ii) =>
          ii === itemIdx ? { ...item, completed } : item
        ),
      };
    });
    setChecklists(updated);
    void updateTask(task.id, { checklists: updated });
  };

  const refreshSubtasks = useCallback(() => {
    void useYougileStore.getState().fetchTasks();
    const currentSubtaskIds = useYougileStore.getState().tasks.find(
      (t) => t.id === task.id
    )?.subtasks;
    if (currentSubtaskIds && currentSubtaskIds.length > 0) {
      void fetchSubtaskTasks(currentSubtaskIds).then(setSubtaskTasks);
    } else {
      setSubtaskTasks([]);
    }
  }, [task.id, fetchSubtaskTasks]);

  const handleAddSubtask = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const result = await createSubtask(task.id, trimmed);
    if (result) {
      refreshSubtasks();
    }
  }, [task.id, createSubtask, refreshSubtasks]);

  const handleToggleSubtask = useCallback(async (subtask: YougileTask) => {
    await toggleSubtask(subtask.id, !subtask.completed);
    refreshSubtasks();
  }, [toggleSubtask, refreshSubtasks]);

  const handleRemoveSubtask = useCallback(async (subtaskId: string) => {
    await removeSubtask(task.id, subtaskId);
    refreshSubtasks();
  }, [task.id, removeSubtask, refreshSubtasks]);

  const commitSubtaskTitle = useCallback(async (subtaskId: string, text: string) => {
    const trimmed = text.trim();
    focusEngine.getState().setMode('NORMAL');
    if (!trimmed) return;
    await updateTask(subtaskId, { title: trimmed });
    refreshSubtasks();
  }, [updateTask, refreshSubtasks]);

  const handleColorChange = useCallback((newColor: string) => {
    setColor(newColor);
    setShowColorPicker(false);
    void updateTask(task.id, { color: newColor });
  }, [task.id, updateTask]);

  const cycleColor = useCallback((delta: -1 | 1) => {
    const currentIndex = YOUGILE_TASK_COLOR_OPTIONS.findIndex((option) => option.value === color);
    const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (fallbackIndex + delta + YOUGILE_TASK_COLOR_OPTIONS.length) % YOUGILE_TASK_COLOR_OPTIONS.length;
    const next = YOUGILE_TASK_COLOR_OPTIONS[nextIndex];
    if (next) {
      handleColorChange(next.value);
    }
  }, [color, handleColorChange]);

  const handleVimSelectKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLSelectElement>,
    options: string[],
    currentValue: string,
    onChange: (value: string) => void,
  ) => {
    if (options.length === 0) return;

    const key = event.key;
    const direction = key === 'j' || key === 'l'
      ? 1
      : key === 'k' || key === 'h'
        ? -1
        : 0;

    if (direction === 0) return;

    event.preventDefault();
    const currentIndex = Math.max(0, options.indexOf(currentValue));
    const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + direction));
    const nextValue = options[nextIndex];
    if (nextValue && nextValue !== currentValue) {
      onChange(nextValue);
    }
  }, []);

  const focusAssigneeByOffset = useCallback(() => {
    // handled internally by AssigneeField
  }, []);

  const handleToggleAssignee = (userId: string) => {
    const nextAssigned = assignedUserIds.includes(userId)
      ? assignedUserIds.filter((id) => id !== userId)
      : [...assignedUserIds, userId];

    setAssignedUserIds(nextAssigned);
    void updateTask(task.id, { assigned: nextAssigned });
  };

  const persistStickerValue = (stickerId: string, rawValue: string) => {
    const trimmed = rawValue.trim();
    const nextValues = { ...stickerValues };

    if (trimmed) {
      nextValues[stickerId] = trimmed;
      setStickerValues(nextValues);
      void updateTask(task.id, { stickers: nextValues });
      return;
    }

    delete nextValues[stickerId];
    setStickerValues(nextValues);
    void updateTask(task.id, {
      stickers: {
        ...nextValues,
        [stickerId]: '-',
      },
    });
  };

  // ── File ops ──────────────────────────────────────────────────────────

  const currentColumn = columns.find((c) => c.id === columnId);
  const colorOption = YOUGILE_TASK_COLOR_OPTIONS.find((option) => option.value === color)
    ?? YOUGILE_TASK_COLOR_OPTIONS[0]!;
  const stickerDefinitions = useMemo(() => [
    ...stringStickers.map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      states: sticker.states.map((state) => ({
        id: state.id,
        name: state.name,
        color: state.color,
      })),
      freeText: sticker.states.length === 0,
    })),
    ...sprintStickers.map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      states: sticker.states.map((state) => ({
        id: state.id,
        name: state.name,
        color: undefined,
      })),
      freeText: false,
    })),
  ], [stringStickers, sprintStickers]);
  const stickerStateLookup = useMemo(() => stickerDefinitions.reduce<Record<string, { stickerName: string; valueName: string }>>(
    (acc, sticker) => {
      for (const state of sticker.states) {
        acc[state.id] = {
          stickerName: sticker.name,
          valueName: state.name,
        };
      }
      return acc;
    },
    {}
  ), [stickerDefinitions]);
  const stickerDefinitionLookup = useMemo(() => stickerDefinitions.reduce<Record<string, { name: string; freeText: boolean; states: Array<{ id: string; name: string; color?: string }> }>>(
    (acc, sticker) => {
      acc[sticker.id] = sticker;
      return acc;
    },
    {}
  ), [stickerDefinitions]);

  // Fetch and resolve subtask IDs to actual task objects
  const [subtaskTasks, setSubtaskTasks] = useState<YougileTask[]>([]);
  const subtaskIds = task.subtasks ?? [];

  useEffect(() => {
    if (subtaskIds.length === 0) {
      setSubtaskTasks([]);
      return;
    }
    // First try to resolve from already-loaded tasks
    const resolved = subtaskIds
      .map((id) => yougileTasks.find((t) => t.id === id))
      .filter((t): t is YougileTask => t !== undefined);
    if (resolved.length === subtaskIds.length) {
      setSubtaskTasks(resolved);
      return;
    }
    // Otherwise fetch missing subtasks from API
    void fetchSubtaskTasks(subtaskIds).then((fetched) => {
      setSubtaskTasks(fetched);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when subtask IDs change
  }, [subtaskIds]);

  // Index scheme:
  // 0-6: Title, Description, Column, Completed, Deadline, Color, Assigned
  // 7..7+N: Stickers
  // 7+N: Subtask "Add" field
  // 7+N+1..7+N+S: Subtask items
  // 7+N+S+1..: Checklist items
  const subtaskBaseIndex = 7 + stickerDefinitions.length;
  const checklistBaseIndex = subtaskBaseIndex + 1 + subtaskTasks.length;

  return (
    <div
      className={`flex flex-col bg-[#141414] ${
        embedded ? 'w-full min-h-0 flex-1 overflow-hidden' : 'h-full shrink-0 w-[360px] border-l border-zinc-800/40'
      }`}
    >
      {/* Header — extracted to EditorHeader */}
      <EditorHeader
        onNavigateBack={onNavigateBack}
        parentTask={parentTask}
        colorHex={getYougileTaskColorValue(colorOption.value) ?? '#7B869E'}
        onClose={onClose}
      />

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-editor>

        {/* Title */}
        <YougileEditorField index={0} onActivate={() => titleRef.current?.focus()}>
          {(isSelected) => (
            <div className={`border-b border-zinc-800/30 px-4 py-3 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
              <textarea
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    tiptapEditorRef.current?.chain().focus().run();
                  }
                }}
                rows={1}
                className="w-full resize-none overflow-hidden bg-transparent text-sm font-medium leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 selection:bg-cyan-500/30"
                placeholder="Task title..."
              />
            </div>
          )}
        </YougileEditorField>

        {/* Description — TipTap-based rich text editor */}
        <YougileEditorField index={1} onActivate={() => tiptapEditorRef.current?.chain().focus().run()}>
          {(isSelected) => (
            <div className={`border-b border-zinc-800/30 px-4 py-3 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
              <TipTapEditor
                content={task.description ?? ''}
                onSave={(html) => {
                  if (html !== (task.description ?? '').trim()) {
                    void updateTask(task.id, { description: html || undefined });
                  }
                }}
                onFocus={() => focusEngine.getState().setMode('INSERT')}
                editorRef={tiptapEditorRef}
                showToolbar
              />
            </div>
          )}
        </YougileEditorField>

        {/* Fields — extracted to EditorFields */}
        <EditorFields
          columns={columns}
          columnId={columnId}
          currentColumn={currentColumn}
          onColumnChange={handleColumnChange}
          onVimKeyDown={handleVimSelectKeyDown}
          task={task}
          onUpdateTask={updateTask}
          deadlineValue={deadlineValue}
          onDeadlineChange={handleDeadlineChange}
          onClearDeadline={handleClearDeadline}
          color={color}
          showColorPicker={showColorPicker}
          onToggleColorPicker={() => setShowColorPicker((v) => !v)}
          onColorChange={handleColorChange}
          cycleColor={cycleColor}
          colorOption={colorOption}
          users={users}
          assignedUserIds={assignedUserIds}
          showAssigneePicker={showAssigneePicker}
          onToggleAssigneePicker={() => setShowAssigneePicker((v) => !v)}
          onToggleAssignee={handleToggleAssignee}
          onFocusAssignee={focusAssigneeByOffset}
        />

        {/* Checklists — extracted to ChecklistSection */}
        <ChecklistSection
          checklists={checklists}
          checklistBaseIndex={checklistBaseIndex}
          onToggleItem={handleToggleChecklistItem}
          onCommitItem={commitEditingItem}
        />

        {/* Subtasks — extracted to SubtaskSection */}
        <SubtaskSection
          taskId={task.id}
          subtaskTasks={subtaskTasks}
          subtaskBaseIndex={subtaskBaseIndex}
          onAddSubtask={handleAddSubtask}
          onToggleSubtask={handleToggleSubtask}
          onRemoveSubtask={handleRemoveSubtask}
          onUpdateTitle={commitSubtaskTitle}
          onNavigateToSubtask={onNavigateToSubtask}
        />

        {/* Time Tracking — extracted to TimeTrackingSection */}
        {task.timeTracking && (
          <TimeTrackingSection
            plan={task.timeTracking.plan}
            work={task.timeTracking.work}
          />
        )}

        {/* Stickers / labels — extracted to StickerSection */}
        <StickerSection
          stickerDefinitions={stickerDefinitions}
          stickerValues={stickerValues}
          stickerStateLookup={stickerStateLookup}
          stickerDefinitionLookup={stickerDefinitionLookup}
          onStickerChange={persistStickerValue}
          baseIndex={7}
        />
      </div>

      {/* Chat / Discussion — press `c` to toggle */}
      {showChat && (
        <ChatPanel
          taskId={task.id}
          show={showChat}
          onClose={() => setShowChat(false)}
          onPreviewImage={setPreviewImage}
        />
      )}

      {/* Footer */}
      <div className="shrink-0 border-t border-zinc-800/40 px-4 py-1.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-700">
          <div className="flex items-center gap-2">
            <span>{task.id.slice(0, 8)}</span>
            <button
              type="button"
              onClick={() => setShowChat(!showChat)}
              className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${
                showChat
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400'
              }`}
            >
              <MessageCircle className="h-3 w-3" />
              <span>Chat</span>
              <span className="font-mono text-[9px] text-zinc-700">c</span>
            </button>
          </div>
          {task.timestamp && (
            <span>
              {new Date(task.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Image preview overlay — extracted to ImagePreviewOverlay */}
      <ImagePreviewOverlay
        src={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}
