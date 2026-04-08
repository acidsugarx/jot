import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, Settings } from 'lucide-react';

import { useFocusable } from '@/hooks/use-focusable';
import { useFocusEngineStore } from '@/hooks/use-focus-engine';
import { focusEngine } from '@/lib/focus-engine';
import { useYougileStore } from '@/store/use-yougile-store';

type BreadcrumbRegion = 'org' | 'project' | 'board';

interface PickerOption {
  id: string;
  label: string;
  meta?: string;
}

interface BreadcrumbSegmentProps {
  region: BreadcrumbRegion;
  index: number;
  label: string;
  value: string;
  selectedId: string | null;
  options: PickerOption[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: (target?: BreadcrumbRegion | 'task-view') => void;
  onSelect: (id: string) => Promise<BreadcrumbRegion | 'task-view' | void> | BreadcrumbRegion | 'task-view' | void;
}

function BreadcrumbSegment({
  region,
  index,
  label,
  value,
  selectedId,
  options,
  isOpen,
  onOpen,
  onClose,
  onSelect,
}: BreadcrumbSegmentProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const openPicker = useCallback(() => {
    onOpen();
    focusEngine.getState().setMode('INSERT');
  }, [onOpen]);

  const { ref, isSelected } = useFocusable<HTMLButtonElement>({
    pane: 'context',
    region,
    index,
    id: `breadcrumb-${region}`,
    onActivate: openPicker,
  });

  const activeOptionId = useMemo(() => {
    const current = options.find((option) => option.id === selectedId);
    return current?.id ?? options[0]?.id ?? null;
  }, [options, selectedId]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedId(null);
      return;
    }

    const nextId = highlightedId && options.some((option) => option.id === highlightedId)
      ? highlightedId
      : activeOptionId;
    setHighlightedId(nextId);

    requestAnimationFrame(() => {
      if (nextId) {
        optionRefs.current.get(nextId)?.focus();
      } else {
        triggerRef.current?.focus();
      }
    });
  }, [activeOptionId, highlightedId, isOpen, options]);

  const closePicker = useCallback((target: BreadcrumbRegion | 'task-view' = 'task-view') => {
    onClose(target);
  }, [onClose]);

  const moveHighlight = useCallback((delta: -1 | 1) => {
    if (options.length === 0) return;

    const currentIndex = highlightedId
      ? options.findIndex((option) => option.id === highlightedId)
      : options.findIndex((option) => option.id === activeOptionId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + delta + options.length) % options.length;
    const nextId = options[nextIndex]?.id ?? null;
    setHighlightedId(nextId);
    if (nextId) {
      requestAnimationFrame(() => optionRefs.current.get(nextId)?.focus());
    }
  }, [activeOptionId, highlightedId, options]);

  const confirmSelection = useCallback((id: string) => {
    const result = onSelect(id);
    const nextTarget = (result instanceof Promise ? undefined : result) ?? 'task-view';
    closePicker(nextTarget);
  }, [closePicker, onSelect]);

  const handlePickerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
      case 'j':
      case 'l':
        event.preventDefault();
        moveHighlight(1);
        return;
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'k':
      case 'h':
        event.preventDefault();
        moveHighlight(-1);
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const id = highlightedId ?? activeOptionId;
        if (id) {
          confirmSelection(id);
        }
        return;
      }
      case 'Escape':
        event.preventDefault();
        closePicker();
        return;
      default:
        return;
    }
  }, [activeOptionId, closePicker, confirmSelection, highlightedId, moveHighlight]);

  return (
    <div className="relative">
      <button
        ref={(node) => {
          triggerRef.current = node;
          (ref as MutableRefObject<HTMLButtonElement | null>).current = node;
        }}
        type="button"
        tabIndex={-1}
        onClick={() => {
          if (isOpen) {
            closePicker();
            return;
          }
          openPicker();
        }}
        className={`flex items-center gap-1 rounded px-2 py-1 text-zinc-300 transition-colors ${
          isSelected ? 'bg-cyan-500/10 text-cyan-200 ring-1 ring-inset ring-cyan-500/30' : 'hover:bg-zinc-800'
        }`}
        title={`${label} - Ctrl+W to focus, i to open`}
      >
        {value}
        <ChevronDown className={`h-3 w-3 ${isOpen ? 'text-cyan-400' : 'text-zinc-600'}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-600">No {label.toLowerCase()}s available</div>
          ) : (
            options.map((option) => {
              const isActive = option.id === (highlightedId ?? activeOptionId);
              return (
                <button
                  key={option.id}
                  ref={(node) => {
                    if (node) {
                      optionRefs.current.set(option.id, node);
                    } else {
                      optionRefs.current.delete(option.id);
                    }
                  }}
                  type="button"
                  onClick={() => confirmSelection(option.id)}
                  onMouseEnter={() => setHighlightedId(option.id)}
                  onKeyDown={handlePickerKeyDown}
                  className={`block w-full px-3 py-2 text-left text-xs transition-colors ${
                    isActive ? 'bg-cyan-500/10 text-cyan-100' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span className="text-zinc-200">{option.label}</span>
                  {option.meta ? <span className="ml-1 text-zinc-600">{option.meta}</span> : null}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function YougileBreadcrumbBar() {
  const {
    yougileEnabled,
    activeSource,
    accounts,
    projects,
    boards,
    yougileContext,
    setYougileContext,
    setActiveSource,
    fetchAccounts,
    fetchProjects,
    fetchBoards,
    fetchColumns,
    fetchTasks,
    fetchUsers,
    selectTask,
  } = useYougileStore();

  const [openPicker, setOpenPicker] = useState<BreadcrumbRegion | null>(null);
  const activePane = useFocusEngineStore((state) => state.activePane);
  const isContextFocused = activePane === 'context';

  const closePicker = useCallback((target: BreadcrumbRegion | 'task-view' = 'task-view') => {
    setOpenPicker(null);
    focusEngine.getState().setMode('NORMAL');
    requestAnimationFrame(() => {
      if (target === 'task-view') {
        focusEngine.getState().focusPane('task-view');
        return;
      }
      focusEngine.getState().focusNode('context', target, 0);
    });
  }, []);

  useEffect(() => {
    if (!yougileEnabled || activeSource !== 'yougile') return;
    if (accounts.length === 0) {
      void fetchAccounts();
    }
  }, [yougileEnabled, activeSource, accounts.length, fetchAccounts]);

  useEffect(() => {
    if (!openPicker) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const container = target instanceof HTMLElement ? target.closest('[data-yougile-breadcrumb]') : null;
      if (container) return;

      closePicker('task-view');
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [closePicker, openPicker]);

  const activeAccount = accounts.find((account) => account.id === yougileContext.accountId);

  const accountOptions = useMemo<PickerOption[]>(() => accounts.map((account) => ({
    id: account.id,
    label: account.companyName,
    meta: account.email,
  })), [accounts]);

  const projectOptions = useMemo<PickerOption[]>(() => projects.map((project) => ({
    id: project.id,
    label: project.title,
  })), [projects]);

  const boardOptions = useMemo<PickerOption[]>(() => boards.map((board) => ({
    id: board.id,
    label: board.title,
  })), [boards]);

  const handleSelectAccount = useCallback((accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;

    setYougileContext({
      accountId,
      projectId: null,
      projectName: null,
      boardId: null,
      boardName: null,
    });
    selectTask(null);
    void fetchProjects();
    return 'project';
  }, [accounts, fetchProjects, selectTask, setYougileContext]);

  const handleSelectProject = useCallback((projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    setYougileContext({
      projectId,
      projectName: project.title,
      boardId: null,
      boardName: null,
    });
    selectTask(null);
    void Promise.all([fetchBoards(projectId), fetchUsers(projectId)]);
    return 'board';
  }, [fetchBoards, fetchUsers, projects, selectTask, setYougileContext]);

  const handleSelectBoard = useCallback((boardId: string) => {
    const board = boards.find((item) => item.id === boardId);
    if (!board) return;

    setYougileContext({ boardId, boardName: board.title });
    setActiveSource('yougile');
    selectTask(null);
    void fetchColumns(boardId).then(() => {
      void fetchTasks();
    });
    return 'task-view';
  }, [boards, fetchColumns, fetchTasks, selectTask, setActiveSource, setYougileContext]);

  if (!yougileEnabled || activeSource !== 'yougile') return null;

  if (accounts.length === 0) {
    return (
      <div className="flex h-9 items-center justify-between border-b border-zinc-800/40 bg-[#141414] px-4">
        <span className="text-xs text-zinc-500">No Yougile accounts connected.</span>
        <button
          type="button"
          onClick={() => void invoke('open_settings_window')}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-cyan-400 hover:bg-zinc-800"
        >
          <Settings className="h-3 w-3" />
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div
      data-yougile-breadcrumb
      className="flex h-9 items-center justify-between gap-3 border-b border-zinc-800/40 bg-[#141414] px-4 text-xs text-zinc-500"
    >
      <div className="flex items-center gap-1">
        <BreadcrumbSegment
          region="org"
          index={0}
          label="Org"
          value={activeAccount?.companyName ?? 'Select org'}
          selectedId={yougileContext.accountId}
          options={accountOptions}
          isOpen={openPicker === 'org'}
          onOpen={() => setOpenPicker('org')}
          onClose={closePicker}
          onSelect={handleSelectAccount}
        />

        <ChevronRight className="h-3 w-3 text-zinc-700" />

        <BreadcrumbSegment
          region="project"
          index={0}
          label="Project"
          value={yougileContext.projectName ?? 'Select project'}
          selectedId={yougileContext.projectId}
          options={projectOptions}
          isOpen={openPicker === 'project'}
          onOpen={() => setOpenPicker('project')}
          onClose={closePicker}
          onSelect={handleSelectProject}
        />

        <ChevronRight className="h-3 w-3 text-zinc-700" />

        <BreadcrumbSegment
          region="board"
          index={0}
          label="Board"
          value={yougileContext.boardName ?? 'Select board'}
          selectedId={yougileContext.boardId}
          options={boardOptions}
          isOpen={openPicker === 'board'}
          onOpen={() => setOpenPicker('board')}
          onClose={closePicker}
          onSelect={handleSelectBoard}
        />
      </div>

      <div className={`hidden items-center font-mono text-[10px] md:flex ${isContextFocused ? 'text-zinc-500' : 'text-zinc-700'}`}>
        <span>ctrl+w</span>
      </div>
    </div>
  );
}
