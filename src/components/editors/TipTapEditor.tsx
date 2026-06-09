// ── TipTap Description Editor — replaces contentEditable rich text ──────
//
// Phase 5: replaces document.execCommand with ProseMirror (TipTap).
// Designed as a controlled drop-in for YougileTaskEditor and TaskTemplatesSettings.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link,
  List,
  ListOrdered,
  Code,
  CheckSquare,
  Indent,
  Outdent,
} from 'lucide-react';

// ══════════════════════════════════════════════════════════════════════════════

interface TipTapEditorProps {
  /** Initial HTML content */
  content: string;
  /** Called with HTML when editor loses focus */
  onSave: (html: string) => void;
  /** Called when editor gains focus */
  onFocus?: () => void;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Show formatting toolbar */
  showToolbar?: boolean;
  /** External ref forwarding (optional) */
  editorRef?: React.MutableRefObject<Editor | null>;
}

// ══════════════════════════════════════════════════════════════════════════════

function ToolbarBtn({
  icon: Icon,
  title,
  onClick,
  isActive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onClick: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.preventDefault(); onClick(); }}
      className={`rounded p-1 transition-colors ${
        isActive
          ? 'bg-cyan-500/20 text-cyan-300'
          : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300'
      }`}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

function LinkInputPopover({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('https://');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const apply = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) { onClose(); return; }
    try {
      const parsed = new URL(trimmed);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        const { from, to } = editor.state.selection;
        if (from !== to) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: parsed.toString() }).run();
      } else {
          editor.chain().focus().insertContent(`<a href="${parsed.toString()}">${parsed.toString()}</a>`).run();
        }
      }
    } catch { /* invalid URL */ }
    onClose();
  }, [url, editor, onClose]);

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
      <input
        ref={inputRef}
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); apply(); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        placeholder="https://example.com"
        className="flex-1 rounded border border-zinc-800 bg-black/20 px-2 py-1 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
      />
      <button
        type="button"
        onClick={apply}
        className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200"
      >
        Apply
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

export function TipTapEditor({
  content,
  onSave,
  onFocus,
  placeholder,
  showToolbar = true,
  editorRef: externalEditorRef,
}: TipTapEditorProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [focused, setFocused] = useState(false);
  const isInternalUpdate = useRef(false);
  // ── Externally-set content tracker (prevents save-loop) ──────────────
  const externalContentRef = useRef(content);

  const handleBlur = useCallback(({ editor: ed }: { editor: Editor }) => {
    setFocused(false);
    if (!isInternalUpdate.current) {
      externalContentRef.current = ed.getHTML();
      onSave(ed.getHTML());
    }
  }, [onSave]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    onFocus?.();
  }, [onFocus]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      LinkExtension.configure({
        openOnClick: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      TaskList.configure({ itemTypeName: 'taskItem' }),
      TaskItem.configure({ nested: true }),
    ],
    content,
    onBlur: handleBlur,
    onFocus: handleFocus,
    editorProps: {
      attributes: {
        class: `prose-jot prose-jot-editor min-h-[2.5rem] cursor-text outline-none ${
          focused ? '' : ''
        }`,
        'data-placeholder': placeholder ?? 'Add a description…',
      },
      handleClick: () => {
        // Link clicks handled by TipTap's LinkExtension
        return false;
      },
    },
    // Enable smart paste for URLs
    enablePasteRules: true,
  });

  // Sync editor content when external content changes (template switch)
  useEffect(() => {
    if (!editor) return;
    if (content !== externalContentRef.current) {
      externalContentRef.current = content;
      isInternalUpdate.current = true;
      editor.commands.setContent(content);
      isInternalUpdate.current = false;
    }
  }, [editor, content]);

  // Expose editor ref externally
  useEffect(() => {
    if (externalEditorRef && editor) {
      externalEditorRef.current = editor;
    }
    return () => {
      if (externalEditorRef) {
        externalEditorRef.current = null;
      }
    };
  }, [editor, externalEditorRef]);

  if (!editor) return null;

  const toggleLink = () => {
    const { from, to } = editor.state.selection;
    if (from !== to && editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
    } else if (from !== to) {
      setShowLinkInput(true);
    } else {
      setShowLinkInput(true);
    }
  };

  return (
    <div>
      {showToolbar && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Description
          </span>
          <div className="flex items-center gap-px rounded-md border border-zinc-800/50 bg-zinc-900/40 px-1.5 py-0.5">
            <ToolbarBtn
              icon={Bold}
              title="Bold (Ctrl+B)"
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
            />
            <ToolbarBtn
              icon={Italic}
              title="Italic (Ctrl+I)"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
            />
            <ToolbarBtn
              icon={Underline}
              title="Underline (Ctrl+U)"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive('underline')}
            />
            <ToolbarBtn
              icon={Strikethrough}
              title="Strikethrough (Ctrl+Shift+S)"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive('strike')}
            />
            <div className="mx-0.5 h-3 w-px border-l border-zinc-800/40" />
            <ToolbarBtn
              icon={Link}
              title="Link (Ctrl+K)"
              onClick={toggleLink}
              isActive={editor.isActive('link')}
            />
            <ToolbarBtn
              icon={List}
              title="Bullet list"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              isActive={editor.isActive('bulletList')}
            />
            <ToolbarBtn
              icon={ListOrdered}
              title="Numbered list"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              isActive={editor.isActive('orderedList')}
            />
            <ToolbarBtn
              icon={Indent}
              title="Indent"
              onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
            />
            <ToolbarBtn
              icon={Outdent}
              title="Outdent"
              onClick={() => editor.chain().focus().liftListItem('listItem').run()}
            />
            <div className="mx-0.5 h-3 w-px border-l border-zinc-800/40" />
            <ToolbarBtn
              icon={Code}
              title="Code (Ctrl+Shift+`)"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              isActive={editor.isActive('codeBlock')}
            />
            <ToolbarBtn
              icon={CheckSquare}
              title="Checkbox (Ctrl+Shift+C)"
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              isActive={editor.isActive('taskList')}
            />
          </div>
        </div>
      )}
      <EditorContent editor={editor} />
      {showLinkInput && <LinkInputPopover editor={editor} onClose={() => setShowLinkInput(false)} />}
    </div>
  );
}
