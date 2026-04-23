---
status: not-started
phase: 1
updated: 2026-04-23
---

# Implementation Plan: Animated GIF Export

## Goal
Add an "Export as GIF" feature to ArchFlow that captures smooth CSS-transition animation across all states and encodes it as a looping animated GIF, integrated into the existing export infrastructure.

## Context & Decisions

| Decision | Rationale | Source |
|----------|-----------|--------|
| Use **gifenc** as the GIF encoder | Zero-dependency, ~5 KB min+gzip, runs on the main thread, no Worker script required — fully compatible with `file://` origins used throughout ArchFlow | `ref:exploration-codebase` |
| Vendor gifenc to `js/lib/gifenc.js` | All existing export libs (jsPDF, PptxGenJS) are loaded as `<script>` globals; vendoring keeps the same pattern, enables offline use, and avoids CDN dependency | `ref:exploration-codebase` |
| Load gifenc via synchronous `<script>` before deferred modules | jsPDF and PptxGenJS already load this way; deferred scripts (app.js, exportManager.js) assume globals are present by the time they run | `ref:exploration-codebase` |
| **Smooth transition** frame capture (live DOM computed-style sampling) | User requirement: GIF must animate through CSS transitions, not just show one frame per state. CSS transitions run in the browser rendering engine; only `getComputedStyle()` reflects mid-transition values, not `el.style.*` | `ref:exploration-codebase` |
| Reset zoom to 1.0 before capture | `zoom.js` applies a CSS `transform: scale(N)` to the live `<svg>` element. This does not affect SVG viewBox geometry but would distort canvas snapshots if not neutralised before cloning | `ref:exploration-codebase` |
| Reuse `renderStateToPNG` sanitization helpers | `inlineExternalImages`, `stripExternalStyleRules`, `removeExternalUseRefs`, `removeExternalFeImageRefs`, `sanitiseInlineStyleURLs`, `postSerialiseStringSanitise` already cover all known canvas-tainting sources; frame capture must apply the same pipeline | `ref:exploration-codebase` |
| Reuse existing `export-modal-backdrop` progress modal | The progress modal (`showExportProgress`, `updateExportProgress`, `hideExportProgress`) is already wired and styled; GIF export should display per-frame progress through it | `ref:exploration-codebase` |
| Reuse `allExportButtons` disable/enable pattern | `exportManager.js` disables all export buttons during a running export to prevent concurrent jobs; the new `#btn-export-gif` must join that array | `ref:exploration-codebase` |
| Settings modal exposes: fps, loop count, output scale | User requirement. Consistent with the existing `modal-backdrop` + `modal-panel glass-panel` HTML pattern used by `#reset-modal` and `#export-modal` | `ref:exploration-codebase` |
| Annotations included via `annotationLayer.renderInto` | `renderStateToPNG` already calls `App.annotationLayer.renderInto(clone, transition.annotations)` before canvas render; the frame capture pipeline must replicate this for the intermediate computed-state clone | `ref:exploration-codebase` |
| Frame count per transition: `ceil(transitionDuration / frameInterval)` | `App.config.transitionDuration` (default 600 ms) drives CSS animation length; `frameInterval = 1000 / fps`. At 12 fps + 600 ms default = 8 frames per transition | `ref:exploration-codebase` |
| Hold frames at each state end = `holdMs / frameInterval` frames | Between transition animations the current state is held; hold duration is a user setting (default: 500 ms, matching the auto-play `transitionDuration + 500 ms` interval in `playback.js`) | `ref:exploration-codebase` |
| Pause active playback before capture; restore afterwards | `App.playback.pause()` is exposed on `App.playback`; export must call it to prevent `setInterval`-driven state changes mid-capture | `ref:exploration-codebase` |

---

## Phase 1: Library Research & Vendoring [PENDING]

- [ ] **1.1 Explore gifenc public API and encoding workflow** ← CURRENT
  → Agent: `explore`
  - Goal: Document the gifenc IIFE/UMD global name, `GIFEncoder` constructor options, `writeFrame(data, width, height, opts)` signature, `finish()` output format, and palette quantization (`quantize`) helper.
  - Input: gifenc source on GitHub (`nicktindall/cyclon.js` → wrong; actual repo is `nick-thompson/gifenc`; check unpkg.com/gifenc) or npm package README.
  - Output: Concise API notes (global name, key methods, delay units, loop option, color quantization call pattern) for use by coder tasks in phases 3–4.

- [ ] 1.2 Download and vendor the gifenc UMD/IIFE build
  → Agent: `coder`
  - Goal: Obtain the production IIFE build of gifenc and save it as `js/lib/gifenc.js`.
  - Input: `https://unpkg.com/gifenc/dist/gifenc.umd.js` (or equivalent build artifact).
  - Output: `/workspace/js/lib/gifenc.js` present and self-contained.
  - Note: Tasks 1.1 and 1.2 may run in parallel.

- [ ] 1.3 Add gifenc `<script>` tag to `index.html`
  → Agent: `coder`
  - Goal: Make gifenc available as a synchronous global before the deferred `<script>` modules execute, matching the pattern used for jsPDF and PptxGenJS.
  - Input: `index.html` (line 14–16 — existing export library `<script>` block); output of 1.2.
  - Output: `<script src="js/lib/gifenc.js"></script>` added to the synchronous export-libraries block in `<head>`.
  - Depends on: 1.2

---

## Phase 2: Settings Modal & GIF Button UI [PENDING]

- [ ] 2.1 Add `#btn-export-gif` button to `#header-actions` in `index.html`
  → Agent: `coder`
  - Goal: Insert a "GIF" export button immediately after the existing `#btn-export-pdf` button, using the same `action-btn` styling.
  - Input: `index.html` lines 49–55 (PPTX/PDF button block).
  - Output: `<button id="btn-export-gif" …>⬇ GIF</button>` in `#header-actions`.
  - Depends on: 1.3

- [ ] 2.2 Add GIF settings modal HTML to `index.html`
  → Agent: `coder`
  - Goal: Implement a settings modal (`#gif-settings-modal-backdrop` / `#gif-settings-modal`) that lets the user configure: **FPS** (select: 5, 10, 12, 15, 24 — default 12), **Hold duration** (number input, ms, default 500), **Loop count** (select: Infinite/0, Once/1, 3×/3 — default 0), and **Scale** (select: 0.5×, 1×, 2× — default 1). Must include "Cancel" and "Export GIF" action buttons.
  - Input: Existing `#reset-modal` HTML (lines 137–151) as structural reference; `modal-backdrop`, `modal-panel glass-panel`, `modal-actions`, `modal-btn` CSS classes.
  - Output: New modal markup block appended before `</body>`, styled with existing CSS classes only (no new CSS needed for structure).
  - Depends on: 2.1

---

## Phase 3: Frame Capture Engine [PENDING]

- [ ] 3.1 Implement `sampleLiveComputedFrame(width, height)` → returns `ImageData`
  → Agent: `coder`
  - Goal: Clone the live `#svg-host > svg`, read `getComputedStyle(record.el)` for every shape in `App.shapes` (fill, stroke, stroke-width, opacity, visibility), write values as presentation attributes on clone elements, apply annotations via `App.annotationLayer.renderInto`, run the full sanitization pipeline, serialize → Blob URL → `<img>` → `<canvas>` → return `ctx.getImageData()`.
  - Input: `exportManager.js` (full sanitization helpers at lines 154–306; `buildCloneKeyMap` at line 42; `renderStateToPNG` pattern at lines 338–500); `annotationLayer.js` `renderInto` API; active `transition.annotations` from `App.config.transitions`.
  - Output: New private function `sampleLiveComputedFrame(width, height)` returning `Promise<ImageData>` in a new file `js/gifExport.js`.
  - Note: Must **not** call `renderStateToPNG` (which applies config state, not live computed state); must use `getComputedStyle` on live elements.
  - Depends on: 1.1 (gifenc API research informs encoding expectations, though sampling itself is independent)

- [ ] 3.2 Implement `captureTransitionFrames(fromStateId, toStateId, fps, holdMs, scaleFactor)` → returns frame array
  → Agent: `coder`
  - Goal: (1) Apply `fromStateId` immediately (no CSS transition) to live DOM using `App.playback.applyStateToSVG` with a temporary `transition: none` override; (2) trigger `App.playback.applyStateToSVG(toStateId)` to start the CSS transition; (3) sample `ceil(transitionDuration / frameInterval)` frames using a `setTimeout` chain at `frameInterval = 1000/fps` ms intervals; (4) append `floor(holdMs / frameInterval)` hold frames of the final state. Each frame is obtained via `sampleLiveComputedFrame`.
  - Input: 3.1; `playback.js` `applyStateToSVG` (exposed as `App.playback.applyStateToSVG`); `App.config.transitionDuration`.
  - Output: `captureTransitionFrames(...)` returning `Promise<Array<{imageData: ImageData, delay: number}>>` in `js/gifExport.js`.
  - Depends on: 3.1

- [ ] 3.3 Implement `captureAllStatesFrames(settings)` — full sequence orchestrator
  → Agent: `coder`
  - Goal: (1) Call `App.playback.pause()` to halt auto-play; (2) store and reset zoom to 1.0 (`App.zoom.reset()`); (3) resolve canvas dimensions from SVG viewBox × `settings.scaleFactor`; (4) iterate all `App.config.transitions` — treating transition from baseline to `transitions[0]` as the first segment, then each consecutive pair — collecting frames per segment; (5) update progress modal after each state segment; (6) restore original zoom level after completion or error; (7) return flat frame array. Handle single-state case (hold frames only, no transition).
  - Input: 3.2; `resolveSVGDimensions` (to be extracted from `exportManager.js` or duplicated in `gifExport.js`); `App.zoom.reset()` and `App.zoom.getLevel()`; `showExportProgress` / `updateExportProgress` hooks.
  - Output: `captureAllStatesFrames(settings)` returning `Promise<Array<{imageData: ImageData, delay: number}>>` in `js/gifExport.js`.
  - Depends on: 3.2

---

## Phase 4: GIF Encoding Pipeline [PENDING]

- [ ] 4.1 Implement `encodeGIF(frames, width, height, loopCount)` using gifenc
  → Agent: `coder`
  - Goal: Instantiate `GIFEncoder`; for each frame: call `quantize(rgba, 256)` to build palette, call `applyPalette(rgba, palette)` for indexed pixels, write frame with correct `delay` (in centiseconds) and loop metadata; call `encoder.finish()` and return `Uint8Array`.
  - Input: gifenc API from 1.1 research; frame array from 3.3; `loopCount` (0 = infinite).
  - Output: `encodeGIF(frames, width, height, loopCount)` returning `Uint8Array` in `js/gifExport.js`.
  - Depends on: 1.1, 3.3

- [ ] 4.2 Implement `exportGIF(settings)` — top-level async orchestrator + download trigger
  → Agent: `coder`
  - Goal: Call `captureAllStatesFrames(settings)` → `encodeGIF(frames, ...)` → create `Blob([bytes], {type:'image/gif'})` → `URL.createObjectURL` → `<a download="archflow-animation.gif">` click → `URL.revokeObjectURL`. Wrap in try/catch with `console.error` on failure. Call `hideExportProgress()` in `finally`.
  - Input: 4.1; existing `Blob + <a download>` trigger pattern from `exportManager.js` (e.g., `triggerSvgDownload` at line 700); `showExportProgress` / `hideExportProgress`.
  - Output: `exportGIF(settings)` async function in `js/gifExport.js`.
  - Depends on: 4.1

---

## Phase 5: Wiring & Integration [PENDING]

- [ ] 5.1 Wire GIF settings modal open/confirm/cancel logic + connect to `exportGIF`
  → Agent: `coder`
  - Goal: In `js/gifExport.js` `DOMContentLoaded` handler: wire `#btn-export-gif` click → open `#gif-settings-modal-backdrop`; wire "Cancel" → close modal; wire "Export GIF" → read form values (fps, holdMs, loopCount, scaleFactor) → close modal → call `disableExportButtons()` → `showExportProgress('Exporting as GIF…', total)` → `exportGIF(settings)` → `enableExportButtons()`.
  - Input: 2.2 (modal HTML IDs); 4.2 (`exportGIF`); `App.config.transitions.length` for `total` progress count.
  - Output: `js/gifExport.js` `DOMContentLoaded` wiring block.
  - Depends on: 2.2, 4.2

- [ ] 5.2 Add `#btn-export-gif` to `allExportButtons` array in `exportManager.js`; add `js/gifExport.js` to `index.html` script list; expose `App.export.exportGIF`
  → Agent: `coder`
  - Goal: (1) In `exportManager.js` `DOMContentLoaded`, add `document.getElementById('btn-export-gif')` to `allExportButtons` so it is disabled during PPTX/PDF exports too. (2) Add `<script src="js/gifExport.js" defer></script>` after `exportManager.js` in `index.html`. (3) Extend the `App.export = { … }` assignment to include `exportGIF`.
  - Input: `exportManager.js` lines 833–885 (init block); `index.html` line 181.
  - Output: Modified `exportManager.js` and `index.html`.
  - Depends on: 5.1

---

## Phase 6: QA & Testing [PENDING]

- [ ] 6.1 Smoke test: basic SVG with fill/opacity transitions → verify downloaded GIF animates correctly
  → Agent: `reviewer`
  - Goal: Load a simple SVG with 2–3 states that change fill colour and opacity; export at 12 fps, scale 1×; open GIF in browser; confirm smooth animation and correct loop behaviour.
  - Input: Any multi-state ArchFlow config; completed phase 5 implementation.
  - Output: Pass/fail notes; any bugs filed as follow-up tasks.
  - Depends on: 5.2

- [ ] 6.2 Edge case tests: single state, very fast transitions, annotations, large canvas
  → Agent: `reviewer`
  - Goal: Verify: (a) single-state config produces a valid static GIF (hold frames only); (b) `transitionDuration = 100 ms` at 24 fps yields ≥1 frame; (c) annotations render visibly in the GIF; (d) 2× scale produces a canvas up to 2× viewBox size without memory crash.
  - Input: Phase 5 implementation.
  - Output: Pass/fail per case; amendments to `captureAllStatesFrames` if single-state path is broken.
  - Depends on: 5.2

- [ ] 6.3 Error-state tests: no SVG loaded, export interrupted, gifenc not loaded
  → Agent: `reviewer`
  - Goal: Verify: (a) clicking "Export GIF" with no SVG shows a graceful error or disabled button; (b) if gifenc script fails to load, `exportGIF` throws a clear console error (not a silent hang); (c) progress modal always closes even on error.
  - Input: Phase 5 implementation.
  - Output: Pass/fail; any guard clauses to add in `exportGIF`.
  - Depends on: 5.2

---

## Dependency Graph

```
1.1 ─────────────────────────────────────► 3.1 → 3.2 → 3.3 ─► 4.1 → 4.2 ─► 5.1 → 5.2 → 6.x
1.2 → 1.3 → 2.1 → 2.2 ──────────────────────────────────────────────────► 5.1
                                                                             ↑
                                                                           4.1 (also → 4.2)
```

Detailed edges:
- 1.2 → 1.3
- 1.3 → 2.1 → 2.2
- 1.1 → 3.1 → 3.2 → 3.3 → 4.1 → 4.2
- 2.2, 4.2 → 5.1 → 5.2
- 5.2 → 6.1, 6.2, 6.3

---

## Parallelization Summary

- **Phase 1** (1.1 & 1.2): parallel — API research and file download are independent; 1.3 waits on 1.2 only
- **Phase 2** (2.1 → 2.2): sequential within phase — modal content depends on button existence; can start in parallel with Phase 3 once 1.3 is done
- **Phase 3** (3.1 → 3.2 → 3.3): sequential — each task builds on the previous
- **Phase 3 & Phase 2**: partially parallel — frame capture engine and modal HTML are independent tracks after Phase 1
- **Phase 4** (4.1 → 4.2): sequential — encoder must exist before orchestrator
- **Phase 5** (5.1 → 5.2): sequential — modal wiring then export-manager registration
- **Phase 6** (6.1, 6.2, 6.3): parallel — independent test scenarios

---

## Notes

- 2026-04-23: Smooth transition capture chosen over slideshow. Requires live DOM `getComputedStyle` sampling rather than static `renderStateToPNG` reuse — a meaningfully new code path. `ref:exploration-codebase`
- 2026-04-23: gifenc gifEncoder delay unit is centiseconds (hundredths of a second). Frame delay at 12 fps = `Math.round(100 / 12)` = 8 cs. Must confirm unit in 1.1 research before implementing 4.1.
- 2026-04-23: Zoom CSS `transform: scale(N)` on the live SVG does not affect viewBox coordinates. `resolveSVGDimensions` reads viewBox/width/height attrs, which are zoom-independent. However, the scale transform visually misaligns the element within `#svg-host`; resetting zoom before cloning avoids any rendering artefacts from the transform persisting in the clone's `style` attribute. `ref:exploration-codebase`
- 2026-04-23: `App.playback.applyStateToSVG` is exposed on `App.playback` (playback.js line 252). To suppress the CSS transition for the "reset to fromState" step, temporarily override `el.style.transition = 'none'` on all shapes before applying, then restore after one frame. `ref:exploration-codebase`
- 2026-04-23: The annotation `marker-end="url(#af-arrowhead)"` references an in-document `<defs>` fragment. This is safe for canvas rendering (no cross-origin risk) as long as the arrowhead marker is present in the clone's `<defs>` — `annotationLayer.renderInto` already calls `ensureArrowheadMarker` on the target SVG. `ref:exploration-codebase`
- 2026-04-23: `gifExport.js` should be a new standalone IIFE module (consistent with all other ArchFlow JS files) rather than extending `exportManager.js`, to keep file size manageable and concerns separated.
