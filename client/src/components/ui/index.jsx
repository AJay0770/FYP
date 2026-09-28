/**
 * Component library.
 *
 * Presentational only - no data fetching, no app-specific logic. Everything is
 * driven by the tokens in styles/designSystem.js + styles/tokens.css, so
 * retheming is a token change rather than a component change.
 *
 * Every component keeps the props it had before the redesign (pages written
 * against the old API keep working); new props are optional.
 */
import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import Icon from '../icons/Icon'
import './ui.css'

export { Icon }

const cx = (...parts) => parts.filter(Boolean).join(' ')

/* ------------------------------------------------------------- Spinner */

export function Spinner({ size = 16, label }) {
  return (
    <span className="ds-spinner" role={label ? 'status' : undefined} aria-label={label}>
      <Icon name="loader-circle" size={size} />
    </span>
  )
}

/* ---------------------------------------------------------------- Button */

/**
 * variant: primary (accent) | secondary | dark | ghost | danger
 * `loading` shows a spinner in place of the label while keeping the button's
 * width, and disables it so an in-flight action can't be submitted twice.
 * `icon` / `iconRight` take an icon name. onClick/type pass straight through.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon,
  iconRight,
  className = '',
  disabled,
  children,
  ...props
}) {
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 20 : 17
  return (
    <button
      type="button"
      className={cx(
        'ds-btn',
        `ds-btn--${variant}`,
        size !== 'md' && `ds-btn--${size}`,
        fullWidth && 'ds-btn--full',
        loading && 'ds-btn--loading',
        !children && (icon || iconRight) && 'ds-btn--icon-only',
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <span className="ds-btn__label">
        {icon && <Icon name={icon} size={iconSize} />}
        {children}
        {iconRight && <Icon name={iconRight} size={iconSize} />}
      </span>
      {loading && (
        <span className="ds-btn__spinner" aria-hidden="true">
          <Icon name="loader-circle" size={iconSize} />
        </span>
      )}
    </button>
  )
}

/* ------------------------------------------------------------ Field bits */

function useFieldIds(id, hint, error) {
  const generatedId = useId()
  const fieldId = id || generatedId
  return {
    fieldId,
    hintId: hint ? `${fieldId}-hint` : undefined,
    errorId: error ? `${fieldId}-error` : undefined,
  }
}

function FieldLabel({ htmlFor, label, required }) {
  if (!label) return null
  return (
    <label className="ds-field__label" htmlFor={htmlFor}>
      {label}
      {required && <span className="ds-field__required" aria-hidden="true">*</span>}
    </label>
  )
}

function FieldMessages({ hint, error, hintId, errorId }) {
  return (
    <>
      {hint && !error && <span id={hintId} className="ds-field__hint">{hint}</span>}
      {error && (
        <span id={errorId} className="ds-field__error" role="alert">
          <Icon name="circle-alert" size={14} />
          {error}
        </span>
      )}
    </>
  )
}

/* ----------------------------------------------------------------- Input */

export function Input({ label, hint, error, required, id, icon, className = '', ...props }) {
  // Generated id keeps <label for> tied to the input even when the caller
  // doesn't supply one - without it the label is decorative to a screen reader.
  const { fieldId, hintId, errorId } = useFieldIds(id, hint, error)
  return (
    <div className="ds-field">
      <FieldLabel htmlFor={fieldId} label={label} required={required} />
      <div className={cx('ds-control', icon && 'ds-control--icon')}>
        {icon && <Icon name={icon} size={17} className="ds-control__icon" />}
        <input
          id={fieldId}
          className={cx('ds-input', error && 'ds-input--error', className)}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          {...props}
        />
      </div>
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  )
}

/* -------------------------------------------------------------- Textarea */

export function Textarea({ label, hint, error, required, id, className = '', rows = 4, ...props }) {
  const { fieldId, hintId, errorId } = useFieldIds(id, hint, error)
  return (
    <div className="ds-field">
      <FieldLabel htmlFor={fieldId} label={label} required={required} />
      <textarea
        id={fieldId}
        rows={rows}
        className={cx('ds-input', 'ds-textarea', error && 'ds-input--error', className)}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  )
}

/* ---------------------------------------------------------------- Select */

export function Select({ label, hint, error, required, id, options = [], children, ...props }) {
  const { fieldId, hintId, errorId } = useFieldIds(id, hint, error)
  return (
    <div className="ds-field">
      <FieldLabel htmlFor={fieldId} label={label} required={required} />
      <div className="ds-control ds-control--select">
        <select
          id={fieldId}
          className={cx('ds-select', error && 'ds-select--error')}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {children}
        </select>
        <Icon name="chevron-down" size={17} className="ds-control__chevron" />
      </div>
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  )
}

/* ------------------------------------------------------------- FileInput */

/**
 * Dropzone-styled wrapper around a native <input type="file">. The input
 * itself (and whatever onChange/accept/name the caller passes) is unchanged;
 * the box around it is presentation, plus a visual echo of the chosen file.
 */
export function FileInput({ label, hint, error, required, id, onChange, accept, ...props }) {
  const { fieldId, hintId, errorId } = useFieldIds(id, hint, error)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  return (
    <div className="ds-field">
      <FieldLabel htmlFor={fieldId} label={label} required={required} />
      <label
        htmlFor={fieldId}
        className={cx('ds-dropzone', dragging && 'ds-dropzone--active', error && 'ds-dropzone--error')}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDrop={() => setDragging(false)}
      >
        <span className="ds-dropzone__icon"><Icon name="upload" size={20} /></span>
        <span className="ds-dropzone__text">
          <strong>{fileName || 'Choose a file'}</strong>
          <span>{fileName ? 'Click to choose a different file' : 'or drag it here'}</span>
        </span>
        <input
          id={fieldId}
          type="file"
          accept={accept}
          required={required}
          className="ds-dropzone__input"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name || '')
            onChange?.(e)
          }}
          {...props}
        />
      </label>
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  )
}

/* ------------------------------------------------------------------ Card */

/**
 * variant: light (default) | dark. `interactive` adds the hover lift for
 * clickable cards. `icon` sits beside the title.
 */
export function Card({
  title,
  subtitle,
  actions,
  icon,
  variant = 'light',
  interactive = false,
  flush = false,
  children,
  className = '',
  ...props
}) {
  return (
    <section
      className={cx('ds-card', variant === 'dark' && 'ds-card--dark', interactive && 'ds-card--interactive', className)}
      {...props}
    >
      {(title || actions) && (
        <header className="ds-card__header">
          <div className="ds-card__heading">
            {icon && <span className="ds-card__icon"><Icon name={icon} size={18} /></span>}
            <div>
              {title && <h3 className="ds-card__title">{title}</h3>}
              {subtitle && <p className="ds-card__subtitle">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="ds-row ds-card__actions">{actions}</div>}
        </header>
      )}
      <div className={cx('ds-card__body', flush && 'ds-card__body--flush')}>{children}</div>
    </section>
  )
}

/* -------------------------------------------------------------- Count-up */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Animates 0 -> value once on first render. Decimals are preserved. */
export function useCountUp(value, durationMs = 700) {
  const [shown, setShown] = useState(typeof value === 'number' && !prefersReducedMotion() ? 0 : value)
  const started = useRef(false)
  useEffect(() => {
    if (typeof value !== 'number' || prefersReducedMotion()) {
      setShown(value)
      return undefined
    }
    // Animate only the first time a number appears; later updates (live data)
    // jump straight to the new value so they are never misread mid-animation.
    if (started.current) {
      setShown(value)
      return undefined
    }
    started.current = true
    const start = performance.now()
    let frame
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - (1 - t) ** 3
      setShown(value * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, durationMs])
  if (typeof value !== 'number') return value
  const decimals = Number.isInteger(value) ? 0 : String(value).split('.')[1]?.length || 0
  return Number(shown).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/* ------------------------------------------------------------- StatCard */

/** KPI tile. `value` counts up on first load when it is a number; `suffix` (e.g. "%") follows it. */
export function StatCard({ icon, label, value, suffix, sub, variant = 'light', tone, loading = false }) {
  const shown = useCountUp(value)
  return (
    <div className={cx('ds-stat', variant === 'dark' && 'ds-stat--dark', tone && `ds-stat--${tone}`)}>
      {icon && <span className="ds-stat__icon"><Icon name={icon} size={20} /></span>}
      <div className="ds-stat__body">
        <div className="ds-stat__label">{label}</div>
        {loading ? (
          <Skeleton width="60%" height={30} />
        ) : (
          <div className="ds-stat__value ds-num">{shown ?? '—'}{suffix && shown != null && <span className="ds-stat__suffix">{suffix}</span>}</div>
        )}
        {sub && <div className="ds-stat__sub">{sub}</div>}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Badge */

/**
 * variant: neutral | success | warning | danger | info | accent | dark.
 * `pulse` animates the dot - for LIVE cameras and fresh safety alerts.
 */
export function Badge({ variant = 'neutral', dot = false, pulse = false, icon, children }) {
  return (
    <span className={cx('ds-badge', `ds-badge--${variant}`, pulse && 'ds-badge--pulse')}>
      {/* Decorative: the label text carries the meaning, so colour is never
          the sole signal. */}
      {(dot || pulse) && <span className="ds-badge__dot" aria-hidden="true" />}
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  )
}

/** Maps domain values to badge variants so status colouring stays consistent. */
export function statusVariant(value) {
  const map = {
    ONLINE: 'success', OFFLINE: 'neutral',
    ACTIVE: 'success', PLANNING: 'info', ON_HOLD: 'warning', COMPLETED: 'neutral',
    NO_HELMET: 'danger', NO_VEST: 'warning',
    ADMIN: 'info', ENGINEER: 'success', CLIENT: 'neutral',
    RECEIVED: 'success', CONSUMED: 'warning',
    EXPIRED: 'danger', CANCELLED: 'neutral',
  }
  return map[value] || 'neutral'
}

/* ---------------------------------------------------------- ProgressBar */

/** value 0..1. For confidence scores and similar. */
export function ProgressBar({ value, variant = 'accent', label }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100
  return (
    <span className="ds-progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <span className={cx('ds-progress__fill', `ds-progress__fill--${variant}`)} style={{ width: `${pct}%` }} />
    </span>
  )
}

/* ------------------------------------------------------------- Skeleton */

export function Skeleton({ width = '100%', height = 14, radius, lines, className = '' }) {
  if (lines) {
    return (
      <span className={cx('ds-skeleton-lines', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="ds-skeleton" style={{ width: i === lines - 1 ? '60%' : '100%', height }} />
        ))}
      </span>
    )
  }
  return <span className={cx('ds-skeleton', className)} style={{ width, height, borderRadius: radius }} aria-hidden="true" />
}

/* ----------------------------------------------------------------- Table */

/**
 * Columns: { key, header, render?, align?: 'left'|'right'|'center', width? }.
 * `loading` shows skeleton rows; `emptyState` (a node) replaces the plain
 * `empty` text when there are no rows.
 */
export function Table({
  columns,
  rows,
  empty = 'No data',
  emptyState,
  loading = false,
  skeletonRows = 4,
  onRowClick,
  getRowKey,
  hover = true,
  rowClassName,
}) {
  return (
    <div className="ds-table-wrap">
      <table className={cx('ds-table', hover && 'ds-table--hover', onRowClick && 'ds-table--clickable')}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.align ? `ds-align-${col.align}` : undefined} style={col.width ? { width: col.width } : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: skeletonRows }, (_, i) => (
              <tr key={`sk-${i}`} className="ds-table__skeleton-row">
                {columns.map((col) => (
                  <td key={col.key}><Skeleton width={`${50 + ((i * 17 + col.key.length * 7) % 45)}%`} /></td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td className="ds-table__empty" colSpan={columns.length}>
                {emptyState || (
                  <span className="ds-table__empty-inner">
                    <Icon name="inbox" size={20} />
                    {empty}
                  </span>
                )}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={getRowKey ? getRowKey(row) : row.id || index}
                className={rowClassName ? rowClassName(row) : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                // Clickable rows must also be reachable and activatable by keyboard.
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.align ? `ds-align-${col.align}` : undefined}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

/* ----------------------------------------------------------------- Modal */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, title, onClose, footer, children }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const returnFocusTo = document.activeElement

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
      // Keep Tab inside the dialog while it is open.
      if (e.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)

    // Move focus into the dialog so keyboard users aren't left behind it.
    dialogRef.current?.focus()

    // Prevent the page behind from scrolling while the overlay is up.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (returnFocusTo && returnFocusTo.focus) returnFocusTo.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="ds-modal__overlay" onClick={onClose} role="presentation">
      <div
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ds-modal__header">
          <h2 className="ds-modal__title">{title}</h2>
          <button className="ds-modal__close" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="ds-modal__body">{children}</div>
        {footer && <footer className="ds-modal__footer">{footer}</footer>}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Toast */

const TOAST_ICONS = { info: 'info', success: 'circle-check', warning: 'triangle-alert', danger: 'shield-alert' }

export function Toast({ variant = 'info', title, message, onDismiss, duration }) {
  return (
    <div className={`ds-toast ds-toast--${variant}`}>
      <span className="ds-toast__icon"><Icon name={TOAST_ICONS[variant] || 'info'} size={18} /></span>
      <div className="ds-toast__content">
        {title && <div className="ds-toast__title">{title}</div>}
        {message && <div className="ds-toast__message">{message}</div>}
      </div>
      {onDismiss && (
        <button className="ds-toast__close" onClick={onDismiss} aria-label="Dismiss notification">
          <Icon name="x" size={15} />
        </button>
      )}
      {duration > 0 && (
        <span className="ds-toast__progress" style={{ animationDuration: `${duration}ms` }} aria-hidden="true" />
      )}
    </div>
  )
}

/**
 * Container for toasts.
 *
 * role="status" + aria-live="polite" so screen readers announce new toasts
 * without interrupting whatever the user is doing. Safety alerts are announced
 * this way rather than as assertive, since they arrive unprompted and could
 * otherwise cut across the user mid-sentence.
 */
export function ToastRegion({ toasts, onDismiss }) {
  if (!toasts?.length) return null
  return (
    <div className="ds-toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} {...t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}

/** Small helper for managing a toast queue. */
export function useToasts(autoDismissMs = 6000) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (toast) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // `duration` only drives the visual countdown bar.
      setToasts((prev) => [...prev, { ...toast, id, duration: autoDismissMs }])
      if (autoDismissMs) setTimeout(() => dismiss(id), autoDismissMs)
      return id
    },
    [autoDismissMs, dismiss]
  )

  return { toasts, push, dismiss }
}

/* -------------------------------------------------------------- Tooltip */

/**
 * Hover/focus tooltip for icon-only controls. The child should still carry
 * its own aria-label; the tooltip is linked with aria-describedby.
 */
export function Tooltip({ label, side = 'top', children }) {
  const tipId = useId()
  const child = Children.only(children)
  return (
    <span className={`ds-tooltip ds-tooltip--${side}`}>
      {isValidElement(child) ? cloneElement(child, { 'aria-describedby': tipId }) : child}
      <span role="tooltip" id={tipId} className="ds-tooltip__bubble">{label}</span>
    </span>
  )
}

/* --------------------------------------------------------------- Avatar */

/** Initials avatar. `name` may be a person's name or an email address. */
export function Avatar({ name = '', size = 36, variant = 'accent' }) {
  const base = name.includes('@') ? name.split('@')[0] : name
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase()
  return (
    <span
      className={`ds-avatar ds-avatar--${variant}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  )
}

/* ------------------------------------------------- Page & section headers */

export function PageHeader({ title, subtitle, breadcrumb, actions, eyebrow }) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-header__text">
        {breadcrumb && <nav className="ds-breadcrumb" aria-label="Breadcrumb">{breadcrumb}</nav>}
        {eyebrow && <div className="ds-eyebrow">{eyebrow}</div>}
        <h1 className="ds-page-header__title">{title}</h1>
        {subtitle && <p className="ds-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ds-row ds-page-header__actions">{actions}</div>}
    </header>
  )
}

export function SectionHeader({ title, subtitle, icon, actions }) {
  return (
    <div className="ds-section-header">
      <div className="ds-card__heading">
        {icon && <span className="ds-card__icon"><Icon name={icon} size={18} /></span>}
        <div>
          <h2 className="ds-section-header__title">{title}</h2>
          {subtitle && <p className="ds-section-header__subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="ds-row">{actions}</div>}
    </div>
  )
}

/* ---------------------------------------------------- Empty / error states */

export function EmptyState({ icon = 'inbox', title, message, action, compact = false }) {
  return (
    <div className={cx('ds-empty', compact && 'ds-empty--compact')}>
      <span className="ds-empty__icon"><Icon name={icon} size={compact ? 20 : 26} /></span>
      {title && <div className="ds-empty__title">{title}</div>}
      {message && <p className="ds-empty__message">{message}</p>}
      {action && <div className="ds-empty__action">{action}</div>}
    </div>
  )
}

/** Error with an optional retry that re-runs the caller's existing fetch. */
export function ErrorState({ message, onRetry, compact = false }) {
  return (
    <div className={cx('ds-empty', 'ds-empty--error', compact && 'ds-empty--compact')} role="alert">
      <span className="ds-empty__icon"><Icon name="triangle-alert" size={compact ? 20 : 26} /></span>
      <p className="ds-empty__message">{message}</p>
      {onRetry && (
        <div className="ds-empty__action">
          <Button size="sm" variant="secondary" icon="refresh-cw" onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Tabs */

/**
 * Pill tabs with a sliding indicator. tabs: [{ id, label, icon?, badge? }].
 * Purely which-panel-is-visible state; the caller decides what each shows.
 */
export function Tabs({ tabs, value, onChange, label = 'Sections' }) {
  const listRef = useRef(null)
  const [indicator, setIndicator] = useState(null)

  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector('[aria-selected="true"]')
    if (!el) return
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
    // Keep the active tab visible when the strip scrolls sideways on small
    // screens. Scroll only the strip: scrollIntoView() would also scroll the
    // page and jump it to wherever the tabs are.
    if (el.offsetLeft < list.scrollLeft) list.scrollLeft = el.offsetLeft - 8
    else if (el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = el.offsetLeft + el.offsetWidth - list.clientWidth + 8
    }
  }, [value, tabs.length])

  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.id === value)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const target = tabs[(next + tabs.length) % tabs.length]
    onChange(target.id)
    listRef.current?.querySelector(`[data-tab="${target.id}"]`)?.focus()
  }

  return (
    <div className="ds-tabs" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
      {indicator && <span className="ds-tabs__indicator" style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }} aria-hidden="true" />}
      {tabs.map((t) => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cx('ds-tabs__tab', selected && 'ds-tabs__tab--active')}
            onClick={() => onChange(t.id)}
          >
            {t.icon && <Icon name={t.icon} size={16} />}
            {t.label}
            {t.badge != null && <span className="ds-tabs__badge">{t.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------ SegmentedControl */

/** options: [{ value, label }]. A compact single-choice switch. */
export function SegmentedControl({ options, value, onChange, label }) {
  return (
    <div className="ds-segmented" role="radiogroup" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          className={cx('ds-segmented__option', opt.value === value && 'ds-segmented__option--active')}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------- Layout helpers */

export function Stack({ children, className = '' }) {
  return <div className={cx('ds-stack', className)}>{children}</div>
}

export function Row({ children, className = '', style }) {
  return <div className={cx('ds-row', className)} style={style}>{children}</div>
}

export function Grid({ columns = 2, children, className = '' }) {
  return <div className={cx('ds-grid', `ds-grid--${columns}`, className)}>{children}</div>
}
