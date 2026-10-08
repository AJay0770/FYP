/**
 * Design tokens.
 *
 * Exported as JS so components (notably Recharts, which takes colours as
 * props) can reference tokens directly, and mirrored as CSS custom properties
 * in tokens.css. Changing a value here means changing it in tokens.css too -
 * they are deliberately kept as a matched pair rather than generated, to avoid
 * a build step.
 *
 * Contrast (WCAG AA): ratios are noted where a colour is used for text or
 * meaningful graphics. The neon accent is 1.6:1 on white, so on light
 * surfaces it is only ever a fill - with near-black text on it, or with a
 * darker outline when it is a chart mark (non-text contrast needs 3:1).
 */

export const colors = {
  bg: '#F5F6F4',
  surface: '#FFFFFF',
  surfaceMuted: '#F9FAF9',
  surfaceDark: '#0B0D0C',
  surfaceDark2: '#151917',
  text: '#111412',
  textMuted: '#5F6B66', // 5.6:1 on white
  textOnDark: '#F4F7F5',
  textMutedOnDark: '#9AA6A1', // 7.8:1 on surfaceDark
  border: '#E6E9E7',
  borderStrong: '#CDD3D0',
  borderDark: '#232826',

  accent: '#2EE6A6', // fill only on light; 12.1:1 as text on surfaceDark
  accentStrong: '#0B7A55', // accent text on light, 5.3:1 on white
  accentSoft: 'rgba(46, 230, 166, 0.12)',

  success: '#16A34A',
  successText: '#15803D',
  successSoft: '#E8F6ED',
  warning: '#F59E0B',
  warningText: '#B45309',
  warningSoft: '#FEF4E2',
  danger: '#EF4444',
  dangerText: '#B91C1C', // 5.7:1 on dangerSoft
  dangerSoft: '#FDECEC',
  info: '#3B82F6', // 3.7:1 on white - fine for chart marks
  infoText: '#1D4ED8',
  infoSoft: '#EAF1FE',

  // Legacy keys still read by older code.
  white: '#FFFFFF',
  neutral500: '#5F6B66',
  neutral700: '#333B37',
  neutral900: '#111412',
}

export const typography = {
  fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',

  hero: { fontSize: '2.5rem', lineHeight: 1.1, fontWeight: 700 },
  title: { fontSize: '1.5rem', lineHeight: 1.2, fontWeight: 600 },
  body: { fontSize: '1rem', lineHeight: 1.55, fontWeight: 400 },
  secondary: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 400 },
  label: { fontSize: '0.75rem', lineHeight: 1.4, fontWeight: 500, letterSpacing: '0.04em' },
  // Legacy keys.
  h1: { fontSize: '2.5rem', lineHeight: 1.1, fontWeight: 700 },
  h2: { fontSize: '1.5rem', lineHeight: 1.2, fontWeight: 600 },
  h3: { fontSize: '1.125rem', lineHeight: 1.3, fontWeight: 600 },
  h4: { fontSize: '1rem', lineHeight: 1.4, fontWeight: 600 },
  bodySmall: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 400 },
  caption: { fontSize: '0.8125rem', lineHeight: 1.45, fontWeight: 400 },
}

// 4px scale.
export const spacing = { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px', 12: '48px', 16: '64px',
  // Legacy keys.
  xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', xxl: '48px' }

export const radius = { input: '8px', button: '12px', card: '16px', hero: '24px', full: '999px' }

export const shadows = {
  sm: '0 1px 2px rgba(16, 24, 20, 0.04)',
  md: '0 4px 16px rgba(16, 24, 20, 0.06)',
  lg: '0 12px 32px rgba(16, 24, 20, 0.10)',
}

export const motion = { ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fast: 150, base: 200, slow: 250 }

export const breakpoints = { mobile: '375px', tablet: '768px', laptop: '1024px', desktop: '1280px', wide: '1440px' }

// Chart palette, categorical order. The accent leads; the others stay
// distinguishable for common colour-vision deficiencies (no red/green-only pair).
// ▼ EDIT: chart colours (bars/lines in Analytics). Keep in sync with tokens.css
export const chartColors = [colors.accent, colors.info, colors.warning, colors.textMuted, colors.danger]

export const chartTheme = {
  grid: colors.border,
  axis: colors.textMuted,
  text: colors.textMuted,
  // Outline for light chart marks (the accent is 1.6:1 on white alone).
  markStroke: colors.accentStrong,
  tooltipBg: colors.surface,
  tooltipText: colors.text,
  tooltipBorder: colors.border,
  cursor: 'rgba(46, 230, 166, 0.08)',
}

export default { colors, typography, spacing, radius, shadows, motion, breakpoints, chartColors, chartTheme }
