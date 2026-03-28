import type { TaskPriority } from '@/types';

export const priorityOptions: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'none', label: 'None', color: 'text-zinc-600' },
  { value: 'low', label: 'Low', color: 'text-blue-400' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-400' },
  { value: 'high', label: 'High', color: 'text-orange-400' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-400' },
];

export const priorityColor: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};
