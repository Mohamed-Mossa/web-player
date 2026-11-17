import {
  FocusContext, GetBoundingClientRectAdapter, init, setFocus, updateRtl, useFocusable, type FocusableComponentLayout, type FocusDetails,
} from '@noriginmedia/norigin-spatial-navigation';
import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, type ReactNode } from 'react';

export function initSpatialNav(rtl: boolean) {
  init({
    debug: false,
    visualDebug: false,
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: false },
    // Measure with getBoundingClientRect: correct for scaled (TV) focus states and RTL layouts.
    layoutAdapter: GetBoundingClientRectAdapter,
    throttle: 60,
    throttleKeypresses: true,
    rtl,
  });
}
export const setSpatialRtl = (rtl: boolean) => updateRtl(rtl);
export { setFocus };

type Dir = 'up' | 'down' | 'left' | 'right';

export interface FocusableProps {
  focusKey?: string;
  onSelect?: () => void;
  onFocused?: (layout: FocusableComponentLayout, details: FocusDetails) => void;
  onArrow?: (dir: Dir) => boolean;
  className?: string;
  children?: ReactNode;
  grow?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  testId?: string;
  as?: 'button' | 'div' | 'a';
  href?: string;
}

/** A remote/keyboard/mouse friendly button. Enter/OK and click both call onSelect. */
export function Focusable({
  focusKey, onSelect, onFocused, onArrow, className, children, grow, disabled, title, ariaLabel, ariaPressed, testId,
}: FocusableProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    focusable: !disabled,
    onEnterPress: () => onSelect?.(),
    onFocus: (layout, _p, details) => onFocused?.(layout, details),
    onArrowPress: onArrow ? (dir) => onArrow(dir as Dir) : undefined,
  });
  return (
    <button
      ref={ref}
      type="button"
      data-focused={focused}
      data-testid={testId}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={() => onSelect?.()}
      className={clsx('focus-ring', grow && 'focus-grow', disabled && 'opacity-40', className)}
    >
      {children}
    </button>
  );
}

export interface SectionHandle {
  focus: () => void;
}

/** Groups focusables; remembers the last focused child so returning to it lands where you left. */
export const FocusSection = forwardRef<
  SectionHandle,
  {
    focusKey?: string;
    children: ReactNode;
    className?: string;
    boundary?: boolean;
    boundaryDirections?: Dir[];
    autoFocus?: boolean;
    preferredChildFocusKey?: string;
    testId?: string;
    as?: 'div' | 'nav' | 'aside' | 'section' | 'main';
  }
>(function FocusSection({ focusKey, children, className, boundary, boundaryDirections, autoFocus, preferredChildFocusKey, testId, as = 'div' }, handle) {
  const { ref, focusKey: fk, focusSelf } = useFocusable({
    focusKey,
    trackChildren: true,
    saveLastFocusedChild: true,
    isFocusBoundary: boundary,
    focusBoundaryDirections: boundaryDirections,
    preferredChildFocusKey,
  });
  useImperativeHandle(handle, () => ({ focus: () => focusSelf() }), [focusSelf]);
  useEffect(() => {
    if (autoFocus) {
      const id = requestAnimationFrame(() => focusSelf());
      return () => cancelAnimationFrame(id);
    }
  }, [autoFocus, focusSelf]);
  const Tag = as;
  return (
    <FocusContext.Provider value={fk}>
      <Tag ref={ref} className={className} data-testid={testId}>
        {children}
      </Tag>
    </FocusContext.Provider>
  );
});

/** Text input that lets left/right move the caret and up/down leave the field. */
export function TextField({
  value, onChange, placeholder, type = 'text', label, focusKey, autoFocus, onSubmit, testId, dir, inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  label?: string;
  focusKey?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  testId?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  inputMode?: 'text' | 'numeric' | 'url';
}) {
  const { ref, focused, focusSelf } = useFocusable({
    focusKey,
    onArrowPress: (d) => d === 'up' || d === 'down',
    onEnterPress: () => onSubmit?.(),
  });
  useEffect(() => {
    if (autoFocus) focusSelf();
  }, [autoFocus, focusSelf]);
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm text-muted">{label}</span>}
      <input
        ref={ref}
        data-focused={focused}
        data-testid={testId}
        className="focus-ring w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-text placeholder:text-muted/70"
        value={value}
        type={type}
        dir={dir}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit?.();
        }}
      />
    </label>
  );
}
