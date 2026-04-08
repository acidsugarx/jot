import { useCallback, useEffect, useMemo, useState } from 'react';
import { sanitizeHtml } from '@/lib/sanitize';
import {
  Bold,
  Check,
  CheckSquare,
  ChevronRight,
  Code,
  FileText,
  Indent,
  Italic,
  Link,
  List,
  ListOrdered,
  Loader2,
  Outdent,
  Plus,
  Square,
  Strikethrough,
  Underline,
  Trash2,
  X,
} from 'lucide-react';
import { consumeTemplateIntent } from '@/lib/settings-navigation';
import { YOUGILE_TASK_COLOR_OPTIONS, getYougileTaskColorValue } from '@/lib/yougile';
import { ToolbarBtn, useRichTextEditor } from '@/hooks/use-rich-text-editor';
import { useTemplateStore } from '@/store/use-template-store';
import { useYougileStore } from '@/store/use-yougile-store';
import type { CreateTaskTemplateInput, TaskTemplate, YougileChecklist } from '@/types/yougile';

interface TemplateDraft {
  title: string;
  description: string;
  color: string | null;
  checklists: YougileChecklist[];
  stickers: Record<string, string>;
  columnId: string | null;
}

function makeLocalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyDraft(defaultColumnId?: string | null): TemplateDraft {
  return {
    title: '',
    description: '',
    color: null,
    checklists: [],
    stickers: {},
    columnId: defaultColumnId ?? null,
  };
}

function toDraft(template: TaskTemplate): TemplateDraft {
  return {
    title: template.title,
    description: template.description ?? '',
    color: template.color,
    checklists: structuredClone(template.checklists),
    stickers: { ...template.stickers },
    columnId: template.columnId,
  };
}

function normalizeDescription(value: string): string | null {
  const sanitized = sanitizeHtml(value).trim();
  const plainText = sanitized
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return plainText ? sanitized : null;
}

function checklistStats(checklists: YougileChecklist[]) {
  const total = checklists.reduce((count, checklist) => count + checklist.items.length, 0);
  const completed = checklists.reduce(
    (count, checklist) => count + checklist.items.filter((item) => item.completed).length,
    0,
  );
  return { total, completed };
}

export function TaskTemplatesSettings() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(() => emptyDraft());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    templates,
    isLoading,
    error,
    clearError,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = useTemplateStore();

  const {
    yougileContext,
    columns,
    stringStickers,
    sprintStickers,
    hydrateSyncState,
    fetchColumns,
    fetchStringStickers,
    fetchSprintStickers,
    error: yougileError,
    clearError: clearYougileError,
  } = useYougileStore();

  useEffect(() => {
    void fetchTemplates();
    void hydrateSyncState();
  }, [fetchTemplates, hydrateSyncState]);

  useEffect(() => {
    const intent = consumeTemplateIntent();
    if (!intent || intent.mode !== 'new') return;

    setIsCreatingNew(true);
    setConfirmDelete(false);
    setSelectedTemplateId(null);
    setDraft({
      ...emptyDraft(columns[0]?.id ?? null),
      title: intent.draft?.title ?? '',
      description: intent.draft?.description ?? '',
      color: intent.draft?.color ?? null,
      checklists: structuredClone(intent.draft?.checklists ?? []),
      stickers: { ...(intent.draft?.stickers ?? {}) },
      columnId: intent.draft?.columnId ?? columns[0]?.id ?? null,
    });
  }, [columns]);

  useEffect(() => {
    if (!yougileContext.boardId) return;
    void Promise.all([
      fetchColumns(yougileContext.boardId),
      fetchStringStickers(yougileContext.boardId),
      fetchSprintStickers(yougileContext.boardId),
    ]);
  }, [
    fetchColumns,
    fetchSprintStickers,
    fetchStringStickers,
    yougileContext.boardId,
  ]);

  useEffect(() => {
    if (isCreatingNew) return;

    const selected = selectedTemplateId
      ? templates.find((template) => template.id === selectedTemplateId)
      : null;

    if (selected) {
      setDraft(toDraft(selected));
      return;
    }

    if (templates.length > 0) {
      const first = templates[0]!;
      setSelectedTemplateId(first.id);
      setDraft(toDraft(first));
      return;
    }

    setSelectedTemplateId(null);
    setDraft(emptyDraft(columns[0]?.id ?? null));
  }, [columns, isCreatingNew, selectedTemplateId, templates]);

  useEffect(() => {
    if (!isCreatingNew) return;
    if (draft.columnId != null) return;
    if (!columns[0]?.id) return;

    setDraft((current) => ({
      ...current,
      columnId: columns[0]?.id ?? null,
    }));
  }, [columns, draft.columnId, isCreatingNew]);

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
      })),
      freeText: false,
    })),
  ], [sprintStickers, stringStickers]);

  const activeTemplate = selectedTemplateId
    ? templates.find((template) => template.id === selectedTemplateId) ?? null
    : null;
  const boardContextLabel = [yougileContext.projectName, yougileContext.boardName]
    .filter(Boolean)
    .join(' / ');
  const visibleError = error ?? yougileError;
  const { total: totalChecklistItems, completed: completedChecklistItems } = checklistStats(
    draft.checklists,
  );
  const isSaveDisabled = draft.title.trim().length === 0 || isLoading;
  const draftColorValue = getYougileTaskColorValue(draft.color);

  const {
    descEditorRef,
    setDescHtml,
    descSanitizedHtml,
    execFormatCommand,
    insertCheckbox,
    openLinkInput,
    handleDescriptionBlur,
    handleDescriptionKeyDown,
    handleSmartPaste,
    handleContentClick,
    linkInputJSX,
  } = useRichTextEditor({
    onBlur: useCallback((html: string) => {
      setDraft((current) => ({ ...current, description: html }));
    }, []),
  });

  // Sync descHtml when draft.description changes externally (template selection, intent)
  useEffect(() => {
    const editor = descEditorRef.current;
    const isFocused = editor?.contains(document.activeElement) ?? false;
    if (!isFocused) {
      setDescHtml(draft.description);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to external draft changes
  }, [draft.description]);

  const selectTemplate = useCallback((template: TaskTemplate) => {
    setIsCreatingNew(false);
    setConfirmDelete(false);
    setSelectedTemplateId(template.id);
    setDraft(toDraft(template));
  }, []);

  const startNewTemplate = useCallback(() => {
    setIsCreatingNew(true);
    setConfirmDelete(false);
    setSelectedTemplateId(null);
    setDraft(emptyDraft(columns[0]?.id ?? null));
  }, [columns]);

  const updateChecklist = useCallback(
    (checklistIndex: number, updater: (checklist: YougileChecklist) => YougileChecklist) => {
      setDraft((current) => ({
        ...current,
        checklists: current.checklists.map((checklist, index) =>
          index === checklistIndex ? updater(checklist) : checklist,
        ),
      }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (draft.title.trim().length === 0) return;

    const payload: CreateTaskTemplateInput = {
      title: draft.title.trim(),
      description: normalizeDescription(draft.description),
      color: draft.color,
      checklists: draft.checklists,
      stickers: draft.stickers,
      columnId: draft.columnId,
    };

    if (isCreatingNew) {
      const created = await createTemplate(payload);
      if (created) {
        selectTemplate(created);
      }
      return;
    }

    if (!selectedTemplateId) return;

    const updated = await updateTemplate({
      id: selectedTemplateId,
      ...payload,
    });
    if (updated) {
      selectTemplate(updated);
    }
  }, [
    createTemplate,
    draft,
    isCreatingNew,
    selectTemplate,
    selectedTemplateId,
    updateTemplate,
  ]);

  const handleDelete = useCallback(async () => {
    if (!selectedTemplateId) return;
    await deleteTemplate(selectedTemplateId);
    setConfirmDelete(false);
    setIsCreatingNew(false);
    const remaining = useTemplateStore.getState().templates;
    if (remaining.length > 0) {
      const next = remaining[0]!;
      setSelectedTemplateId(next.id);
      setDraft(toDraft(next));
      return;
    }
    setSelectedTemplateId(null);
    setDraft(emptyDraft(columns[0]?.id ?? null));
  }, [columns, deleteTemplate, selectedTemplateId]);

  const clearStickerValue = useCallback((stickerId: string) => {
    setDraft((current) => {
      const next = { ...current.stickers };
      delete next[stickerId];
      return {
        ...current,
        stickers: next,
      };
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Yougile Task Templates
            </span>
          </div>
          <p className="text-sm text-zinc-500">
            Templates are stored locally and applied from the capture bar when creating Yougile tasks.
          </p>
        </div>
        <button
          type="button"
          onClick={startNewTemplate}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-[#111111] px-3 text-xs text-cyan-400 transition-colors hover:border-zinc-700 hover:text-cyan-300"
        >
          <Plus className="h-3.5 w-3.5" />
          New Template
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800/50 bg-[#161616]/70 p-3">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-600">
          <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5">
            {boardContextLabel ? `Board ${boardContextLabel}` : 'No active Yougile board'}
          </span>
          <span>Column bindings and stickers use the current synced board context.</span>
        </div>
      </div>

      {visibleError && (
        <div className="flex items-center justify-between rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span>{visibleError}</span>
          <button
            type="button"
            onClick={() => {
              clearError();
              clearYougileError();
            }}
            className="text-red-200 transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-2 rounded-xl border border-zinc-800/50 bg-[#161616] p-2">
          <div className="flex items-center justify-between px-2 pt-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              Templates
            </span>
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
          </div>

          {templates.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-zinc-500">
              No templates yet.
            </div>
          ) : (
            templates.map((template) => {
              const isActive = !isCreatingNew && selectedTemplateId === template.id;
              const stats = checklistStats(template.checklists);

              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => selectTemplate(template)}
                  className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-cyan-500/30 bg-cyan-500/10'
                      : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900/70'
                  }`}
                >
                  <div
                    className="mt-1 h-2 w-2 shrink-0 rounded-full border border-zinc-700/80"
                    style={{ backgroundColor: getYougileTaskColorValue(template.color) ?? '#3f3f46' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">{template.title}</div>
                    <div className="truncate pt-0.5 text-[11px] text-zinc-500">
                      {[
                        stats.total > 0 ? `${stats.total} items` : null,
                        Object.keys(template.stickers).length > 0
                          ? `${Object.keys(template.stickers).length} stickers`
                          : null,
                      ].filter(Boolean).join(' · ') || 'Title only'}
                    </div>
                  </div>
                  {isActive && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />}
                </button>
              );
            })
          )}
        </div>

        <div className="rounded-xl border border-zinc-800/50 bg-[#161616]">
          <div className="flex items-center justify-between border-b border-zinc-800/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full border border-zinc-700/80"
                style={{ backgroundColor: draftColorValue ?? '#7B869E' }}
              />
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                {isCreatingNew ? 'New Template' : activeTemplate ? 'Edit Template' : 'Template'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!isCreatingNew && selectedTemplateId && (
                confirmDelete ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3 w-3" />
                      Confirm Delete
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaveDisabled}
                className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {isCreatingNew ? 'Create Template' : 'Update Template'}
              </button>
            </div>
          </div>

          <div className="space-y-5 p-4">
            <section className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                    Title
                  </label>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Bug report"
                    className="h-9 w-full rounded-md border border-zinc-800 bg-[#111111] px-3 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-cyan-500/40"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                    Column Binding
                  </label>
                  <select
                    value={draft.columnId ?? ''}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      columnId: event.target.value || null,
                    }))}
                    className="h-9 w-full rounded-md border border-zinc-800 bg-[#111111] px-3 text-sm text-zinc-200 outline-none transition-colors focus:border-cyan-500/40"
                  >
                    <option value="">First board column</option>
                    {columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Description
                </span>
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
                  <ToolbarBtn icon={Code} title="Code block" onMouseDown={() => execFormatCommand('formatBlock', 'pre')} />
                  <ToolbarBtn icon={CheckSquare} title="Checkbox (Ctrl+Shift+C)" onMouseDown={() => insertCheckbox()} />
                </div>
              </div>

              {/* Link input popover */}
              {linkInputJSX}

              <div
                ref={descEditorRef}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: descSanitizedHtml }}
                onBlur={handleDescriptionBlur}
                onKeyDown={handleDescriptionKeyDown}
                onPaste={handleSmartPaste}
                onClick={handleContentClick}
                className="prose-jot prose-jot-yougile prose-jot-editor min-h-[140px] rounded-xl border border-zinc-800 bg-[#111111] px-3 py-2 text-sm text-zinc-200 outline-none"
                data-placeholder="Add a description…"
                spellCheck={false}
              />
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                    Checklists
                  </div>
                  <div className="pt-1 text-xs text-zinc-500">
                    {totalChecklistItems === 0
                      ? 'No checklist items'
                      : `${completedChecklistItems}/${totalChecklistItems} items completed by default`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({
                    ...current,
                    checklists: [
                      ...current.checklists,
                      {
                        id: makeLocalId(),
                        title: '',
                        items: [],
                      },
                    ],
                  }))}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-cyan-400 transition-colors hover:text-cyan-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Checklist
                </button>
              </div>

              {draft.checklists.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-5 text-center text-sm text-zinc-500">
                  Add one or more checklists to prefill task subtasks.
                </div>
              ) : (
                <div className="space-y-3">
                  {draft.checklists.map((checklist, checklistIndex) => (
                    <div
                      key={checklist.id ?? checklistIndex}
                      className="rounded-xl border border-zinc-800/60 bg-[#111111] p-3"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={checklist.title}
                          onChange={(event) => updateChecklist(checklistIndex, (current) => ({
                            ...current,
                            title: event.target.value,
                          }))}
                          placeholder="Checklist title"
                          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-cyan-500/40"
                        />
                        <button
                          type="button"
                          onClick={() => setDraft((current) => ({
                            ...current,
                            checklists: current.checklists.filter((_, index) => index !== checklistIndex),
                          }))}
                          className="rounded p-1 text-zinc-600 transition-colors hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {checklist.items.map((item, itemIndex) => (
                          <div key={item.id ?? itemIndex} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateChecklist(checklistIndex, (current) => ({
                                ...current,
                                items: current.items.map((entry, index) => index === itemIndex
                                  ? { ...entry, completed: !entry.completed }
                                  : entry),
                              }))}
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                                item.completed
                                  ? 'border-cyan-500/40 bg-cyan-500/20'
                                  : 'border-zinc-700 hover:border-zinc-500'
                              }`}
                            >
                              {item.completed ? (
                                <CheckSquare className="h-3 w-3 text-cyan-400" />
                              ) : (
                                <Square className="h-3 w-3 text-zinc-600" />
                              )}
                            </button>
                            <input
                              type="text"
                              value={item.title}
                              onChange={(event) => updateChecklist(checklistIndex, (current) => ({
                                ...current,
                                items: current.items.map((entry, index) => index === itemIndex
                                  ? { ...entry, title: event.target.value }
                                  : entry),
                              }))}
                              placeholder="Checklist item"
                              className="h-8 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-cyan-500/40"
                            />
                            <button
                              type="button"
                              onClick={() => updateChecklist(checklistIndex, (current) => ({
                                ...current,
                                items: current.items.filter((_, index) => index !== itemIndex),
                              }))}
                              className="rounded p-1 text-zinc-600 transition-colors hover:text-red-400"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => updateChecklist(checklistIndex, (current) => ({
                            ...current,
                            items: [
                              ...current.items,
                              {
                                id: makeLocalId(),
                                title: '',
                                completed: false,
                              },
                            ],
                          }))}
                          className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Item
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                Color
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, color: null }))}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    draft.color == null
                      ? 'border-cyan-500/30 bg-cyan-500/10'
                      : 'border-zinc-800 bg-[#111111] hover:border-zinc-700'
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full border border-zinc-700/80 bg-transparent" />
                  <span className="text-sm text-zinc-200">No Color</span>
                </button>
                {YOUGILE_TASK_COLOR_OPTIONS.map((option) => {
                  const isActive = draft.color === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, color: option.value }))}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                        isActive
                          ? 'border-cyan-500/30 bg-cyan-500/10'
                          : 'border-zinc-800 bg-[#111111] hover:border-zinc-700'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-zinc-700/80"
                        style={{ backgroundColor: getYougileTaskColorValue(option.value) ?? '#7B869E' }}
                      />
                      <span className="text-sm text-zinc-200">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Stickers
                </div>
                <div className="pt-1 text-xs text-zinc-500">
                  Uses the active board&apos;s sticker definitions.
                </div>
              </div>

              {stickerDefinitions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-5 text-center text-sm text-zinc-500">
                  No sticker definitions available for the current board.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {stickerDefinitions.map((sticker) => {
                    const value = draft.stickers[sticker.id] ?? '';
                    return (
                      <div key={sticker.id} className="rounded-xl border border-zinc-800/60 bg-[#111111] p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-zinc-200">{sticker.name}</span>
                          {value && (
                            <button
                              type="button"
                              onClick={() => clearStickerValue(sticker.id)}
                              className="text-zinc-600 transition-colors hover:text-zinc-300"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {sticker.freeText ? (
                          <input
                            type="text"
                            value={value}
                            onChange={(event) => setDraft((current) => ({
                              ...current,
                              stickers: {
                                ...current.stickers,
                                [sticker.id]: event.target.value,
                              },
                            }))}
                            placeholder="Value"
                            className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-cyan-500/40"
                          />
                        ) : (
                          <select
                            value={value}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setDraft((current) => {
                                const stickers = { ...current.stickers };
                                if (!nextValue) {
                                  delete stickers[sticker.id];
                                } else {
                                  stickers[sticker.id] = nextValue;
                                }
                                return { ...current, stickers };
                              });
                            }}
                            className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 outline-none transition-colors focus:border-cyan-500/40"
                          >
                            <option value="">Not set</option>
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
            </section>

            <section className="rounded-xl border border-zinc-800/60 bg-[#111111] px-3 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <FileText className="h-3.5 w-3.5 text-zinc-600" />
                <span>{draft.title.trim() || 'Untitled template'}</span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
                <span>
                  {draft.columnId
                    ? columns.find((column) => column.id === draft.columnId)?.title ?? 'Bound column'
                    : 'First board column'}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
                <span>{totalChecklistItems} checklist items</span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
                <span>{Object.keys(draft.stickers).length} stickers</span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
