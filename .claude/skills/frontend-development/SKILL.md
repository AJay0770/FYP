---
name: frontend-development
description: Build and modify UI in the React 18 + Vite frontend — component structure, state, API/socket integration, accessibility, and the project's existing design system. Use when adding or changing anything under client/.
---

# Frontend Development

Act as a senior frontend engineer building on BuildSite 360's existing React app.

## When to Use

Adding or changing a page, component, or client-side behavior under `client/`.

## This Project's Stack

React 18 (functional components + hooks only — no class components exist), Vite build, Axios (`client/src/api/axios.js`) with interceptors, `socket.io-client` (`client/src/api/socket.js`), Recharts for charts, React Context (`AuthContext`) for auth state. **No router library** — views switch via local state in `App.jsx`. **No CSS framework** — hand-written design tokens (`styles/tokens.css`, `styles/designSystem.js`). No Redux/Zustand/global store.

## Component Architecture

- Reusable primitives live in `client/src/components/ui/index.jsx`: `Button`, `Input`, `Select`, `Card`, `Badge`, `Table`, `Modal`, `Toast`/`ToastRegion`/`useToasts`, and layout helpers `Stack`/`Row`/`Grid`. Use these instead of raw `<button>`/`<input>`/hand-rolled layout — `ComponentGallery.jsx` is the living reference for what's already available.
- Feature-specific "panels" live in `client/src/components/` (`ChatPanel`, `MaterialsPanel`, `SafetyAlertsPanel`, `SiteUpdatesPanel`) and get composed into top-level views in `client/src/pages/` (one file per page).
- **Before adding a new page or component, check both directories for something close enough to extend.** This codebase already has two overlapping pages for the same feature (`LiveMonitoring.jsx` and `LiveMonitoringPage.jsx`) from that not happening — don't add a third variant of anything; extend or ask which one is current.

## State Management

Local component state (`useState`/`useEffect`) plus `AuthContext` for the logged-in user is the entire state model. Don't introduce a global store or extra Context providers for state a parent component can hold and pass down as props.

## API & Realtime Integration

- Always use the shared `api` Axios instance (`client/src/api/axios.js`), never a fresh `axios()` call — the shared instance is what carries auth headers and refresh behavior.
- Use `connectSocket()` from `client/src/api/socket.js` for realtime; disconnect/clean up listeners on unmount (mirror how existing panels/pages handle socket lifecycle).
- Never hardcode an API URL — the shared instance reads `VITE_API_BASE_URL`.

## Responsive Design

Tablet is the documented minimum supported width; some pages are explicitly desktop-only due to complex layouts (a known, accepted limitation — see `PROJECT_OVERVIEW.md`). Don't assume phone-width support unless asked, but don't regress tablet width either.

## Accessibility

This codebase already uses `aria-*`/`role` attributes and a skip-link (`App.jsx`'s `.ds-skip-link`) — preserve and extend that rather than dropping it in new code. Use `ui/Input` and `ui/Select` (which already handle label/id/error wiring) instead of raw `<input>`/`<select>` so labeling stays correct by default.

## Loading / Error / Empty States

Follow the existing patterns rather than inventing new ones:
- Connection/status states: the `checking` / `connected` / `disconnected` pattern in `App.jsx`.
- Empty lists: `Table`'s `empty` prop.
- Transient success/error messages: `Toast`/`ToastRegion` via the `useToasts` hook.

## Performance

- Memoize expensive derived values or callbacks passed to frequently-rendered children (`useMemo`/`useCallback` — see `LiveMonitoring.jsx` for the existing pattern).
- Prefer the Socket.io event that already delivers an update over polling the same data — several pages already receive live pushes (chat, safety alerts, attendance); don't add a poll loop next to an existing socket subscription for the same data.
- Don't add a new heavy dependency for something the existing stack (Recharts, the `ui/` kit) already covers.

## UI Consistency

Use `styles/tokens.css` variables and `designSystem.js` rather than hardcoded colors/spacing/font sizes. Match the visual language already established in `ComponentGallery.jsx` and the `ui/` primitives.

## Avoid Unnecessary Complexity

No router, no global state library, no CSS-in-JS. Don't introduce any of these for a single feature — extend the existing manual view-switch (`App.jsx`) and Context pattern instead. If a feature genuinely outgrows this (e.g. needs deep-linkable URLs), raise that as a decision for the user rather than silently adding a router.

## Workflow

1. Find the closest existing page/panel/component and follow its structure.
2. Compose it from `ui/` primitives rather than raw markup.
3. Wire it to the shared `api` instance and/or socket connection.
4. Handle loading, error, and empty states using the existing patterns above.
5. Check accessibility: labeled inputs, `aria-*` where interactive state isn't otherwise conveyed.
6. Verify layout at tablet width, not just full desktop.
7. Manually test in the browser — there is no automated frontend test suite.

## Verification

Run `npm run dev` in `client/` and exercise the actual flow in the browser. If the change affects role-gated UI, check it under at least two different roles (e.g. ADMIN vs. CLIENT). There is no automated frontend test suite in this repo — say so explicitly rather than claiming coverage that doesn't exist.
