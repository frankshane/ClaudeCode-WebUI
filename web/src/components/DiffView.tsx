import { useMemo, useState } from 'react';
import { diffLines } from 'diff';

interface Line {
  sign: '+' | '-' | ' ';
  text: string;
}

const MAX_LINES = 300;

export function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const part of diffLines(oldText ?? '', newText ?? '')) {
      const sign = part.added ? '+' : part.removed ? '-' : ' ';
      const rows = part.value.split('\n');
      if (rows[rows.length - 1] === '') rows.pop();
      for (const text of rows) out.push({ sign, text });
    }
    return out;
  }, [oldText, newText]);

  const visible = showAll ? lines : lines.slice(0, MAX_LINES);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <pre className="scroll-thin max-h-[28rem] overflow-auto bg-sunken/50 py-1 font-mono dark:bg-bg/70 text-xs leading-5">
        {visible.map((l, i) => (
          <div
            key={i}
            className={
              l.sign === '+'
                ? 'bg-green-500/15 text-green-800 dark:text-green-300'
                : l.sign === '-'
                  ? 'bg-red-500/15 text-red-800 dark:text-red-300'
                  : 'text-muted'
            }
          >
            <span className="inline-block w-5 select-none text-center opacity-60">{l.sign}</span>
            {l.text}
          </div>
        ))}
      </pre>
      {lines.length > MAX_LINES && !showAll && (
        <button className="w-full border-t border-line py-1 text-xs text-muted transition-colors hover:bg-sunken/50 hover:text-fg" onClick={() => setShowAll(true)}>
          还有 {lines.length - MAX_LINES} 行，点击展开
        </button>
      )}
    </div>
  );
}
