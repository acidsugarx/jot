import { useEffect, useState } from 'react';
import { LayoutList, Columns, Calendar as CalendarIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KanbanBoard } from '@/components/KanbanBoard';
import { TaskEditorPane } from '@/components/TaskEditorPane';
import { useTaskStore } from '@/store/use-task-store';
import { Task } from '@/types';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useVimBindings, ViewMode } from '@/hooks/use-vim-bindings';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('list');
  const { tasks, fetchTasks, selectedTaskId, selectTask, isEditorOpen, setIsEditorOpen } = useTaskStore();

  useVimBindings(activeTab as ViewMode);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#111111] font-sans text-zinc-100 selection:bg-cyan-500/30">
      
      {/* Header Overlay */}
      <div 
        data-tauri-drag-region 
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
            void getCurrentWindow().startDragging();
          }
        }}
        className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-6 shadow-sm backdrop-blur-md pl-[80px]"
      >
        <div data-tauri-drag-region className="flex items-center gap-4 pointer-events-none">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full mt-2 pointer-events-auto">
            <TabsList className="bg-transparent h-10 border border-zinc-700/50 rounded-md">
              <TabsTrigger value="list" className="data-[state=active]:bg-zinc-800">
                <LayoutList className="h-4 w-4 mr-2" />
                List
              </TabsTrigger>
              <TabsTrigger value="kanban" className="data-[state=active]:bg-zinc-800">
                <Columns className="h-4 w-4 mr-2" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="calendar" className="data-[state=active]:bg-zinc-800">
                <CalendarIcon className="h-4 w-4 mr-2" />
                Calendar
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        
        <div className="flex items-center text-zinc-400">
          <span className="text-xs bg-zinc-800/80 px-2.5 py-1 rounded-md font-medium tracking-wider cursor-pointer hover:bg-zinc-700 transition-colors text-zinc-300">
            {tasks.length} {tasks.length === 1 ? 'Task' : 'Tasks'} Loaded
          </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Content Pane */}
        <div className="flex-1 overflow-y-auto w-full relative z-0">
            {activeTab === 'list' && (
              <div className="p-8 pb-32">
                  <h2 className="text-xl font-semibold mb-6">List View</h2>
                  <div className="flex flex-col gap-2">
                      {tasks.map((t: Task) => (
                          <div 
                            key={t.id} 
                            onClick={() => selectTask(t.id)}
                            onDoubleClick={() => setIsEditorOpen(true)}
                            className={`p-4 rounded-lg border shadow-sm hover:border-zinc-500 transition-colors cursor-pointer flex justify-between items-center group ${
                              selectedTaskId === t.id ? 'border-cyan-500/50 bg-[#1e1e1a]' : 'border-zinc-700/60 bg-[#27272A] hover:bg-[#2e2e33]'
                            }`}
                          >
                            <span className="font-medium text-zinc-100 tracking-tight">{t.title}</span>
                            <span className="text-xs font-mono px-2 py-1 bg-zinc-900 rounded text-zinc-400 group-hover:text-cyan-400 transition-colors">
                              {t.status}
                            </span>
                          </div>
                      ))}
                  </div>
              </div>
            )}
            {activeTab === 'kanban' && (
              <div className="h-full w-full">
                  <KanbanBoard />
              </div>
            )}
            {activeTab === 'calendar' && (
              <div className="p-8">
                  <h2 className="text-xl font-semibold mb-6">Calendar / Gantt</h2>
                  <p className="text-zinc-500">Timeline view based on `due_date` loading...</p>
              </div>
            )}
        </div>

        {/* TaskEditorPane Slide-in Overlay Logic */}
        <div 
          className={`absolute right-0 top-0 h-full transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-10 ${
            selectedTaskId && isEditorOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'
          }`}
        >
          <TaskEditorPane />
        </div>
      </div>
    </div>
  );
}
