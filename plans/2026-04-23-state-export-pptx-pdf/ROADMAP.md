---
status: in-progress
phase: 1
updated: 2026-04-23
---

# Implementation Plan: PowerPoint + PDF State Export

## Goal
Add per-transition-state PNG rendering with PPTX and PDF bundling, surfaced via header export buttons with a progress modal, all in plain vanilla JS IIFEs compatible with `file://` loading.

## Context & Decisions

| Decision | Rationale | Source |
|----------|-----------|--------|
| Single new file `js/exportManager.js` (IIFE, attaches to `App.export`) | Matches existing module pattern (one IIFE per file, attaches to `window.App.*`); no build tooling needed | `ref:explore-001` |
| SVG clone + canvas approach for PNG rendering | `file://` origin blocks `foreignObject` and cross-origin fonts; serialising a clean clone then drawing via `<img>` on `<canvas>` is the only reliable path | `ref:explore-001` |
| Re-walk clone with same SHAPE_TAGS_SELECTOR + skip-defs logic as `svgParser.js` | Shape keys are position-stable: element `id` else `tagName-N` counter per `walkSVGTree`; must replicate exactly or keys won't match App.shapes baselines | `ref:explore-001` |
| Apply baselines first, then state overrides to clone (mirrors `playback.applyStateToSVG`) | Keeps PNG output semantically identical to what the viewer shows; no extra state diffing needed | `ref:explore-001` |
| Strip `el.style.transition` on all clone elements before serialisation | CSS transition declarations cause animated frames on canvas draw; must be removed for clean snapshots | `ref:explore-001` |
| Canvas size from SVG `viewBox` (falling back to `width`/`height` attrs, then 800×600) | viewBox is the canonical intrinsic size; width/height may be `100%` in responsive SVGs | `ref:explore-001` |
| PptxGenJS `3.12.0` CDN UMD bundle → global `PptxGenJS` | Matches supplied CDN URL; UMD exposes named global, no ES-module import needed | `ref:explore-001` |
| jsPDF `2.5.1` CDN UMD bundle → `window.jspdf.jsPDF` | Matches supplied CDN URL; namespace path confirmed from jsPDF UMD bundle convention | `ref:explore-001` |
| CDN `<script>` tags added **before** `js/app.js` in `<head>` (no `defer`) | Library globals must be available synchronously when `exportManager.js` runs; placing before deferred app scripts is the simplest safe ordering | `ref:explore-001` |
| `exportManager.js` loaded **last** in the deferred script list (after `playback.js`) | Depends on `App.playback.applyStateToSVG` and `App.shapes`, both set up by earlier deferred scripts | `ref:explore-001` |
| Progress modal uses existing `.modal-backdrop` / `.modal-panel` / `.glass-panel` CSS pattern | Reuses ArchFlow's established glass-panel modal system; no new layout primitives; CSS additions are minimal overlay state variants | `ref:explore-001` |
| Export buttons use existing `.action-btn` class with a second `.header-action-divider` separator | Matches Load Config / Export Config button styling exactly; header flex layout absorbs extra children without wrapping | `ref:explore-001` |
| Async PNG generation uses `requestAnimationFrame` + micro-batching (one state per tick) | Prevents main-thread jank while iterating potentially many states; allows modal progress bar updates | `ref:explore-001` |
| Guard clause: abort export if `App.config.image` is null or `transitions` is empty | Fail-loud: shows a console error and disables buttons; no partial exports | `ref:explore-001` |

## Phase 1: Core Engine [IN PROGRESS]

- [ ] **1.1 Create `js/exportManager.js` — SVG clone + PNG renderer** ← CURRENT
  - Goal: Implement `renderStateToPNG(stateId) → Promise<string>` — the fundamental per-state image primitive used by both PPTX and PDF exporters
  - Input: Live `<svg>` from `#svg-host`, `App.shapes` (Map of baselines), `App.config.transitions` (state overrides), `SHAPE_TAGS_SELECTOR` constants from svgParser conventions
  - Output: `/workspace/js/exportManager.js` containing IIFE with `renderStateToPNG`, `exportPPTX`, `exportPDF`, `showExportProgress`, `hideExportProgress` — attached as `App.export`
  - Steps:
    1. Guard: throw if `!window.App`, `!App.config.image`, or `App.config.transitions.length === 0`
    2. `cloneNode(true)` the live `<svg>` from `#svg-host > svg`
    3. Re-walk clone with `SHAPE_TAGS = ['rect','circle','ellipse','path','polygon','polyline','line','text','g']`, skip `closest('defs,clipPath,mask,marker,pattern,symbol')`, key by `id || tagName-N` counter
    4. Apply baseline from `App.shapes.get(key).baseline` to each clone element via `el.setAttribute` (not `el.style`, so serialisation captures them)
    5. Apply state overrides from `transition.shapes` on top via `el.setAttribute`
    6. Strip `style.transition` (set `el.style.transition = 'none'` then `el.removeAttribute('style')` if style is now only `transition`) — safe: use `el.style.cssText = el.style.cssText.replace(/transition[^;]*;?/g, '')`
    7. Resolve canvas dimensions: parse `viewBox` → `[x,y,w,h]`; fall back to `width`/`height` attrs; default `800×600`
    8. `new XMLSerializer().serializeToString(clone)` → Blob URL → `new Image()` → draw on `OffscreenCanvas` or regular `<canvas>` → `canvas.toDataURL('image/png')`
    9. Return PNG data URL, revoke Blob URL in `finally`
  - Depends on: nothing (pure utility)

- [ ] 1.2 Implement `exportPPTX()` in `exportManager.js`
  - Goal: Iterate all transitions, render each to PNG, assemble a `.pptx` file using PptxGenJS and trigger download
  - Input: `App.config.transitions` array, `renderStateToPNG` from 1.1, `window.PptxGenJS` global
  - Output: `.pptx` download, progress modal updated per slide
  - Steps:
    1. Guard: `if (!window.PptxGenJS) { console.error(...); return; }`
    2. `new PptxGenJS()` → set layout to `LAYOUT_WIDE` (16:9) or custom from canvas aspect ratio
    3. For each transition (in order): `await renderStateToPNG(id)` → `pptx.addSlide()` → `slide.addImage({ data: pngDataUrl, x:0, y:0, w:'100%', h:'100%' })` → update progress modal
    4. `await pptx.writeFile({ fileName: 'archflow-states.pptx' })`
  - Depends on: 1.1

- [ ] 1.3 Implement `exportPDF()` in `exportManager.js`
  - Goal: Iterate all transitions, render each to PNG, assemble a `.pdf` file using jsPDF and trigger download
  - Input: `App.config.transitions` array, `renderStateToPNG` from 1.1, `window.jspdf.jsPDF` global
  - Output: `.pdf` download, progress modal updated per page
  - Steps:
    1. Guard: `if (!window.jspdf || !window.jspdf.jsPDF) { console.error(...); return; }`
    2. Parse canvas dimensions from first PNG to set page size; default landscape A4 fallback
    3. For each transition (in order): `await renderStateToPNG(id)` → on first page `doc.addImage(...)`, subsequent pages `doc.addPage()` then `doc.addImage(...)` → update progress modal
    4. `doc.save('archflow-states.pdf')`
  - Depends on: 1.1

- [ ] 1.4 Implement progress modal controller in `exportManager.js`
  - Goal: `showExportProgress(label)`, `updateExportProgress(current, total)`, `hideExportProgress()` — async-safe, non-blocking
  - Input: Export progress modal DOM nodes (added in Phase 2 task 2.1)
  - Output: Modal shows/updates/hides correctly; uses `requestAnimationFrame` for non-blocking DOM updates
  - Steps:
    1. `showExportProgress(label)`: set `#export-modal-label` text, set progress to 0/N, remove `hidden`, add `--visible` class via `requestAnimationFrame`
    2. `updateExportProgress(current, total)`: update `#export-progress-fill` width, update `#export-progress-counter` text (`"2 / 5"`)
    3. `hideExportProgress()`: remove `--visible` class, wait 220ms (CSS exit), then set `hidden`
    4. Wrap all three calls so they yield to the microtask queue (`await new Promise(r => setTimeout(r, 0))`) between state renders
  - Depends on: 2.1 (DOM nodes) — implement stubs first, wire to real DOM in 2.1

## Phase 2: UI Integration [PENDING]

- [ ] 2.1 Add export progress modal HTML to `index.html`
  - Goal: Insert `#export-modal-backdrop` + `#export-modal` (`.modal-panel.glass-panel`) matching the existing reset modal pattern
  - Input: Existing `#reset-modal-backdrop` as structural reference (`ref:explore-001`)
  - Output: Modified `index.html` with progress modal markup inserted before closing `</body>`; export buttons in `#header-actions`; CDN `<script>` tags in `<head>`
  - Steps:
    1. Add jsPDF `<script>` tag (no `defer`, no `async`) in `<head>` after Google Fonts links
    2. Add PptxGenJS `<script>` tag (no `defer`, no `async`) in `<head>` after jsPDF
    3. In `#header-actions`, after the existing `<div class="header-action-divider">`, add:
       - `<button id="btn-export-pptx" class="action-btn" aria-label="Export as PowerPoint">Export PPTX</button>`
       - `<button id="btn-export-pdf" class="action-btn" aria-label="Export as PDF">Export PDF</button>`
    4. Add `#export-modal-backdrop` + `#export-modal` HTML before the JS scripts block, modelled on `#reset-modal-backdrop`; inner elements: `#export-modal-icon`, `#export-modal-label`, `#export-progress-track` → `#export-progress-fill`, `#export-progress-counter`
    5. Add `<script src="js/exportManager.js" defer></script>` as the **last** deferred script (after `playback.js`)
  - Depends on: 1.4

- [ ] 2.2 Add export button + progress modal CSS to `styles.css`
  - Goal: Style the two new export buttons and the progress modal; match ArchFlow E-Ink theme exactly
  - Input: Existing `.action-btn`, `.modal-backdrop`, `.modal-panel`, `.modal-btn`, CSS variable system (`ref:explore-001`)
  - Output: Modified `css/styles.css` with new section `23. EXPORT MODAL` appended
  - Steps:
    1. Export buttons: no new class needed — `action-btn` base covers it; add `.action-btn--export` modifier that adds a subtle `⬇` icon tint using `--accent-secondary`
    2. Progress modal: reuse `.modal-backdrop` + `.modal-backdrop--visible` animation exactly
    3. `#export-modal`: same as `.modal-panel` but replaces `.modal-actions` with progress track; add `#export-progress-track` (full-width, `height: 6px`, `border-radius: 3px`, `background: var(--border-subtle)`) + `#export-progress-fill` (transitions `width` with `var(--transition-state)`)
    4. `#export-progress-counter`: `font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary)`
    5. Disabled state for export buttons while export is running: `button[disabled] { opacity: 0.45; cursor: not-allowed; }`
  - Depends on: 2.1

- [ ] 2.3 Wire button event listeners in `exportManager.js` DOMContentLoaded init
  - Goal: Connect `#btn-export-pptx` and `#btn-export-pdf` to `exportPPTX()` / `exportPDF()`; guard against missing SVG / empty transitions
  - Input: Button IDs from 2.1, `App.config`, `App.export` functions from Phase 1
  - Output: Buttons trigger export + progress flow; buttons disabled during export; `App.export` public API attached to `window.App.export`
  - Steps:
    1. `DOMContentLoaded`: find both buttons; if not found, `console.warn` and return
    2. Each click handler: disable both buttons, call `showExportProgress(label)`, `await exportXxx()`, re-enable buttons, call `hideExportProgress()`
    3. Wrap in `try/catch`: on error, `hideExportProgress()`, re-enable buttons, `console.error`
    4. Attach `App.export = { exportPPTX, exportPDF, renderStateToPNG }` for testability
  - Depends on: 1.2, 1.3, 1.4, 2.1

## Phase 3: Review [PENDING]

- [ ] 3.1 Code review of `exportManager.js` against 5 Laws of Elegant Defense
  - Goal: Verify guard clauses, parsed state, atomic predictability, fail-loud, intentional naming across all export functions
  - Input: Completed `js/exportManager.js` from Phases 1–2
  - Output: Review findings; any violations fixed before merging
  - Agent: `reviewer`
  - Depends on: 2.3

- [ ] 3.2 UI review of export buttons + progress modal against 5 Pillars of Intentional UI
  - Goal: Confirm export buttons and progress modal match ArchFlow E-Ink aesthetic; no "AI slop" — intentional hierarchy, spacing, typography
  - Input: Modified `index.html`, `styles.css` from Phase 2
  - Output: Review findings; any visual inconsistencies fixed
  - Agent: `reviewer`
  - Depends on: 2.2

## Dependency Graph

```
1.1 (renderStateToPNG)
 ├──▶ 1.2 (exportPPTX)
 └──▶ 1.3 (exportPDF)

1.4 (progress modal controller stubs)
 └──▶ 2.1 (HTML modal DOM + CDN scripts + buttons)
       └──▶ 2.2 (CSS for modal + buttons)
             └──▶ 2.3 (wire event listeners, finalise App.export)

1.2, 1.3, 1.4 ──▶ 2.3

2.3 ──▶ 3.1 (code review)
2.2 ──▶ 3.2 (UI review)
```

## Parallelization Summary

- **Phase 1**: 1.1 must complete first (PNG primitive). Then 1.2, 1.3, and 1.4 can all run **in parallel** — they have no mutual dependencies.
- **Phase 2**: 2.1 must complete first (DOM structure). Then 2.2 (CSS) and the wiring stub in 2.3 can run **in parallel**; full 2.3 completion requires 1.2 + 1.3 + 1.4 from Phase 1.
- **Phase 3**: 3.1 and 3.2 can run **in parallel** after 2.3 and 2.2 respectively.

## Notes

- 2026-04-23: No build system — all JS must be plain IIFE, no `import`/`export`, no template literals that break old parsers. Use `var` or `const`/`let` consistently with existing files (`const`/`let` is fine — existing codebase uses them). `ref:explore-001`
- 2026-04-23: `App.shapes` stores `.el` refs to live DOM nodes. The clone must be walked independently — do NOT reuse `.el` from `App.shapes` on the clone. Match by position/key only. `ref:explore-001`
- 2026-04-23: The `applyPropertiesToElement` in `playback.js` uses `el.style.*` (inline style). For the clone we should prefer `el.setAttribute('fill', ...)` directly so the serialised SVG carries the values as presentation attributes (not inline style which may be overridden or stripped by canvas renderers). `ref:explore-001`
- 2026-04-23: Header will have 5 action buttons after this change (New, divider, Load Config, Export Config, divider, Export PPTX, Export PDF). Verify the header flex row doesn't overflow on 1280px viewports — use `flex-wrap: nowrap` and small padding if needed. `ref:explore-001`
- 2026-04-23: PptxGenJS `writeFile` is async and returns a Promise; jsPDF `save` is synchronous. Both exports must be wrapped in `async` functions with `await` where applicable. `ref:explore-001`
- 2026-04-23: `OffscreenCanvas` is not available in all `file://`-loaded browsers (Firefox partial support). Use a detached `document.createElement('canvas')` instead — it works in all targets. `ref:explore-001`
