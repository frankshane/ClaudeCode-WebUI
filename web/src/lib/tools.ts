import {
  Bot,
  ClipboardList,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface ToolDescription {
  icon: LucideIcon;
  label: string;
  detail: string;
}

export const AGENT_TOOLS = new Set(['Agent', 'Task']);

/** Icon + one-line summary shown in a collapsed tool card. */
export function describeTool(name: string, input: any): ToolDescription {
  const i = input ?? {};
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { icon: Terminal, label: name, detail: i.description || i.command || '' };
    case 'Read':
      return { icon: FileText, label: '读取', detail: withRange(i.file_path, i.offset, i.limit) };
    case 'Write':
      return { icon: FilePlus, label: '写入', detail: i.file_path ?? '' };
    case 'Edit':
    case 'MultiEdit':
      return { icon: FilePen, label: '编辑', detail: i.file_path ?? '' };
    case 'NotebookEdit':
      return { icon: FilePen, label: '编辑笔记本', detail: i.notebook_path ?? '' };
    case 'Glob':
      return { icon: FileSearch, label: 'Glob', detail: join(i.pattern, i.path) };
    case 'Grep':
      return { icon: Search, label: 'Grep', detail: join(i.pattern, i.path ?? i.glob) };
    case 'WebFetch':
      return { icon: Globe, label: '抓取网页', detail: i.url ?? '' };
    case 'WebSearch':
      return { icon: Globe, label: '网络搜索', detail: i.query ?? '' };
    case 'Agent':
    case 'Task':
      return { icon: Bot, label: i.subagent_type ? `子 Agent · ${i.subagent_type}` : '子 Agent', detail: i.description ?? '' };
    case 'TodoWrite':
      return { icon: ListTodo, label: '任务列表', detail: '' };
    case 'AskUserQuestion':
      return { icon: MessageCircleQuestion, label: '提问', detail: i.questions?.[0]?.question ?? '' };
    case 'ExitPlanMode':
      return { icon: ClipboardList, label: '提交计划', detail: '' };
    case 'Skill':
      return { icon: Sparkles, label: 'Skill', detail: i.skill ?? i.name ?? '' };
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return { icon: Wrench, label: `${mcp[1]} · ${mcp[2]}`, detail: firstStringValue(i) };
  return { icon: Wrench, label: name, detail: firstStringValue(i) };
}

function withRange(path: string | undefined, offset?: number, limit?: number): string {
  if (!path) return '';
  if (offset == null && limit == null) return path;
  const start = offset ?? 1;
  return limit ? `${path}:${start}-${start + limit - 1}` : `${path}:${start}-`;
}

function join(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join('  ·  ');
}

function firstStringValue(input: Record<string, unknown>): string {
  for (const v of Object.values(input)) if (typeof v === 'string' && v.length < 200) return v;
  return '';
}
