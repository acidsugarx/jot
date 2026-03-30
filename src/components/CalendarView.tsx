import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTaskStore } from '@/store/use-task-store';
import { Task, TaskPriority } from '@/types';
import { YougileTask } from '@/types/yougile';
import { PRIORITY_DOT_CLASS } from '@/lib/yougile';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toLocalDateKey(isoString: string): string {
  // Parse as UTC, display as local date key YYYY-MM-DD
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tsToLocalDateKey(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayKey(): string {
  return toLocalDateKey(new Date().toISOString());
}

// Normalised task shape used internally by the calendar
interface CalendarTask {
  id: string;
  title: string;
  dateKey: string | null;
  isDone: boolean;
  priority?: string;
  isYougile?: boolean;
}

function normaliseLocalTask(t: Task): CalendarTask {
  return {
    id: t.id,
    title: t.title,
    dateKey: t.dueDate ? toLocalDateKey(t.dueDate) : null,
    isDone: t.status === 'done',
    priority: t.priority,
    isYougile: false,
  };
}

function normaliseYougileTask(t: YougileTask): CalendarTask {
  return {
    id: t.id,
    title: t.title,
    dateKey: t.deadline?.deadline != null ? tsToLocalDateKey(t.deadline.deadline) : null,
    isDone: t.completed,
    isYougile: true,
  };
}

interface Props {
  tasks: Task[];
  yougileMode?: boolean;
  yougileTasksRaw?: YougileTask[];
  onSelectTask?: (id: string) => void;
  onOpenEditor?: () => void;
}

export function CalendarView({
  tasks,
  yougileMode,
  yougileTasksRaw,
  onSelectTask,
  onOpenEditor,
}: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  const { selectTask, setIsEditorOpen } = useTaskStore();

  // Normalise to a single list of CalendarTask
  const allTasks: CalendarTask[] = useMemo(() => {
    if (yougileMode && yougileTasksRaw) {
      return yougileTasksRaw
        .filter((t) => !t.archived && !t.deleted)
        .map(normaliseYougileTask);
    }
    return tasks.map(normaliseLocalTask);
  }, [tasks, yougileMode, yougileTasksRaw]);

  // Group tasks by date key
  const tasksByDate = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of allTasks) {
      if (!task.dateKey) continue;
      // For local tasks, skip archived
      const existing = map.get(task.dateKey);
      if (existing) existing.push(task);
      else map.set(task.dateKey, [task]);
    }
    return map;
  }, [allTasks]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const monthName = new Date(year, month).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  // Build grid cells
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const tKey = todayKey();

  // Tasks without a due date (shown in sidebar)
  const unscheduled = allTasks.filter((t) => !t.dateKey && !t.isDone);

  const handleTaskClick = (e: React.MouseEvent, task: CalendarTask) => {
    e.stopPropagation();
    (onSelectTask ?? selectTask)(task.id);
    (onOpenEditor ?? (() => setIsEditorOpen(true)))();
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Calendar grid */}
      <div className="flex flex-1 flex-col overflow-hidden px-6 py-4">
        {/* Month navigation */}
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={prevMonth}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-mono text-sm font-medium text-zinc-300">{monthName}</span>
          <button
            type="button"
            onClick={nextMonth}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Weekday headers */}
        <div className="mb-1 grid grid-cols-7 gap-px">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-1 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid flex-1 grid-cols-7 gap-px overflow-hidden">
          {Array.from({ length: totalCells }, (_, i) => {
            const dayNum = i - firstDay + 1;
            const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
            if (!isCurrentMonth) {
              return <div key={i} className="rounded" />;
            }

            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isToday = dateKey === tKey;
            const dayTasks = tasksByDate.get(dateKey) ?? [];
            const isWeekend = (i % 7 === 0) || (i % 7 === 6);

            return (
              <div
                key={i}
                className={`flex flex-col overflow-hidden rounded p-1.5 ${
                  isToday ? 'bg-cyan-500/[0.06] ring-1 ring-cyan-500/20' : 'hover:bg-zinc-900/40'
                }`}
              >
                {/* Day number */}
                <span className={`mb-1 self-end font-mono text-[11px] leading-none ${
                  isToday ? 'font-bold text-cyan-400' : isWeekend ? 'text-zinc-600' : 'text-zinc-500'
                }`}>
                  {dayNum}
                </span>

                {/* Task pills */}
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {dayTasks.slice(0, 3).map((task) => {
                    const dot = task.priority ? PRIORITY_DOT_CLASS[task.priority as TaskPriority] : null;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={(e) => handleTaskClick(e, task)}
                        className={`group flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left transition-colors hover:bg-zinc-700/60 ${
                          task.isDone ? 'opacity-40' : ''
                        }`}
                      >
                        {dot ? (
                          <div className={`h-1 w-1 shrink-0 rounded-full ${dot}`} />
                        ) : (
                          <div className="w-1 shrink-0" />
                        )}
                        <span className={`truncate font-sans text-[10px] leading-tight ${
                          task.isDone ? 'line-through text-zinc-600' : 'text-zinc-400 group-hover:text-zinc-200'
                        }`}>
                          {task.title}
                        </span>
                      </button>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <span className="pl-1 font-mono text-[9px] text-zinc-600">
                      +{dayTasks.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unscheduled sidebar */}
      {unscheduled.length > 0 && (
        <div className="flex w-48 shrink-0 flex-col border-l border-zinc-800/40">
          <div className="flex h-9 items-center px-3">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              No date
            </span>
            <span className="ml-1.5 font-mono text-[10px] text-zinc-700">{unscheduled.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {unscheduled.map((task) => {
              const dot = task.priority ? PRIORITY_DOT_CLASS[task.priority as TaskPriority] : null;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={(e) => handleTaskClick(e, task)}
                  className="group flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-900/40 transition-colors"
                >
                  {dot ? (
                    <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                  ) : (
                    <div className="w-1.5 shrink-0" />
                  )}
                  <span className="truncate font-sans text-[11px] text-zinc-500 group-hover:text-zinc-300">
                    {task.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
