/**
 * Thin, app-shaped wrappers around the KendoReact (free tier) form
 * components. Pages keep working with plain strings — '' for "nothing
 * picked", 'yyyy-MM-dd' for dates — exactly like the native controls they
 * replaced, so Supabase payload code didn't have to change. Only free
 * components are used here (no license key needed):
 * DropDownList, DatePicker, Input, TextArea, NumericTextBox, Checkbox, Loader.
 */
import { format, parseISO } from 'date-fns';
import { DropDownList } from '@progress/kendo-react-dropdowns';
import { DatePicker } from '@progress/kendo-react-dateinputs';
import { Checkbox, Input, NumericTextBox, TextArea } from '@progress/kendo-react-inputs';
import { Loader } from '@progress/kendo-react-indicators';
import { Popover } from '@progress/kendo-react-tooltip';
import { SvgIcon } from '@progress/kendo-react-common';
import { infoCircleIcon } from '@progress/kendo-svg-icons';
import { useState } from 'react';

export { Button } from '@progress/kendo-react-buttons';

export interface SelectOption {
  value: string;
  label: string;
}

/** Dropdown over `{ value, label }` options; value is the option's string. */
export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  disabled,
  placeholder,
  size,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  size?: 'small' | 'medium' | 'large';
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  /** Shown when no option matches `value` (e.g. '' before anything is picked). */
  placeholder?: string;
}) {
  const current = options.find((o) => o.value === value) ?? null;
  return (
    <DropDownList
      data={options}
      textField="label"
      dataItemKey="value"
      value={current}
      defaultItem={placeholder && !options.some((o) => o.value === '') ? { value: '', label: placeholder } : undefined}
      onChange={(e) => onChange((e.value as SelectOption | null)?.value ?? '')}
      ariaLabel={ariaLabel}
      className={className}
      disabled={disabled}
      size={size}
    />
  );
}

/** Date picker bound to a 'yyyy-MM-dd' string ('' = no date). */
export function DateField({
  value,
  onChange,
  max,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <DatePicker
      value={value ? parseISO(value) : null}
      onChange={(e) => onChange(e.value ? format(e.value, 'yyyy-MM-dd') : '')}
      max={max ? parseISO(max) : undefined}
      format="d MMM yyyy"
      formatPlaceholder="formatPattern"
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
  inputMode,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputMode?: 'numeric' | 'text';
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(String(e.value ?? ''))}
      placeholder={placeholder}
      className={className}
      autoFocus={autoFocus}
      inputMode={inputMode}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 2,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <TextArea
      value={value}
      onChange={(e) => onChange(String(e.value ?? ''))}
      placeholder={placeholder}
      rows={rows}
      className={className}
      autoSize
    />
  );
}

/** Number box bound to a string ('' = empty), so callers can keep
 * validating free text exactly as before. */
export function NumberField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const n = value.trim() === '' ? null : Number(value);
  return (
    <NumericTextBox
      value={n !== null && Number.isFinite(n) ? n : null}
      onChange={(e) => onChange(e.value === null || e.value === undefined ? '' : String(e.value))}
      placeholder={placeholder}
      format="#,##0.####"
      spinners={false}
    />
  );
}

export function CheckField({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return <Checkbox checked={checked} onChange={(e) => onChange(Boolean(e.value))} label={label} aria-label={ariaLabel} disabled={disabled} />;
}

/** Centered page-level spinner — replaces the old "Loading …" text blocks. */
export function PageLoader({ label }: { label: string }) {
  return (
    <div className="page-loading" role="status">
      <Loader type="converging-spinner" size="medium" themeColor="primary" />
      <span>{label}</span>
    </div>
  );
}

/** Small inline spinner for a section that's still fetching. */
export function InlineLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty-state inline-loading" role="status">
      <Loader type="pulsing" size="small" themeColor="primary" />
      <span>{label}</span>
    </div>
  );
}

/** Small "i" button that reveals explanatory text on hover, focus or tap —
 * keeps help copy available without leaving paragraphs on screen.
 *
 * Rendered as a focusable span with role="button", not a <button>: InfoTips
 * often sit inside a field's <label>, and a label forwards clicks on its
 * non-interactive parts (like a Kendo dropdown) to its first <button> or
 * input — which made clicking the dropdown open this tip instead. */
export function InfoTip({ children, label = 'More info' }: { children: React.ReactNode; label?: string }) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        ref={setAnchor}
        className="info-tip"
        aria-label={label}
        aria-expanded={open}
        // A tap on a phone fires hover, focus AND click; reacting to all
        // three opened and instantly closed the tip on Android. So: hover
        // only for a mouse, focus only from the keyboard, and a tap toggles.
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Don't let a surrounding <label> treat this as a click on its field.
          e.preventDefault();
          const pointerType = (e.nativeEvent as PointerEvent).pointerType;
          if (pointerType === 'mouse') setOpen(true);
          else setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      >
        <SvgIcon icon={infoCircleIcon} size="small" />
      </span>
      <Popover show={open && Boolean(anchor)} anchor={anchor} position="bottom" callout className="info-tip-popover">
        <div className="info-tip-body">{children}</div>
      </Popover>
    </>
  );
}
