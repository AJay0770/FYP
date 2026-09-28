import iconData from './iconData'

/**
 * Line icon from the vendored Lucide set (see scripts/fetch-icons.mjs).
 *
 * Decorative by default (aria-hidden): the text beside an icon carries its
 * meaning. For an icon that stands alone as the only content of a control,
 * pass `label` - it becomes the accessible name.
 *
 * The markup comes from iconData.js, which is generated from a pinned,
 * vendored copy of Lucide - never from user or API data - so injecting it is
 * safe.
 */
export default function Icon({ name, size = 18, strokeWidth = 2, label, className = '', ...props }) {
  const inner = iconData[name]
  if (!inner) {
    if (import.meta.env.DEV) console.warn(`Unknown icon "${name}" - add it to scripts/fetch-icons.mjs`)
    return null
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ds-icon ${className}`.trim()}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: inner }}
      {...props}
    />
  )
}

export const iconNames = Object.keys(iconData)
