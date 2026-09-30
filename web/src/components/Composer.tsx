import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  File,
  FilePen,
  FileText,
  Folder,
  Hand,
  Paperclip,
  Plus,
  Puzzle,
  ShieldAlert,
  ShieldOff,
  Slash,
  Sparkles,
  Square,
  X,
  Zap,
} from 'lucide-react';
import type { Attachment, EffortLevel, FileMatch, ModelInfo, PermissionMode, SlashCommand } from '../../../shared/protocol.ts';
import { api } from '../lib/api.ts';
import { commandSuggestions, fileSuggestions, findTrigger, type Suggestion, type Trigger } from '../lib/completion.ts';
import {
  currentMode,
  interrupt,
  sendText,
  setEffort,
  setModel,
  setPermissionMode,
  showNotice,
  takePrefill,
  useStore,
} from '../lib/store.ts';
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
import { ContextMeter } from './ContextMeter.tsx';
import { Dropdown, resolvePlacement, type Placement } from './Dropdown.tsx';
import { PluginsPanel } from './PluginsPanel.tsx';

/** Stable fallbacks: a selector returning a fresh [] would re-render forever under zustand v5. */
const NO_MODELS: ModelInfo[] = [];
const NO_SKILLS: SlashCommand[] = [];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * `hero`: the big centered composer of a blank chat; popups open wherever there's room.
 * `dock`: pinned under the transcript; popups open upward.
 */
export function Composer({ variant = 'dock' }: { variant?: 'hero' | 'dock' }) {
  const hero = variant === 'hero';
  const placement: Placement = hero ? 'auto' : 'top';
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [popupSide, setPopupSide] = useState<'top' | 'bottom'>('top');
  const live = useStore((s) => s.live);
  const cwd = useStore((s) => s.view?.cwd ?? null);
  const catalog = useStore((s) => s.catalog);
  const prefill = useStore((s) => s.prefill);
  const busy = live?.status === 'running' || live?.status === 'waiting';
  const canSend = !!cwd && (!!text.trim() || attachments.length > 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, hero ? 360 : 300)}px`;
  }, [text, hero]);

  useEffect(() => {
    if (!prefill) return;
    const value = takePrefill();
    if (value === null) return;
    setText(value);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      setCursor(value.length);
    });
  }, [prefill]);

  const trigger = findTrigger(text, cursor);
  const triggerId = trigger ? `${trigger.kind}:${trigger.start}` : null;
  const open = !!trigger && triggerId !== dismissed;
  useLayoutEffect(() => {
    if (open) setPopupSide(resolvePlacement(placement, boxRef.current));
  }, [open, placement]);

  // Fetch file matches for `@`, debounced.
  const mentionQuery = open && trigger?.kind === 'mention' ? trigger.query : null;
  useEffect(() => {
    if (mentionQuery === null || !cwd) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<FileMatch[]>(`/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(mentionQuery)}`)
        .then((list) => !cancelled && setFiles(list))
        .catch(() => !cancelled && setFiles([]));
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionQuery, cwd]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!open || !trigger) return [];
    if (trigger.kind === 'slash') return commandSuggestions(catalog?.commands ?? [], catalog?.terminalCommands ?? [], trigger.query);
    return fileSuggestions(files);
  }, [open, trigger?.kind, trigger?.query, catalog, files]);

  useEffect(() => setActive(0), [trigger?.kind, trigger?.query]);

  const syncCursor = () => setCursor(ref.current?.selectionStart ?? 0);

  const focusAt = (pos: number) =>
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });

  const apply = (s: Suggestion, t: Trigger) => {
    const next = text.slice(0, t.start) + s.insert + text.slice(t.end);
    const pos = t.start + s.insert.length;
    setText(next);
    setCursor(pos);
    setDismissed(s.keepOpen ? null : `${t.kind}:${t.start}`);
    focusAt(pos);
  };

  /** Puts `/name ` at the start of the message (used by the + menu's skill list). */
  const insertCommand = (name: string) => {
    const rest = text.replace(/^\/\S*\s*/, '');
    const next = `/${name} ${rest}`;
    setText(next);
    setCursor(next.length);
    setDismissed(`slash:0`);
    focusAt(next.length);
  };

  const addFiles = async (list: FileList | File[]) => {
    const added: Attachment[] = [];
    for (const f of Array.from(list)) {
      try {
        if (IMAGE_TYPES.has(f.type)) {
          if (f.size > MAX_IMAGE_BYTES) throw new Error(`图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB`);
          added.push({ kind: 'image', name: f.name || 'image.png', mediaType: f.type, data: await toBase64(f) });
        } else {
          if (f.size > MAX_TEXT_BYTES) throw new Error(`超过 ${MAX_TEXT_BYTES / 1024}KB，建议用 @ 引用项目里的文件`);
          const content = await f.text();
          if (content.includes('\u0000')) throw new Error('不是文本文件');
          added.push({ kind: 'text', name: f.name, text: content });
        }
      } catch (err) {
        showNotice(`无法添加 ${f.name}：${err instanceof Error ? err.message : err}`);
      }
    }
    if (added.length) setAttachments((a) => [...a, ...added]);
  };

  const submit = () => {
    if (!canSend) return;
    sendText(text, attachments);
    setText('');
    setAttachments([]);
    setCursor(0);
    setDismissed(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: don't act while an IME (e.g. Chinese pinyin) is mid-composition.
    if (e.nativeEvent.isComposing) return;
    if (open && trigger && suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((a) => (a + step + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        const s = suggestions[active];
        // Enter on an exact, already-typed command sends it instead of re-inserting.
        if (e.key === 'Enter' && trigger.kind === 'slash' && s.insert.trim() === text.trim()) {
          e.preventDefault();
          submit();
          return;
        }
        e.preventDefault();
        apply(s, trigger);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(triggerId);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = !cwd
    ? '先在上方选择一个项目文件夹'
    : busy
      ? 'Claude 正在工作，新消息会排队发送…'
      : hero
        ? '描述你想让 Claude 做的事，/ 调用命令与 skill，@ 引用文件'
        : '回复 Claude…（/ 命令，@ 引用文件，Shift+Enter 换行）';

  return (
    <div
      ref={boxRef}
      className={`relative rounded-[1.25rem] border bg-panel transition-[border-color,box-shadow] duration-200 ${
        dragging ? 'border-accent ring-4 ring-accent/15' : 'border-line focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent/8'
      } ${hero ? 'shadow-float' : 'shadow-card'}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
      {open && trigger && (
        <SuggestionPopup
          trigger={trigger}
          suggestions={suggestions}
          active={active}
          side={popupSide}
          onHover={setActive}
          onPick={(s) => apply(s, trigger)}
        />
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {attachments.map((a, i) => (
            <AttachmentChip key={i} attachment={a} onRemove={() => setAttachments((list) => list.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        autoFocus
        disabled={!cwd}
        className={`scroll-thin block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 leading-relaxed outline-none placeholder:text-muted/70 disabled:cursor-not-allowed ${
          hero ? 'min-h-[5.5rem] text-[0.9375rem]' : 'min-h-[3.75rem] text-[0.9375rem]'
        }`}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCursor(e.target.selectionStart);
        }}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData.files);
          if (pasted.length) {
            e.preventDefault();
            void addFiles(pasted);
          }
        }}
        onSelect={syncCursor}
        onClick={syncCursor}
        onBlur={() => setTimeout(() => setDismissed(triggerId), 150)}
        onFocus={() => setDismissed(null)}
        onKeyDown={onKeyDown}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
        <PlusMenu placement={placement} onSkill={insertCommand} onAttach={() => fileInput.current?.click()} />
        <button className={roundBtn} title="添加图片或文件（也可以粘贴、拖拽）" onClick={() => fileInput.current?.click()}>
          <Paperclip size={16} />
        </button>
        <PermissionPicker placement={placement} />
        <div className="flex-1" />
        {!hero && <ContextMeter placement={placement} />}
        <ModelPicker placement={placement} />
        {busy ? (
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg text-bg shadow-sm transition-all hover:opacity-85 active:scale-95"
            title="中断"
            onClick={interrupt}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_2px_8px_-2px] shadow-accent/50 transition-all hover:bg-accent-strong active:scale-95 disabled:bg-accent-soft disabled:shadow-none dark:disabled:text-white/50"
            title="发送（Enter）"
            disabled={!canSend}
            onClick={submit}
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  return (
    <div className="group relative flex h-14 max-w-52 items-center gap-2 overflow-hidden rounded-xl border border-line bg-bg pr-2 shadow-card">
      {attachment.kind === 'image' ? (
        <img src={`data:${attachment.mediaType};base64,${attachment.data}`} alt="" className="h-full w-14 shrink-0 object-cover" />
      ) : (
        <span className="flex h-full w-12 shrink-0 items-center justify-center bg-sunken text-muted">
          <FileText size={18} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs">{attachment.name}</span>
        <span className="block text-[0.6875rem] text-muted">{attachment.kind === 'image' ? '图片' : `${attachment.text.length} 字符`}</span>
      </span>
      <button
        className="absolute top-1 right-1 hidden h-5 w-5 items-center justify-center rounded-full bg-fg/75 text-bg transition-colors group-hover:flex hover:bg-fg"
        title="移除"
        onClick={onRemove}
      >
        <X size={11} />
      </button>
    </div>
  );
}

function SuggestionPopup(props: {
  trigger: Trigger;
  suggestions: Suggestion[];
  active: number;
  side: 'top' | 'bottom';
  onHover: (i: number) => void;
  onPick: (s: Suggestion) => void;
}) {
  const { trigger, suggestions, active, side, onHover, onPick } = props;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      className={`pop-in absolute inset-x-0 z-20 overflow-hidden rounded-xl border border-line bg-panel shadow-pop ${
        side === 'top' ? 'bottom-full mb-2' : 'pop-in-down top-full mt-2'
      }`}
    >
      <div className="border-b border-line px-3 py-1.5 text-xs text-faint">
        {trigger.kind === 'slash' ? '命令与 skill' : '引用文件（内容会发给 Claude）'} · ↑↓ 选择，Tab/Enter 确认，Esc 关闭
      </div>
      <div ref={listRef} className="scroll-thin max-h-72 overflow-y-auto p-1">
        {suggestions.length === 0 ? (
          <div className="px-2 py-2 text-sm text-muted">{trigger.kind === 'slash' ? '没有匹配的命令' : '没有匹配的文件'}</div>
        ) : (
          suggestions.map((s, i) => {
            const Icon = trigger.kind === 'slash' ? Slash : s.keepOpen ? Folder : File;
            return (
              <button
                key={s.key}
                data-i={i}
                className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${i === active ? 'bg-sunken' : ''}`}
                onMouseEnter={() => onHover(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(s);
                }}
              >
                <Icon size={13} className={`shrink-0 self-center ${i === active ? 'text-accent' : 'text-muted'}`} />
                <span className="shrink-0 font-mono text-[0.8125rem] font-medium">{s.label}</span>
                {s.hint && (
                  <span className="max-w-[40%] shrink-0 truncate font-mono text-xs text-muted" title={s.hint}>
                    {s.hint}
                  </span>
                )}
                {s.badge && <span className="shrink-0 rounded-full border border-line px-1.5 text-[0.6875rem] text-muted">{s.badge}</span>}
                <span className="min-w-0 truncate text-xs text-muted">{s.detail}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---- controls ----

const roundBtn =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-transparent hover:bg-sunken hover:text-fg';
const chip = 'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] transition-colors hover:bg-sunken';
const menuRow = 'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sunken';

const MODE_ICONS: Partial<Record<PermissionMode, typeof Hand>> = {
  default: Hand,
  acceptEdits: FilePen,
  auto: Zap,
  bypassPermissions: ShieldOff,
  plan: ClipboardList,
};

type PlusView = 'root' | 'skills' | 'plugins';

function PlusMenu(props: { placement: Placement; onSkill: (name: string) => void; onAttach: () => void }) {
  const { placement, onSkill, onAttach } = props;
  const [view, setView] = useState<PlusView>('root');
  const skills = useStore((s) => s.catalog?.skills ?? NO_SKILLS);

  return (
    <Dropdown
      placement={placement}
      className={roundBtn}
      title="更多：Skills、插件、附件"
      panelClassName={`${view === 'plugins' ? 'w-[26rem]' : 'w-80'} max-w-[calc(100vw-2rem)]`}
      trigger={() => <Plus size={17} />}
    >
      {(close) =>
        view === 'skills' ? (
          <SkillsPanel
            skills={skills}
            onBack={() => setView('root')}
            onPick={(name) => {
              close();
              setView('root');
              onSkill(name);
            }}
          />
        ) : view === 'plugins' ? (
          <PluginsPanel onBack={() => setView('root')} />
        ) : (
          <div className="p-1">
            <NavRow icon={Sparkles} label="Skills" hint={`${skills.length} 个可用`} onClick={() => setView('skills')} />
            <NavRow icon={Puzzle} label="插件" hint="启用、停用、安装和卸载插件" onClick={() => setView('plugins')} />
            <div className="my-1 border-t border-line" />
            <button
              className={menuRow}
              onClick={() => {
                close();
                onAttach();
              }}
            >
              <Paperclip size={17} className="text-muted" />
              <span className="text-sm">添加图片或文件</span>
            </button>
          </div>
        )
      }
    </Dropdown>
  );
}

function NavRow(props: { icon: typeof Plus; label: string; hint: string; onClick: () => void }) {
  const { icon: Icon, label, hint, onClick } = props;
  return (
    <button className={menuRow} onClick={onClick}>
      <Icon size={17} className="text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <ChevronDown size={14} className="-rotate-90 text-muted" />
    </button>
  );
}

function PanelHeader({ title, onBack, extra }: { title: string; onBack: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-1.5 py-1.5">
      <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-fg" onClick={onBack}>
        <ChevronLeft size={16} />
      </button>
      <span className="flex-1 text-sm font-semibold">{title}</span>
      {extra}
    </div>
  );
}

function SkillsPanel({ skills, onBack, onPick }: { skills: SlashCommand[]; onBack: () => void; onPick: (name: string) => void }) {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const shown = skills.filter((s) => !f || s.name.toLowerCase().includes(f) || s.description.toLowerCase().includes(f));
  return (
    <div>
      <PanelHeader title="Skills" onBack={onBack} />
      <div className="px-3 pt-2">
        <input
          autoFocus
          className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm transition-shadow outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/12"
          placeholder="筛选 skill"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="scroll-thin max-h-[min(18rem,calc(var(--dd-room,100vh)-7.5rem))] overflow-y-auto p-1">
        {shown.length === 0 ? (
          <div className="px-2 py-2 text-sm text-muted">{skills.length ? '没有匹配的 skill' : '等待 Claude Code 启动…'}</div>
        ) : (
          shown.map((s) => (
            <button key={s.name} className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sunken" onClick={() => onPick(s.name)}>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[0.8125rem] font-medium">/{s.name}</span>
                {!s.builtin && <span className="rounded-full bg-accent/12 px-1.5 text-[0.6875rem] text-accent-strong">自定义</span>}
              </span>
              <span className="line-clamp-2 text-xs text-muted">{s.description}</span>
            </button>
          ))
        )}
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[0.6875rem] text-faint">选中后会插入到输入框开头，补充说明后发送</div>
    </div>
  );
}

/** Text color for a mode's label: red for skipping every prompt, teal for plan mode. */
function modeTone(mode: PermissionMode): string {
  return mode === 'bypassPermissions' ? 'text-red-600 dark:text-red-400' : mode === 'plan' ? 'text-plan' : '';
}

function PermissionPicker({ placement }: { placement: Placement }) {
  const mode = useStore((s) => currentMode(s));
  const Icon = MODE_ICONS[mode] ?? ShieldAlert;

  return (
    <Dropdown
      placement={placement}
      className={`${chip} ${modeTone(mode) || 'text-fg/80'} ${mode === 'plan' ? 'bg-plan/10 hover:bg-plan/15' : ''}`}
      title="权限模式"
      panelClassName="w-80 p-1"
      trigger={() => (
        <>
          <Icon size={15} />
          {MODE_LABELS[mode] ?? mode}
          <ChevronDown size={13} className="text-muted" />
        </>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">权限模式</div>
          {PICKER_MODES.map((m) => {
            const ItemIcon = MODE_ICONS[m] ?? ShieldAlert;
            return (
              <OptionRow
                key={m}
                selected={m === mode}
                label={
                  <span className={`flex items-center gap-2 ${modeTone(m)}`}>
                    <ItemIcon size={15} />
                    {MODE_LABELS[m]}
                  </span>
                }
                hint={MODE_HINTS[m]}
                onClick={() => {
                  setPermissionMode(m);
                  close();
                }}
              />
            );
          })}
        </>
      )}
    </Dropdown>
  );
}

function useCurrentModel() {
  const live = useStore((s) => s.live);
  const prefs = useStore((s) => s.prefs);
  return { live, model: live ? live.model : prefs.model, effort: live ? live.effort : prefs.effort };
}

function findModel(models: ModelInfo[], value: string | null): ModelInfo | undefined {
  if (!value) return models.find((m) => m.value === 'default');
  return models.find((m) => m.value === value || m.resolvedModel === value);
}

function ModelPicker({ placement }: { placement: Placement }) {
  const { live, model, effort } = useCurrentModel();
  const models = useStore((s) => s.catalog?.models ?? NO_MODELS);
  const current = findModel(models, model);
  const defaultModel = models.find((m) => m.value === 'default');

  // Haiku-style rows carry no effort fields at all; an unloaded catalog shows every level.
  const supportsEffort = !current || current.supportsEffort === true || !!current.supportedEffortLevels?.length;
  const levels: EffortLevel[] = current?.supportedEffortLevels ?? ALL_EFFORTS;

  const modelLabel = model
    ? prettyModel(current?.displayName ?? model)
    : prettyModel(live?.activeModel ?? defaultModel?.resolvedModel) || '默认模型';
  const effortLabel = effort ? EFFORT_LABELS[effort] : live?.activeEffort ? EFFORT_LABELS[live.activeEffort] : AUTO_EFFORT_LABEL;

  return (
    <Dropdown
      placement={placement}
      align="right"
      className={chip}
      title="模型与推理强度"
      panelClassName="flex w-[30rem] max-w-[calc(100vw-2rem)]"
      trigger={() => (
        <>
          <span className="font-semibold text-fg/85">{modelLabel}</span>
          {supportsEffort && <span className="text-muted">{effortLabel}</span>}
          <ChevronDown size={13} className="text-muted" />
        </>
      )}
    >
      {() => (
        <>
          <div className="scroll-thin max-h-80 min-w-0 flex-1 overflow-y-auto p-1">
            <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">模型</div>
            {models.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted">等待 Claude Code 启动…</div>
            ) : (
              <>
                <OptionRow
                  selected={!model}
                  label="默认"
                  hint={defaultModel?.resolvedModel ? `当前为 ${prettyModel(defaultModel.resolvedModel)}` : 'Claude Code 的默认模型'}
                  onClick={() => setModel(null)}
                />
                {models
                  .filter((m) => m.value !== 'default')
                  .map((m) => (
                    <OptionRow
                      key={m.value}
                      selected={model === m.value || (!!model && m.resolvedModel === model)}
                      label={prettyModel(m.displayName)}
                      hint={m.description}
                      onClick={() => setModel(m.value)}
                    />
                  ))}
              </>
            )}
          </div>
          <div className="w-48 shrink-0 border-l border-line p-1">
            <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">推理强度</div>
            {supportsEffort ? (
              <>
                <OptionRow
                  selected={!effort}
                  label={AUTO_EFFORT_LABEL}
                  hint={live?.activeEffort && !effort ? `当前：${EFFORT_LABELS[live.activeEffort]}` : EFFORT_HINTS.auto}
                  onClick={() => setEffort(null)}
                />
                {levels.map((level) => (
                  <OptionRow
                    key={level}
                    selected={effort === level}
                    label={EFFORT_LABELS[level]}
                    hint={EFFORT_HINTS[level]}
                    onClick={() => setEffort(level)}
                  />
                ))}
              </>
            ) : (
              <div className="px-2 py-2 text-xs text-muted">这个模型不支持调节推理强度</div>
            )}
          </div>
        </>
      )}
    </Dropdown>
  );
}

function OptionRow(props: { selected: boolean; label: React.ReactNode; hint?: string; onClick: () => void }) {
  const { selected, label, hint, onClick } = props;
  return (
    <button
      className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sunken ${selected ? 'bg-sunken/60' : ''}`}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${selected ? 'font-medium' : ''}`}>{label}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
      <Check size={14} className={`mt-0.5 shrink-0 text-accent ${selected ? '' : 'invisible'}`} />
    </button>
  );
}
