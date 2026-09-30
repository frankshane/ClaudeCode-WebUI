import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type Placement = 'top' | 'bottom' | 'auto';

/** Room a popover panel typically needs; 'auto' opens downward only if it fits. */
const PANEL_ROOM = 360;

/** Resolves 'auto' against the space around `el` in the viewport. */
export function resolvePlacement(placement: Placement, el: Element | null): 'top' | 'bottom' {
  if (placement !== 'auto' || !el) return placement === 'bottom' ? 'bottom' : 'top';
  const rect = el.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  return below >= PANEL_ROOM || below >= rect.top ? 'bottom' : 'top';
}

/** A trigger button with a popover panel; closes on outside click or Escape. */
export function Dropdown(props: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  placement?: Placement;
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
  title?: string;
  disabled?: boolean;
  /** Called each time the panel opens. */
  onOpen?: () => void;
}) {
  const { trigger, children, placement = 'top', align = 'left', className = '', panelClassName = '', title, disabled, onOpen } = props;
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'top' | 'bottom'>('top');
  /** Viewport space on the side the panel opens to; panels read it as `--dd-room` to cap their lists. */
  const [room, setRoom] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = () => {
    if (!open) {
      const next = resolvePlacement(placement, ref.current);
      const rect = ref.current?.getBoundingClientRect();
      setSide(next);
      setRoom(rect ? Math.max(160, (next === 'top' ? rect.top : window.innerHeight - rect.bottom) - 16) : 0);
      onOpen?.();
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className={className} title={title} disabled={disabled} onClick={toggle}>
        {trigger(open)}
      </button>
      {open && (
        <div
          className={`pop-in absolute z-30 overflow-hidden rounded-xl border border-line bg-panel shadow-pop ${
            side === 'top' ? 'bottom-full mb-2' : 'pop-in-down top-full mt-2'
          } ${align === 'right' ? 'right-0' : 'left-0'} ${panelClassName}`}
          style={room ? ({ '--dd-room': `${room}px` } as CSSProperties) : undefined}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
