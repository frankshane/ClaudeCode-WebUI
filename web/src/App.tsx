import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { ClaudeCodeLogo } from './components/Logo.tsx';
import { api, getToken, initToken, setToken, UnauthorizedError } from './lib/api.ts';
import { closeSearch, connect, newChat, openSearch, useStore } from './lib/store.ts';
import { ChatView } from './components/ChatView.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';

type Auth = 'checking' | 'ok' | 'missing' | 'invalid';

export function App() {
  // The server only asks for a token when started with --token; probe it and show the gate on a 401.
  const [auth, setAuth] = useState<Auth>(() => (initToken(), 'checking'));

  useEffect(() => {
    if (auth !== 'checking') return;
    api('/meta')
      .then(() => {
        setAuth('ok');
        connect();
      })
      .catch((err) => setAuth(err instanceof UnauthorizedError ? (getToken() ? 'invalid' : 'missing') : 'ok'));
  }, [auth]);

  if (auth === 'checking') return null;
  if (auth === 'missing' || auth === 'invalid') {
    return <TokenGate invalid={auth === 'invalid'} onSubmit={(t) => (setToken(t), setAuth('checking'))} />;
  }
  return <Shell />;
}

function Shell() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const searchOpen = useStore((s) => s.searchOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (useStore.getState().searchOpen) closeSearch();
        else openSearch();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full">
      {sidebarOpen && <Sidebar />}
      <ChatView />
      {searchOpen && <SearchDialog />}
    </div>
  );
}

function TokenGate({ invalid, onSubmit }: { invalid: boolean; onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <ClaudeCodeLogo className="fade-up mb-6" />
      <div className="fade-up w-full max-w-md space-y-3 rounded-2xl border border-line bg-panel p-6 shadow-float">
        <div className="flex items-center gap-2 font-semibold">
          <KeyRound size={18} className="text-accent" /> 需要访问令牌
        </div>
        <p className="text-sm text-muted">
          {invalid ? '令牌无效或已更换。' : ''}请使用服务启动时终端里打印的链接打开，或把令牌（保存在 ~/.ccwebui/token）粘贴到下面。
        </p>
        <input
          autoFocus
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm transition-shadow outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/12"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && onSubmit(value.trim())}
        />
        <button
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-strong disabled:opacity-40"
          disabled={!value.trim()}
          onClick={() => onSubmit(value.trim())}
        >
          继续
        </button>
      </div>
    </div>
  );
}
