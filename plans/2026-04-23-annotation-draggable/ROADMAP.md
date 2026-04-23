---
status: in-progress
phase: 1
updated: 2026-04-23
---

# Implementation Plan: Annotation Toolbox Draggable

## Goal
Make the Annotations toolbox panel draggable using the existing `App.makeDraggable` utility, consistent with how the Shapes and Properties toolboxes are already handled.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| Use `App.makeDraggable()` from `draggable.js` | Already adopted by Shapes and Properties panels; zero new dependencies, consistent UX | `ref:ses_24563d842ffeJDkJmXY4oDm75U` |
| `storageKey: 'archflow-panel-annotations'` | Follows established naming convention `archflow-panel-<name>` used by all sibling panels | `ref:ses_24563d842ffeJDkJmXY4oDm75U` |
| `handleSelector: '.panel-drag-handle'` | Shared CSS class convention across every draggable panel in the workspace | `ref:ses_24563d842ffeJDkJmXY4oDm75U` |

## Phase 1: Implementation [IN PROGRESS]
- [ ] **1.1 Add `.panel-drag-handle` header element to annotation panel HTML in `annotationEditor.js`** ← CURRENT
  - Goal: Inject a drag-handle element into the annotations panel HTML structure (around line 383) so the user has a visible grip area, matching the pattern used by Shapes and Properties panels
  - Input: Panel creation block in `annotationEditor.js` ~line 383; sibling panel HTML as structural reference
  - Output: `.panel-drag-handle` element present in the annotations panel template
  - Agent: `coder`
- [ ] 1.2 Call `App.makeDraggable` on the annotations panel with `storageKey: 'archflow-panel-annotations'`
  - Goal: Wire up drag behavior immediately after panel creation, mirroring Shapes (`archflow-panel-shapelist`) and Properties (`archflow-panel-propeditor`) initialization
  - Input: Panel element reference from step 1.1; `draggable.js` signature `App.makeDraggable(panelEl, { handleSelector, storageKey })`
  - Output: Annotations panel is draggable and persists its last position via `localStorage`
  - Depends on: 1.1
  - Agent: `coder`

## Phase 2: Review [PENDING]
- [ ] 2.1 Code review of `annotationEditor.js` changes
  - Goal: Validate implementation quality, consistency with sibling panels, and correctness of drag-handle placement and `makeDraggable` call
  - Input: Diff / updated `annotationEditor.js`
  - Output: Review findings with severity classification; approval or required revisions
  - Depends on: 1.1, 1.2
  - Agent: `reviewer`

## Dependency Graph
Task 1.2 → Task 1.1
Task 2.1 → Task 1.1, Task 1.2

## Parallelization Summary
- Phase 1: sequential — Task 1.2 cannot be wired up until the handle element from Task 1.1 exists in the DOM template
- Phase 2: sequential — Review begins only after all Phase 1 tasks are complete

## Notes
- 2026-04-23: Exploration confirmed Shapes panel uses `storageKey: 'archflow-panel-shapelist'` and Properties panel uses `storageKey: 'archflow-panel-propeditor'`; Annotations panel is the only toolbox missing both the `.panel-drag-handle` element and the `App.makeDraggable(...)` call `ref:ses_24563d842ffeJDkJmXY4oDm75U`
