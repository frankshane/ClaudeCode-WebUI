import { useState } from 'react';
import { ClipboardList, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import type { PermissionRequest } from '../../../shared/protocol.ts';
import { respondPermission } from '../lib/store.ts';
import { describeTool } from '../lib/tools.ts';
import { DiffView } from './DiffView.tsx';
import { Markdown } from './Markdown.tsx';

export function PermissionPanel({ request, queued }: { request: PermissionRequest; queued: number }) {
  const body =
    request.toolName === 'AskUserQuestion' ? (
      <QuestionForm request={request} />
    ) : request.toolName === 'ExitPlanMode' ? (
      <PlanApproval request={request} />
    ) : (
      <ToolApproval request={request} />
    );
  return (
    <div className="fade-up rounded-2xl border border-accent/35 bg-panel shadow-float ring-4 ring-accent/6">
      {body}
      {queued > 0 && <div className="border-t border-line px-4 py-1.5 text-xs text-muted">还有 {queued} 个请求排队中</div>}
    </div>
  );
}

const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100';
const primary = `${btn} bg-accent text-accent-fg shadow-sm hover:bg-accent-strong`;
const secondary = `${btn} border border-line bg-panel hover:bg-sunken`;
const field =
  'w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm transition-shadow outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/12';
const badge = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent';

function ToolApproval({ request }: { request: PermissionRequest }) {
  const [feedback, setFeedback] = useState('');
  const { label } = describeTool(request.toolName, request.input);
  const i = request.input as any;
  const allow = (always = false) => respondPermission(request.requestId, { behavior: 'allow', always });
  const deny = () => respondPermission(request.requestId, { behavior: 'deny', message: feedback });

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className={badge}>
          <ShieldAlert size={16} />
        </span>
        <div className="min-w-0 pt-0.5">
          <div className="font-semibold">{request.title ?? `Claude 想要使用 ${label}`}</div>
          {request.description && <div className="text-sm text-muted">{request.description}</div>}
          {request.decisionReason && <div className="text-xs text-muted">原因：{request.decisionReason}</div>}
          {request.blockedPath && <div className="font-mono text-xs text-muted">路径：{request.blockedPath}</div>}
          {request.agentID && <div className="text-xs text-muted">来自子 Agent</div>}
        </div>
      </div>

      <div className="scroll-thin max-h-72 overflow-auto">
        {request.toolName === 'Bash' || request.toolName === 'PowerShell' ? (
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-sunken/70 px-3 py-2 font-mono text-xs leading-5 dark:bg-bg/70">
            {i.description && <div className="mb-1 font-sans text-muted">{i.description}</div>}
            {i.command}
          </pre>
        ) : request.toolName === 'Edit' ? (
          <FileDiff path={i.file_path} oldText={i.old_string} newText={i.new_string} />
        ) : request.toolName === 'Write' ? (
          <FileDiff path={i.file_path} oldText="" newText={i.content} />
        ) : (
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-sunken/70 px-3 py-2 font-mono text-xs leading-5 dark:bg-bg/70">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        )}
      </div>

      <input
        className={field}
        placeholder="拒绝时可以告诉 Claude 应该怎么做（可选）"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && deny()}
      />
      <div className="flex flex-wrap gap-2">
        <button className={primary} onClick={() => allow()} autoFocus={!request.defaultToNo}>
          允许
        </button>
        {request.canAlwaysAllow && (
          <button className={secondary} onClick={() => allow(true)}>
            本会话始终允许
          </button>
        )}
        <button className={secondary} onClick={deny} autoFocus={request.defaultToNo}>
          拒绝
        </button>
      </div>
    </div>
  );
}

function FileDiff({ path, oldText, newText }: { path?: string; oldText?: string; newText?: string }) {
  return (
    <div className="space-y-1">
      <div className="truncate font-mono text-xs text-muted">{path}</div>
      <DiffView oldText={oldText ?? ''} newText={newText ?? ''} />
    </div>
  );
}

interface Question {
  question: string;
  header: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description: string }>;
}

function QuestionForm({ request }: { request: PermissionRequest }) {
  const questions = ((request.input as any).questions ?? []) as Question[];
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});

  const answerFor = (n: number) => (other[n]?.trim() ? other[n].trim() : (picked[n] ?? []).join(', '));
  const complete = questions.every((_, n) => answerFor(n));

  const toggle = (n: number, label: string, multi: boolean) => {
    setOther((o) => ({ ...o, [n]: '' }));
    setPicked((p) => {
      const cur = p[n] ?? [];
      if (!multi) return { ...p, [n]: [label] };
      return { ...p, [n]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  };

  const submit = () => {
    const answers = Object.fromEntries(questions.map((q, n) => [q.question, answerFor(n)]));
    respondPermission(request.requestId, { behavior: 'allow', updatedInput: { ...request.input, answers } });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2.5 font-semibold">
        <span className={badge}>
          <MessageCircleQuestion size={16} />
        </span>
        Claude 有问题想问你
      </div>
      {questions.map((q, n) => (
        <div key={n} className="space-y-2">
          <div>
            <span className="mr-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">{q.header}</span>
            <span className="text-sm font-medium">{q.question}</span>
            {q.multiSelect && <span className="ml-1 text-xs text-muted">（可多选）</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => {
              const on = (picked[n] ?? []).includes(o.label) && !other[n]?.trim();
              return (
                <button
                  key={o.label}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                    on ? 'border-accent bg-accent/8 ring-1 ring-accent/40' : 'border-line hover:border-accent/30 hover:bg-sunken/60'
                  }`}
                  onClick={() => toggle(n, o.label, !!q.multiSelect)}
                >
                  <div className="font-medium">{o.label}</div>
                  {o.description && <div className="text-xs text-muted">{o.description}</div>}
                </button>
              );
            })}
          </div>
          <input
            className={field}
            placeholder="其他（自己填写）"
            value={other[n] ?? ''}
            onChange={(e) => setOther((o) => ({ ...o, [n]: e.target.value }))}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button className={primary} disabled={!complete} onClick={submit}>
          提交回答
        </button>
        <button
          className={secondary}
          onClick={() => respondPermission(request.requestId, { behavior: 'deny', message: 'The user declined to answer.' })}
        >
          跳过
        </button>
      </div>
    </div>
  );
}

function PlanApproval({ request }: { request: PermissionRequest }) {
  const [feedback, setFeedback] = useState('');
  const plan = (request.input as any).plan;
  const approve = (mode: 'acceptEdits' | 'default') =>
    respondPermission(request.requestId, { behavior: 'allow', permissionMode: mode });

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2.5 font-semibold">
        <span className={badge}>
          <ClipboardList size={16} />
        </span>
        Claude 完成了计划，准备开始执行
      </div>
      {typeof plan === 'string' && (
        <div className="scroll-thin max-h-96 overflow-auto rounded-xl border border-line bg-bg/60 px-4 py-3">
          <Markdown text={plan} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={primary} onClick={() => approve('acceptEdits')} autoFocus>
          批准，并自动接受编辑
        </button>
        <button className={secondary} onClick={() => approve('default')}>
          批准，编辑逐项确认
        </button>
      </div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm transition-shadow outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/12"
          placeholder="想调整计划？写下修改意见"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <button
          className={secondary}
          onClick={() =>
            respondPermission(request.requestId, {
              behavior: 'deny',
              message: feedback.trim() || 'The user wants to keep planning.',
            })
          }
        >
          继续规划
        </button>
      </div>
    </div>
  );
}
