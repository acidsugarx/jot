import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { X, Calendar, Clock, CheckSquare, Square, Users, ChevronDown, MessageCircle, Send, Loader2, ZoomIn, Paperclip, Image as ImageIcon, Bold, Italic, Strikethrough, Link, List, ListOrdered, Code, ArrowLeft, Plus, Trash2, ListChecks, Underline, Indent, Outdent } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { useRegisteredNormalKeyActions } from '@/lib/focus-actions';
import { todayDateInput } from '@/lib/formatting';
import { formatYougileTrackedHours, getYougileTaskColorValue, YOUGILE_TASK_COLOR_OPTIONS } from '@/lib/yougile';
import { sanitizeHtml } from '@/lib/sanitize';
import { useYougileStore } from '@/store/use-yougile-store';
import { focusEngine } from '@/lib/focus-engine';
import { useFocusable } from '@/hooks/use-focusable';
import type { YougileTask, YougileChecklist } from '@/types/yougile';

// Wrapper that registers each editor field as a focusable node for j/k navigation
function YougileEditorField({ index, id: idProp, onActivate, onEnter, children }: {
  index: number;
  id?: string;
  onActivate?: () => void;
  onEnter?: () => void;
  children: (isSelected: boolean) => ReactNode;
}) {
  const { ref, isSelected } = useFocusable<HTMLDivElement>({
    pane: 'editor',
    region: 'editor',
    index,
    id: idProp ?? `yougile-field-${index}`,
    onActivate: () => {
      onActivate?.();
      focusEngine.getState().setMode('INSERT');
    },
    onEnter,
  });

  return (
    <div
      ref={ref}
    >
      {children(isSelected)}
    </div>
  );
}

function ToolbarBtn({ icon: Icon, title, onMouseDown }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(e); }}
      className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

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

function cloneChecklists(checklists: YougileChecklist[] | undefined): YougileChecklist[] {
  return checklists ? structuredClone(checklists) : [];
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
    chatMessages,
    chatLoading,
    companyUsers,
    fetchChatMessages,
    sendChatMessage,
    sendChatWithAttachments,
    fetchCompanyUsers,
    tasks: yougileTasks,
    fetchSubtaskTasks,
    createSubtask,
    removeSubtask,
    toggleSubtask,
  } = useYougileStore();

  const [title, setTitle] = useState(task.title);
  const [descHtml, setDescHtml] = useState(task.description ?? '');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkDraft, setLinkDraft] = useState('https://');
  const descEditorRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const pendingLinkRangeRef = useRef<Range | null>(null);
  const [columnId, setColumnId] = useState(task.columnId ?? '');
  const [deadlineValue, setDeadlineValue] = useState(
    unixMsToDateInput(task.deadline?.deadline ?? null)
  );
  const [checklists, setChecklists] = useState<YougileChecklist[]>(() => cloneChecklists(task.checklists));
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [pendingSubtaskConfirm, setPendingSubtaskConfirm] = useState<{ action: 'toggle' | 'delete'; subtaskId: string } | null>(null);
  const pendingSubtaskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const columnSelectRef = useRef<HTMLSelectElement>(null);
  const deadlineInputRef = useRef<HTMLInputElement>(null);
  const stickerRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement | null>>(new Map());
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const assigneeButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const lastTaskChecklistsRef = useRef(task.checklists);
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

  const syncDescriptionFromTask = useCallback((rawDescription: string) => {
    setDescHtml(rawDescription);

    const editor = descEditorRef.current;
    if (!editor || editor.contains(document.activeElement)) {
      return;
    }

    const nextHtml = sanitizeHtml(rawDescription) || '<p><br></p>';
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
  }, []);

  // Sync when task identity changes externally
  useEffect(() => {
    setTitle(task.title);
    syncDescriptionFromTask(task.description ?? '');
    setColumnId(task.columnId ?? '');
    setDeadlineValue(unixMsToDateInput(task.deadline?.deadline ?? null));
    setChecklists(cloneChecklists(task.checklists));
    lastTaskChecklistsRef.current = task.checklists;
    setColor(task.color ?? 'task-primary');
    setAssignedUserIds(task.assigned);
    setStickerValues(normalizeStickerMap(task.stickers));
    setShowAssigneePicker(false);
    setShowLinkInput(false);
    setLinkDraft('https://');
    pendingLinkRangeRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reset local editor state only when task identity changes
  }, [syncDescriptionFromTask, taskId]);

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
    onNewItem: () => {
      const { activePane, activeRegion, activeIndex, nodes } = focusEngine.getState();
      if (!activePane || !activeRegion) return;
      const key = `${activePane}:${activeRegion}`;
      const nodeList = nodes.get(key) ?? [];
      const activeNode = nodeList[activeIndex];
      if (!activeNode) return;

      // Subtask: 'o' on a subtask item or add-subtask field → focus add-subtask input
      if (activeNode.id.startsWith('yougile-subtask-')) {
        setNewSubtaskTitle('');
        focusEngine.getState().setMode('INSERT');
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLInputElement>('[data-subtask-add-input]');
          input?.focus();
        });
        return;
      }

      // Checklist: 'o' on a checklist item → add new item
      if (activeNode.id.startsWith('yougile-checklist-')) {
        const parts = activeNode.id.split('-');
        const clIdx = parseInt(parts[2] ?? '', 10);
        if (Number.isNaN(clIdx) || clIdx < 0 || clIdx >= checklists.length) return;

        const targetChecklist = checklists[clIdx];
        if (!targetChecklist) return;

        const newItemIdx = targetChecklist.items.length;
        const updated = checklists.map((checklist, checklistIndex) => (
          checklistIndex === clIdx
            ? { ...checklist, items: [...checklist.items, { title: '', completed: false }] }
            : checklist
        ));
        setChecklists(updated);
        void updateTask(task.id, { checklists: updated });

        const newKey = `${clIdx}:${newItemIdx}`;
        setEditingItemKey(newKey);
        setEditingItemText('');
        focusEngine.getState().setMode('INSERT');
      }
    },
    onToggleDone: () => {
      const { activePane, activeRegion, activeIndex, nodes } = focusEngine.getState();
      if (!activePane || !activeRegion) return;
      const key = `${activePane}:${activeRegion}`;
      const nodeList = nodes.get(key) ?? [];
      const activeNode = nodeList[activeIndex];
      if (!activeNode) return;

      // 'x' on a subtask item → toggle completion (double-press to confirm)
      if (activeNode.id.startsWith('yougile-subtask-item-')) {
        const subtaskId = activeNode.id.replace('yougile-subtask-item-', '');
        const subtask = subtaskTasks.find((t) => t.id === subtaskId);
        if (subtask) {
          if (pendingSubtaskConfirm?.action === 'toggle' && pendingSubtaskConfirm.subtaskId === subtaskId) {
            if (pendingSubtaskTimerRef.current) clearTimeout(pendingSubtaskTimerRef.current);
            setPendingSubtaskConfirm(null);
            void handleToggleSubtask(subtask);
          } else {
            if (pendingSubtaskTimerRef.current) clearTimeout(pendingSubtaskTimerRef.current);
            setPendingSubtaskConfirm({ action: 'toggle', subtaskId });
            pendingSubtaskTimerRef.current = setTimeout(() => {
              setPendingSubtaskConfirm(null);
              pendingSubtaskTimerRef.current = null;
            }, 3000);
          }
        }
      }
    },
    onDelete: () => {
      const { activePane, activeRegion, activeIndex, nodes } = focusEngine.getState();
      if (!activePane || !activeRegion) return;
      const key = `${activePane}:${activeRegion}`;
      const nodeList = nodes.get(key) ?? [];
      const activeNode = nodeList[activeIndex];
      if (!activeNode) return;

      // 'd' on a subtask item → remove from parent (double-press to confirm)
      if (activeNode.id.startsWith('yougile-subtask-item-')) {
        const subtaskId = activeNode.id.replace('yougile-subtask-item-', '');
        if (pendingSubtaskConfirm?.action === 'delete' && pendingSubtaskConfirm.subtaskId === subtaskId) {
          if (pendingSubtaskTimerRef.current) clearTimeout(pendingSubtaskTimerRef.current);
          setPendingSubtaskConfirm(null);
          void handleRemoveSubtask(subtaskId);
        } else {
          if (pendingSubtaskTimerRef.current) clearTimeout(pendingSubtaskTimerRef.current);
          setPendingSubtaskConfirm({ action: 'delete', subtaskId });
          pendingSubtaskTimerRef.current = setTimeout(() => {
            setPendingSubtaskConfirm(null);
            pendingSubtaskTimerRef.current = null;
          }, 3000);
        }
      }
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

  const handleDescriptionBlur = useCallback(() => {
    const el = descEditorRef.current;
    if (!el) return;
    const newHtml = el.innerHTML.trim();
    if (newHtml !== (task.description ?? '').trim()) {
      setDescHtml(newHtml);
      void updateTask(task.id, { description: newHtml || undefined });
    }
  }, [task.id, task.description, updateTask]);

  const execFormatCommand = useCallback((command: string, value?: string) => {
    descEditorRef.current?.focus();
    document.execCommand(command, false, value);
  }, []);

  const insertCheckbox = useCallback(() => {
    descEditorRef.current?.focus();
    // Yougile CKEditor 5 compatible checkbox HTML (without-description variant)
    document.execCommand(
      'insertHTML',
      false,
      '<ul class="todo-list"><li><span class="todo-list__label todo-list__label_without-description"><span contenteditable="false"><input type="checkbox" tabindex="-1"></span></span><p> </p></li></ul>&nbsp;'
    );
  }, []);

  const openLinkInput = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    pendingLinkRangeRef.current = sel.getRangeAt(0).cloneRange();
    const selectedText = sel.toString().trim();
    setLinkDraft(/^https?:\/\//i.test(selectedText) ? selectedText : 'https://');
    setShowLinkInput(true);
    requestAnimationFrame(() => linkInputRef.current?.focus());
  }, []);

  const applyLink = useCallback(() => {
    const href = linkDraft.trim();
    if (!href) {
      setShowLinkInput(false);
      return;
    }

    let parsedHref: URL;
    try {
      parsedHref = new URL(href);
    } catch {
      return;
    }

    if (!/^https?:$/i.test(parsedHref.protocol)) {
      return;
    }

    const selection = window.getSelection();
    const pendingRange = pendingLinkRangeRef.current;
    if (selection && pendingRange) {
      selection.removeAllRanges();
      selection.addRange(pendingRange);
    }

    descEditorRef.current?.focus();
    if (selection?.rangeCount && !selection.isCollapsed) {
      document.execCommand('createLink', false, parsedHref.toString());
    } else {
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${parsedHref.toString()}">${parsedHref.toString()}</a>`,
      );
    }

    setShowLinkInput(false);
    setLinkDraft('https://');
    pendingLinkRangeRef.current = null;
  }, [linkDraft]);

  const handleDescriptionKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;

    // Ctrl+B bold
    if (mod && e.key === 'b') { e.preventDefault(); execFormatCommand('bold'); return; }
    // Ctrl+I italic
    if (mod && e.key === 'i') { e.preventDefault(); execFormatCommand('italic'); return; }
    // Ctrl+U underline
    if (mod && e.key === 'u') { e.preventDefault(); execFormatCommand('underline'); return; }
    // Ctrl+Shift+S strikethrough
    if (mod && e.shiftKey && e.key === 'S') { e.preventDefault(); execFormatCommand('strikeThrough'); return; }
    // Ctrl+K insert link
    if (mod && e.key === 'k') { e.preventDefault(); openLinkInput(); return; }
    // Ctrl+Shift+C insert checkbox
    if (mod && e.shiftKey && e.key === 'C') { e.preventDefault(); insertCheckbox(); return; }
    // Tab indent
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); execFormatCommand('indent'); return; }
    // Shift+Tab outdent
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); execFormatCommand('outdent'); return; }

    // Enter inside a checkbox line → create new checkbox
    if (e.key === 'Enter' && !e.shiftKey) {
      // Check for Yougile CKEditor todo-list format (both with/without description variants)
      const todoItem = (e.target as HTMLElement).closest?.('.todo-list__label, .todo-list__label_without-description');
      if (todoItem) {
        e.preventDefault();
        document.execCommand(
          'insertHTML', false,
          '</span></p></li><li><span class="todo-list__label todo-list__label_without-description"><span contenteditable="false"><input type="checkbox" tabindex="-1"></span></span><p>'
        );
        return;
      }
      // Also handle when cursor is in the <p> sibling of a checkbox
      const liParent = (e.target as HTMLElement).closest?.('ul.todo-list > li');
      if (liParent && liParent.querySelector('input[type="checkbox"]')) {
        e.preventDefault();
        document.execCommand(
          'insertHTML', false,
          '</p></li><li><span class="todo-list__label todo-list__label_without-description"><span contenteditable="false"><input type="checkbox" tabindex="-1"></span></span><p>'
        );
      }
    }
  }, [execFormatCommand, insertCheckbox, openLinkInput]);

  const handleSmartPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    // First try HTML paste (preserves formatting from other task descriptions)
    const html = e.clipboardData?.getData('text/html');
    if (html) {
      e.preventDefault();
      const sanitized = sanitizeHtml(html);
      document.execCommand('insertHTML', false, sanitized);
      // Update descHtml immediately so React's next render doesn't overwrite pasted content
      requestAnimationFrame(() => {
        const current = descEditorRef.current?.innerHTML ?? '';
        setDescHtml(current);
      });
      return;
    }

    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;

    e.preventDefault();

    // Auto-detect URLs in pasted text → wrap in <a> tags
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    const hasUrls = urlRegex.test(text);

    if (hasUrls) {
      // Reset regex state (lastIndex)
      const matches = text.match(/(https?:\/\/[^\s<]+)/g) ?? [];
      let result = text;
      for (const url of matches) {
        const escaped = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        result = result.replace(url, `<a href="${escaped}">${escaped}</a>`);
      }
      document.execCommand('insertHTML', false, result);
    } else {
      // Plain text — insert as-is (escapes handled by browser)
      document.execCommand('insertText', false, text);
    }
  }, []);

  useEffect(() => {
    const rawDescription = task.description ?? '';
    if ((descEditorRef.current?.contains(document.activeElement) ?? false) || descHtml === rawDescription) {
      return;
    }

    syncDescriptionFromTask(rawDescription);
  }, [descHtml, syncDescriptionFromTask, task.description]);

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
      setEditingItemKey(null);
      setEditingItemText('');
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
    setEditingItemKey(null);
    setEditingItemText('');
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

  const handleAddSubtask = useCallback(async () => {
    const title = newSubtaskTitle.trim();
    if (!title) return;
    const result = await createSubtask(task.id, title);
    if (result) {
      setNewSubtaskTitle('');
      refreshSubtasks();
    }
  }, [newSubtaskTitle, task.id, createSubtask, refreshSubtasks]);

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
    setEditingSubtaskId(null);
    setEditingSubtaskTitle('');
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

  const focusAssigneeByOffset = useCallback((userId: string, delta: -1 | 1) => {
    const ids = users.map((user) => user.id);
    const currentIndex = ids.indexOf(userId);
    if (currentIndex < 0) return;
    const nextIndex = Math.max(0, Math.min(ids.length - 1, currentIndex + delta));
    const nextId = ids[nextIndex];
    if (!nextId) return;
    assigneeButtonRefs.current.get(nextId)?.focus();
  }, [users]);

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
  // Sanitized HTML for initial render into contentEditable
  const descSanitizedHtml = useMemo(
    () => sanitizeHtml(descHtml),
    [descHtml]
  );

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

  const totalChecklistItems = checklists.reduce((sum, cl) => sum + cl.items.length, 0);
  const completedChecklistItems = checklists.reduce(
    (sum, cl) => sum + cl.items.filter((i) => i.completed).length,
    0
  );

  return (
    <div
      className={`flex flex-col bg-[#141414] ${
        embedded ? 'w-full min-h-0 flex-1 overflow-hidden' : 'h-full shrink-0 w-[360px] border-l border-zinc-800/40'
      }`}
    >
      {/* Header */}
      <div className="shrink-0 flex h-11 items-center justify-between border-b border-zinc-800/40 px-4">
        <div className="flex items-center gap-2 min-w-0">
          {onNavigateBack && (
            <button
              type="button"
              onClick={onNavigateBack}
              className="shrink-0 rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              title={`Back to ${parentTask?.title ?? 'parent'}`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <div
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: getYougileTaskColorValue(colorOption.value) ?? '#7B869E' }}
          />
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600 truncate">
            {parentTask ? 'Subtask' : 'Yougile Task'}
          </span>
          {parentTask && (
            <span className="font-mono text-[10px] text-zinc-700 truncate">
              of {parentTask.title}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

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
                    descEditorRef.current?.focus();
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
        <YougileEditorField index={1} onActivate={() => descEditorRef.current?.focus()}>
          {(isSelected) => (
            <div className={`border-b border-zinc-800/30 px-4 py-3 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Description
                </span>
                {/* Formatting toolbar */}
                <div className="flex items-center gap-px rounded-md border border-zinc-800/50 bg-zinc-900/40 px-1.5 py-0.5">
                  <ToolbarBtn icon={Bold} title="Bold (Ctrl+B)" onMouseDown={() => execFormatCommand('bold')} />
                  <ToolbarBtn icon={Italic} title="Italic (Ctrl+I)" onMouseDown={() => execFormatCommand('italic')} />
                  <ToolbarBtn icon={Underline} title="Underline (Ctrl+U)" onMouseDown={() => execFormatCommand('underline')} />
                  <ToolbarBtn icon={Strikethrough} title="Strikethrough (Ctrl+Shift+S)" onMouseDown={() => execFormatCommand('strikeThrough')} />
                  <div className="mx-0.5 h-3 w-px border-l border-zinc-800/40" />
                  <ToolbarBtn icon={Link} title="Link (Ctrl+K)" onMouseDown={() => openLinkInput()} />
                  <ToolbarBtn icon={List} title="Bullet list" onMouseDown={() => execFormatCommand('insertUnorderedList')} />
                  <ToolbarBtn icon={ListOrdered} title="Numbered list" onMouseDown={() => execFormatCommand('insertOrderedList')} />
                  <ToolbarBtn icon={Outdent} title="Outdent (Shift+Tab)" onMouseDown={() => execFormatCommand('outdent')} />
                  <ToolbarBtn icon={Indent} title="Indent (Tab)" onMouseDown={() => execFormatCommand('indent')} />
                  <div className="mx-0.5 h-3 w-px border-l border-zinc-800/40" />
                  <ToolbarBtn icon={Code} title="Code (Ctrl+Shift+`)" onMouseDown={() => execFormatCommand('formatBlock', 'pre')} />
                  <ToolbarBtn icon={CheckSquare} title="Checkbox (Ctrl+Shift+C)" onMouseDown={() => insertCheckbox()} />
                </div>
              </div>
              <div
                ref={descEditorRef}
                contentEditable
                suppressContentEditableWarning
                className="prose-jot prose-jot-yougile prose-jot-editor min-h-[2.5rem] cursor-text outline-none"
                dangerouslySetInnerHTML={{ __html: descSanitizedHtml || '<p><br></p>' }}
                onBlur={handleDescriptionBlur}
                onKeyDown={handleDescriptionKeyDown}
                onPaste={handleSmartPaste}
                onClick={(e) => {
                  // Checkbox toggle (Yougile CKEditor format — both variants)
                  // The checkbox is inside <span contenteditable="false"> so the click
                  // target might be the wrapper span, not the input itself.
                  const target = e.target as HTMLElement;
                  let checkbox: HTMLInputElement | null = null;
                  if (target instanceof HTMLInputElement && target.type === 'checkbox') {
                    checkbox = target;
                  } else {
                    // Check if clicked on the contenteditable=false wrapper around checkbox
                    const wrapper = target.closest('span[contenteditable="false"]');
                    if (wrapper) {
                      checkbox = wrapper.querySelector('input[type="checkbox"]');
                    }
                    if (!checkbox) {
                      checkbox = target.closest('input[type="checkbox"]');
                    }
                  }
                  if (checkbox) {
                    e.preventDefault();
                    checkbox.checked = !checkbox.checked;
                    if (checkbox.checked) {
                      checkbox.setAttribute('checked', 'checked');
                    } else {
                      checkbox.removeAttribute('checked');
                    }
                    // Mark the parent <li> with a data attribute for CSS styling
                    const li = checkbox.closest('li');
                    if (li) {
                      li.dataset.checked = checkbox.checked ? 'true' : 'false';
                    }
                    return;
                  }
                  // Link → open in browser
                  const anchor = (e.target as HTMLElement).closest('a');
                  if (anchor?.href) {
                    e.preventDefault();
                    void invoke('open_url', { url: anchor.href });
                  }
                }}
                data-placeholder="Add a description…"
                spellCheck={false}
              />
              {showLinkInput && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                  <input
                    ref={linkInputRef}
                    type="url"
                    value={linkDraft}
                    onChange={(event) => setLinkDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        applyLink();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setShowLinkInput(false);
                        setLinkDraft('https://');
                        pendingLinkRangeRef.current = null;
                        descEditorRef.current?.focus();
                      }
                    }}
                    placeholder="https://example.com"
                    className="flex-1 rounded border border-zinc-800 bg-black/20 px-2 py-1 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={applyLink}
                    className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200"
                  >
                    Apply
                  </button>
                </div>
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
                     onKeyDown={(event) => {
                       const optionValues = columns.map((col) => col.id);
                       if (!optionValues.includes(columnId) && columnId) {
                         optionValues.push(columnId);
                       }
                       handleVimSelectKeyDown(event, optionValues, columnId, handleColumnChange);
                     }}
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
                const today = todayDateInput();
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
                        const today = todayDateInput();
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
          <YougileEditorField
            index={5}
            onActivate={() => {
              setShowColorPicker(true);
              requestAnimationFrame(() => colorButtonRef.current?.focus());
            }}
          >
            {(isSelected) => (
              <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Color
                </span>
                <div className="relative">
                  <button
                    ref={colorButtonRef}
                    type="button"
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    onKeyDown={(event) => {
                      if (event.key === 'j' || event.key === 'l') {
                        event.preventDefault();
                        cycleColor(1);
                        return;
                      }
                      if (event.key === 'k' || event.key === 'h') {
                        event.preventDefault();
                        cycleColor(-1);
                      }
                    }}
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
          <YougileEditorField
            index={6}
            onActivate={() => {
              setShowAssigneePicker(true);
              requestAnimationFrame(() => {
                const firstId = users[0]?.id;
                if (firstId) {
                  assigneeButtonRefs.current.get(firstId)?.focus();
                }
              });
            }}
          >
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
                          ref={(el) => {
                            if (el) {
                              assigneeButtonRefs.current.set(user.id, el);
                            } else {
                              assigneeButtonRefs.current.delete(user.id);
                            }
                          }}
                          type="button"
                          onClick={() => handleToggleAssignee(user.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'j' || event.key === 'l') {
                              event.preventDefault();
                              focusAssigneeByOffset(user.id, 1);
                              return;
                            }
                            if (event.key === 'k' || event.key === 'h') {
                              event.preventDefault();
                              focusAssigneeByOffset(user.id, -1);
                              return;
                            }
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleToggleAssignee(user.id);
                            }
                          }}
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
            {totalChecklistItems > 0 && (
              <div className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-cyan-500/60 transition-all"
                  style={{ width: `${(completedChecklistItems / totalChecklistItems) * 100}%` }}
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
                        const isEditing = editingItemKey === itemKey;
                        flatIndex++;
                        return (
                          <YougileEditorField
                            key={nodeId}
                            index={nodeIndex}
                            id={nodeId}
                            onActivate={() => {
                              setEditingItemKey(itemKey);
                              setEditingItemText(item.title);
                              focusEngine.getState().setMode('INSERT');
                            }}
                            onEnter={() => handleToggleChecklistItem(clIdx, itemIdx, !item.completed)}
                          >
                            {(isSelected) => (
                              <div className={`flex items-start gap-2 rounded px-1 py-0.5 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                                <button
                                  type="button"
                                  onClick={() => handleToggleChecklistItem(clIdx, itemIdx, !item.completed)}
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
                                    value={editingItemText}
                                    onChange={(e) => setEditingItemText(e.target.value)}
                                    onBlur={() => commitEditingItem(clIdx, itemIdx, editingItemText)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        commitEditingItem(clIdx, itemIdx, editingItemText);
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setEditingItemKey(null);
                                        setEditingItemText('');
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
                          </YougileEditorField>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* Subtasks */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
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

          {/* Subtask items — each wrapped in YougileEditorField for j/k navigation */}
          {subtaskTasks.map((subtask, subtaskIdx) => {
            const nodeIndex = subtaskBaseIndex + 1 + subtaskIdx;
            const nodeId = `yougile-subtask-item-${subtask.id}`;
            const isEditingSubtask = editingSubtaskId === subtask.id;
            return (
              <YougileEditorField
                key={nodeId}
                index={nodeIndex}
                id={nodeId}
                onActivate={() => {
                  setEditingSubtaskId(subtask.id);
                  setEditingSubtaskTitle(subtask.title);
                  focusEngine.getState().setMode('INSERT');
                }}
                onEnter={() => void onNavigateToSubtask(subtask.id)}
              >
                {(isSelected) => (
                  <div className={`group/sub flex items-center gap-2 rounded px-1 py-0.5 transition-shadow duration-150 ${
                    pendingSubtaskConfirm?.subtaskId === subtask.id
                      ? 'ring-1 ring-inset ring-amber-500/40 bg-amber-500/5'
                      : isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''
                  }`}>
                    {pendingSubtaskConfirm?.subtaskId === subtask.id && (
                      <span className="text-[9px] font-mono text-amber-400 shrink-0">
                        {pendingSubtaskConfirm.action === 'toggle' ? 'x?' : 'd?'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleToggleSubtask(subtask)}
                      className="mt-px shrink-0"
                    >
                      {subtask.completed ? (
                        <CheckSquare className="h-3 w-3 text-cyan-400" />
                      ) : (
                        <Square className="h-3 w-3 text-zinc-600" />
                      )}
                    </button>
                    {isEditingSubtask ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingSubtaskTitle}
                        onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                        onBlur={() => void commitSubtaskTitle(subtask.id, editingSubtaskTitle)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitSubtaskTitle(subtask.id, editingSubtaskTitle);
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingSubtaskId(null);
                            setEditingSubtaskTitle('');
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
                      onClick={() => void handleRemoveSubtask(subtask.id)}
                      className="rounded p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover/sub:opacity-100"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )}
              </YougileEditorField>
            );
          })}

          {/* Add subtask input — focusable via YougileEditorField */}
          <YougileEditorField
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
                      void handleAddSubtask();
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
          </YougileEditorField>
        </div>

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
                {stickerDefinitions.map((sticker, stickerIndex) => {
                  const currentValue = stickerValues[sticker.id] ?? '';
                  return (
                    <YougileEditorField
                      key={sticker.id}
                      index={7 + stickerIndex}
                      onActivate={() => stickerRefs.current.get(sticker.id)?.focus()}
                    >
                      {(isSelected) => (
                        <div className={`flex items-center justify-between gap-3 rounded px-1 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
                            {sticker.name}
                          </span>
                          {sticker.freeText ? (
                            <input
                              ref={(el) => {
                                if (el) {
                                  stickerRefs.current.set(sticker.id, el);
                                } else {
                                  stickerRefs.current.delete(sticker.id);
                                }
                              }}
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
                              ref={(el) => {
                                if (el) {
                                  stickerRefs.current.set(sticker.id, el);
                                } else {
                                  stickerRefs.current.delete(sticker.id);
                                }
                              }}
                              value={currentValue}
                              onChange={(event) => persistStickerValue(sticker.id, event.target.value)}
                              onKeyDown={(event) => {
                                const optionValues = ['', 'empty', ...sticker.states.map((state) => state.id)];
                                handleVimSelectKeyDown(event, optionValues, currentValue, (nextValue) => {
                                  persistStickerValue(sticker.id, nextValue);
                                });
                              }}
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
                      )}
                    </YougileEditorField>
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
        <div className={`flex min-h-0 flex-col border-t border-zinc-800/40 ${embedded ? 'max-h-[40%]' : 'flex-1'}`}>
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
                          className="prose-jot prose-jot-yougile mt-0.5 text-xs leading-relaxed text-zinc-400 [&_img]:max-w-full [&_img]:max-h-48 [&_img]:rounded [&_img]:my-1 [&_img]:cursor-pointer"
                          dangerouslySetInnerHTML={{ __html: html }}
                          onClick={(e) => {
                            const img = (e.target as HTMLElement).closest('img');
                            if (img?.src) { setPreviewImage(img.src); return; }
                            const anchor = (e.target as HTMLElement).closest('a');
                            if (anchor?.href) {
                              e.preventDefault();
                              const href = anchor.href;
                              // Yougile file attachments → download; external URLs → open in browser
                              if (href.includes('yougile.com/user-data/') || href.includes('/root/#file:')) {
                                const fileName = fileNameFromAttachmentUrl(href);
                                void handleDownloadFile(href, fileName);
                              } else {
                                void invoke('open_url', { url: href });
                              }
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
