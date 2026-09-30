import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Download, LoaderCircle, Puzzle, RefreshCw, Search, ShieldAlert, Trash } from 'lucide-react';
import type { AvailablePlugin, InstalledPlugin, PluginActionResult, PluginCatalog } from '../../../shared/protocol.ts';
import { api } from '../lib/api.ts';
import { reloadPlugins } from '../lib/store.ts';

type Tab = 'installed' | 'market';

/** Market rows rendered before the user types a filter (the list is sorted by popularity). */
const MARKET_PAGE = 60;

const iconBtn = 'flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-fg';
const row = 'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors';

/** Installed plugins (enable, disable, uninstall) and the marketplace (browse, install). */
export function PluginsPanel({ onBack }: { onBack: () => void }) {
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [tab, setTab] = useState<Tab>('installed');
  const [filter, setFilter] = useState('');
  /** Plugin id (or 'marketplaces') with an operation in flight. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; command: string; sha256: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<PluginCatalog>('/plugins').then(setCatalog, (err) => setError(String(err?.message ?? err)));
  };
  useEffect(load, []);

  /** Runs one plugin request; `apply` gets the parsed response on success. */
  const run = async <T,>(key: string, request: () => Promise<T>, apply: (res: T) => void) => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      apply(await request());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  /** Shared handling for install / uninstall / marketplace-update results. */
  const settle = (res: PluginActionResult, success: string, id?: string) => {
    if (res.catalog) setCatalog(res.catalog);
    if (res.confirm && id) setConfirm({ id, ...res.confirm });
    else if (!res.ok) setError(res.message || '操作失败');
    else {
      setDone(success);
      reloadPlugins();
    }
  };

  const toggle = (p: InstalledPlugin) =>
    run(p.id, () => api<PluginCatalog>('/plugins/toggle', { method: 'POST', body: { id: p.id, enabled: !p.enabled } }), (c) => {
      setCatalog(c);
      reloadPlugins();
    });

  const install = (id: string, acceptCommand?: string) => {
    setConfirm(null);
    return run(id, () => api<PluginActionResult>('/plugins/install', { method: 'POST', body: { id, acceptCommand } }), (res) =>
      settle(res, `已安装 ${id.split('@')[0]}，当前会话已加载`, id),
    );
  };

  const uninstall = (p: InstalledPlugin) => {
    setRemoving(null);
    return run(p.id, () => api<PluginActionResult>('/plugins/uninstall', { method: 'POST', body: { id: p.id, scope: p.scope } }), (res) =>
      settle(res, `已卸载 ${p.name}`),
    );
  };

  const updateMarketplaces = () =>
    run('marketplaces', () => api<PluginActionResult>('/plugins/marketplaces/update', { method: 'POST' }), (res) =>
      settle(res, res.message || '市场目录已更新'),
    );

  const f = filter.trim().toLowerCase();
  const matches = (p: { name: string; description?: string }) =>
    !f || p.name.toLowerCase().includes(f) || !!p.description?.toLowerCase().includes(f);
  const installed = useMemo(() => (catalog?.installed ?? []).filter(matches), [catalog, f]);
  const available = useMemo(() => (catalog?.available ?? []).filter(matches), [catalog, f]);
  const shownAvailable = f ? available : available.slice(0, MARKET_PAGE);

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-line px-1.5 py-1.5">
        <button className={iconBtn} onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        <span className="flex-1 text-sm font-semibold">插件</span>
        <div className="flex rounded-lg bg-sunken p-0.5 text-xs" role="tablist">
          {(['installed', 'market'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`rounded-md px-2.5 py-1 transition-colors ${tab === t ? 'bg-panel font-medium shadow-card' : 'text-muted hover:text-fg'}`}
              onClick={() => {
                setTab(t);
                setError(null);
                setDone(null);
              }}
            >
              {t === 'installed' ? `已安装${catalog ? ` ${catalog.installed.length}` : ''}` : `市场${catalog ? ` ${catalog.available.length}` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2.5 pt-2">
        <label className="flex items-center gap-1.5 rounded-lg border border-line bg-bg px-2 focus-within:border-accent/60 focus-within:ring-3 focus-within:ring-accent/12">
          <Search size={14} className="text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted/70"
            placeholder={tab === 'installed' ? '筛选已安装的插件' : '搜索市场里的插件'}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      </div>

      {/* Header, search and footer take ~8.5rem; the list gets the rest of the room the dropdown has. */}
      <div className="scroll-thin max-h-[min(22rem,calc(var(--dd-room,100vh)-8.5rem))] overflow-y-auto p-1">
        {error && <div className="mx-1.5 mb-1 rounded-md bg-red-500/10 px-2 py-1.5 text-xs break-words text-red-700 dark:text-red-300">{error}</div>}
        {done && <div className="mx-1.5 mb-1 rounded-md bg-green-500/10 px-2 py-1.5 text-xs text-green-700 dark:text-green-300">{done}</div>}
        {confirm && (
          <div className="mx-1.5 mb-1.5 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/8 p-2.5 text-xs">
            <div className="flex items-start gap-1.5 font-medium text-amber-800 dark:text-amber-300">
              <ShieldAlert size={15} className="mt-px shrink-0" />
              安装 {confirm.id.split('@')[0]} 需要在你的电脑上执行下面这条命令，请确认它可信：
            </div>
            <pre className="max-h-32 overflow-auto rounded-md bg-sunken/80 px-2 py-1.5 font-mono text-[0.6875rem] whitespace-pre-wrap break-all">{confirm.command}</pre>
            <div className="flex gap-1.5">
              <button
                className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-fg transition-colors hover:bg-accent-strong"
                onClick={() => void install(confirm.id, confirm.sha256)}
              >
                确认执行并安装
              </button>
              <button className="rounded-md border border-line px-2.5 py-1 transition-colors hover:bg-sunken" onClick={() => setConfirm(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        {catalog === null ? (
          !error && (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted">
              <LoaderCircle size={14} className="animate-spin" /> 读取插件列表…
            </div>
          )
        ) : tab === 'installed' ? (
          installed.length === 0 ? (
            <div className="px-2 py-2 text-sm text-muted">{f ? '没有匹配的插件' : '还没有安装插件，去「市场」看看。'}</div>
          ) : (
            installed.map((p) =>
              removing === p.id ? (
                <div key={p.id} className="mx-1 my-0.5 space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 px-2.5 py-2 text-sm">
                  <div>
                    卸载「<span className="font-medium">{p.name}</span>」？
                    <div className="text-xs text-muted">会删除插件文件和它的数据目录，之后可以从市场重新安装。</div>
                  </div>
                  <div className="flex gap-1.5 text-xs">
                    <button className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700" onClick={() => void uninstall(p)}>
                      卸载
                    </button>
                    <button className="rounded-md border border-line px-2.5 py-1 hover:bg-sunken" onClick={() => setRemoving(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div key={p.id} className={`${row} group hover:bg-sunken`}>
                  <Puzzle size={16} className={`shrink-0 ${p.enabled ? 'text-accent' : 'text-muted'}`} />
                  <button className="min-w-0 flex-1 text-left disabled:opacity-60" disabled={busy !== null} onClick={() => void toggle(p)}>
                    <span className="block truncate text-sm">
                      {p.name}
                      {p.version && <span className="ml-1.5 text-xs text-muted">{p.version.length > 12 ? p.version.slice(0, 7) : p.version}</span>}
                      {p.scope !== 'user' && <span className="ml-1.5 rounded-full border border-line px-1.5 text-[0.6875rem] text-muted">{p.scope}</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">{p.description || p.marketplace}</span>
                  </button>
                  {busy === p.id ? (
                    <LoaderCircle size={16} className="shrink-0 animate-spin text-muted" />
                  ) : (
                    <>
                      <button
                        className={`${iconBtn} shrink-0 opacity-0 group-hover:opacity-100 hover:text-red-600 disabled:hidden`}
                        title="卸载"
                        disabled={busy !== null}
                        onClick={() => setRemoving(p.id)}
                      >
                        <Trash size={14} />
                      </button>
                      <button className="shrink-0 disabled:opacity-60" title={p.enabled ? '停用' : '启用'} disabled={busy !== null} onClick={() => void toggle(p)}>
                        <Toggle on={p.enabled} />
                      </button>
                    </>
                  )}
                </div>
              ),
            )
          )
        ) : shownAvailable.length === 0 ? (
          <div className="px-2 py-2 text-sm text-muted">{f ? '没有匹配的插件' : '市场里的插件都已安装。'}</div>
        ) : (
          <>
            {shownAvailable.map((p) => (
              <MarketRow key={p.id} plugin={p} busy={busy} onInstall={() => void install(p.id)} />
            ))}
            {!f && available.length > MARKET_PAGE && (
              <div className="px-2 py-1.5 text-center text-xs text-faint">按安装量显示前 {MARKET_PAGE} 个，搜索可以找到全部 {available.length} 个</div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[0.6875rem] text-faint">
        <span className="flex-1">改动写入 Claude Code 用户设置，终端里同样生效</span>
        {tab === 'market' && (
          <button
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted transition-colors hover:bg-sunken hover:text-fg disabled:opacity-60"
            title="从 GitHub 等来源拉取最新的市场目录"
            disabled={busy !== null}
            onClick={() => void updateMarketplaces()}
          >
            <RefreshCw size={12} className={busy === 'marketplaces' ? 'animate-spin' : ''} /> 更新市场
          </button>
        )}
      </div>
    </div>
  );
}

function MarketRow({ plugin: p, busy, onInstall }: { plugin: AvailablePlugin; busy: string | null; onInstall: () => void }) {
  const installing = busy === p.id;
  return (
    <div className={`${row} items-start hover:bg-sunken`}>
      <Puzzle size={16} className="mt-0.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-sm">{p.name}</span>
          {p.installCount != null && <span className="shrink-0 text-[0.6875rem] text-faint tabular-nums">{installs(p.installCount)}</span>}
        </span>
        {p.description && <span className="line-clamp-2 text-xs text-muted">{p.description}</span>}
        {installing && <span className="mt-0.5 block text-[0.6875rem] text-accent-strong">正在安装，从 Git 下载的插件可能需要一两分钟…</span>}
      </span>
      <button
        className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-line px-2.5 text-xs transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent-strong disabled:opacity-50"
        disabled={busy !== null}
        onClick={onInstall}
      >
        {installing ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />}
        安装
      </button>
    </div>
  );
}

function installs(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万次安装` : `${n.toLocaleString('en-US')}次安装`;
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`relative block h-5 w-9 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
    </span>
  );
}
