// ── Checklist Section — Yougile task checklists ────────────────────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { EditorField } from '@/components/editors/EditorField';
import { focusEngine } from '@/lib/focus-engine';
import type { YougileChecklist } from '@/types/yougile';

// ══════════════════════════════════════════════════════════════════════════════

interface ChecklistSectionProps {
  checklists: YougileChecklist[];
  checklistBaseIndex: number;
  onToggleItem: (clIdx: number, itemIdx: number, completed: boolean) => void;
  onCommitItem: (clIdx: number, itemIdx: number, text: string) => void;
}

export function ChecklistSection({
  checklists,
  checklistBaseIndex,
  onToggleItem,
  onCommitItem,
}: ChecklistSectionProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const totalItems = checklists.reduce((sum, cl) => sum + cl.items.length, 0);
  const completedItems = checklists.reduce(
    (sum, cl) => sum + cl.items.filter((i) => i.completed).length,
    0,
  );

  if (checklists.length === 0) return null;

  return (
    <div className="border-b border-zinc-800/30 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Checklists
        </span>
        {totalItems > 0 && (
          <span className="font-mono text-[10px] text-zinc-600">
            {completedItems}/{totalItems}
          </span>
        )}
      </div>
      {totalItems > 0 && (
        <div className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-cyan-500/60 transition-all"
            style={{ width: `${(completedItems / totalItems) * 100}%` }}
          />
        </div>
      )}
      <div className="flex flex-col gap-3">
        {(() => {
          let flatIndex = 0;
          return checklists.map((cl, clIdx) => (
            <div key={clIdx}>
              {cl.title && (
                <div className="mb-1.5 font-mono text-[10px] font-medium text-zinc-500">
                  {cl.title}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {cl.items.map((item, itemIdx) => {
                  const nodeIndex = checklistBaseIndex + flatIndex;
                  const nodeId = `yougile-checklist-${clIdx}-${itemIdx}`;
                  const itemKey = `${clIdx}:${itemIdx}`;
                  const isEditing = editingKey === itemKey;
                  flatIndex++;
                  return (
                    <EditorField
                      key={nodeId}
                      index={nodeIndex}
                      id={nodeId}
                      onActivate={() => {
                        setEditingKey(itemKey);
                        setEditingText(item.title);
                        focusEngine.getState().setMode('INSERT');
                      }}
                      onEnter={() => onToggleItem(clIdx, itemIdx, !item.completed)}
                    >
                      {(isSelected) => (
                        <div className={`flex items-start gap-2 rounded px-1 py-0.5 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                          <button
                            type="button"
                            onClick={() => onToggleItem(clIdx, itemIdx, !item.completed)}
                            className="mt-px shrink-0"
                          >
                            {item.completed ? (
                              <CheckSquare className="h-3 w-3 text-cyan-400" />
                            ) : (
                              <Square className="h-3 w-3 text-zinc-600" />
                            )}
                          </button>
                          {isEditing ? (
                            <input
                              autoFocus
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onBlur={() => onCommitItem(clIdx, itemIdx, editingText)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  onCommitItem(clIdx, itemIdx, editingText);
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditingKey(null);
                                  setEditingText('');
                                  focusEngine.getState().setMode('NORMAL');
                                }
                              }}
                              className="flex-1 bg-transparent text-xs leading-relaxed text-zinc-300 outline-none"
                            />
                          ) : (
                            <span className={`text-xs leading-relaxed ${
                              item.completed ? 'text-zinc-600 line-through' : 'text-zinc-400'
                            }`}>
                              {item.title || <span className="text-zinc-700 italic">empty</span>}
                            </span>
                          )}
                        </div>
                      )}
                    </EditorField>
                  );
                })}
              </div>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}
