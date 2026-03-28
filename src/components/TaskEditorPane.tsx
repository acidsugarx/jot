import { useState, useEffect, useRef, useCallback } from 'react';
import { useTaskStore } from '@/store/use-task-store';
import { FileText, Link as LinkIcon, X, Plus, Calendar, Eye, PenLine } from 'lucide-react';
import { toDateInputValue } from '@/lib/formatting';
import { priorityOptions, priorityColor } from '@/lib/constants';
import { TaskPriority } from '@/types';
import type { Checklist, Task as TaskType } from '@/types';
import { ChecklistEditor } from '@/components/ChecklistEditor';
import { SubtaskList } from '@/components/SubtaskList';

export function TaskEditorPane() {
  const { tasks, columns, selectedTaskId, setIsEditorOpen, updateTask, openLinkedNote, getChecklists, getSubtasks, selectTask } = useTaskStore();
  const task = tasks.find((t) => t.id === selectedTaskId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>('todo');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [dueDate, setDueDate] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [descPreview, setDescPreview] = useState(false);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [subtasks, setSubtasks] = useState<TaskType[]>([]);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Sync local state when task changes
  const taskId = task?.id;
  const taskUpdatedAt = task?.updatedAt;
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description || '');
    setStatus(task.status);
    setPriority(task.priority);
    setDueDate(task.dueDate ? toDateInputValue(task.dueDate) : '');
    setTags([...task.tags]);
    setTagInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync local state on task identity change, not on every task mutation
  }, [taskId, taskUpdatedAt]);

  // Auto-resize textareas
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  useEffect(() => { autoResize(titleRef.current); }, [title, autoResize]);
  useEffect(() => { autoResize(descRef.current); }, [description, autoResize]);

  const loadExtras = useCallback(async () => {
    if (!task) return;
    const [cl, st] = await Promise.all([
      getChecklists(task.id),
      getSubtasks(task.id),
    ]);
    setChecklists(cl);
    setSubtasks(st);
  }, [task, getChecklists, getSubtasks]);

  useEffect(() => { void loadExtras(); }, [loadExtras]);

  if (!task) return null;

  const save = (patch: Record<string, unknown>) => {
    void updateTask({ id: task.id, ...patch });
  };

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      save({ title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  const handleDescriptionBlur = () => {
    const val = description.trim();
    const current = task.description || '';
    if (val !== current) {
      save({ description: val || null });
    }
  };

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    save({ status: newStatus });
  };

  const handlePriorityChange = (newPriority: TaskPriority) => {
    setPriority(newPriority);
    save({ priority: newPriority });
  };

  const handleDueDateChange = (value: string) => {
    setDueDate(value);
    save({ dueDate: value ? new Date(value + 'T00:00:00').toISOString() : null });
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().replace(/^#/, '').trim();
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      setTagInput('');
      save({ tags: newTags });
    }
  };

  const handleRemoveTag = (tag: string) => {
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    save({ tags: newTags });
  };

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-zinc-800/40 bg-[#141414]">
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-zinc-800/40 px-4">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Editor
        </span>
        <button
          onClick={() => setIsEditorOpen(false)}
          className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Title — editable textarea */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            }}
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent text-sm font-medium leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 selection:bg-cyan-500/30"
            placeholder="Task title..."
          />
        </div>

        {/* Description — editable textarea with markdown preview */}
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
              rows={2}
              className="w-full resize-none overflow-hidden bg-transparent text-xs leading-relaxed text-zinc-400 outline-none placeholder:text-zinc-700 selection:bg-cyan-500/30"
              placeholder="Add a description…  (supports **bold**, *italic*, `code`, [links](url), - lists)"
            />
          )}
        </div>

        {/* Fields — flat rows */}
        <div className="border-b border-zinc-800/30">
          {/* Status */}
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Status</span>
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="bg-transparent text-right text-sm text-zinc-300 focus:outline-none cursor-pointer"
            >
              {columns.map((col) => (
                <option key={col.id} value={col.statusKey}>{col.name}</option>
              ))}
              <option value="archived">Archived</option>
            </select>
          </div>

          {/* Priority */}
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Priority</span>
            <select
              value={priority}
              onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
              className={`bg-transparent text-right text-sm focus:outline-none cursor-pointer ${priorityColor[priority] || 'text-zinc-600'}`}
            >
              {priorityOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Due Date */}
          <div className="flex h-9 items-center justify-between px-4">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Due</span>
            <div className="flex items-center gap-1.5">
              {dueDate ? (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    className="bg-transparent font-mono text-sm text-zinc-400 focus:outline-none cursor-pointer [color-scheme:dark]"
                  />
                  <button
                    type="button"
                    onClick={() => handleDueDateChange('')}
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
                    handleDueDateChange(today);
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
                >
                  <Calendar className="h-3 w-3" />
                  <span className="font-mono text-xs">Set date</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tags — editable */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
          <div className="mb-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Tags</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="group/tag flex items-center gap-0.5 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-0.5 opacity-0 group-hover/tag:opacity-100 text-zinc-600 hover:text-zinc-300 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <div className="flex items-center">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); }
                  if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                    handleRemoveTag(tags[tags.length - 1]!);
                  }
                }}
                onBlur={() => { if (tagInput.trim()) handleAddTag(); }}
                placeholder="add tag"
                className="h-5 w-16 bg-transparent font-mono text-[10px] text-zinc-500 placeholder:text-zinc-700 outline-none"
              />
              {tagInput.trim() && (
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="rounded p-0.5 text-zinc-700 hover:text-cyan-400 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Checklists */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
          <div className="mb-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Checklists</span>
          </div>
          <ChecklistEditor taskId={task.id} checklists={checklists} onUpdate={loadExtras} />
        </div>

        {/* Subtasks */}
        <div className="border-b border-zinc-800/30 px-4 py-3">
          <div className="mb-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Subtasks</span>
          </div>
          <SubtaskList
            parentId={task.id}
            subtasks={subtasks}
            onUpdate={loadExtras}
            onSelect={(id) => selectTask(id)}
          />
        </div>

        {/* Linked Note */}
        {task.linkedNotePath && (
          <div className="border-b border-zinc-800/30 px-4 py-3">
            <div className="mb-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Linked Note</span>
            </div>
            <button
              type="button"
              onClick={() => void openLinkedNote(task.linkedNotePath!)}
              className="group flex w-full items-center gap-2 rounded-md border border-zinc-800/40 bg-[#111111] px-3 py-2 text-left transition-colors hover:border-cyan-500/30"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-500/60 group-hover:text-cyan-400" />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] text-zinc-500 group-hover:text-zinc-300">
                  {task.linkedNotePath.split('/').pop()}
                </span>
              </div>
              <LinkIcon className="h-3 w-3 shrink-0 text-zinc-700 group-hover:text-cyan-500/60" />
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800/40 px-4 py-1.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-700">
          <span>{task.id.slice(0, 8)}</span>
          <span>{new Date(task.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      </div>
    </div>
  );
}

function renderMarkdown(text: string): string {
  // Escape HTML
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
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    let processed = line;

    // Headers
    if (processed.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<h3>${inlineFormat(processed.slice(4))}</h3>`;
    } else if (processed.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<h2>${inlineFormat(processed.slice(3))}</h2>`;
    } else if (processed.startsWith('# ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<h1>${inlineFormat(processed.slice(2))}</h1>`;
    }
    // Blockquotes
    else if (processed.startsWith('&gt; ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = `<blockquote>${inlineFormat(processed.slice(5))}</blockquote>`;
    }
    // List items
    else if (/^[-*] /.test(processed)) {
      if (!inList) { result.push('<ul>'); inList = true; }
      processed = `<li>${inlineFormat(processed.slice(2))}</li>`;
    }
    // Blank line
    else if (processed.trim() === '') {
      if (inList) { result.push('</ul>'); inList = false; }
      processed = '<br/>';
    }
    // Regular text
    else {
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

