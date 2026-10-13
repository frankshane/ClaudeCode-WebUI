import { useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Download,
  ExternalLink,
  GitBranch,
  Info,
  LoaderCircle,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import type { EffortLevel, ModelInfo, PermissionMode } from '../../../shared/protocol.ts';
import {
  ALL_EFFORTS,
  AUTO_EFFORT_LABEL,
  EFFORT_HINTS,
  EFFORT_LABELS,
  MODE_HINTS,
  MODE_LABELS,
  PICKER_MODES,
  prettyModel,
} from '../lib/format.ts';
import { closeSettings, setEffort, setModel, setPermissionMode, setRunningDisplayMode, useStore } from '../lib/store.ts';
import { setTheme, useTheme, type Theme } from '../lib/theme.ts';

type Tab = 'model' | 'updates' | 'appearance';

interface RemoteCommitInfo {
  sha: string;
  message: string;
  date: string;
  author: string;
  url: string;
}

export function SettingsDialog() {
  const [activeTab, setActiveTab] = useState<Tab>('model');
  const live = useStore((s) => s.live);
  const prefs = useStore((s) => s.prefs);
  const catalog = useStore((s) => s.catalog);
  const models = catalog?.models ?? [];
  const theme = useTheme((s) => s.theme);
  const runningDisplayMode = useStore((s) => s.runningDisplayMode);

  // 检查更新状态
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [latestCommit, setLatestCommit] = useState<RemoteCommitInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Esc 键关闭弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function checkForUpdates() {
    setChecking(true);
    setUpdateError(null);
    try {
      const res = await fetch('https://api.github.com/repos/frankshane/ClaudeCode-WebUI/commits/main', {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (!res.ok) {
        throw new Error(`GitHub API 返回 HTTP ${res.status}`);
      }
      const data = await res.json();
      setLatestCommit({
        sha: (data.sha || '').slice(0, 7),
        message: data.commit?.message?.split('\n')[0] || '更新维护',
        date: data.commit?.author?.date || '',
        author: data.commit?.author?.name || 'frankshane',
        url: data.html_url || 'https://github.com/frankshane/ClaudeCode-WebUI',
      });
      setLastChecked(Date.now());
    } catch (err: any) {
      setUpdateError(err?.message || '检查更新失败，请检查网络连接');
    } finally {
      setChecking(false);
    }
  }

  const selectedModel = models.find((m) => m.value === prefs.model || m.resolvedModel === prefs.model);
  const defaultModel = models.find((m) => m.value === 'default');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[2px]"
      onMouseDown={closeSettings}
    >
      <div
        className="pop-in flex h-[38rem] max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 左侧选项卡导航 */}
        <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-side/60 p-3">
          <div className="mb-4 flex items-center gap-2 px-2 pt-1 font-semibold text-fg">
            <SettingsIcon size={18} className="text-accent" />
            <span>设置</span>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            <TabButton
              active={activeTab === 'model'}
              icon={Cpu}
              label="模型与推理"
              onClick={() => setActiveTab('model')}
            />
            <TabButton
              active={activeTab === 'updates'}
              icon={RefreshCw}
              label="检查更新"
              onClick={() => setActiveTab('updates')}
            />
            <TabButton
              active={activeTab === 'appearance'}
              icon={Sun}
              label="外观与关于"
              onClick={() => setActiveTab('appearance')}
            />
          </nav>

          <div className="px-2 pt-2 text-[0.6875rem] text-faint">
            CC WebUI v0.1.0
          </div>
        </aside>

        {/* 右侧设置主体区 */}
        <main className="flex flex-1 flex-col overflow-hidden bg-panel">
          {/* 顶栏 */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-6">
            <h2 className="text-sm font-semibold text-fg">
              {activeTab === 'model' && '模型与推理设置'}
              {activeTab === 'updates' && '检查更新'}
              {activeTab === 'appearance' && '外观与关于'}
            </h2>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-fg"
              onClick={closeSettings}
              title="关闭 (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {/* 滚动内容 */}
          <div className="scroll-thin flex-1 overflow-y-auto p-6 space-y-6">
            {activeTab === 'model' && (
              <>
                {/* 1. CC Switch 协同托管状态 */}
                <div className="rounded-xl border border-line bg-side/40 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu size={16} className="text-accent" />
                      <span className="text-xs font-semibold text-fg">模型与渠道（CC Switch 协同托管）</span>
                    </div>
                    <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[0.6875rem] font-medium text-accent-strong">
                      CC Switch 托管中
                    </span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    当前 Claude Code 的模型、API 渠道和 Key 推荐由桌面上的 <b className="text-fg">CC Switch</b> 统一切换与管理。在 CC Switch 中切好渠道或模型后，本 WebUI 会自动无缝跟随生效，无需在此重复配置。
                  </p>
                  <div className="flex items-center gap-2 pt-1 text-xs">
                    <span className="text-muted">当前检测到的生效模型：</span>
                    <code className="rounded bg-panel px-2 py-0.5 border border-line font-mono text-accent-strong font-semibold">
                      {prettyModel(live?.activeModel ?? defaultModel?.resolvedModel ?? prefs.model) || '默认模型 (Claude Code CLI 托管)'}
                    </code>
                  </div>
                </div>

                {/* 2. 推理强度 */}
                <div className="space-y-2.5 pt-2 border-t border-line/60">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold tracking-wide text-fg/90 uppercase">
                      思考 / 推理强度 (Thinking Effort)
                    </label>
                    <span className="text-xs text-muted">
                      {prefs.effort ? EFFORT_LABELS[prefs.effort] : AUTO_EFFORT_LABEL}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                    <button
                      type="button"
                      className={`flex h-9 items-center justify-center rounded-lg border text-xs font-medium transition-all ${
                        prefs.effort === null
                          ? 'border-accent bg-accent/12 text-accent-strong font-semibold shadow-sm'
                          : 'border-line/70 bg-panel hover:bg-sunken text-fg/80'
                      }`}
                      onClick={() => setEffort(null)}
                    >
                      自动
                    </button>
                    {ALL_EFFORTS.map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        className={`flex h-9 items-center justify-center rounded-lg border text-xs font-medium transition-all ${
                          prefs.effort === lvl
                            ? 'border-accent bg-accent/12 text-accent-strong font-semibold shadow-sm'
                            : 'border-line/70 bg-panel hover:bg-sunken text-fg/80'
                        }`}
                        onClick={() => setEffort(lvl)}
                      >
                        {EFFORT_LABELS[lvl]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[0.75rem] text-muted">
                    {prefs.effort ? EFFORT_HINTS[prefs.effort] : EFFORT_HINTS.auto}
                  </p>
                </div>

                {/* 3. 权限模式 */}
                <div className="space-y-2.5 pt-2 border-t border-line/60">
                  <label className="text-xs font-semibold tracking-wide text-fg/90 uppercase">
                    权限放行模式 (Permission Mode)
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {PICKER_MODES.map((mode) => (
                      <div
                        key={mode}
                        role="button"
                        tabIndex={0}
                        className={`flex cursor-pointer items-start justify-between rounded-xl border p-3 transition-all ${
                          prefs.permissionMode === mode
                            ? 'border-accent bg-accent/8 ring-1 ring-accent'
                            : 'border-line/70 bg-panel hover:bg-sunken'
                        }`}
                        onClick={() => setPermissionMode(mode)}
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-semibold text-fg">{MODE_LABELS[mode] || mode}</div>
                          <div className="text-[0.6875rem] text-muted">
                            {MODE_HINTS[mode]}
                          </div>
                        </div>
                        {prefs.permissionMode === mode && (
                          <Check size={16} className="text-accent shrink-0 mt-0.5" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'updates' && (
              <div className="space-y-6">
                {/* 仓库与版本信息卡片 */}
                <div className="rounded-xl border border-line bg-side/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitBranch size={17} className="text-accent" />
                      <span className="font-semibold text-sm">frankshane/ClaudeCode-WebUI</span>
                    </div>
                    <span className="rounded-full bg-accent/12 px-2 py-0.5 text-xs font-medium text-accent-strong">
                      v0.1.0
                    </span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    在浏览器里使用 Claude Code 的本地 Web 界面，基于 Claude Agent SDK 构建。
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={checking}
                      onClick={checkForUpdates}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
                      {checking ? '正在检查官方仓库…' : '立即检查更新'}
                    </button>
                    <a
                      href="https://github.com/frankshane/ClaudeCode-WebUI"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors"
                    >
                      <ExternalLink size={13} /> 前往 GitHub 主页
                    </a>
                  </div>
                </div>

                {/* 检查结果反馈 */}
                {updateError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-4 text-xs text-red-600 dark:text-red-400">
                    <div className="font-semibold mb-1">检查更新出错</div>
                    <div>{updateError}</div>
                  </div>
                )}

                {latestCommit && (
                  <div className="rounded-xl border border-line bg-panel p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-fg">远程主分支最新提交记录</span>
                      <span className="text-[0.6875rem] text-muted font-mono">{latestCommit.sha}</span>
                    </div>
                    <div className="text-xs text-fg font-medium bg-sunken/60 p-2.5 rounded-lg border border-line/60">
                      {latestCommit.message}
                    </div>
                    <div className="flex items-center justify-between text-[0.6875rem] text-muted">
                      <span>提交者：{latestCommit.author}</span>
                      <span>时间：{latestCommit.date ? new Date(latestCommit.date).toLocaleString() : '-'}</span>
                    </div>
                    <div className="pt-3 border-t border-line/60 flex items-center justify-between gap-3 flex-wrap">
                      <a
                        href="https://github.com/frankshane/ClaudeCode-WebUI/archive/refs/heads/main.zip"
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 active:scale-95"
                      >
                        <Download size={14} /> 一键下载最新更新包 (.zip)
                      </a>
                      <a
                        href={latestCommit.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors"
                      >
                        <ExternalLink size={13} /> 查看提交详情
                      </a>
                    </div>
                  </div>
                )}

                {!latestCommit && !updateError && !checking && (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-muted">
                    <RefreshCw size={28} className="mb-2 opacity-40" />
                    <div className="text-xs">点击上方按钮，通过 GitHub API 自动对比上游主干最新变更</div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-6">
                {/* 主题外观切换 */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold tracking-wide text-fg/90 uppercase">
                    主题外观 (Appearance)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <ThemeCard
                      icon={Sun}
                      label="浅色模式"
                      selected={theme === 'light'}
                      onClick={() => setTheme('light')}
                    />
                    <ThemeCard
                      icon={Moon}
                      label="深色模式"
                      selected={theme === 'dark'}
                      onClick={() => setTheme('dark')}
                    />
                  </div>
                </div>

                {/* 运行中对话显示方式 */}
                <div className="space-y-2.5 pt-4 border-t border-line/60">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold tracking-wide text-fg/90 uppercase">
                      运行中对话展示方式
                    </label>
                    <span className="text-xs text-muted">
                      {runningDisplayMode === 'chips' ? '直接平铺' : '收起折叠'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                        runningDisplayMode === 'chips'
                          ? 'border-accent bg-accent/8 ring-1 ring-accent text-fg font-semibold'
                          : 'border-line/70 bg-panel hover:bg-sunken text-muted hover:text-fg font-medium'
                      }`}
                      onClick={() => setRunningDisplayMode('chips')}
                    >
                      <div className="text-xs font-semibold text-fg">直接平铺显示（默认推荐）</div>
                      <div className="text-[0.6875rem] text-muted">顶栏右上角直接展示各个运行中的会话标签，免点击直接查看与切换</div>
                    </button>
                    <button
                      type="button"
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                        runningDisplayMode === 'dropdown'
                          ? 'border-accent bg-accent/8 ring-1 ring-accent text-fg font-semibold'
                          : 'border-line/70 bg-panel hover:bg-sunken text-muted hover:text-fg font-medium'
                      }`}
                      onClick={() => setRunningDisplayMode('dropdown')}
                    >
                      <div className="text-xs font-semibold text-fg">收起为下拉徽标</div>
                      <div className="text-[0.6875rem] text-muted">仅展示「正在运行 (N)」微缩徽标，点击展开下拉菜单</div>
                    </button>
                  </div>
                </div>

                {/* 关于项目 */}
                <div className="space-y-2.5 pt-4 border-t border-line/60">
                  <label className="text-xs font-semibold tracking-wide text-fg/90 uppercase">
                    关于 CC WebUI
                  </label>
                  <div className="rounded-xl border border-line bg-side/30 p-4 text-xs space-y-2 leading-relaxed text-muted">
                    <div>
                      <b className="text-fg">Claude Code WebUI</b> 提供了基于浏览器的现代化交互界面，与本地 CLI 完全同源，会话、权限和配置实时互通。
                    </div>
                    <div>
                      原作者：<b className="text-fg">frankshane</b>
                    </div>
                    <div className="pt-2">
                      <a
                        href="https://github.com/frankshane/ClaudeCode-WebUI"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <ExternalLink size={12} /> https://github.com/frankshane/ClaudeCode-WebUI
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function TabButton(props: { active: boolean; icon: any; label: string; onClick: () => void }) {
  const { active, icon: Icon, label, onClick } = props;
  return (
    <button
      type="button"
      className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-all ${
        active
          ? 'bg-panel text-fg font-semibold shadow-card ring-1 ring-line/70 dark:bg-sunken dark:ring-transparent'
          : 'text-muted hover:bg-sunken/60 hover:text-fg'
      }`}
      onClick={onClick}
    >
      <Icon size={15} className={active ? 'text-accent' : ''} />
      <span>{label}</span>
    </button>
  );
}

function ModelCard(props: { name: string; sub: string; selected: boolean; onClick: () => void }) {
  const { name, sub, selected, onClick } = props;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex cursor-pointer items-start justify-between rounded-xl border p-3 transition-all ${
        selected
          ? 'border-accent bg-accent/8 ring-1 ring-accent'
          : 'border-line/70 bg-panel hover:bg-sunken'
      }`}
      onClick={onClick}
    >
      <div className="min-w-0 pr-2">
        <div className="text-xs font-semibold text-fg truncate">{name}</div>
        <div className="text-[0.6875rem] text-muted truncate mt-0.5">{sub}</div>
      </div>
      {selected && <Check size={16} className="text-accent shrink-0 mt-0.5" />}
    </div>
  );
}

function ThemeCard(props: { icon: any; label: string; selected: boolean; onClick: () => void }) {
  const { icon: Icon, label, selected, onClick } = props;
  return (
    <button
      type="button"
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3.5 transition-all ${
        selected
          ? 'border-accent bg-accent/8 ring-1 ring-accent text-accent-strong font-semibold'
          : 'border-line/70 bg-panel hover:bg-sunken text-muted hover:text-fg font-medium'
      }`}
      onClick={onClick}
    >
      <Icon size={20} />
      <span className="text-xs">{label}</span>
    </button>
  );
}
