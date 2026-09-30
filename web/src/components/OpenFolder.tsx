import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { PickFolderResult } from '../../../shared/protocol.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.ts';

const secondaryBtn = 'rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:bg-sunken';

/**
 * Picks a project folder. Opens the OS folder dialog (shown by the server, which is the only one that can
 * return a real path) as soon as it mounts; falls back to typing a path when no dialog is available.
 */
export function OpenFolder({ onOpen, onCancel }: { onOpen: (path: string) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'picking' | 'typing'>('picking');
  const [note, setNote] = useState<string | null>(null);
  const pickId = useRef<string | null>(null);
  const handlers = useRef({ onOpen, onCancel });
  handlers.current = { onOpen, onCancel };

  /** Closes the dialog this panel opened, if it is still up. */
  const closeDialog = () => {
    const id = pickId.current;
    pickId.current = null;
    if (id) api(`/fs/pick/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const openDialog = () => {
    closeDialog();
    const id = crypto.randomUUID();
    pickId.current = id;
    setMode('picking');
    setNote(null);
    const fallback = (reason: string) => {
      setNote(reason);
      setMode('typing');
    };
    api<PickFolderResult>('/fs/pick', { method: 'POST', body: { id, near: useStore.getState().view?.cwd } }).then(
      (r) => {
        if (pickId.current !== id) return; // closed from here, or replaced by a newer dialog
        pickId.current = null;
        if (r.status === 'picked') handlers.current.onOpen(r.path);
        else if (r.status === 'cancelled') handlers.current.onCancel();
        else fallback(r.reason);
      },
      (err) => {
        if (pickId.current !== id) return;
        pickId.current = null;
        fallback(`无法打开文件夹选择窗口：${err instanceof Error ? err.message : err}`);
      },
    );
  };

  useEffect(() => {
    openDialog();
    return closeDialog;
  }, []);

  if (mode === 'picking') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <LoaderCircle size={13} className="shrink-0 animate-spin text-accent" />
          请在弹出的窗口中选择文件夹
        </div>
        <div className="flex gap-1">
          <button className={secondaryBtn} title="窗口被挡住或找不到时，重新弹出" onClick={openDialog}>
            重新弹出
          </button>
          <button
            className={secondaryBtn}
            onClick={() => {
              closeDialog();
              setMode('typing');
            }}
          >
            手动输入路径
          </button>
          <button
            className={secondaryBtn}
            onClick={() => {
              closeDialog();
              onCancel();
            }}
          >
            取消
          </button>
        </div>
      </div>
    );
  }
  return <PathInput note={note} onOpen={onOpen} onCancel={onCancel} />;
}

/** Path input that validates a directory on the server before accepting it. */
function PathInput({ note, onOpen, onCancel }: { note: string | null; onOpen: (path: string) => void; onCancel: () => void }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const res = await api<{ ok: boolean; path?: string; error?: string }>(`/fs/dir?path=${encodeURIComponent(path)}`);
    if (res.ok && res.path) onOpen(res.path);
    else setError(res.error ?? '无法打开');
  };
  return (
    <div className="space-y-1">
      {note && <div className="text-xs text-muted">{note}</div>}
      <input
        autoFocus
        className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-xs transition-shadow outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/12"
        placeholder="目录绝对路径，或 ~/code/my-app"
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex gap-1">
        <button className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-strong" onClick={() => void submit()}>
          打开
        </button>
        <button className={secondaryBtn} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
