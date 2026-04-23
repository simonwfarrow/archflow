---
status: complete
phase: 4
updated: 2026-04-23
---

# Implementation Plan: SVG Inline Annotations

## Goal
Add per-transition inline SVG annotations (arrows + text labels) stored in `transitions[].annotations[]`, authored via a two-click UI, that stay in relative position at all zoom levels.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| Inline SVG `<g>` layer | SVG is zoomed via CSS `scale()`, so injected elements inherit zoom automatically | `ref:ses_2458cdf2cffeGYKrwk5Zw1zSCK` |
| IIFE module pattern | All existing scripts use IIFE; no bundler present | `ref:ses_2458cdf2cffeGYKrwk5Zw1zSCK` |
| `annotations[]` on each transition | `persist.js` serialises full `App.config` — no persistence changes needed | `ref:ses_2458cdf2cffeGYKrwk5Zw1zSCK` |
| Hook rendering in `applyStateToSVG()` | Single authoritative place to synchronise per-transition visual state | `ref:ses_2458cdf2cffeGYKrwk5Zw1zSCK` |

## Phase 1: Core Annotation Layer [COMPLETE]
- [x] **1.1 Create `js/annotationLayer.js`**
- [x] 1.2 Add annotationLayer.js script tag to `index.html`

## Phase 2: Playback Integration [COMPLETE]
- [x] 2.1 Modify `applyStateToSVG()` to render annotations

## Phase 3: Annotation Editor [COMPLETE]
- [x] 3.1 Create `js/annotationEditor.js`
- [x] 3.2 Add annotationEditor.js script tag to `index.html`

## Phase 4: CSS Styles [COMPLETE]
- [x] 4.1 Add annotation styles to `css/styles.css`

## Notes
- 2026-04-23: Vanilla JS IIFE, CSS-transform zoom, full config serialisation confirmed `ref:ses_2458cdf2cffeGYKrwk5Zw1zSCK`
- 2026-04-23: `clear()` on mode-change is not needed — `render([])` handles empty state; `resetProject()` removes the annotation layer DOM entirely
