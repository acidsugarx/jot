# Product Requirements Document (PRD) & Development Flow

**Project Name:** Jot
**Core Identity:** A frictionless, keyboard-centric task manager and Zettelkasten bridge.
**Target OS:** macOS (Primary focus), Cross-platform via Tauri.

---

## 1. Context & Architecture (For LLM)

**System Paradigm:** Jot acts as the "Command Center". It strictly separates stateful task data from long-form knowledge.

* **Tasks belong to Jot:** Stored locally in a high-speed SQLite database. Jot handles filtering, queries, statuses, and deadlines.
* **Notes belong to the File System:** Stored as standard .md files in an external Obsidian Vault.
* **The Bridge:** Jot links tasks to notes via absolute file paths and can trigger the OS to open these notes in Obsidian (via URI) or Neovim (via a configurable shell command).

## 2. Tech Stack

* **Backend / System:** Rust + Tauri v2
* **Database:** Local SQLite (using rusqlite)
* **Frontend:** React 18+, TypeScript, Vite
* **UI Components:** shadcn/ui (Command, Badge, ScrollArea, Button)
* **Styling:** Tailwind CSS (brutalist dark mode - zinc-950 background, zinc-800 borders)
* **Icons:** Lucide React
* **State Management:** Zustand
* **Aesthetic:** Dark mode brutalist with sharp edges (rounded-lg), high contrast (zinc-50/100/300), translucent glass effects (backdrop-blur-xl)

---

## 3. Core Features & UX Flow

### 3.1. Dual-Mode Interface

The app runs as a background daemon (System Tray) with zero idle window footprint.

1. **Zen-Popup (Quick Capture):** Triggered via global shortcut (e.g., Opt+Space). A transient, cmdk-powered search/input bar. Disappears on blur or Esc.
2. **Dashboard (Management):** Triggered via secondary shortcut (e.g., Cmd+Shift+Space). A full-window view for Kanbans, lists, and deep management.
3. **Vim-Centric Navigation:** Complete UI traversal using j/k (up/down), / (search), x (toggle done), Enter (action).

### 3.2. Smart Input & NLP Parsing

The input string acts as a CLI command.

* **Format:** [Task Title] #[tag] ![priority] [date/time] [@zettel]
* **Example:** Write architecture review tomorrow at 10am #work !high @zettel
* **Behavior:** Rust parses this string on submission, extracts metadata, creates the SQLite entry, and triggers file generation if operators like @zettel are present.

### 3.3. The Obsidian / Neovim Bridge

When the @zettel flag is used:

1. **File Generation:** Rust creates a file YYYYMMDDHHMM-title.md in a pre-configured target directory.
2. **Templating:** Injects a base YAML frontmatter and H1 tag.
3. **Path Linking:** Saves the absolute path of the generated .md file to the linked_note_path column in SQLite.
4. **Opening Mechanism (Dual-Engine):**
* *GUI Mode:* Execute system open via obsidian://open?file=...
* *CLI Mode:* Execute a configurable shell command (e.g., `nvim <path>` or a custom script) opening the file in the user's preferred editor/terminal.



---

## 4. Data Schema (SQLite)

**Table:** tasks
CREATE TABLE tasks (
id TEXT PRIMARY KEY,               -- UUID
title TEXT NOT NULL,               -- Parsed task name
status TEXT DEFAULT 'todo',        -- 'todo', 'in_progress', 'done', 'archived'
priority TEXT DEFAULT 'none',      -- 'low', 'medium', 'high', 'urgent', 'none'
tags TEXT,                         -- JSON array of strings ["work", "dev"]
due_date DATETIME,                 -- Parsed from NLP
linked_note_path TEXT,             -- Absolute path to the .md file (if @zettel used)
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

---

## 5. Development Flow & Phases (Instructions for LLM)

When assisting with building this application, strictly follow these phases sequentially. Do not jump to UI design before the Rust core is stable.

### Phase 1: Foundation & IPC Setup

1. Initialize Tauri v2 with React + TypeScript.
2. Configure Tauri to start hidden (System Tray daemon).
3. Implement Global Shortcut registration in Rust (Opt+Space).
4. Create basic IPC commands (Frontend -> Rust): hide_window, show_window.

### Phase 2: Database & Core Rust Logic

1. Initialize SQLite via rusqlite or sqlx in the Tauri setup phase. Ensure the .db file is stored in the OS-native AppData/ApplicationSupport directory.
2. Implement Rust structs representing the Task model.
3. Write CRUD operations in Rust and expose them via tauri::command.
* create_task, get_tasks, update_task_status, delete_task.



### Phase 3: NLP & The Zettel Bridge (Rust)

1. Implement a parser function in Rust to extract tags (#), priority (!), and dates from a raw string.
2. Implement the @zettel logic:
* Read Vault target path from a config/env.
* Write .md file via std::fs.
* Return the created path to the SQLite create_task pipeline.


3. Implement the open_linked_note command (handling both URI scheme execution and terminal process spawning).

### Phase 4: Transient UI & React Frontend

1. Setup Tailwind CSS and install cmdk.
2. Build the Raycast-like popup interface.
3. Connect the cmdk input to the Rust create_task IPC command.
4. Implement optimistic UI updates using Zustand.
5. Add Action Menu (Cmd+K) on selected items to trigger status changes or open the linked note file.

### Phase 5: Dashboard & Vim Bindings

1. Build the expanded UI (Board/List views).
2. Implement global keyboard event listeners in React for j/k navigation.
3. Finalize the styling and transition animations between Zen-Popup and Dashboard modes.

Here is the UI/UX style guide formatted as plain text instructions for an LLM. You can copy and paste this directly into your context window alongside the PRD.

---

# UI/UX Style Guide & Design Principles for "Jot"

## 1. Core Aesthetic & Vibe (For the LLM)

When generating UI code (React/Tailwind), adhere strictly to a "Developer-First, Invisible UI" aesthetic. Think Linear, Vercel, Raycast, and Neovim. The interface should feel like a high-end CLI tool rather than a traditional bloated web app.

* **No Clutter:** Remove unnecessary borders, heavy drop shadows, and visual noise.
* **High Density:** Information should be structured compactly, similar to lines of code in a terminal or an IDE.
* **Keyboard-First:** Every interactive element must have a visible keyboard shortcut hint (e.g., [Cmd+K], [Enter]). Hide mouse-only controls (like "Save" buttons).

## 2. Color Palette & Typography

* **Backgrounds:** Use true black (#000000) or very deep graphite (#0A0A0A) for primary backgrounds to reduce eye strain and match terminal environments.
* **Accents:** Use a single, subtle accent color (e.g., neon purple or muted cyan) strictly for active states, parsed tags, or the `@zettel` operator.
* **UI Font:** Use modern, clean sans-serif fonts like Inter or Geist.
* **Data Font:** Use a monospace font (JetBrains Mono, Geist Mono, or Fira Code) exclusively for tags (#work), operators (!high), and metadata (dates). This visually separates parsed metadata from natural language.

## 3. Zen-Popup Mode (Quick Capture Component)

This is the transient overlay triggered by the global shortcut.

* **Structure:** A centered, floating command palette powered by the `cmdk` library.
* **Styling:** Implement a slight glassmorphism effect (backdrop-blur) with a semi-transparent background. Use a very subtle 1px border (white at 10% opacity) and a soft, diffuse shadow to lift it from the OS background.
* **Input Field:** An oversized, borderless (outline-none) text input.
* **Syntax Highlighting:** As the user types, dynamically highlight NLP operators (e.g., turn `!high` red and `@zettel` blue) right inside the input field to provide instant parsing feedback.
* **Dropdown List:** A smooth, spring-animated dropdown list for search results or command actions, featuring small gray keyboard hints on the right side of each row.

### 4. Secondary Windows (Settings / Future Modals)

* **Raycast Native Presentation:** All standalone configuration windows MUST utilize native macOS traffic lights seamlessly rendering over the React tree using Tauri's `TitleBarStyle::Overlay`. 
* **Header Navigation:** Ditch sidebars for horizontally top-aligned flex tabs dragged via `data-tauri-drag-region`.
* **Auto-Save Workflows:** Do not use massive standard "Save/Close" footers. Forms should commit immediately on change (`onBlur`, `onKeyDown`) and sync globally utilizing Tauri `emit()` handlers.

## 4. Dashboard Mode (Main Window Component)

The expanded view for deep task management.

* **Layout:** Prefer a dense List View over bulky Kanban cards.
* **Task Rows:** Render tasks as clean, horizontal rows.
* Left: Custom minimal checkbox.
* Center: Task title in sans-serif.
* Right: Monospace badges for dates and tags. If `linked_note_path` exists, show a subtle document/Obsidian icon.


* **Sidebar:** A collapsible, minimal left sidebar for basic filters (Inbox, Today, Tags).
* **Split View:** Pressing Enter on a task can slide in an optional right-side details pane without leaving the list context.

## 5. Micro-interactions & Polish

* **Animations:** Use Framer Motion (or standard CSS transitions) for very fast, spring-based micro-animations (100-200ms). Menus should snap into place without feeling sluggish.
* **State Changes:** When a task is checked off, lower its opacity to 50% and apply a strikethrough rather than making it disappear instantly.

