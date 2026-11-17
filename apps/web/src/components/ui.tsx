import clsx from 'clsx';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Focusable, FocusSection, setFocus } from '../nav/focus';

export function Button({
  children, onClick, variant = 'secondary', className, focusKey, disabled, icon, testId, title,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  focusKey?: string;
  disabled?: boolean;
  icon?: ReactNode;
  testId?: string;
  title?: string;
}) {
  return (
    <Focusable
      focusKey={focusKey}
      onSelect={disabled ? undefined : onClick}
      disabled={disabled}
      testId={testId}
      title={title}
      ariaLabel={title}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent/90',
        variant === 'secondary' && 'bg-surface-2 text-text hover:bg-line',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-text',
        variant === 'danger' && 'bg-bad/15 text-bad hover:bg-bad/25',
        className,
      )}
    >
      {icon}
      {children}
    </Focusable>
  );
}

export function Chip({ active, children, onClick, testId, focusKey }: { active?: boolean; children: ReactNode; onClick: () => void; testId?: string; focusKey?: string }) {
  return (
    <Focusable
      focusKey={focusKey}
      onSelect={onClick}
      testId={testId}
      ariaPressed={active}
      className={clsx(
        'rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap',
        active ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:text-text',
      )}
    >
      {children}
    </Focusable>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block size-5 animate-spin rounded-full border-2 border-muted/40 border-t-accent', className)} />;
}

/** Modal dialog: traps D-pad focus inside, restores focus to where it was on close. */
export function Modal({ open, onClose, title, children, testId }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; testId?: string }) {
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    prev.current = getCurrentFocusKey();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('keydown', onKey, true);
      const back = prev.current;
      if (back) requestAnimationFrame(() => setFocus(back));
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-testid={testId}>
        <FocusSection boundary autoFocus>
          {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
          {children}
        </FocusSection>
      </div>
    </div>
  );
}

export function Img({ src, alt, className, fallback }: { src?: string; alt: string; className?: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <>{fallback ?? <div className={clsx('bg-surface-2', className)} />}</>;
  return <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} className={className} onError={() => setFailed(true)} />;
}

export function PosterFallback({ title, className }: { title: string; className?: string }) {
  const hue = [...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div
      className={clsx('flex items-end p-3 text-start text-sm font-semibold leading-snug text-white/90', className)}
      style={{ background: `linear-gradient(160deg, hsl(${hue} 45% 32%), hsl(${(hue + 40) % 360} 35% 14%))` }}
    >
      <span className="line-clamp-3">{title}</span>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center text-muted">
      {icon}
      <p className="text-base">{title}</p>
      {children}
    </div>
  );
}
