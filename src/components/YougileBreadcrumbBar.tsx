import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';

export function YougileBreadcrumbBar() {
  const {
    yougileEnabled,
    activeSource,
    accounts,
    projects,
    boards,
    yougileContext,
    setYougileContext,
    setActiveSource,
    fetchAccounts,
    fetchProjects,
    fetchBoards,
    fetchColumns,
    fetchTasks,
    fetchUsers,
    selectTask,
  } = useYougileStore();

  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showBoardPicker, setShowBoardPicker] = useState(false);

  useEffect(() => {
    if (!yougileEnabled || activeSource !== 'yougile') return;
    if (accounts.length === 0) {
      void fetchAccounts();
    }
  }, [yougileEnabled, activeSource, accounts.length, fetchAccounts]);

  if (!yougileEnabled || activeSource !== 'yougile') return null;

  const activeAccount = accounts.find((account) => account.id === yougileContext.accountId);

  const handleSelectAccount = async (accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;

    setYougileContext({
      accountId,
      projectId: null,
      projectName: null,
      boardId: null,
      boardName: null,
    });
    selectTask(null);
    setShowOrgPicker(false);
    await fetchProjects();
  };

  const handleSelectProject = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    setYougileContext({
      projectId,
      projectName: project.title,
      boardId: null,
      boardName: null,
    });
    selectTask(null);
    setShowProjectPicker(false);
    await Promise.all([fetchBoards(projectId), fetchUsers(projectId)]);
  };

  const handleSelectBoard = async (boardId: string) => {
    const board = boards.find((item) => item.id === boardId);
    if (!board) return;

    setYougileContext({ boardId, boardName: board.title });
    setActiveSource('yougile');
    selectTask(null);
    setShowBoardPicker(false);
    await fetchColumns(boardId);
    await fetchTasks();
  };

  if (accounts.length === 0) {
    return (
      <div className="flex h-9 items-center justify-between border-b border-zinc-800/40 bg-[#141414] px-4">
        <span className="text-xs text-zinc-500">No Yougile accounts connected.</span>
        <button
          type="button"
          onClick={() => void invoke('open_settings_window')}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-cyan-400 hover:bg-zinc-800"
        >
          <Settings className="h-3 w-3" />
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-9 items-center gap-1 border-b border-zinc-800/40 bg-[#141414] px-4 text-xs text-zinc-500">
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowOrgPicker((open) => !open)}
          className="flex items-center gap-1 rounded px-2 py-1 text-zinc-300 hover:bg-zinc-800"
        >
          {activeAccount?.companyName ?? 'Select org'}
          <ChevronDown className="h-3 w-3 text-zinc-600" />
        </button>
        {showOrgPicker && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => void handleSelectAccount(account.id)}
                className="block w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
              >
                <span className="text-zinc-200">{account.companyName}</span>
                <span className="ml-1 text-zinc-600">{account.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ChevronRight className="h-3 w-3 text-zinc-700" />

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowProjectPicker((open) => !open)}
          className="flex items-center gap-1 rounded px-2 py-1 text-zinc-300 hover:bg-zinc-800"
        >
          {yougileContext.projectName ?? 'Select project'}
          <ChevronDown className="h-3 w-3 text-zinc-600" />
        </button>
        {showProjectPicker && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => void handleSelectProject(project.id)}
                className="block w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
              >
                {project.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <ChevronRight className="h-3 w-3 text-zinc-700" />

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowBoardPicker((open) => !open)}
          className="flex items-center gap-1 rounded px-2 py-1 text-zinc-300 hover:bg-zinc-800"
        >
          {yougileContext.boardName ?? 'Select board'}
          <ChevronDown className="h-3 w-3 text-zinc-600" />
        </button>
        {showBoardPicker && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
            {boards.map((board) => (
              <button
                key={board.id}
                type="button"
                onClick={() => void handleSelectBoard(board.id)}
                className="block w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
              >
                {board.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
