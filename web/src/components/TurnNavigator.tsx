import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { Item } from '../lib/transcript.ts';

interface TurnInfo {
  index: number;
  anchorId: string;
  userPrompt: string;
  assistantSummary: string;
}

/** 彻底清洗用户文本中的内部标签、图片占位符与系统注入块，还原真实提问 */
function extractCleanUserPrompt(item: Item): string {
  if (item.kind !== 'user') return '';
  let text = item.text || '';

  // 1. 去除系统提示词、图片占位标记、附件标记与 XML 标签
  text = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\[Image:\s*source:[^\]]*\]/gi, '')
    .replace(/<attachment\s+filename="([^"]*)">[\s\S]*?<\/attachment>/gi, '$1 ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[图片\]/g, '')
    .trim();

  // 2. 如果包含上传的文件/图片，补充说明
  if (!text) {
    if (item.files && item.files.length > 0) {
      return `[附件] ${item.files.map((f) => f.name).join('、')}`;
    }
    if (item.images && item.images.length > 0) {
      return '[发送了一张图片]';
    }
    return '（用户消息）';
  }

  // 3. 压缩多余空白
  return text.replace(/\s+/g, ' ');
}

/** 提取助手回复的有效首段摘要 */
function extractAssistantSummary(text: string): string {
  if (!text) return '';
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^[#\s*`>_~-]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function TurnNavigator({
  scrollerRef,
  items,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  items: Item[];
}) {
  const [activeTurn, setActiveTurn] = useState<number>(1);
  const [hoveredTurn, setHoveredTurn] = useState<number | null>(null);
  const [hoveredTop, setHoveredTop] = useState<number | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  // 提取用户提问与该轮助手回复开头摘要
  const turns = useMemo(() => {
    const list: TurnInfo[] = [];
    let currentTurn: TurnInfo | null = null;
    let count = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'user') {
        count++;
        const prompt = extractCleanUserPrompt(item);
        currentTurn = {
          index: count,
          anchorId: `turn-anchor-${item.key}`,
          userPrompt: prompt,
          assistantSummary: '',
        };
        list.push(currentTurn);
      } else if (item.kind === 'text' && currentTurn && !currentTurn.assistantSummary) {
        const summary = extractAssistantSummary(item.text);
        if (summary) {
          currentTurn.assistantSummary = summary.length > 90 ? `${summary.slice(0, 90)}…` : summary;
        }
      }
    }
    return list;
  }, [items]);

  // 滚动监听（Scrollspy）：高亮当前视口正在阅读的对话轮次
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || turns.length < 2) return;

    const onScroll = () => {
      const scrollerRect = scroller.getBoundingClientRect();
      const threshold = scrollerRect.top + 140;
      let current = turns[0]?.index ?? 1;

      for (const t of turns) {
        const el = document.getElementById(t.anchorId);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= threshold) {
          current = t.index;
        } else {
          break;
        }
      }
      setActiveTurn(current);
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [turns, scrollerRef]);

  // 鼠标悬停事件：精准计算悬停刻度相对于 aside 的纵向绝对坐标
  const handleMouseEnter = (index: number, e: MouseEvent<HTMLButtonElement>) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    const btnRect = e.currentTarget.getBoundingClientRect();
    const asideRect = asideRef.current?.getBoundingClientRect();
    if (asideRect) {
      setHoveredTop(btnRect.top - asideRect.top + btnRect.height / 2);
    }
    setHoveredTurn(index);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredTurn(null);
      setHoveredTop(null);
      hoverTimerRef.current = null;
    }, 150);
  };

  // 轮次小于 2 时不展示，保持单轮时的界面纯净
  if (turns.length < 2) return null;

  const scrollToTurn = (anchorId: string) => {
    const el = document.getElementById(anchorId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const activeHoveredInfo = hoveredTurn ? turns.find((t) => t.index === hoveredTurn) : null;

  return (
    <aside
      ref={asideRef}
      className="absolute right-1 top-1/2 -translate-y-1/2 z-30 hidden md:flex flex-col items-end select-none py-1"
      aria-label="对话时间轴导航"
      onMouseLeave={handleMouseLeave}
    >
      {/*
        浮动预览卡片直接挂在 aside 顶层（与 overflow-y-auto 容器平级）！
        彻底消灭任何 CSS 裁剪（BFC 切割）问题，100% 稳定弹出！
      */}
      {activeHoveredInfo && hoveredTop !== null && (
        <div
          className="pop-in absolute right-8 -translate-y-1/2 pointer-events-none z-50 w-72 max-w-[85vw] rounded-2xl border border-line bg-panel p-3.5 shadow-pop text-left"
          style={{ top: hoveredTop }}
        >
          {/* 第一行：加粗显示你发的问题 */}
          <div className="text-[0.8125rem] font-semibold text-fg leading-snug line-clamp-3">
            {activeHoveredInfo.userPrompt}
          </div>

          {/* 第二行：灰色正文，显示该轮助手的作答开头 */}
          {activeHoveredInfo.assistantSummary ? (
            <div className="text-xs text-muted/80 leading-relaxed line-clamp-2 mt-2 pt-2 border-t border-line/60">
              {activeHoveredInfo.assistantSummary}
            </div>
          ) : (
            <div className="text-[0.6875rem] text-faint mt-1.5 pt-1.5 border-t border-line/50 italic">
              （AI 作答中…）
            </div>
          )}
        </div>
      )}

      {/* 紧凑刻度线容器：恢复原版紧致小间距（gap-0.5） */}
      <div className="scroll-thin flex max-h-[70vh] flex-col items-end overflow-y-auto px-1 py-0.5">
        {turns.map((t) => {
          const isActive = t.index === activeTurn;
          const isHovered = t.index === hoveredTurn;

          return (
            <div key={t.index} className="flex items-center justify-end">
              {/*
                精致紧凑刻度按钮：
                1. 高度缩紧回 h-3.5（14px），彻底告别原先松散的大间距；
                2. 彻底去掉原生 title 属性，绝不弹出操作系统的默认小黑框！
              */}
              <button
                type="button"
                className="flex h-3.5 w-6 cursor-pointer items-center justify-end px-1 transition-colors focus:outline-none"
                onClick={() => scrollToTurn(t.anchorId)}
                onMouseEnter={(e) => handleMouseEnter(t.index, e)}
              >
                {/* DSH 1:1 同款细刻度水平短横线 */}
                <span
                  className={`pointer-events-none rounded-full transition-all duration-150 ${
                    isActive
                      ? 'h-[2.5px] w-4.5 bg-accent shadow-[0_0_6px_rgba(217,119,87,0.5)]'
                      : isHovered
                        ? 'h-[2px] w-4 bg-accent/80'
                        : 'h-[1.5px] w-2.5 bg-muted/40 hover:bg-muted/70'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
