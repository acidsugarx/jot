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
  deleted?: boolean;
  timestamp?: number;
  color?: string;
  users?: Record<string, string>;
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
  color?: number;
  deleted: boolean;
}

export interface YougileUser {
  id: string;
  email?: string;
  realName?: string;
  isAdmin?: boolean;
  status?: string;
  lastActivity?: number;
}

export interface YougileStringStickerState {
  id: string;
  name: string;
  color?: string;
  deleted?: boolean;
}

export interface YougileStringSticker {
  id: string;
  name: string;
  icon?: string;
  deleted?: boolean;
  states: YougileStringStickerState[];
}

export interface YougileSprintStickerState {
  id: string;
  name: string;
  begin?: number;
  end?: number;
  deleted?: boolean;
}

export interface YougileSprintSticker {
  id: string;
  name: string;
  deleted?: boolean;
  states: YougileSprintStickerState[];
}

export interface YougileChecklistItem {
  id?: string;
  title: string;
  completed: boolean;
}

export interface YougileChecklist {
  id?: string;
  title: string;
  items: YougileChecklistItem[];
}

export interface YougileDeadline {
  deadline?: number;
  startDate?: number;
  withTime?: boolean;
  history: string[];
  blockedPoints: string[];
  links: string[];
  deleted?: boolean;
  empty?: boolean;
}

export interface YougileTimeTracking {
  plan?: number;
  work?: number;
  deleted?: boolean;
}

export interface YougileStopwatch {
  running: boolean;
  seconds: number;
  atMoment?: number;
  deleted?: boolean;
}

export interface YougileTimer {
  running: boolean;
  seconds: number;
  since?: number;
  deleted?: boolean;
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
  stickers?: Record<string, unknown>;
  deadline?: YougileDeadline;
  timeTracking?: YougileTimeTracking;
  stopwatch?: YougileStopwatch;
  timer?: YougileTimer;
  createdBy?: string;
  timestamp?: number;
}

export interface CreateYougileTask {
  title: string;
  rawInput?: string;
  columnId: string;
  description?: string;
  color?: string;
  assigned?: string[];
  deadline?: YougileDeadline;
  timeTracking?: YougileTimeTracking;
  checklists?: YougileChecklist[];
  stopwatch?: YougileStopwatch;
  timer?: YougileTimer;
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
  subtasks?: string[];
  deadline?: YougileDeadline;
  timeTracking?: YougileTimeTracking;
  stickers?: Record<string, unknown>;
  checklists?: YougileChecklist[];
  stopwatch?: YougileStopwatch;
  timer?: YougileTimer;
}

export interface YougileChatMessage {
  id: number;
  fromUserId: string;
  text: string;
  textHtml?: string;
  label?: string;
  editTimestamp?: number;
  deleted: boolean;
}

export interface YougileFileUploadResponse {
  result: string;
  url: string;
  fullUrl: string;
}

export interface YougileContext {
  accountId: string | null;
  projectId: string | null;
  projectName: string | null;
  boardId: string | null;
  boardName: string | null;
}

export interface YougileSyncState extends YougileContext {
  activeSource: 'local' | 'yougile';
}
