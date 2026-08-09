/**
 * Component library.
 *
 * Presentational only — no data fetching, no app-specific logic. Everything is
 * driven by the tokens in styles/designSystem.js + styles/tokens.css, so retheming
 * is a token change rather than a component change.
 */
import { useEffect, useId, useRef, useState, useCallback } from 'react'
import './ui.css'

/* ---------------------------------------------------------------- Button */

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  ...props
}) {
  const classes = [
    'ds-btn',
    `ds-btn--${variant}`,
    size !== 'md' ? `ds-btn--${size}` : '',
    fullWidth ? 'ds-btn--full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  )
}

/* ----------------------------------------------------------------- Input */

export function Input({ label, hint, error, required, id, className = '', ...props }) {
  // Generated id keeps <label for> tied to the input even when the caller
  // doesn't supply one — without it the label is decorative to a screen reader.
  const generatedId = useId()
  const inputId = id || generatedId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined

  return (
    <div className="ds-field">
      {label && (
        <label className="ds-field__label" htmlFor={inputId}>
          {label}
          {required && <span className="ds-field__required" aria-hidden="true">*</span>}
        </label>
      )}
      <input
        id={inputId}
        className={`ds-input ${error ? 'ds-input--error' : ''} ${className}`.trim()}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {hint && !error && <span id={hintId} className="ds-field__hint">{hint}</span>}
      {error && <span id={errorId} className="ds-field__error" role="alert">{error}</span>}
    </div>
  )
}

/* ---------------------------------------------------------------- Select */

export function Select({ label, hint, error, required, id, options = [], children, ...props }) {
  const generatedId = useId()
  const selectId = id || generatedId
  const hintId = hint ? `${selectId}-hint` : undefined
  const errorId = error ? `${selectId}-error` : undefined

  return (
    <div className="ds-field">
      {label && (
        <label className="ds-field__label" htmlFor={selectId}>
          {label}
          {required && <span className="ds-field__required" aria-hidden="true">*</span>}
        </label>
      )}
      <select
        id={selectId}
        className={`ds-select ${error ? 'ds-select--error' : ''}`}
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
      {hint && !error && <span id={hintId} className="ds-field__hint">{hint}</span>}
      {error && <span id={errorId} className="ds-field__error" role="alert">{error}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ Card */

export function Card({ title, subtitle, actions, flush = false, children, className = '', ...props }) {
  return (
    <section className={`ds-card ${className}`.trim()} {...props}>
      {(title || actions) && (
        <header className="ds-card__header">
          <div>
            {title && <h3 className="ds-card__title">{title}</h3>}
            {subtitle && <p className="ds-card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="ds-row">{actions}</div>}
        </header>
      )}
      <div className={`ds-card__body ${flush ? 'ds-card__body--flush' : ''}`.trim()}>{children}</div>
    </section>
  )
}

/* ----------------------------------------------------------------- Badge */

export function Badge({ variant = 'neutral', dot = false, children }) {
  return (
    <span className={`ds-badge ds-badge--${variant}`}>
      {/* Decorative: the label text carries the meaning, so colour is never
          the sole signal. */}
      {dot && <span className="ds-badge__dot" aria-hidden="true" />}
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

/* ----------------------------------------------------------------- Table */

export function Table({ columns, rows, empty = 'No data', onRowClick, getRowKey, hover = true }) {
  return (
    <div className="ds-table-wrap">
      <table className={`ds-table ${hover ? 'ds-table--hover' : ''} ${onRowClick ? 'ds-table--clickable' : ''}`.trim()}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="ds-table__empty" colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={getRowKey ? getRowKey(row) : row.id || index}
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
                  <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
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

export function Modal({ open, title, onClose, footer, children }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
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
            &times;
          </button>
        </header>
        <div className="ds-modal__body">{children}</div>
        {footer && <footer className="ds-modal__footer">{footer}</footer>}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Toast */

export function Toast({ variant = 'info', title, message, onDismiss }) {
  return (
    <div className={`ds-toast ds-toast--${variant}`}>
      <div className="ds-toast__content">
        {title && <div className="ds-toast__title">{title}</div>}
        {message && <div className="ds-toast__message">{message}</div>}
      </div>
      {onDismiss && (
        <button className="ds-toast__close" onClick={onDismiss} aria-label="Dismiss notification">
          &times;
        </button>
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
      setToasts((prev) => [...prev, { ...toast, id }])
      if (autoDismissMs) setTimeout(() => dismiss(id), autoDismissMs)
      return id
    },
    [autoDismissMs, dismiss]
  )

  return { toasts, push, dismiss }
}

/* ------------------------------------------------------- Layout helpers */

export function Stack({ children, className = '' }) {
  return <div className={`ds-stack ${className}`.trim()}>{children}</div>
}

export function Row({ children, className = '' }) {
  return <div className={`ds-row ${className}`.trim()}>{children}</div>
}

export function Grid({ columns = 2, children, className = '' }) {
  return <div className={`ds-grid ds-grid--${columns} ${className}`.trim()}>{children}</div>
}
