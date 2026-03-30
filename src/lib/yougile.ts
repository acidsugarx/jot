export const YOUGILE_TASK_COLOR_OPTIONS = [
  { value: 'task-primary', label: 'Default', hex: '#7B869E' },
  { value: 'task-gray', label: 'Gray', hex: '#667085' },
  { value: 'task-red', label: 'Red', hex: '#EB3737' },
  { value: 'task-pink', label: 'Pink', hex: '#E25EF2' },
  { value: 'task-yellow', label: 'Yellow', hex: '#F5CC00' },
  { value: 'task-green', label: 'Green', hex: '#5CDC11' },
  { value: 'task-turquoise', label: 'Turquoise', hex: '#08A7A9' },
  { value: 'task-blue', label: 'Blue', hex: '#5089F2' },
  { value: 'task-violet', label: 'Violet', hex: '#CC8CFF' },
] as const;

const YOUGILE_TASK_COLOR_MAP = new Map<string, string>(
  YOUGILE_TASK_COLOR_OPTIONS.map((option) => [option.value, option.hex])
);

export function getYougileTaskColorValue(color: string | null | undefined): string | null {
  if (!color) return null;
  return YOUGILE_TASK_COLOR_MAP.get(color) ?? null;
}

export function formatYougileTrackedHours(hours: number | null | undefined): string {
  if (hours == null) return '—';

  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (wholeHours === 0) return `${minutes}m`;
  if (minutes === 0) return `${wholeHours}h`;
  return `${wholeHours}h ${minutes}m`;
}

/**
 * Type guard: true when the task comes from Yougile (has `columnId`).
 * Works with both `Task | YougileTask` and `CardTask` union types.
 */
export function isYougileTask(task: Record<string, unknown>): boolean {
  return 'columnId' in task && task.columnId !== undefined;
}

export const PRIORITY_DOT_CLASS: Record<string, string> = {
  urgent: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-yellow-400',
  low: 'bg-blue-400',
  none: '',
};
