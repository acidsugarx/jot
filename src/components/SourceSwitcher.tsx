import { useState } from 'react';
import { ChevronDown, Monitor, Cloud } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';

export function SourceSwitcher() {
  const {
    activeSource, setActiveSource, yougileEnabled,
    yougileContext, setYougileContext,
    accounts, projects, boards,
    fetchProjects, fetchBoards,
  } = useYougileStore();

  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showBoardPicker, setShowBoardPicker] = useState(false);

  if (!yougileEnabled) return null;

  const handleSourceToggle = () => {
    if (activeSource === 'local') {
      if (accounts.length === 0) return;
      setActiveSource('yougile');
    } else {
      setActiveSource('local');
    }
  };

  const handleSelectAccount = async (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    setYougileContext({
      accountId,
      projectId: null,
      projectName: null,
      boardId: null,
      boardName: null,
    });
    setShowOrgPicker(false);
    await fetchProjects();
  };

  const handleSelectProject = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    setYougileContext({
      projectId,
      projectName: project.title,
      boardId: null,
      boardName: null,
    });
    setShowProjectPicker(false);
    await fetchBoards(projectId);
  };

  const handleSelectBoard = (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) return;
    setYougileContext({ boardId, boardName: board.title });
    setShowBoardPicker(false);
  };

  const activeAccount = accounts.find((a) => a.id === yougileContext.accountId);

  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        onClick={handleSourceToggle}
        className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
          activeSource === 'yougile'
            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
        }`}
      >
        {activeSource === 'local' ? <Monitor size={12} /> : <Cloud size={12} />}
        {activeSource === 'local' ? 'Local' : 'Yougile'}
      </button>

      {activeSource === 'yougile' && (
        <div className="flex items-center gap-1 text-zinc-500">
          <div className="relative">
            <button
              onClick={() => setShowOrgPicker(!showOrgPicker)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
            >
              {activeAccount?.companyName || 'Select org'}
              <ChevronDown size={10} />
            </button>
            {showOrgPicker && (
              <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => void handleSelectAccount(a.id)}
                    className="block w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    {a.companyName}
                    <span className="text-zinc-600 ml-1">{a.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {yougileContext.accountId && (
            <>
              <span className="text-zinc-700">/</span>
              <div className="relative">
                <button
                  onClick={() => setShowProjectPicker(!showProjectPicker)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
                >
                  {yougileContext.projectName || 'Select project'}
                  <ChevronDown size={10} />
                </button>
                {showProjectPicker && (
                  <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => void handleSelectProject(p.id)}
                        className="block w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {yougileContext.projectId && (
            <>
              <span className="text-zinc-700">/</span>
              <div className="relative">
                <button
                  onClick={() => setShowBoardPicker(!showBoardPicker)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300"
                >
                  {yougileContext.boardName || 'Select board'}
                  <ChevronDown size={10} />
                </button>
                {showBoardPicker && (
                  <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                    {boards.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => handleSelectBoard(b.id)}
                        className="block w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        {b.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
