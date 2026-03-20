export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'archived';
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
}

export interface CreateTaskInput {
  title?: string | null;
  rawInput?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[] | null;
  dueDate?: string | null;
  linkedNotePath?: string | null;
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
}

export interface AppSettings {
  vaultDir: string | null;
}
