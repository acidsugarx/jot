import { useState } from 'react';
import { useTaskStore } from '@/store/use-task-store';
import { Plus, Trash2 } from 'lucide-react';
import type { Checklist } from '@/types';

interface ChecklistEditorProps {
  taskId: string;
  checklists: Checklist[];
  onUpdate: () => void;
}

export function ChecklistEditor({ taskId, checklists, onUpdate }: ChecklistEditorProps) {
  const { createChecklist, addChecklistItem, updateChecklistItem, deleteChecklist, deleteChecklistItem } =
    useTaskStore();

  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [itemInputs, setItemInputs] = useState<Record<string, string>>({});

  const handleCreateChecklist = async () => {
    const title = newChecklistTitle.trim();
    if (!title) return;
    await createChecklist(taskId, title);
    setNewChecklistTitle('');
    onUpdate();
  };

  const handleAddItem = async (checklistId: string) => {
    const text = (itemInputs[checklistId] || '').trim();
    if (!text) return;
    await addChecklistItem(checklistId, text);
    setItemInputs((prev) => ({ ...prev, [checklistId]: '' }));
    onUpdate();
  };

  const handleToggleItem = async (itemId: string, completed: boolean) => {
    await updateChecklistItem(itemId, undefined, !completed);
    onUpdate();
  };

  const handleDeleteChecklist = async (id: string) => {
    await deleteChecklist(id);
    onUpdate();
  };

  const handleDeleteItem = async (id: string) => {
    await deleteChecklistItem(id);
    onUpdate();
  };

  return (
    <div className="space-y-3">
      {checklists.map((cl) => {
        const doneCount = cl.items.filter((i) => i.completed).length;
        return (
          <div key={cl.id} className="rounded border border-zinc-800/40 bg-[#111111] p-2">
            {/* Checklist header */}
            <div className="group/cl mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-300">{cl.title}</span>
                <span className="font-mono text-[10px] text-zinc-600">
                  {doneCount}/{cl.items.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleDeleteChecklist(cl.id)}
                className="rounded p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover/cl:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>

            {/* Items */}
            <div className="space-y-0.5">
              {cl.items.map((item) => (
                <div
                  key={item.id}
                  className="group/item flex items-center gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/40"
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => void handleToggleItem(item.id, item.completed)}
                    className="h-3 w-3 cursor-pointer rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <span
                    className={`flex-1 text-xs ${item.completed ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}
                  >
                    {item.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteItem(item.id)}
                    className="rounded p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover/item:opacity-100"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add item input */}
            <div className="mt-1 flex items-center gap-1.5 px-1">
              <Plus className="h-2.5 w-2.5 text-zinc-700" />
              <input
                type="text"
                value={itemInputs[cl.id] || ''}
                onChange={(e) => setItemInputs((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddItem(cl.id);
                  }
                }}
                placeholder="Add item..."
                className="h-5 flex-1 bg-transparent text-xs text-zinc-400 placeholder:text-zinc-700 outline-none"
              />
            </div>
          </div>
        );
      })}

      {/* Add new checklist */}
      <div className="flex items-center gap-1.5">
        <Plus className="h-3 w-3 text-zinc-700" />
        <input
          type="text"
          value={newChecklistTitle}
          onChange={(e) => setNewChecklistTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCreateChecklist();
            }
          }}
          placeholder="New checklist..."
          className="h-5 flex-1 bg-transparent text-xs text-zinc-400 placeholder:text-zinc-600 outline-none"
        />
      </div>
    </div>
  );
}
