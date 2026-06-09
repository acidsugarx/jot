// ── Editor Fields — Column, Completed, Deadline, Color, Assignee ──────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { useRef } from 'react';
import { ChevronDown, X, Calendar, CheckSquare, Square, Users } from 'lucide-react';
import { todayDateInput } from '@/lib/formatting';
import { YOUGILE_TASK_COLOR_OPTIONS } from '@/lib/yougile';
import { EditorField } from '@/components/editors/EditorField';
import type { YougileColumn, YougileUser, YougileTask } from '@/types/yougile';

// ══════════════════════════════════════════════════════════════════════════════

interface ColumnFieldProps {
  columns: YougileColumn[];
  columnId: string;
  currentColumn: YougileColumn | undefined;
  onColumnChange: (columnId: string) => void;
  onVimKeyDown: (
    event: React.KeyboardEvent<HTMLSelectElement>,
    options: string[],
    currentValue: string,
    onChange: (value: string) => void,
  ) => void;
}

function ColumnField({ columns, columnId, currentColumn, onColumnChange, onVimKeyDown }: ColumnFieldProps) {
  const columnSelectRef = useRef<HTMLSelectElement>(null);

  return (
    <EditorField index={2} onActivate={() => columnSelectRef.current?.focus()}>
      {(isSelected) => (
        <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Column</span>
          <div className="flex items-center gap-1">
            <select
              ref={columnSelectRef}
              data-field="column"
              value={columnId}
              onChange={(e) => onColumnChange(e.target.value)}
              onKeyDown={(event) => {
                const optionValues = columns.map((col) => col.id);
                if (!optionValues.includes(columnId) && columnId) {
                  optionValues.push(columnId);
                }
                onVimKeyDown(event, optionValues, columnId, onColumnChange);
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
    </EditorField>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

interface CompletedFieldProps {
  task: Pick<YougileTask, 'id' | 'completed'>;
  onUpdateTask: (taskId: string, payload: { completed: boolean }) => void;
}

function CompletedField({ task, onUpdateTask }: CompletedFieldProps) {
  return (
    <EditorField
      index={3}
      onActivate={() => void onUpdateTask(task.id, { completed: !task.completed })}
      onEnter={() => void onUpdateTask(task.id, { completed: !task.completed })}
    >
      {(isSelected) => (
        <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Completed</span>
          <button
            type="button"
            onClick={() => void onUpdateTask(task.id, { completed: !task.completed })}
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
    </EditorField>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

interface DeadlineFieldProps {
  deadlineValue: string;
  onDeadlineChange: (value: string) => void;
  onClearDeadline: () => void;
}

function DeadlineField({ deadlineValue, onDeadlineChange, onClearDeadline }: DeadlineFieldProps) {
  const deadlineInputRef = useRef<HTMLInputElement>(null);

  return (
    <EditorField
      index={4}
      onActivate={() => {
        if (deadlineValue) {
          deadlineInputRef.current?.focus();
        } else {
          const today = todayDateInput();
          onDeadlineChange(today);
          requestAnimationFrame(() => deadlineInputRef.current?.focus());
        }
      }}
    >
      {(isSelected) => (
        <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Deadline</span>
          <div className="flex items-center gap-1.5">
            {deadlineValue ? (
              <div className="flex items-center gap-1">
                <input
                  ref={deadlineInputRef}
                  type="date"
                  value={deadlineValue}
                  onChange={(e) => onDeadlineChange(e.target.value)}
                  className="bg-transparent font-mono text-sm text-zinc-400 focus:outline-none cursor-pointer [color-scheme:dark]"
                />
                <button
                  type="button"
                  onClick={onClearDeadline}
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
                  onDeadlineChange(today);
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
    </EditorField>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

interface ColorFieldProps {
  color: string;
  showColorPicker: boolean;
  onToggleColorPicker: () => void;
  onColorChange: (color: string) => void;
  cycleColor: (delta: -1 | 1) => void;
  colorOption: { value: string; label: string; hex: string };
}

function ColorField({ color, showColorPicker, onToggleColorPicker, onColorChange, cycleColor, colorOption }: ColorFieldProps) {
  const colorButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <EditorField
      index={5}
      onActivate={() => {
        onToggleColorPicker();
        requestAnimationFrame(() => colorButtonRef.current?.focus());
      }}
    >
      {(isSelected) => (
        <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">Color</span>
          <div className="relative">
            <button
              ref={colorButtonRef}
              type="button"
              onClick={onToggleColorPicker}
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
                style={{ backgroundColor: colorOption.hex }}
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
                    onClick={() => onColorChange(opt.value)}
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
    </EditorField>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

interface AssigneeFieldProps {
  users: YougileUser[];
  assignedUserIds: string[];
  showAssigneePicker: boolean;
  onTogglePicker: () => void;
  onToggleAssignee: (userId: string) => void;
  onFocusAssignee: (..._args: unknown[]) => void;
}

function AssigneeField({ users, assignedUserIds, showAssigneePicker, onTogglePicker, onToggleAssignee, onFocusAssignee }: AssigneeFieldProps) {
  const assigneeButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  if (users.length === 0 && assignedUserIds.length === 0) return null;

  return (
    <EditorField
      index={6}
      onActivate={() => {
        onTogglePicker();
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
                onClick={onTogglePicker}
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
                    onClick={() => onToggleAssignee(user.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'j' || event.key === 'l') {
                        event.preventDefault();
                        onFocusAssignee(user.id, 1);
                        return;
                      }
                      if (event.key === 'k' || event.key === 'h') {
                        event.preventDefault();
                        onFocusAssignee(user.id, -1);
                        return;
                      }
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onToggleAssignee(user.id);
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
    </EditorField>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

export interface EditorFieldsProps {
  columns: YougileColumn[];
  columnId: string;
  currentColumn: YougileColumn | undefined;
  onColumnChange: (columnId: string) => void;
  onVimKeyDown: (
    event: React.KeyboardEvent<HTMLSelectElement>,
    options: string[],
    currentValue: string,
    onChange: (value: string) => void,
  ) => void;

  task: Pick<YougileTask, 'id' | 'completed'>;
  onUpdateTask: (taskId: string, payload: { completed: boolean }) => void;

  deadlineValue: string;
  onDeadlineChange: (value: string) => void;
  onClearDeadline: () => void;

  color: string;
  showColorPicker: boolean;
  onToggleColorPicker: () => void;
  onColorChange: (color: string) => void;
  cycleColor: (delta: -1 | 1) => void;
  colorOption: { value: string; label: string; hex: string };

  users: YougileUser[];
  assignedUserIds: string[];
  showAssigneePicker: boolean;
  onToggleAssigneePicker: () => void;
  onToggleAssignee: (userId: string) => void;
  onFocusAssignee: (..._args: unknown[]) => void;
}

export function EditorFields(props: EditorFieldsProps) {
  // Import React for useRef
  return (
    <>
      <ColumnField
        columns={props.columns}
        columnId={props.columnId}
        currentColumn={props.currentColumn}
        onColumnChange={props.onColumnChange}
        onVimKeyDown={props.onVimKeyDown}
      />
      <CompletedField
        task={props.task}
        onUpdateTask={props.onUpdateTask}
      />
      <DeadlineField
        deadlineValue={props.deadlineValue}
        onDeadlineChange={props.onDeadlineChange}
        onClearDeadline={props.onClearDeadline}
      />
      <ColorField
        color={props.color}
        showColorPicker={props.showColorPicker}
        onToggleColorPicker={props.onToggleColorPicker}
        onColorChange={props.onColorChange}
        cycleColor={props.cycleColor}
        colorOption={props.colorOption}
      />
      <AssigneeField
        users={props.users}
        assignedUserIds={props.assignedUserIds}
        showAssigneePicker={props.showAssigneePicker}
        onTogglePicker={props.onToggleAssigneePicker}
        onToggleAssignee={props.onToggleAssignee}
        onFocusAssignee={props.onFocusAssignee}
      />
    </>
  );
}
