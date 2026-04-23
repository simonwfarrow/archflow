---
status: not-started
phase: 1
updated: 2026-04-23
---

# Implementation Plan: Click-and-Drag Pan

## Goal
Add click-and-drag panning to `#canvas-container` so users can navigate a zoomed-in SVG diagram, with clamped offsets, cursor feedback, and automatic reset on SVG load or zoom reset.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| `zoom.js` remains the sole writer of the SVG `transform` property | Prevents conflicting writes; the composed `translate(panX, panY) scale(n)` must be applied atomically in one assignment | `codebase-analysis` |
| Replace `applyZoom()` with `applyTransform()` | A single function composing pan + zoom is the only way to guarantee the two transforms are always in sync and never partially overwritten | `codebase-analysis` |
| Class-based cursor toggle (`.is-pannable` / `.is-panning`) on `#canvas-container` | Simpler and more maintainable than a `data-*` attribute; keeps cursor logic in CSS where it belongs; consistent with the existing class-toggle patterns (`body.svg-loaded`, `.panel-drag-handle:active`) in the codebase | `codebase-analysis` |
| Mouse event listeners on `#canvas-container`, not on the SVG element | `#canvas-container` (`overflow: hidden`) is the visual viewport; attaching there captures the full canvas hit-area, not just the scaled SVG footprint, which shrinks/grows with zoom | `codebase-analysis` |
| Clamp pan using container `getBoundingClientRect` vs scaled SVG natural size × level | Keeps at least half the SVG always within the viewport; scaled extents = `svgEl.getBBox()` (or `clientWidth/clientHeight`) × `level`; half-overlap rule gives the tightest correct bounds | `codebase-analysis` |
| `resetPan()` called from both `App.on('onSVGLoad', …)` and `reset()` (zoom reset) | Both events return the canvas to 1× fit; stale pan offsets on a newly loaded or reset diagram would be disorienting | `codebase-analysis` |
| Pan state stored in the same IIFE closure as `level` | Keeps all mutable canvas-transform state co-located in the single writer; no global variables or cross-module state leaks | `codebase-analysis` |

## Phase 1: JS — Pan Logic in zoom.js [PENDING]
- [ ] **1.1 Add pan state variables** ← CURRENT
  - Goal: Declare the five mutable variables that track pan offset and drag gesture inside the zoom.js IIFE, immediately below `let level = 1.0`.
  - Input: `js/zoom.js` — "Mutable state" section (line 22–24).
  - Output: Five new `let` declarations — `panX`, `panY` (both `0`), `isDragging` (`false`), `dragStartX`, `dragStartY` (both `0`); each with a JSDoc comment matching the existing `level` comment style.
  - Depends on: —
  - Agent: `coder`

- [ ] 1.2 Replace `applyZoom()` with `applyTransform()`
  - Goal: Change the single SVG transform writer to compose `translate(panX px, panY px) scale(n)` and toggle the `.is-pannable` cursor class on `#canvas-container` based on `level > 1`.
  - Input: `js/zoom.js` — `applyZoom()` function (lines 36–54) and its three call sites in `zoomIn()`, `zoomOut()`, and `reset()`.
  - Output: `applyZoom` renamed to `applyTransform`; `svgEl.style.transform` now writes `'translate(' + panX + 'px, ' + panY + 'px) scale(' + level + ')'`; after updating the SVG, toggle `canvasContainer.classList.toggle('is-pannable', level > 1)` (resolve `canvasContainer` by ID at the top of the function, guard null); all three call sites updated to `applyTransform()`.
  - Depends on: 1.1
  - Agent: `coder`

- [ ] 1.3 Add `resetPan()`
  - Goal: Provide a dedicated function that zeroes pan offsets and re-applies the transform, so callers never manually mutate `panX`/`panY`.
  - Input: `js/zoom.js` — "Public controls" section (after `getLevel`, before the DOM-wiring block).
  - Output: `function resetPan() { panX = 0; panY = 0; applyTransform(); }` with a JSDoc comment; function is not yet exposed on `window.App.zoom` (internal use only).
  - Depends on: 1.2
  - Agent: `coder`

- [ ] 1.4 Add `clampPan()`
  - Goal: Constrain `panX` and `panY` so the SVG can never be dragged entirely out of the visible viewport.
  - Input: `js/zoom.js` — same "Public controls" section, immediately before `resetPan`.
  - Output: `function clampPan()` that (a) gets `canvasContainer.getBoundingClientRect()` for container `width`/`height`, (b) gets the SVG element's `clientWidth` and `clientHeight` for its natural (unscaled) dimensions, (c) computes `scaledW = svgClientWidth * level`, `scaledH = svgClientHeight * level`, (d) computes `maxX = Math.max(0, (scaledW - containerW) / 2)`, `maxY = Math.max(0, (scaledH - containerH) / 2)`, (e) clamps `panX = Math.max(-maxX, Math.min(maxX, panX))` and `panY` equivalently; called from inside `applyTransform()` before the transform string is built (no-ops if no SVG element is present).
  - Depends on: 1.3
  - Agent: `coder`

- [ ] 1.5 Add mousedown / mousemove / mouseup / mouseleave event listeners
  - Goal: Wire drag-to-pan gesture on `#canvas-container` inside the existing `DOMContentLoaded` handler.
  - Input: `js/zoom.js` — `DOMContentLoaded` handler (lines 96–147); attach after the `wheel` listener.
  - Output: Three listeners — `mousedown`: if `level > 1`, set `isDragging = true`, record `dragStartX = e.clientX - panX`, `dragStartY = e.clientY - panY`, add `is-panning` class; `mousemove`: if `isDragging`, set `panX = e.clientX - dragStartX`, `panY = e.clientY - dragStartY`, call `applyTransform()` (clamp runs inside); `mouseup` and `mouseleave`: set `isDragging = false`, remove `is-panning` class. All four handlers use named inline functions (not anonymous arrows) for readability.
  - Depends on: 1.4
  - Agent: `coder`

- [ ] 1.6 Wire `resetPan()` into SVGLoad hook and zoom `reset()`
  - Goal: Ensure pan offsets are always cleared when a new diagram loads or the user resets zoom to 1×.
  - Input: `js/zoom.js` — `reset()` function (line 79–82) and `App.on('onSVGLoad', …)` handler (line 126–130).
  - Output: `reset()` calls `resetPan()` before or after resetting `level` (either order is correct since `applyTransform` is called at the end of `resetPan`; prefer `panX = panY = 0` inline then single `applyTransform()` call to avoid a double-apply); `App.on('onSVGLoad', …)` callback also calls `resetPan()` (or relies on the `reset()` call already there — confirm `reset()` is already invoked in that hook and add `resetPan()` only if `reset()` does not already delegate to it).
  - Depends on: 1.5
  - Agent: `coder`

## Phase 2: CSS — Cursor and Grab Styles [PENDING]
- [ ] 2.1 Add pan cursor rules to `styles.css`
  - Goal: Declare `cursor: grab` and `cursor: grabbing` states for `#canvas-container` driven purely by CSS classes toggled by `zoom.js`.
  - Input: `css/styles.css` — Section 22 "ZOOM WIDGET" block ends at line ~1361; insert a new sub-section immediately after it and before Section 23 "EXPORT MODAL".
  - Output: New section "22b. PAN CURSOR" (or append to section 22) containing: `#canvas-container.is-pannable { cursor: grab; user-select: none; }` and `#canvas-container.is-panning { cursor: grabbing; user-select: none; }`; `user-select: none` on both prevents accidental text selection during drag.
  - Depends on: —
  - Agent: `coder`

## Phase 3: Review [PENDING]
- [ ] 3.1 Code review of all changes
  - Goal: Verify pan logic correctness, code-philosophy compliance, edge-case coverage, and CSS consistency with the e-ink theme.
  - Input: `js/zoom.js` (all changes from Phase 1) and `css/styles.css` (Phase 2); edge cases to verify: (a) pan while at exactly `level = 1.0` is a no-op, (b) rapid drag + scroll combination doesn't desync `isDragging`, (c) zoom-out past 1.0 resets pan and removes `.is-pannable`, (d) SVG reload clears pan offset and drag state, (e) `clampPan` correctly handles SVGs smaller than the container (maxX/maxY = 0 means no pan permitted), (f) `mouseleave` fires when pointer leaves `#canvas-container` mid-drag and correctly ends the gesture.
  - Output: Review findings; any blocking issues must be resolved before the plan is marked `complete`.
  - Depends on: 1.6, 2.1
  - Agent: `reviewer`

## Dependency Graph
```
1.2 → 1.1
1.3 → 1.2
1.4 → 1.3
1.5 → 1.4
1.6 → 1.5
3.1 → 1.6
3.1 → 2.1
```

## Parallelization Summary
- Phase 1: sequential — each task builds on the previous function/call-site change in `zoom.js`; the chain is linear
- Phase 2: parallel with Phase 1 — `styles.css` and `zoom.js` are independent files; CSS class names are agreed upfront (`.is-pannable`, `.is-panning`) so both phases can be authored concurrently
- Phase 3: sequential — review must wait for both Phase 1 and Phase 2 to be complete

## Notes
- 2026-04-23: `applyZoom()` in the existing `zoom.js` writes only `scale(n)`; the upgrade to `applyTransform()` must preserve all existing side-effects (overflow toggle on `#svg-host`, zoom-level label update) while adding pan composition and the `.is-pannable` class toggle. `codebase-analysis`
- 2026-04-23: `dragStartX` is stored as `e.clientX - panX` (not raw `e.clientX`) so that on each `mousemove`, `panX = e.clientX - dragStartX` naturally gives the accumulated offset without needing to track a delta. This is the standard "anchor point" drag idiom. `codebase-analysis`
- 2026-04-23: `clampPan()` must be called *inside* `applyTransform()` (before building the transform string) so that any direct `panX`/`panY` mutation (e.g., from `resetPan`) is also clamped. The only call site is `applyTransform()` itself. `codebase-analysis`
- 2026-04-23: `zoom.js` already has `reset()` called inside `App.on('onSVGLoad', …)` (line 127); task 1.6 only needs to ensure `resetPan()` is also called there — either by having `reset()` call `resetPan()` internally, or by calling `resetPan()` directly in the hook. The former is cleaner since zoom reset and pan reset are always coupled. `codebase-analysis`
