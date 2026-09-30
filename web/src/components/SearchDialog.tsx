import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import type { SearchHit } from '../../../shared/protocol.ts';
import { api } from '../lib/api.ts';
import { baseName, shortTime } from '../lib/format.ts';
import { closeSearch, openSession, useStore } from '../lib/store.ts';
import { sessionTitle } from './Sidebar.tsx';

/** Ctrl+K palette: instant title/tag/folder filter plus debounced full-text search. */
export function SearchDialog() {
  const sessions = useStore((s) => s.sessions);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Map<string, SearchHit> | null>(null);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (q.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`)
        .then((list) => !cancelled && setHits(new Map(list.map((h) => [h.sessionId, h]))))
        .catch(() => !cancelled && setHits(new Map()))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const results = useMemo(() => {
    const all = sessions ?? [];
    if (!q) return all.slice(0, 30);
    return all
      .filter(
        (s) =>
          sessionTitle(s).toLowerCase().includes(q) ||
          s.tag?.toLowerCase().includes(q) ||
          baseName(s.cwd ?? '').toLowerCase().includes(q) ||
          hits?.has(s.sessionId),
      )
      .slice(0, 50);
  }, [sessions, q, hits]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (i: number) => {
    const s = results[i];
    if (s?.cwd) openSession(s.cwd, s.sessionId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={closeSearch}>
      <div
        className="pop-in pop-in-down w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          {searching ? <LoaderCircle size={17} className="animate-spin text-muted" /> : <Search size={17} className="text-muted" />}
          <input
            autoFocus
            className="h-12 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted"
            placeholder="搜索会话标题、标签、文件夹和对话内容"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Escape') closeSearch();
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setActive((a) => (results.length ? (a + step + results.length) % results.length : 0));
              }
              if (e.key === 'Enter') pick(active);
            }}
          />
          <button className="rounded-md p-1 text-muted transition-colors hover:bg-sunken hover:text-fg" onClick={closeSearch}>
            <X size={17} />
          </button>
        </div>
        <div ref={listRef} className="scroll-thin max-h-[60vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted">{searching ? '搜索中…' : '没有找到匹配的会话'}</div>
          ) : (
            results.map((s, i) => {
              const hit = hits?.get(s.sessionId);
              return (
                <button
                  key={s.sessionId}
                  data-i={i}
                  className={`block w-full rounded-lg px-2.5 py-2 text-left ${i === active ? 'bg-sunken' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{sessionTitle(s)}</span>
                    {s.tag && <span className="shrink-0 rounded-full bg-accent/12 px-1.5 text-[0.6875rem] font-medium text-accent-strong">{s.tag}</span>}
                    <span className="shrink-0 text-xs tabular-nums text-faint">
                      {baseName(s.cwd ?? '')} · {shortTime(s.lastModified)}
                    </span>
                  </div>
                  {hit?.snippets.slice(0, 2).map((sn, n) => (
                    <div key={n} className="mt-0.5 truncate text-xs text-muted">
                      <span className="mr-1 opacity-70">{sn.role === 'user' ? '你:' : 'Claude:'}</span>
                      {sn.text.slice(0, sn.start)}
                      <mark className="rounded-sm bg-accent/25 px-0.5 text-fg">{sn.text.slice(sn.start, sn.end)}</mark>
                      {sn.text.slice(sn.end)}
                    </div>
                  ))}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
