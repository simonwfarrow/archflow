---
status: not-started
phase: 1
updated: 2026-04-24
---

# Implementation Plan: Export as PNG (ZIP)

## Goal
Add a "Export PNG (ZIP)" button to ArchFlow that renders every transition state as a PNG and bundles them into a single downloadable ZIP file, with no build step and no ES modules.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| JSZip via CDN blocking `<script>` in `<head>` | No ZIP library exists in the project; CDN globals must be available before deferred scripts execute — same pattern as jsPDF/pptxgenjs | `ref:ses_240850700ffeD9rNi3MwOwFQoZ` |
| New file `js/pngZipExport.js` as IIFE, loaded last (after `gifExport.js`) | All modules are IIFEs on `window.App`; load-order is a hard dependency enforced by `defer` declaration order in `index.html` | `ref:ses_240850700ffeD9rNi3MwOwFQoZ` |
| Reuse SVG→canvas→PNG pipeline from `exportManager.js` | `buildCloneKeyMap()`, `MANAGED_CSS_PROPS`, `applyPropertiesAsAttributes()`, and `canvas.toDataURL('image/png')` already implement the full pipeline correctly | `ref:ses_240850700ffeD9rNi3MwOwFQoZ` |
| Reuse shared export modal (`#export-modal-backdrop`, `#export-modal`, `#export-progress-*`) | Single shared modal is the established UX pattern; avoids duplicated markup | `ref:ses_240850700ffeD9rNi3MwOwFQoZ` |
| Disable all four existing export buttons during export | `gifExport.js` sets this precedent; prevents concurrent export races | `ref:ses_240850700ffeD9rNi3MwOwFQoZ` |

## Phase 1: Dependencies & HTML Scaffolding [PENDING]
- [ ] **1.1 Add JSZip CDN `<script>` to `index.html` `<head>`** ← CURRENT → Agent: `coder`
  - Goal: Make `window.JSZip` available as a blocking global before any deferred scripts run
  - Input: `index.html` — existing CDN block in `<head>` (jsPDF, pptxgenjs, gifenc)
  - Output: New `<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>` line appended to the CDN block in `<head>`, **before** the first `defer` script tag
  - Depends on: —

- [ ] 1.2 Add `#btn-export-png-zip` toolbar button to `index.html` → Agent: `coder`
  - Goal: Surface the new export action in the header toolbar, visually consistent with existing export buttons
  - Input: `index.html` — toolbar section containing `#btn-export-gif` (last export button)
  - Output: New `<button id="btn-export-png-zip">` inserted immediately after `#btn-export-gif`, matching existing button markup/class pattern; visible only when `body.svg-loaded`
  - Depends on: —

- [ ] 1.3 Register `js/pngZipExport.js` in `index.html` script list → Agent: `coder`
  - Goal: Ensure the new module loads last in dependency order
  - Input: `index.html` — final `<script defer src="js/gifExport.js">` tag
  - Output: `<script src="js/pngZipExport.js" defer></script>` added immediately after `gifExport.js` script tag
  - Depends on: 1.1, 1.2

## Phase 2: Core Export Module [PENDING]
- [ ] 2.1 Create `js/pngZipExport.js` — IIFE skeleton & event wiring → Agent: `coder`
  - Goal: Establish module boilerplate: IIFE wrapping, `window.App.pngZipExport` attachment, `DOMContentLoaded` listener, button click handler registration, guard against missing `window.JSZip`
  - Input: `js/gifExport.js` (structural reference for IIFE + button-wiring pattern); `AGENTS.md` module rules
  - Output: `js/pngZipExport.js` with skeleton — no export logic yet, just wiring and `console.warn` guard if JSZip absent
  - Depends on: Phase 1 complete

- [ ] 2.2 Implement SVG-clone → canvas → PNG pipeline inside `pngZipExport.js` → Agent: `coder`
  - Goal: Port the per-transition render logic from `exportManager.js`: clone SVG, call `buildCloneKeyMap()`, clear `MANAGED_CSS_PROPS` inline styles, apply shape overrides as presentation attributes via `applyPropertiesAsAttributes()`, draw to `<canvas>`, call `canvas.toDataURL('image/png')` to get base64 PNG
  - Input: `js/exportManager.js` (canonical pipeline); `AGENTS.md` invariants (`MANAGED_CSS_PROPS`, `SHAPE_TAGS`, `buildCloneKeyMap` mirror)
  - Output: Internal helper `renderTransitionToPng(transition)` → `Promise<string>` (base64 data URL) inside `pngZipExport.js`
  - Depends on: 2.1

- [ ] 2.3 Implement ZIP assembly loop & download trigger → Agent: `coder`
  - Goal: Iterate `App.config.transitions`, call `renderTransitionToPng` for each, add resulting PNG to a `JSZip` instance with filename `<index>-<transition-name>.png`, then call `zip.generateAsync({type:'blob'})` and trigger a `<a download>` click
  - Input: `js/gifExport.js` (download-trigger pattern); `js/pngZipExport.js` (2.2 output); `App.config` schema from `AGENTS.md`
  - Output: Completed `exportPngZip()` async function wired to button click; produces `archflow-export.zip` download
  - Depends on: 2.2

- [ ] 2.4 Implement UI state management (progress modal + button disable/enable) → Agent: `coder`
  - Goal: Mirror `gifExport.js` pattern — disable `#btn-export-config`, `#btn-export-pptx`, `#btn-export-pdf`, `#btn-export-gif`, `#btn-export-png-zip` at export start; show shared `#export-modal-backdrop` / `#export-progress-*` with per-transition progress updates; re-enable all buttons and hide modal on completion or error
  - Input: `js/gifExport.js` (button-disable pattern, modal wiring); `index.html` modal IDs
  - Output: `showProgress(msg)`, `hideProgress()`, `setButtonsDisabled(bool)` helpers inside `pngZipExport.js`; integrated into `exportPngZip()`
  - Depends on: 2.1

## Phase 3: Review & Polish [PENDING]
- [ ] 3.1 Code review against code-philosophy and AGENTS.md invariants → Agent: `reviewer`
  - Goal: Verify `SHAPE_TAGS` array in `pngZipExport.js` (if duplicated) exactly matches the copies in `exportManager.js` and `gifExport.js`; verify `MANAGED_CSS_PROPS` matches; confirm no `import`/`export` syntax; confirm `window.App` attachment pattern is correct; flag any Law violations
  - Input: `js/pngZipExport.js`, `js/exportManager.js`, `js/gifExport.js`, `AGENTS.md`
  - Output: Review findings; coder fixes any flagged issues
  - Depends on: 2.3, 2.4

- [ ] 3.2 Verify edge-case behaviour → Agent: `coder`
  - Goal: Manually trace three scenarios: (a) no SVG loaded — button must be absent/disabled so export never fires; (b) config with a single transition — ZIP contains exactly one PNG; (c) transition with zero shape overrides — PNG renders baseline SVG appearance
  - Input: `js/pngZipExport.js` (final), `index.html` (button visibility logic)
  - Output: Any defensive guards added (e.g., early return if `!App.config || !App.config.transitions?.length`); no regressions in normal flow
  - Depends on: 3.1

## Dependency Graph
```
1.1 ──┐
      ├──► 1.3 ──► 2.1 ──► 2.2 ──► 2.3 ──► 3.1 ──► 3.2
1.2 ──┘              └──► 2.4 ──┘
```

## Parallelization Summary
- Phase 1: Tasks 1.1 and 1.2 are **parallel** (independent sections of `index.html`); 1.3 depends on both and is **sequential** after them
- Phase 2: Tasks 2.2 and 2.4 are **parallel** after 2.1 (PNG pipeline and UI helpers are independent); 2.3 is **sequential** after 2.2 (needs PNG output); 2.3 and 2.4 converge when wiring `exportPngZip()`
- Phase 3: Tasks 3.1 and 3.2 are **sequential** — review must complete before edge-case fixes are applied

## Notes
- 2026-04-24: Architecture sourced from codebase exploration; JSZip 3.10.1 chosen as stable, widely-used, CDN-available ZIP library with no build dependency `ref:ses_240850700ffeD9rNi3MwOwFQoZ`
- 2026-04-24: `SHAPE_TAGS` and `buildCloneKeyMap()` are duplicated across `exportManager.js` and `gifExport.js` per AGENTS.md invariants #1 and #2 — `pngZipExport.js` must carry its own copy if it walks the SVG tree directly, or delegate to `exportManager.js` helpers if exposed on `window.App`
