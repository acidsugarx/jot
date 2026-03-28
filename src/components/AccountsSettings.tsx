import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';
import type { YougileCompany } from '@/types/yougile';

export function AccountsSettings() {
  const { accounts, login, addAccount, removeAccount, fetchAccounts } = useYougileStore();
  const [step, setStep] = useState<'list' | 'credentials' | 'company'>('list');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<YougileCompany[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const handleLogin = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await login(email, password);
      if (result.length === 0) {
        // Check store for error message
        const storeState = useYougileStore.getState();
        setError(storeState.error || 'Invalid credentials or no organizations found');
        return;
      }
      setCompanies(result);
      setStep('company');
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [email, password, login]);

  const handleSelectCompany = useCallback(async (company: YougileCompany) => {
    setIsLoading(true);
    setError(null);
    try {
      await addAccount(email, password, company.id, company.title);
      setStep('list');
      setEmail('');
      setPassword('');
      setCompanies([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [email, password, addAccount]);

  const handleRemove = useCallback(async (id: string) => {
    await removeAccount(id);
  }, [removeAccount]);

  if (step === 'credentials') {
    return (
      <div className="space-y-3">
        <div className="text-sm text-zinc-300 mb-2">Sign in to Yougile</div>
        {error && <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-500"
        />
        <div className="flex gap-2">
          <button onClick={() => setStep('list')} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button
            onClick={() => void handleLogin()}
            disabled={isLoading || !email || !password}
            className="px-3 py-1.5 text-sm bg-cyan-500/10 text-cyan-400 rounded hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : 'Sign In'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'company') {
    return (
      <div className="space-y-3">
        <div className="text-sm text-zinc-300 mb-2">Select organization</div>
        {error && <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>}
        {companies.map((c) => (
          <button
            key={c.id}
            onClick={() => void handleSelectCompany(c)}
            disabled={isLoading}
            className="block w-full text-left px-3 py-2 bg-zinc-800 border border-zinc-700 rounded hover:border-cyan-500 text-sm text-zinc-200"
          >
            {c.title}
          </button>
        ))}
        <button onClick={() => setStep('credentials')} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">Back</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.length === 0 ? (
        <div className="text-sm text-zinc-500">No Yougile accounts connected.</div>
      ) : (
        accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between px-3 py-2 bg-zinc-800 border border-zinc-700 rounded">
            <div>
              <div className="text-sm text-zinc-200">{account.companyName}</div>
              <div className="text-xs text-zinc-500">{account.email}</div>
            </div>
            <button onClick={() => void handleRemove(account.id)} className="p-1 text-zinc-600 hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
        ))
      )}
      <button onClick={() => setStep('credentials')} className="flex items-center gap-1 px-3 py-1.5 text-sm text-cyan-400 hover:text-cyan-300">
        <Plus size={14} /> Add Account
      </button>
    </div>
  );
}
