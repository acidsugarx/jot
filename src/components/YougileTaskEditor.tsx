import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { X, Eye, PenLine, Calendar, Clock, CheckSquare, Square, Users, ChevronDown, MessageCircle, Send, Loader2, ZoomIn, Paperclip, Image as ImageIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { formatYougileTrackedHours, getYougileTaskColorValue, YOUGILE_TASK_COLOR_OPTIONS } from '@/lib/yougile';
import { escapeHtml } from '@/lib/formatting';
import { sanitizeHtml } from '@/lib/sanitize';
import { useYougileStore } from '@/store/use-yougile-store';
import { focusEngine } from '@/lib/focus-engine';
import { useFocusable } from '@/hooks/use-focusable';
import type { YougileTask, YougileChecklist } from '@/types/yougile';

// Wrapper that registers each editor field as a focusable node for j/k navigation
function YougileEditorField({ index, onActivate, onEnter, children }: {
  index: number;
  onActivate?: () => void;
  onEnter?: () => void;
  children: (isSelected: boolean) => ReactNode;
}) {
  const { ref, isSelected } = useFocusable<HTMLDivElement>({
    pane: 'editor',
    region: 'editor',
    index,
    id: `yougile-field-${index}`,
    onActivate: () => {
      onActivate?.();
      focusEngine.getState().setMode('INSERT');
    },
    onEnter,
  });

  return (
    <div
      ref={(node) => { (ref as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
    >
      {children(isSelected)}
    </div>
  );
}

export interface YougileTaskEditorProps {
  task: YougileTask;
  onClose: () => void;
  embedded?: boolean;
}

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

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

const CHAT_IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|heic|heif|avif)(?:$|[?#])/i;

function resolveYougileFileUrl(rawPath: string): string {
  const normalized = rawPath
    .replace(/^\/?root\/#file:/i, '')
    .replace(/^\/+/, '');
  return `https://yougile.com/${normalized}`;
}

function normalizeChatHtml(html: string): string {
  // First resolve all user-data URLs
  let result = html.replace(
    /\b(src|href)="((?:\/?root\/#file:)?\/?user-data\/[^"]+)"/gi,
    (_match, attr: string, path: string) => `${attr}="${resolveYougileFileUrl(path)}"`
  );
  // Convert <a> tags that point to image files into <img> tags
  result = result.replace(
    /<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_match, href: string, _label: string) => {
      if (CHAT_IMAGE_EXT_RE.test(href)) {
        return `<img src="${href}" alt="" style="max-width:100%;max-height:12rem;border-radius:4px;cursor:pointer" />`;
      }
      return _match;
    }
  );
  return result;
}

interface ChatAttachment {
  url: string;
  fileName: string;
}

function fileNameFromAttachmentUrl(url: string): string {
  const base = url.split('?')[0]?.split('#')[0] ?? url;
  const parts = base.split('/');
  const raw = parts[parts.length - 1] || base;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function extractYougileAttachment(text: string): ChatAttachment | null {
  const match = text.match(/\/(?:root\/#file:)?\/?(user-data\/[a-f0-9-]+\/[^\s]+)/i);
  if (!match?.[1]) return null;
  const url = resolveYougileFileUrl(match[1]);
  return {
    url,
    fileName: fileNameFromAttachmentUrl(url),
  };
}

function isImageAttachmentUrl(url: string): boolean {
  return CHAT_IMAGE_EXT_RE.test(url);
}

function getAttachmentName(attachment: File | string): string {
  if (typeof attachment !== 'string') {
    return attachment.name;
  }
  const parts = attachment.split(/[\\/]/);
  return parts[parts.length - 1] || attachment;
}

function descriptionToEditorText(value: string | null | undefined): string {
  const source = value ?? '';
  if (!source) return source;

  // Always use regex-based conversion instead of DOMParser.
  // DOMParser's innerText collapses literal \n to spaces when text contains
  // angle brackets (e.g. "<script>" in template text triggers HTML parsing).
  return source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
    .replace(/<\/li>\s*<li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function editorTextToDescriptionHtml(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => (
      `<p>${paragraph.split('\n').map((line) => escapeHtml(line)).join('<br/>')}</p>`
    ))
    .join('');
}

function extractStickerValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    for (const key of ['title', 'name', 'value', 'id']) {
      const nested = candidate[key];
      if (typeof nested === 'string' && nested.trim()) {
        return nested;
      }
    }
  }
  return undefined;
}

function normalizeStickerMap(stickers: Record<string, unknown> | undefined): Record<string, string> {
  if (!stickers) return {};

  return Object.entries(stickers).reduce<Record<string, string>>((acc, [key, value]) => {
    const parsed = extractStickerValue(value);
    if (parsed) {
      acc[key] = parsed;
    }
    return acc;
  }, {});
}

function formatStickerValue(value: unknown, fallback: string): string {
  const parsed = extractStickerValue(value);
  if (parsed) {
    return parsed;
  }
  try {
    return value && typeof value === 'object' ? JSON.stringify(value) : fallback;
  } catch {
    return fallback;
  }
}

export function YougileTaskEditor({ task, onClose, embedded }: YougileTaskEditorProps) {
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
    chatMessages,
    chatLoading,
    companyUsers,
    fetchChatMessages,
    sendChatMessage,
    sendChatWithAttachments,
    fetchCompanyUsers,
  } = useYougileStore();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(descriptionToEditorText(task.description));
  const [descPreview, setDescPreview] = useState(false);
  const [columnId, setColumnId] = useState(task.columnId ?? '');
  const [deadlineValue, setDeadlineValue] = useState(
    unixMsToDateInput(task.deadline?.deadline ?? null)
  );
  const [checklists, setChecklists] = useState<YougileChecklist[]>(
    task.checklists ? structuredClone(task.checklists) : []
  );
  const [color, setColor] = useState(task.color ?? 'task-primary');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(task.assigned);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [stickerValues, setStickerValues] = useState<Record<string, string>>(
    normalizeStickerMap(task.stickers)
  );

  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Array<File | string>>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const columnSelectRef = useRef<HTMLSelectElement>(null);
  const deadlineInputRef = useRef<HTMLInputElement>(null);
  const taskId = task.id;

  // Fetch chat when opening the chat panel
  useEffect(() => {
    if (showChat) {
      void fetchChatMessages(taskId);
      void fetchCompanyUsers();
    }
  }, [showChat, taskId, fetchChatMessages, fetchCompanyUsers]);

  // Scroll chat to bottom when messages update
  useEffect(() => {
    if (showChat) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showChat]);

  // Sync when task changes externally
  useEffect(() => {
    setTitle(task.title);
    setDescription(descriptionToEditorText(task.description));
    setColumnId(task.columnId ?? '');
    setDeadlineValue(unixMsToDateInput(task.deadline?.deadline ?? null));
    setChecklists(task.checklists ? structuredClone(task.checklists) : []);
    setColor(task.color ?? 'task-primary');
    setAssignedUserIds(task.assigned);
    setStickerValues(normalizeStickerMap(task.stickers));
    setShowAssigneePicker(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync local state on task identity change, not on every task mutation
  }, [taskId]);

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
  useEffect(() => { autoResize(descRef.current); }, [description, autoResize]);

  // Auto-focus title and switch to editor pane when editor opens
  useEffect(() => {
    requestAnimationFrame(() => {
      const engine = focusEngine.getState();
      if (engine.panes.has('editor')) {
        engine.focusPane('editor');
        engine.setMode('INSERT');
      }
      titleRef.current?.focus();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: focus on open
  }, []);

  // Wire Escape into focus engine — close editor from NORMAL mode
  useEffect(() => {
    const existing = window.__jotActions;
    window.__jotActions = {
      ...existing,
      onEscape: () => {
        const engineMode = focusEngine.getState().mode;
        if (engineMode === 'INSERT') {
          focusEngine.getState().setMode('NORMAL');
        } else {
          onClose();
        }
      },
    };
    return () => {
      // Restore previous actions without onEscape
      if (existing) {
        window.__jotActions = existing;
      } else if (window.__jotActions) {
        delete window.__jotActions;
      }
    };
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
    const current = descriptionToEditorText(task.description);
    if (val !== current) {
      void updateTask(task.id, { description: editorTextToDescriptionHtml(val) });
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

  const handleColorChange = (newColor: string) => {
    setColor(newColor);
    setShowColorPicker(false);
    void updateTask(task.id, { color: newColor });
  };

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

  const handleSendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text && pendingFiles.length === 0) return;
    setChatSending(true);
    let ok: boolean;
    if (pendingFiles.length > 0) {
      ok = await sendChatWithAttachments(taskId, text, pendingFiles);
    } else {
      ok = await sendChatMessage(taskId, text);
    }
    setChatSending(false);
    if (ok) {
      setChatInput('');
      setPendingFiles([]);
      requestAnimationFrame(() => chatInputRef.current?.focus());
    }
  }, [chatInput, pendingFiles, sendChatMessage, sendChatWithAttachments, taskId]);

  const handleDownloadFile = useCallback(async (url: string, fileName: string) => {
    try {
      const savePath = await saveFileDialog({
        title: 'Save file',
        defaultPath: fileName,
      });
      if (!savePath) return;
      await invoke('yougile_download_file', { url, savePath });
    } catch (e) {
      console.error('Download failed:', e);
    }
  }, []);

  const handlePasteImage = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      setPendingFiles((prev) => [...prev, ...imageFiles]);
    }
  }, []);

  const handlePickFiles = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        title: 'Attach files',
      });

      if (selected == null) return;

      const next = Array.isArray(selected) ? selected : [selected];
      const paths = next.filter((path): path is string => typeof path === 'string');
      if (paths.length > 0) {
        setPendingFiles((prev) => [...prev, ...paths]);
      }
    } catch {
      fileInputRef.current?.click();
    }
  }, []);

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
  const descriptionPreviewHtml = useMemo(() => editorTextToDescriptionHtml(description), [description]);

  const totalChecklistItems = checklists.reduce((sum, cl) => sum + cl.items.length, 0);
  const completedChecklistItems = checklists.reduce(
    (sum, cl) => sum + cl.items.filter((i) => i.completed).length,
    0
  );

  return (
    <div
      className={`flex h-full shrink-0 flex-col bg-[#141414] ${
        embedded ? 'w-full' : 'w-[360px] border-l border-zinc-800/40'
      }`}
    >
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-zinc-800/40 px-4">
        <div className="flex items-center gap-2">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: getYougileTaskColorValue(colorOption.value) ?? '#7B869E' }}
          />
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
      <div className="flex-1 overflow-y-auto" data-editor>

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
                    descRef.current?.focus();
                  }
                }}
                rows={1}
                className="w-full resize-none overflow-hidden bg-transparent text-sm font-medium leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 selection:bg-cyan-500/30"
                placeholder="Task title..."
              />
            </div>
          )}
        </YougileEditorField>

        {/* Description */}
        <YougileEditorField index={1} onActivate={() => { if (!descPreview) descRef.current?.focus(); }}>
          {(isSelected) => (
            <div className={`border-b border-zinc-800/30 px-4 py-3 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
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
                  dangerouslySetInnerHTML={{ __html: descriptionPreviewHtml ?? '<p></p>' }}
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
                      (e.currentTarget.closest('[data-editor]') as HTMLElement | null)
                        ?.querySelector<HTMLElement>('[data-field="column"]')
                        ?.focus();
                    }
                  }}
                  rows={2}
                  className="w-full resize-none overflow-hidden bg-transparent text-xs leading-relaxed text-zinc-400 outline-none placeholder:text-zinc-700 selection:bg-cyan-500/30"
                  placeholder="Add a description…"
                />
              )}
            </div>
          )}
        </YougileEditorField>

        {/* Fields */}
        <div className="border-b border-zinc-800/30">
          {/* [2] Column */}
          <YougileEditorField index={2} onActivate={() => columnSelectRef.current?.focus()}>
            {(isSelected) => (
              <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Column
                </span>
                <div className="flex items-center gap-1">
                  <select
                    ref={columnSelectRef}
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
            )}
          </YougileEditorField>

          {/* [3] Completed */}
          <YougileEditorField
            index={3}
            onActivate={() => void updateTask(task.id, { completed: !task.completed })}
            onEnter={() => void updateTask(task.id, { completed: !task.completed })}
          >
            {(isSelected) => (
              <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
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
            )}
          </YougileEditorField>

          {/* [4] Deadline */}
          <YougileEditorField
            index={4}
            onActivate={() => {
              if (deadlineValue) {
                deadlineInputRef.current?.focus();
              } else {
                const today = new Date().toISOString().split('T')[0] ?? '';
                handleDeadlineChange(today);
                requestAnimationFrame(() => deadlineInputRef.current?.focus());
              }
            }}
          >
            {(isSelected) => (
              <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Deadline
                </span>
                <div className="flex items-center gap-1.5">
                  {deadlineValue ? (
                    <div className="flex items-center gap-1">
                      <input
                        ref={deadlineInputRef}
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
            )}
          </YougileEditorField>

          {/* [5] Color */}
          <YougileEditorField index={5} onActivate={() => setShowColorPicker(true)}>
            {(isSelected) => (
              <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Color
                </span>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                  >
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: getYougileTaskColorValue(colorOption.value) ?? '#7B869E' }}
                    />
                    <span className="font-mono text-[10px]">{colorOption.label}</span>
                  </button>
                  {showColorPicker && (
                    <div className="absolute right-0 top-full z-10 mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-700 bg-[#1a1a1a] p-2 shadow-xl w-[140px]">
                      {YOUGILE_TASK_COLOR_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          title={opt.label}
                          onClick={() => handleColorChange(opt.value)}
                          className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                            color === opt.value ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-[#1a1a1a]' : ''
                          }`}
                          style={{ backgroundColor: opt.hex }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </YougileEditorField>
        </div>

        {/* Assigned Users */}
        {(users.length > 0 || assignedUserIds.length > 0) && (
          <YougileEditorField index={6} onActivate={() => setShowAssigneePicker(true)}>
            {(isSelected) => (
              <div className={`border-b border-zinc-800/30 px-4 py-3 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-zinc-600" />
                    <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                      Assigned ({assignedUserIds.length})
                    </span>
                  </div>
                  {users.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAssigneePicker((open) => !open)}
                      className="rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
                    >
                      {showAssigneePicker ? 'Done' : 'Edit'}
                    </button>
                  )}
                </div>
                {assignedUserIds.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {assignedUserIds.map((userId) => {
                      const user = users.find((u) => u.id === userId);
                      return (
                        <div
                          key={userId}
                          className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1"
                        >
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-700 font-mono text-[9px] text-zinc-400">
                            {user?.realName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
                            {user?.realName ?? user?.email ?? userId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-zinc-800 px-2 py-2 font-mono text-[10px] text-zinc-700">
                    No assignees
                  </div>
                )}
                {showAssigneePicker && users.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900/40 p-1">
                    {users.map((user) => {
                      const isAssigned = assignedUserIds.includes(user.id);
                      const label = user.realName ?? user.email ?? user.id;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => handleToggleAssignee(user.id)}
                          className={`flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                            isAssigned ? 'bg-cyan-500/10 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                          }`}
                        >
                          {isAssigned ? (
                            <CheckSquare className="h-3 w-3 shrink-0 text-cyan-400" />
                          ) : (
                            <Square className="h-3 w-3 shrink-0 text-zinc-700" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </YougileEditorField>
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
                  {formatYougileTrackedHours(task.timeTracking.plan)}
                </span>
              </div>
              <div className="h-8 w-px bg-zinc-800" />
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">Logged</span>
                <span className="font-mono text-xs text-zinc-400">
                  {formatYougileTrackedHours(task.timeTracking.work)}
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
                      {formatYougileTrackedHours(
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
        {(stickerDefinitions.length > 0 || Object.keys(stickerValues).length > 0) && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Stickers
              </span>
            </div>

            {stickerDefinitions.length > 0 && (
              <div className="flex flex-col gap-2">
                {stickerDefinitions.map((sticker) => {
                  const currentValue = stickerValues[sticker.id] ?? '';
                  return (
                    <div key={sticker.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
                        {sticker.name}
                      </span>
                      {sticker.freeText ? (
                        <input
                          type="text"
                          value={currentValue}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setStickerValues((current) => {
                              const next = { ...current };
                              if (nextValue.trim()) {
                                next[sticker.id] = nextValue;
                              } else {
                                delete next[sticker.id];
                              }
                              return next;
                            });
                          }}
                          onBlur={(event) => persistStickerValue(sticker.id, event.target.value)}
                          className="w-40 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-700"
                          placeholder="Value"
                        />
                      ) : (
                        <select
                          value={currentValue}
                          onChange={(event) => persistStickerValue(sticker.id, event.target.value)}
                          className="w-40 bg-transparent text-right text-xs text-zinc-300 focus:outline-none cursor-pointer"
                        >
                          <option value="">Not set</option>
                          <option value="empty">Empty</option>
                          {sticker.states.map((state) => (
                            <option key={state.id} value={state.id}>
                              {state.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {Object.entries(stickerValues).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(stickerValues).map(([key, value]) => {
                  const resolvedState = stickerStateLookup[value];
                  const resolvedSticker = stickerDefinitionLookup[key];
                  const label = resolvedState
                    ? `${resolvedState.stickerName}: ${resolvedState.valueName}`
                    : resolvedSticker
                      ? `${resolvedSticker.name}: ${value}`
                      : formatStickerValue(value, key);

                  return (
                    <span
                      key={key}
                      className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat / Discussion */}
      {showChat && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-800/40">
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {chatLoading && chatMessages.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="py-6 text-center font-mono text-[10px] text-zinc-700">
                No messages yet
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {chatMessages.map((msg) => {
                  const user = users.find((u) => u.id === msg.fromUserId)
                    ?? companyUsers.find((u) => u.id === msg.fromUserId)
                    ?? users.find((u) => u.email === msg.fromUserId)
                    ?? companyUsers.find((u) => u.email === msg.fromUserId);
                  // Use || not ?? so empty strings fall through.
                  // Skip realName if it looks like an email address.
                  const rawName = user?.realName;
                  const realName = rawName && !rawName.includes('@') ? rawName : null;
                  const name = realName
                    || user?.email?.split('@')[0]
                    || (msg.fromUserId.includes('@') ? msg.fromUserId.split('@')[0] : null)
                    || msg.fromUserId.slice(0, 8);
                  const time = new Date(msg.id).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  let html = msg.textHtml ?? '';
                  if (html) {
                    html = sanitizeHtml(normalizeChatHtml(html));
                  }
                  const hasHtml = html && looksLikeHtml(html);
                  const attachment = !hasHtml ? extractYougileAttachment(msg.text) : null;
                  const fileMarkerIndex = attachment
                    ? msg.text.search(/\/(?:root\/#file:)?\/?user-data\//i)
                    : -1;
                  const fileLeadText = fileMarkerIndex > 0 ? msg.text.slice(0, fileMarkerIndex).trim() : '';
                  const isImageFile = attachment ? isImageAttachmentUrl(attachment.url) : false;
                  return (
                    <div key={msg.id} className="group">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[10px] font-medium text-zinc-400">
                          {name}
                        </span>
                        <span className="font-mono text-[9px] text-zinc-700">
                          {time}
                        </span>
                      </div>
                      {hasHtml ? (
                        <div
                          className="prose-jot mt-0.5 text-xs leading-relaxed text-zinc-400 [&_img]:max-w-full [&_img]:max-h-48 [&_img]:rounded [&_img]:my-1 [&_img]:cursor-pointer"
                          dangerouslySetInnerHTML={{ __html: html }}
                          onClick={(e) => {
                            const img = (e.target as HTMLElement).closest('img');
                            if (img?.src) { setPreviewImage(img.src); return; }
                            const anchor = (e.target as HTMLElement).closest('a');
                            if (anchor?.href) {
                              e.preventDefault();
                              const href = anchor.href;
                              const fileName = fileNameFromAttachmentUrl(href);
                              void handleDownloadFile(href, fileName);
                            }
                          }}
                        />
                      ) : attachment ? (
                        <div className="mt-0.5">
                          {fileLeadText && (
                            <div className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
                              {fileLeadText}
                            </div>
                          )}
                          {isImageFile ? (
                            <div className="group/img relative mt-1 inline-block">
                              <img
                                src={attachment.url}
                                alt=""
                                className="max-w-full max-h-48 rounded cursor-pointer"
                                onClick={() => setPreviewImage(attachment.url)}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                              <button
                                type="button"
                                onClick={() => setPreviewImage(attachment.url)}
                                className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover/img:opacity-100"
                              >
                                <ZoomIn className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleDownloadFile(attachment.url, attachment.fileName)}
                              className="mt-1 inline-flex items-center font-mono text-xs text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
                            >
                              {attachment.fileName}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
                          {msg.text}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
          <div className="border-t border-zinc-800/30 px-4 py-2">
            {/* Pending file previews */}
            {pendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="group relative flex items-center gap-1 rounded bg-zinc-800/60 px-2 py-1 text-[10px] text-zinc-400">
                    <ImageIcon className="h-3 w-3 shrink-0" />
                    <span className="max-w-[100px] truncate">{getAttachmentName(f)}</span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="ml-0.5 text-zinc-600 hover:text-zinc-300"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  setPendingFiles((prev) => [...prev, ...Array.from(files)]);
                }
                e.target.value = '';
              }}
            />
            <div className="flex items-end gap-2">
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onPaste={handlePasteImage}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendMessage();
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setChatInput('');
                    setShowChat(false);
                  }
                }}
                rows={1}
                placeholder="Write a message…"
                className="min-h-[28px] flex-1 resize-none rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-zinc-700"
              />
              <button
                type="button"
                onClick={() => void handlePickFiles()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
                title="Attach file"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={chatSending || (!chatInput.trim() && pendingFiles.length === 0)}
                onClick={() => void handleSendMessage()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-cyan-500/10 text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {chatSending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-zinc-800/40 px-4 py-1.5">
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
            </button>
          </div>
          {task.timestamp && (
            <span>
              {new Date(task.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Image preview overlay */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="Preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl font-light"
            onClick={() => setPreviewImage(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
