import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Eye, PenLine, Calendar, Clock, CheckSquare, Square, Users, ChevronDown } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';
import type { YougileTask, YougileChecklist } from '@/types/yougile';

export interface YougileTaskEditorProps {
  task: YougileTask;
  onClose: () => void;
}

const COLOR_OPTIONS = [
  { value: null, label: 'None', cls: 'bg-zinc-700' },
  { value: 'red', label: 'Red', cls: 'bg-red-500' },
  { value: 'orange', label: 'Orange', cls: 'bg-orange-500' },
  { value: 'yellow', label: 'Yellow', cls: 'bg-yellow-500' },
  { value: 'green', label: 'Green', cls: 'bg-green-500' },
  { value: 'blue', label: 'Blue', cls: 'bg-blue-500' },
  { value: 'purple', label: 'Purple', cls: 'bg-purple-500' },
  { value: 'pink', label: 'Pink', cls: 'bg-pink-500' },
];

function unixMsToDateInput(ms: number | null | undefined): string {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

function dateInputToUnixMs(value: string): number | undefined {
  if (!value) return undefined;
  try {
    return new Date(value + 'T00:00:00').getTime();
  } catch {
    return undefined;
  }
}

function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function renderMarkdown(text: string): string {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = html.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inList) { result.push('</ul>'); inList = false; }
      inCodeBlock = !inCodeBlock;
      result.push(inCodeBlock ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inCodeBlock) { result.push(line); continue; }

    let processed = line;

    if (processed.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<h3>${inlineFormat(processed.slice(4))}</h3>`;
    } else if (processed.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<h2>${inlineFormat(processed.slice(3))}</h2>`;
    } else if (processed.startsWith('# ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<h1>${inlineFormat(processed.slice(2))}</h1>`;
    } else if (processed.startsWith('&gt; ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<blockquote>${inlineFormat(processed.slice(5))}</blockquote>`;
    } else if (/^[-*] /.test(processed)) {
      if (!inList) { result.push('<ul>'); inList = true; }
      processed = `<li>${inlineFormat(processed.slice(2))}</li>`;
    } else if (processed.trim() === '') {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = '<br/>';
    } else {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<p>${inlineFormat(processed)}</p>`;
    }

    result.push(processed);
  }

  if (inList) result.push('</ul>');
  if (inCodeBlock) result.push('</code></pre>');
  return result.join('\n');
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function YougileTaskEditor({ task, onClose }: YougileTaskEditorProps) {
  const { updateTask, moveTask, columns, users } = useYougileStore();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [descPreview, setDescPreview] = useState(false);
  const [columnId, setColumnId] = useState(task.columnId ?? '');
  const [deadlineValue, setDeadlineValue] = useState(
    unixMsToDateInput(task.deadline?.deadline ?? null)
  );
  const [checklists, setChecklists] = useState<YougileChecklist[]>(
    task.checklists ? JSON.parse(JSON.stringify(task.checklists)) : []
  );
  const [color, setColor] = useState(task.color ?? null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const taskId = task.id;

  // Sync when task changes externally
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setColumnId(task.columnId ?? '');
    setDeadlineValue(unixMsToDateInput(task.deadline?.deadline ?? null));
    setChecklists(task.checklists ? JSON.parse(JSON.stringify(task.checklists)) : []);
    setColor(task.color ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Auto-resize textareas
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  useEffect(() => { autoResize(titleRef.current); }, [title, autoResize]);
  useEffect(() => { autoResize(descRef.current); }, [description, autoResize]);

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      void updateTask(task.id, { title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  const handleDescriptionBlur = () => {
    const val = description.trim();
    const current = task.description ?? '';
    if (val !== current) {
      void updateTask(task.id, { description: val || undefined });
    }
  };

  const handleColumnChange = (newColumnId: string) => {
    setColumnId(newColumnId);
    void moveTask(task.id, newColumnId);
  };

  const handleDeadlineChange = (value: string) => {
    setDeadlineValue(value);
    const ms = dateInputToUnixMs(value);
    void updateTask(task.id, {
      deadline: { deadline: ms, withTime: task.deadline?.withTime ?? false },
    });
  };

  const handleClearDeadline = () => {
    setDeadlineValue('');
    void updateTask(task.id, { deadline: { deadline: undefined, withTime: false } });
  };

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

  const handleColorChange = (newColor: string | null) => {
    setColor(newColor);
    setShowColorPicker(false);
    void updateTask(task.id, { color: newColor ?? undefined });
  };

  const currentColumn = columns.find((c) => c.id === columnId);
  const colorOption = COLOR_OPTIONS.find((c) => c.value === color) ?? COLOR_OPTIONS[0]!;

  const totalChecklistItems = checklists.reduce((sum, cl) => sum + cl.items.length, 0);
  const completedChecklistItems = checklists.reduce(
    (sum, cl) => sum + cl.items.filter((i) => i.completed).length,
    0
  );

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-zinc-800/40 bg-[#141414]">
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-zinc-800/40 px-4">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${colorOption.cls}`} />
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Yougile Task
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* Title */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === 'Tab') {
                e.preventDefault();
                descRef.current?.focus();
              }
            }}
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent text-sm font-medium leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 selection:bg-cyan-500/30"
            placeholder="Task title..."
          />
        </div>

        {/* Description */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Description
            </span>
            {description && (
              <button
                type="button"
                onClick={() => setDescPreview(!descPreview)}
                className="flex items-center gap-1 font-mono text-[10px] text-zinc-700 hover:text-zinc-400 transition-colors"
              >
                {descPreview ? <PenLine className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                {descPreview ? 'Edit' : 'Preview'}
              </button>
            )}
          </div>
          {descPreview ? (
            <div
              className="prose-jot min-h-[2.5rem]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }}
            />
          ) : (
            <textarea
              ref={descRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  // Tab out of description to next focusable element
                  (e.currentTarget.closest('[data-editor]') as HTMLElement | null)
                    ?.querySelector<HTMLElement>('[data-field="column"]')
                    ?.focus();
                }
              }}
              rows={2}
              className="w-full resize-none overflow-hidden bg-transparent text-xs leading-relaxed text-zinc-400 outline-none placeholder:text-zinc-700 selection:bg-cyan-500/30"
              placeholder="Add a description… (supports **bold**, *italic*, `code`)"
            />
          )}
        </div>

        {/* Fields */}
        <div className="border-b border-zinc-800/30">
          {/* Column / Status */}
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Column
            </span>
            <div className="flex items-center gap-1">
              <select
                data-field="column"
                value={columnId}
                onChange={(e) => handleColumnChange(e.target.value)}
                className="bg-transparent text-right text-sm text-zinc-300 focus:outline-none cursor-pointer"
              >
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>{col.title}</option>
                ))}
                {!currentColumn && columnId && (
                  <option value={columnId}>{columnId}</option>
                )}
              </select>
              <ChevronDown className="h-3 w-3 text-zinc-600 pointer-events-none" />
            </div>
          </div>

          {/* Completed toggle */}
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Completed
            </span>
            <button
              type="button"
              onClick={() => void updateTask(task.id, { completed: !task.completed })}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {task.completed ? (
                <CheckSquare className="h-3.5 w-3.5 text-cyan-400" />
              ) : (
                <Square className="h-3.5 w-3.5 text-zinc-600" />
              )}
              <span className="font-mono text-[10px] text-zinc-500">
                {task.completed ? 'Yes' : 'No'}
              </span>
            </button>
          </div>

          {/* Deadline */}
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Deadline
            </span>
            <div className="flex items-center gap-1.5">
              {deadlineValue ? (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={deadlineValue}
                    onChange={(e) => handleDeadlineChange(e.target.value)}
                    className="bg-transparent font-mono text-sm text-zinc-400 focus:outline-none cursor-pointer [color-scheme:dark]"
                  />
                  <button
                    type="button"
                    onClick={handleClearDeadline}
                    className="rounded p-0.5 text-zinc-700 hover:text-zinc-400 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0] ?? '';
                    handleDeadlineChange(today);
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
                >
                  <Calendar className="h-3 w-3" />
                  <span className="font-mono text-xs">Set date</span>
                </button>
              )}
            </div>
          </div>

          {/* Color */}
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Color
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              >
                <div className={`h-3 w-3 rounded-full ${colorOption.cls}`} />
                <span className="font-mono text-[10px]">{colorOption.label}</span>
              </button>
              {showColorPicker && (
                <div className="absolute right-0 top-full z-10 mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-700 bg-[#1a1a1a] p-2 shadow-xl w-[140px]">
                  {COLOR_OPTIONS.map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      title={opt.label}
                      onClick={() => handleColorChange(opt.value)}
                      className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${opt.cls} ${
                        color === opt.value ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-[#1a1a1a]' : ''
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Assigned Users */}
        {task.assigned.length > 0 && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Users className="h-3 w-3 text-zinc-600" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Assigned ({task.assigned.length})
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {task.assigned.map((userId) => {
                const user = users.find((u) => u.id === userId);
                return (
                  <div
                    key={userId}
                    className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1"
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-700 font-mono text-[9px] text-zinc-400">
                      {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
                      {user?.name ?? user?.email ?? userId}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Checklists */}
        {checklists.length > 0 && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Checklists
              </span>
              {totalChecklistItems > 0 && (
                <span className="font-mono text-[10px] text-zinc-600">
                  {completedChecklistItems}/{totalChecklistItems}
                </span>
              )}
            </div>
            {/* Progress bar */}
            {totalChecklistItems > 0 && (
              <div className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-cyan-500/60 transition-all"
                  style={{ width: `${(completedChecklistItems / totalChecklistItems) * 100}%` }}
                />
              </div>
            )}
            <div className="flex flex-col gap-3">
              {checklists.map((cl, clIdx) => (
                <div key={clIdx}>
                  {cl.title && (
                    <div className="mb-1.5 font-mono text-[10px] font-medium text-zinc-500">
                      {cl.title}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {cl.items.map((item, itemIdx) => (
                      <button
                        key={itemIdx}
                        type="button"
                        onClick={() => handleToggleChecklistItem(clIdx, itemIdx, !item.completed)}
                        className="flex items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-zinc-800/40 transition-colors"
                      >
                        {item.completed ? (
                          <CheckSquare className="mt-px h-3 w-3 shrink-0 text-cyan-400" />
                        ) : (
                          <Square className="mt-px h-3 w-3 shrink-0 text-zinc-600" />
                        )}
                        <span className={`text-xs leading-relaxed ${
                          item.completed ? 'text-zinc-600 line-through' : 'text-zinc-400'
                        }`}>
                          {item.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Time Tracking */}
        {task.timeTracking && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-zinc-600" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Time Tracking
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">Plan</span>
                <span className="font-mono text-xs text-zinc-400">
                  {formatMinutes(task.timeTracking.plan)}
                </span>
              </div>
              <div className="h-8 w-px bg-zinc-800" />
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">Logged</span>
                <span className="font-mono text-xs text-zinc-400">
                  {formatMinutes(task.timeTracking.work)}
                </span>
              </div>
              {task.timeTracking.plan != null && task.timeTracking.work != null && (
                <>
                  <div className="h-8 w-px bg-zinc-800" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">Left</span>
                    <span className={`font-mono text-xs ${
                      (task.timeTracking.work ?? 0) > (task.timeTracking.plan ?? 0)
                        ? 'text-red-400'
                        : 'text-zinc-400'
                    }`}>
                      {formatMinutes(
                        Math.max(0, (task.timeTracking.plan ?? 0) - (task.timeTracking.work ?? 0))
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Stickers / labels */}
        {task.stickers && Object.keys(task.stickers).length > 0 && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Stickers
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(task.stickers).map(([key, value]) => (
                <span
                  key={key}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                >
                  {value || key}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800/40 px-4 py-1.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-700">
          <span>{task.id.slice(0, 8)}</span>
          {task.timestamp && (
            <span>
              {new Date(task.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
