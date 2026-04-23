---
status: complete
phase: 3
updated: 2026-04-23
---

# Implementation Plan: Annotation Export Fix

## Goal
Render annotations into exported PowerPoint/PDF slides by exposing a `renderInto(svgEl, annotations)` method on `annotationLayer.js` and calling it inside `exportManager.js`'s `renderStateToPNG()`.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| Add `renderInto` to annotationLayer public API | Private helpers (`createArrowLine`, `createLabelBackground`, etc.) already exist; exposing a single render-into method reuses them without duplication | direct analysis |
| Call `renderInto` after Step 5 (state overrides) and before Step 6 (strip CSS) in `renderStateToPNG` | Annotations must be stamped onto the already-overridden clone before CSS transitions are stripped, matching live-render order | direct analysis |
| Default to empty array (`transition.annotations || []`) | Older transitions may lack the `annotations` key; defaulting prevents null-reference errors | direct analysis |

## Phase 1: Extend annotationLayer.js Public API [COMPLETE]
- [x] **1.1 Add `renderInto(svgEl, annotations)` to `annotationLayer.js`**

## Phase 2: Update exportManager.js Export Pipeline [COMPLETE]
- [x] 2.1 Call `App.annotationLayer.renderInto(clone, transition.annotations || [])` inside `renderStateToPNG()`

## Phase 3: Review [COMPLETE]
- [x] 3.1 Code review of both changed files

## Notes
- 2026-04-23: Root cause confirmed — `renderStateToPNG` clones the live SVG but never invokes annotation rendering. Fix is additive (new public method + one call site); no existing code is deleted.
