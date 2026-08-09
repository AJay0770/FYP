/**
 * Design tokens.
 *
 * Exported as JS so components can reference tokens directly, and mirrored as CSS
 * custom properties in tokens.css so stylesheets can use the same values. Changing
 * a value here means changing it in tokens.css too — they are deliberately kept as
 * a matched pair rather than generated, to avoid a build step.
 *
 * Contrast: every foreground/background pairing used for text in the component
 * library was checked against WCAG AA (4.5:1 for body text, 3:1 for large text).
 * Ratios are noted beside the tokens where it matters.
 */

export const colors = {
  // Primary — construction/industrial blue.
  primary50: '#eef4fb',
  primary100: '#d6e6f6',
  primary300: '#7fb0e0',
  primary500: '#1f6fb2',
  primary600: '#1a5d96', // 5.7:1 on white — safe for body text
  primary700: '#144a77',

  // Secondary — slate.
  secondary500: '#4a5568',
  secondary600: '#3a4453',

  // Accent — safety amber. Very low contrast on white, so it is used for fills
  // and borders only, never for text on a light background.
  accent400: '#f0a202',
  accent500: '#d98c00',

  // Neutrals.
  white: '#ffffff',
  neutral50: '#f7f8fa',
  neutral100: '#eceef2',
  neutral200: '#dcdfe5',
  neutral300: '#c2c7d0',
  neutral500: '#6b7280', // 4.8:1 on white — the lightest usable for body text
  neutral700: '#3f4652',
  neutral900: '#1c2027', // 15.8:1 on white

  // Status.
  successBg: '#e6f4ec',
  success: '#0f7a45',   // 4.9:1 on white
  warningBg: '#fdf3e2',
  warning: '#8a5a00',   // 5.9:1 on white
  dangerBg: '#fdeceb',
  danger: '#b3261e',    // 6.4:1 on white
  infoBg: '#e8f0fa',
  info: '#1a5d96',

  // Camera / connection state.
  online: '#0f7a45',
  offline: '#6b7280',
};

export const typography = {
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontMono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",

  // Type scale.
  h1: { fontSize: '2rem', lineHeight: 1.25, fontWeight: 700 },
  h2: { fontSize: '1.5rem', lineHeight: 1.3, fontWeight: 700 },
  h3: { fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 600 },
  h4: { fontSize: '1.0625rem', lineHeight: 1.4, fontWeight: 600 },
  body: { fontSize: '0.9375rem', lineHeight: 1.55, fontWeight: 400 },
  bodySmall: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 400 },
  caption: { fontSize: '0.8125rem', lineHeight: 1.45, fontWeight: 400 },
};

// 8px base scale.
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
};

export const radius = {
  sm: '4px',
  md: '6px',
  lg: '10px',
  pill: '999px',
};

export const shadows = {
  sm: '0 1px 2px rgba(16, 24, 40, 0.06)',
  md: '0 2px 8px rgba(16, 24, 40, 0.08)',
  lg: '0 8px 24px rgba(16, 24, 40, 0.12)',
};

// Tablet-first: 1024px is the supported minimum, 768px is best-effort.
export const breakpoints = {
  tablet: '1024px',
  smallTablet: '768px',
};

// Chart palette. Ordered for categorical use and chosen to stay distinguishable
// for the most common colour-vision deficiencies (no red/green-only pairing).
export const chartColors = [
  colors.primary500,
  colors.accent500,
  colors.success,
  colors.secondary500,
  colors.danger,
  colors.primary300,
];

export const chartTheme = {
  grid: colors.neutral200,
  axis: colors.neutral500,
  tooltipBg: colors.white,
  tooltipBorder: colors.neutral300,
  text: colors.neutral700,
};

export default { colors, typography, spacing, radius, shadows, breakpoints, chartColors, chartTheme };
