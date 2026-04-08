import { useCallback, useMemo, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';

// ── Shared ToolbarBtn ────────────────────────────────────────────────────────

export function ToolbarBtn({ icon: Icon, title, onMouseDown }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  onMouseDown: (e: ReactMouseEvent) => void;
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

// ── Hook options ─────────────────────────────────────────────────────────────

export interface UseRichTextEditorOptions {
  /** Called when the editor loses focus with the current HTML content */
  onBlur: (html: string) => void;
  /** Optional: called when a link is clicked inside the editor (for opening in browser) */
  onLinkClick?: (href: string) => void;
}

// ── Hook return type ─────────────────────────────────────────────────────────

export interface UseRichTextEditorReturn {
  descEditorRef: React.MutableRefObject<HTMLDivElement | null>;
  descHtml: string;
  setDescHtml: (html: string) => void;
  descSanitizedHtml: string;
  showLinkInput: boolean;
  setShowLinkInput: (show: boolean) => void;
  linkDraft: string;
  setLinkDraft: (url: string) => void;
  pendingLinkRangeRef: React.MutableRefObject<Range | null>;
  linkInputRef: React.RefObject<HTMLInputElement | null>;
  execFormatCommand: (command: string, value?: string) => void;
  insertCheckbox: () => void;
  openLinkInput: () => void;
  applyLink: () => void;
  cancelLinkInput: () => void;
  handleDescriptionBlur: () => void;
  handleDescriptionKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  handleSmartPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  handleContentClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  linkInputJSX: React.ReactNode;
}

// ── Checkbox HTML constant ───────────────────────────────────────────────────

const CHECKBOX_HTML =
  '<ul class="todo-list"><li><span class="todo-list__label todo-list__label_without-description"><span contenteditable="false"><input type="checkbox" tabindex="-1"></span></span><p> </p></li></ul>&nbsp;';

const NEW_CHECKBOX_LINE =
  '</span></p></li><li><span class="todo-list__label todo-list__label_without-description"><span contenteditable="false"><input type="checkbox" tabindex="-1"></span></span><p>';

// ── Hook implementation ──────────────────────────────────────────────────────

export function useRichTextEditor(options: UseRichTextEditorOptions): UseRichTextEditorReturn {
  const { onBlur, onLinkClick } = options;

  const descEditorRef = useRef<HTMLDivElement | null>(null);
  const [descHtml, setDescHtml] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkDraft, setLinkDraft] = useState('https://');
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const pendingLinkRangeRef = useRef<Range | null>(null);

  const descSanitizedHtml = useMemo(
    () => sanitizeHtml(descHtml) || '<p><br></p>',
    [descHtml]
  );

  const handleDescriptionBlur = useCallback(() => {
    const html = descEditorRef.current?.innerHTML ?? '';
    setDescHtml(html);
    onBlur(html);
  }, [onBlur]);

  const execFormatCommand = useCallback((command: string, value?: string) => {
    descEditorRef.current?.focus();
    document.execCommand(command, false, value);
  }, []);

  const insertCheckbox = useCallback(() => {
    descEditorRef.current?.focus();
    document.execCommand('insertHTML', false, CHECKBOX_HTML);
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

  const cancelLinkInput = useCallback(() => {
    setShowLinkInput(false);
    setLinkDraft('https://');
    pendingLinkRangeRef.current = null;
    descEditorRef.current?.focus();
  }, []);

  const handleDescriptionKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key === 'b') { e.preventDefault(); execFormatCommand('bold'); return; }
    if (mod && e.key === 'i') { e.preventDefault(); execFormatCommand('italic'); return; }
    if (mod && e.key === 'u') { e.preventDefault(); execFormatCommand('underline'); return; }
    if (mod && e.shiftKey && e.key === 'S') { e.preventDefault(); execFormatCommand('strikeThrough'); return; }
    if (mod && e.key === 'k') { e.preventDefault(); openLinkInput(); return; }
    if (mod && e.shiftKey && e.key === 'C') { e.preventDefault(); insertCheckbox(); return; }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); execFormatCommand('indent'); return; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); execFormatCommand('outdent'); return; }

    // Enter inside a checkbox line → create new checkbox
    if (e.key === 'Enter' && !e.shiftKey) {
      const todoItem = (e.target as HTMLElement).closest?.('.todo-list__label, .todo-list__label_without-description');
      if (todoItem) {
        e.preventDefault();
        document.execCommand('insertHTML', false, NEW_CHECKBOX_LINE);
        return;
      }
      const liParent = (e.target as HTMLElement).closest?.('ul.todo-list > li');
      if (liParent && liParent.querySelector('input[type="checkbox"]')) {
        e.preventDefault();
        document.execCommand('insertHTML', false, NEW_CHECKBOX_LINE);
      }
    }
  }, [execFormatCommand, insertCheckbox, openLinkInput]);

  const handleSmartPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData?.getData('text/html');
    if (html) {
      e.preventDefault();
      const sanitized = sanitizeHtml(html);
      document.execCommand('insertHTML', false, sanitized);
      requestAnimationFrame(() => {
        const current = descEditorRef.current?.innerHTML ?? '';
        setDescHtml(current);
      });
      return;
    }

    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;

    e.preventDefault();

    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    const hasUrls = urlRegex.test(text);

    if (hasUrls) {
      const matches = text.match(/(https?:\/\/[^\s<]+)/g) ?? [];
      let result = text;
      for (const url of matches) {
        const escaped = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        result = result.replace(url, `<a href="${escaped}">${escaped}</a>`);
      }
      document.execCommand('insertHTML', false, result);
    } else {
      document.execCommand('insertText', false, text);
    }
  }, []);

  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    let checkbox: HTMLInputElement | null = null;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      checkbox = target;
    } else {
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
      const li = checkbox.closest('li');
      if (li) {
        li.dataset.checked = checkbox.checked ? 'true' : 'false';
      }
      return;
    }

    // Link click
    if (onLinkClick) {
      const anchor = target.closest('a');
      if (anchor?.href) {
        e.preventDefault();
        onLinkClick(anchor.href);
      }
    }
  }, [onLinkClick]);

  // Pre-built link input JSX
  const linkInputJSX = showLinkInput ? (
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
            cancelLinkInput();
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
  ) : null;

  return {
    descEditorRef,
    descHtml,
    setDescHtml,
    descSanitizedHtml,
    showLinkInput,
    setShowLinkInput,
    linkDraft,
    setLinkDraft,
    pendingLinkRangeRef,
    linkInputRef,
    execFormatCommand,
    insertCheckbox,
    openLinkInput,
    applyLink,
    cancelLinkInput,
    handleDescriptionBlur,
    handleDescriptionKeyDown,
    handleSmartPaste,
    handleContentClick,
    linkInputJSX,
  };
}
