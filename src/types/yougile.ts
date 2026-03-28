// Yougile frontend types — mirror the Rust models with camelCase

export interface YougileCompany {
  id: string;
  title: string;
}

export interface YougileAccount {
  id: string;
  email: string;
  companyId: string;
  companyName: string;
  apiKey: string;
  createdAt: string;
}

export interface YougileProject {
  id: string;
  title: string;
  color?: string;
  users?: string[];
}

export interface YougileBoard {
  id: string;
  title: string;
  projectId?: string;
  deleted: boolean;
}

export interface YougileColumn {
  id: string;
  title: string;
  boardId?: string;
  color?: string;
  deleted: boolean;
}

export interface YougileUser {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
}

export interface YougileChecklistItem {
  id?: string;
  title: string;
  completed: boolean;
}

export interface YougileChecklist {
  id?: string;
  title?: string;
  items: YougileChecklistItem[];
}

export interface YougileDeadline {
  deadline?: number;
  startDate?: number;
  withTime: boolean;
}

export interface YougileTimeTracking {
  plan?: number;
  work?: number;
}

export interface YougileTask {
  id: string;
  title: string;
  description?: string;
  color?: string;
  columnId?: string;
  completed: boolean;
  archived: boolean;
  deleted: boolean;
  assigned: string[];
  subtasks: string[];
  checklists?: YougileChecklist[];
  stickers?: Record<string, string>;
  deadline?: YougileDeadline;
  timeTracking?: YougileTimeTracking;
  createdBy?: string;
  timestamp?: number;
}

export interface CreateYougileTask {
  title: string;
  columnId: string;
  description?: string;
  color?: string;
  assigned?: string[];
  deadline?: YougileDeadline;
  checklists?: YougileChecklist[];
}

export interface UpdateYougileTask {
  title?: string;
  description?: string;
  color?: string;
  columnId?: string;
  completed?: boolean;
  archived?: boolean;
  deleted?: boolean;
  assigned?: string[];
  deadline?: YougileDeadline;
  timeTracking?: YougileTimeTracking;
  stickers?: Record<string, string>;
  checklists?: YougileChecklist[];
}

export interface YougileContext {
  accountId: string | null;
  projectId: string | null;
  projectName: string | null;
  boardId: string | null;
  boardName: string | null;
}
