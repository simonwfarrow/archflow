---
status: in-progress
phase: 1
updated: 2026-04-23
---

# Implementation Plan: SVG Zoom Controls

## Goal
Add a pill-shaped zoom widget and mousewheel support that lets users scale the SVG diagram from 0.25× to 8× while all toolbars remain fully visible.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| Apply zoom via `transform: scale(n)` on `<svg>` element | Keeps SVG in-flow; no layout recalculation on host or container needed | `codebase-explore` |
| Set `overflow: visible` on `#svg-host` when zoom > 1 | `#canvas-container` already has `overflow: hidden` and acts as the visual viewport clip | `codebase-explore` |
| Zoom range 0.25–8.0, step factor 1.25 per click/wheel tick | Covers practical diagram scales; 1.25 is the CSS zoom convention for smooth discrete steps | `codebase-explore` |
| Widget pinned bottom-right of canvas, z-index 850 | Sits above canvas (default) but below `.floating-toolbar` (z-index 900) and `#mode-bar` (z-index 1000) | `codebase-explore` |
| Widget visibility driven by `body.svg-loaded` class | Matches `#edit-toolbar` pattern in `markSVGLoaded()`; single source of truth for loaded state | `codebase-explore` |
| `wheel` event on `#canvas-container` calls `preventDefault()` | Prevents page scroll; hit-area is contained to the canvas | `codebase-explore` |
| New file `js/zoom.js` loaded via deferred `<script>` after `svgLoader.js` | Follows the established deferred-script dependency order (`app.js` → `svgLoader.js` → dependents) | `codebase-explore` |
| Expose public API as `window.App.zoom = { zoomIn, zoomOut, reset, getLevel }` | Matches App's flat namespace-extension pattern; other modules can call `App.zoom.reset()` on SVG reload | `codebase-explore` |
| Reset zoom on `App.on('onSVGLoad', …)` | Every new SVG load should start at 1× (fit); hook fires after `notifySVGLoaded()` in `svgLoader.js` | `codebase-explore` |

## Phase 1: HTML + CSS [IN PROGRESS]
- [ ] **1.1 Add `#zoom-widget` markup to `index.html`** ← CURRENT
  - Goal: Insert the pill-shaped zoom cluster into the DOM so JS and CSS can target it.
  - Input: `index.html` — place `<div id="zoom-widget">` after `#playback-bar`, before `</body>`.
  - Output: `#zoom-widget` div containing `#btn-zoom-out` (−), `#zoom-level-display` (100%), `#btn-zoom-in` (+), `#btn-zoom-reset` (⊡); include `hidden` attribute to match the `#edit-toolbar` pattern — `markSVGLoaded()` and `zoom.js` will manage it.
  - Depends on: —
  - Agent: `coder`

- [ ] 1.2 Add CSS rules for `#zoom-widget` to `styles.css`
  - Goal: Position the widget bottom-right of the canvas above the toolbar strip, theme it to the e-ink palette, and wire `body.svg-loaded` visibility.
  - Input: `styles.css` — add after the `.floating-toolbar` block (~line 474).
  - Output: `#zoom-widget` — `position: fixed; bottom: 12px; right: 16px; z-index: 850` — pill `border-radius: 999px`, ink-black border, warm-paper background, flex row with gap; `body:not(.svg-loaded) #zoom-widget { display: none !important; }`; `#zoom-level-display` monospace with `min-width` for stable label layout.
  - Depends on: 1.1
  - Agent: `coder`

## Phase 2: JS — zoom.js Module + Wiring [PENDING]
- [ ] 2.1 Create `js/zoom.js` — core zoom module
  - Goal: Implement all zoom logic — state, transform application, public API, button handlers, wheel listener, and SVGLoad reset hook.
  - Input: DOM IDs `#svg-host`, `#canvas-container`, `#btn-zoom-in`, `#btn-zoom-out`, `#btn-zoom-reset`, `#zoom-level-display`; `window.App.on('onSVGLoad', …)`.
  - Output: IIFE that (a) maintains `let level = 1.0`, (b) `applyZoom()` writes `svg.style.transform = 'scale(n)'` + `transformOrigin`, toggles `#svg-host` `overflow`, updates label text, (c) `zoomIn`/`zoomOut` multiply/divide by 1.25 clamped to [0.25, 8.0] then call `applyZoom`, (d) `reset` sets level to 1.0 and calls `applyZoom`, (e) `wheel` listener on `#canvas-container` calls `e.preventDefault()` and delegates to `zoomIn`/`zoomOut`, (f) button click listeners bound on `DOMContentLoaded`, (g) `App.on('onSVGLoad', reset)`, (h) assigns `window.App.zoom = { zoomIn, zoomOut, reset, getLevel }`.
  - Depends on: 1.1, 1.2
  - Agent: `coder`

- [ ] 2.2 Add `<script src="js/zoom.js" defer>` to `index.html`
  - Goal: Load the zoom module in the correct deferred position.
  - Input: `index.html` script block — insert immediately after `<script src="js/svgLoader.js" defer>`.
  - Output: One new `<script>` tag; no other changes to the file.
  - Depends on: 2.1
  - Agent: `coder`

## Phase 3: Review [PENDING]
- [ ] 3.1 Code review of all changes
  - Goal: Verify correctness, code-philosophy compliance, e-ink theme consistency, and edge-case handling (no SVG loaded, rapid wheel events, zoom at boundary values, multiple SVG loads).
  - Input: All modified/created files — `index.html`, `css/styles.css`, `js/zoom.js`.
  - Output: Review findings report; any blocking issues flagged for resolution before plan is marked complete.
  - Depends on: 2.1, 2.2
  - Agent: `reviewer`

## Dependency Graph
```
1.1 → 1.2
1.1 → 2.1
1.2 → 2.1
2.1 → 2.2
2.1 → 3.1
2.2 → 3.1
```

## Parallelization Summary
- Phase 1: sequential — 1.2 CSS selectors reference IDs introduced by 1.1 HTML
- Phase 2: sequential — script tag in 2.2 references the file created in 2.1
- Phase 3: sequential — review waits for all implementation to complete

## Notes
- 2026-04-23: `markSVGLoaded()` in `app.js` sets `body.svg-loaded` and toggles `hidden` on toolbar elements; `#zoom-widget` must follow the same `hidden` attribute + CSS `body:not(.svg-loaded)` guard pattern. `codebase-explore`
- 2026-04-23: SVG inline styles (`max-width`, `max-height`, `width: auto`, `height: auto`, `display: block`) are written by `svgLoader.js`; `zoom.js` must only write `transform` and `transform-origin` — never touch those responsive-sizing properties. `codebase-explore`
- 2026-04-23: `App.notifySVGLoaded()` fires *after* `markSVGLoaded(true)` in `svgLoader.js`, so `App.on('onSVGLoad', reset)` fires post-inject and is the correct hook for resetting zoom on new diagram load. `codebase-explore`
