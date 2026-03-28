// status is a free-form string matching a KanbanColumn.statusKey, or "archived"
export type TaskStatus = string;
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  dueDate: string | null;
  linkedNotePath: string | null;
  createdAt: string;
  updatedAt: string;
  parentId: string | null;
  color: string | null;
  timeEstimated: number | null;
  timeSpent: number | null;
}

export interface CreateTaskInput {
  title?: string | null;
  rawInput?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[] | null;
  dueDate?: string | null;
  linkedNotePath?: string | null;
  parentId?: string | null;
  color?: string | null;
}

export interface UpdateTaskStatusInput {
  id: string;
  status: TaskStatus;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  dueDate?: string | null;
  color?: string | null;
  timeEstimated?: number | null;
  timeSpent?: number | null;
}

export interface AppSettings {
  vaultDir: string | null;
  theme: string;
  yougileEnabled: boolean;
}

export interface KanbanColumn {
  id: string;
  name: string;
  statusKey: string;
  position: number;
}

export interface CreateColumnInput {
  name: string;
}

export interface UpdateColumnInput {
  id: string;
  name?: string;
}

export interface ReorderColumnsInput {
  ids: string[];
}

export interface Checklist {
  id: string;
  taskId: string;
  title: string;
  position: number;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  completed: boolean;
  position: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}
