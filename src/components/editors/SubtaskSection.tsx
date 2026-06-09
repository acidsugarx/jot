// ── Subtask Section — Yougile task subtask list ────────────────────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback } from 'react';
import { Plus, CheckSquare, Square, Trash2, ListChecks } from 'lucide-react';
import { EditorField } from '@/components/editors/EditorField';
import { focusEngine } from '@/lib/focus-engine';
import { useRegisteredNormalKeyActions } from '@/lib/focus-actions';
import type { YougileTask } from '@/types/yougile';

// ══════════════════════════════════════════════════════════════════════════════

interface SubtaskSectionProps {
  taskId: string;
  subtaskTasks: YougileTask[];
  subtaskBaseIndex: number;
  onAddSubtask: (title: string) => Promise<void>;
  onToggleSubtask: (subtask: YougileTask) => Promise<void>;
  onRemoveSubtask: (subtaskId: string) => Promise<void>;
  onUpdateTitle: (subtaskId: string, title: string) => Promise<void>;
  onNavigateToSubtask: (subtaskId: string) => void;
}

export function SubtaskSection({
  taskId,
  subtaskTasks,
  subtaskBaseIndex,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onUpdateTitle,
  onNavigateToSubtask,
}: SubtaskSectionProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<{ action: 'toggle' | 'delete'; subtaskId: string } | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle double-press confirm for toggle/delete via keyboard
  useRegisteredNormalKeyActions(`subtask-section:${taskId}`, {
    onToggleDone: () => {
      // 'x' on subtask — double-press to confirm toggle
      const el = document.activeElement;
      if (!el || !el.closest('[data-subtask-section]')) return;
      const subtaskEl = el.closest('[data-subtask-item]');
      if (!subtaskEl) return;
      const subtaskId = subtaskEl.getAttribute('data-subtask-id');
      if (!subtaskId) return;
      const subtask = subtaskTasks.find((t) => t.id === subtaskId);
      if (!subtask) return;

      if (pendingConfirm?.action === 'toggle' && pendingConfirm.subtaskId === subtaskId) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        setPendingConfirm(null);
        void onToggleSubtask(subtask);
      } else {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        setPendingConfirm({ action: 'toggle', subtaskId });
        pendingTimerRef.current = setTimeout(() => {
          setPendingConfirm(null);
          pendingTimerRef.current = null;
        }, 3000);
      }
    },
    onDelete: () => {
      // 'd' on subtask — double-press to confirm delete
      const el = document.activeElement;
      if (!el || !el.closest('[data-subtask-section]')) return;
      const subtaskEl = el.closest('[data-subtask-item]');
      if (!subtaskEl) return;
      const subtaskId = subtaskEl.getAttribute('data-subtask-id');
      if (!subtaskId) return;

      if (pendingConfirm?.action === 'delete' && pendingConfirm.subtaskId === subtaskId) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        setPendingConfirm(null);
        void onRemoveSubtask(subtaskId);
      } else {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        setPendingConfirm({ action: 'delete', subtaskId });
        pendingTimerRef.current = setTimeout(() => {
          setPendingConfirm(null);
          pendingTimerRef.current = null;
        }, 3000);
      }
    },
  });

  const handleAdd = useCallback(async () => {
    const title = newSubtaskTitle.trim();
    if (!title) return;
    await onAddSubtask(title);
    setNewSubtaskTitle('');
  }, [newSubtaskTitle, onAddSubtask]);

  const handleCommitTitle = useCallback(async (subtaskId: string, text: string) => {
    const trimmed = text.trim();
    setEditingId(null);
    setEditingTitle('');
    focusEngine.getState().setMode('NORMAL');
    if (!trimmed) return;
    await onUpdateTitle(subtaskId, trimmed);
  }, [onUpdateTitle]);

  return (
    <div className="border-b border-zinc-800/30 px-4 py-3" data-subtask-section>
      <div className="mb-2 flex items-center gap-1.5">
        <ListChecks className="h-3 w-3 text-zinc-600" />
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Subtasks
        </span>
        {subtaskTasks.length > 0 && (
          <span className="font-mono text-[10px] text-zinc-700">
            {subtaskTasks.filter((t) => t.completed).length}/{subtaskTasks.length}
          </span>
        )}
      </div>

      {/* Subtask items */}
      {subtaskTasks.map((subtask, subtaskIdx) => {
        const nodeIndex = subtaskBaseIndex + 1 + subtaskIdx;
        const nodeId = `yougile-subtask-item-${subtask.id}`;
        const isEditing = editingId === subtask.id;
        return (
          <EditorField
            key={nodeId}
            index={nodeIndex}
            id={nodeId}
            onActivate={() => {
              setEditingId(subtask.id);
              setEditingTitle(subtask.title);
              focusEngine.getState().setMode('INSERT');
            }}
            onEnter={() => void onNavigateToSubtask(subtask.id)}
          >
            {(isSelected) => (
              <div
                className={`group/sub flex items-center gap-2 rounded px-1 py-0.5 transition-shadow duration-150 ${
                  pendingConfirm?.subtaskId === subtask.id
                    ? 'ring-1 ring-inset ring-amber-500/40 bg-amber-500/5'
                    : isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''
                }`}
                data-subtask-item
                data-subtask-id={subtask.id}
              >
                {pendingConfirm?.subtaskId === subtask.id && (
                  <span className="text-[9px] font-mono text-amber-400 shrink-0">
                    {pendingConfirm.action === 'toggle' ? 'x?' : 'd?'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void onToggleSubtask(subtask)}
                  className="mt-px shrink-0"
                >
                  {subtask.completed ? (
                    <CheckSquare className="h-3 w-3 text-cyan-400" />
                  ) : (
                    <Square className="h-3 w-3 text-zinc-600" />
                  )}
                </button>
                {isEditing ? (
                  <input
                    autoFocus
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => void handleCommitTitle(subtask.id, editingTitle)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCommitTitle(subtask.id, editingTitle);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingId(null);
                        setEditingTitle('');
                        focusEngine.getState().setMode('NORMAL');
                      }
                    }}
                    className="flex-1 bg-transparent text-xs leading-relaxed text-zinc-300 outline-none"
                  />
                ) : (
                  <span
                    className={`flex-1 text-xs leading-relaxed cursor-pointer ${
                      subtask.completed ? 'text-zinc-600 line-through' : 'text-zinc-300'
                    } hover:text-cyan-400 transition-colors`}
                    onClick={() => void onNavigateToSubtask(subtask.id)}
                  >
                    {subtask.title}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void onRemoveSubtask(subtask.id)}
                  className="rounded p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover/sub:opacity-100"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
          </EditorField>
        );
      })}

      {/* Add subtask input */}
      <EditorField
        index={subtaskBaseIndex}
        id="yougile-subtask-add"
        onActivate={() => {
          focusEngine.getState().setMode('INSERT');
          requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>('[data-subtask-add-input]')?.focus();
          });
        }}
      >
        {(isSelected) => (
          <div className={`flex items-center gap-1.5 px-1 py-0.5 rounded transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
            <Plus className="h-3 w-3 text-zinc-700" />
            <input
              type="text"
              data-subtask-add-input
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAdd();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setNewSubtaskTitle('');
                  focusEngine.getState().setMode('NORMAL');
                }
              }}
              placeholder="Add subtask..."
              className="h-5 flex-1 bg-transparent text-xs text-zinc-400 placeholder:text-zinc-600 outline-none"
            />
          </div>
        )}
      </EditorField>
    </div>
  );
}
