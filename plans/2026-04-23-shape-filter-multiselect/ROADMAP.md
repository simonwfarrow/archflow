---
status: in-progress
phase: 1
updated: 2026-04-23
---

# Implementation Plan: Shape Filter + Multi-Select + Bulk Edit

## Goal
Add live shape filtering by text/type and Ctrl/Cmd-click multi-selection to the shape list panel, then extend the property editor to apply changes to all selected shapes at once.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| `filterText` + `filterTag` as module-level vars in `shapeListPanel.js` | Filter state is local to the panel IIFE; no cross-module access needed — mirrors existing `selectedKey` pattern | `direct analysis` |
| `selectedKey: string\|null` → `selectedKeys: Set<string>` | Multi-select is a set problem; Set gives O(1) has/add/delete, replaces the existing string scalar cleanly | `direct analysis` |
| Type pills collected at `render()` time from `App.shapes` | Tags are not registered separately in `App`; deriving them from the live map is always consistent with the current SVG load | `direct analysis` |
| Count display changes from `"N"` to `"X of Y"` when filter is active | Communicates total corpus size while filtered — zero-cost UX signal reusing existing `#shape-count` element | `direct analysis` |
| `propertyEditor.bindMulti(keySet)` added alongside existing `bind(key)` | Preserves backward-compat (shapeList single-select path still calls `bind`); bulk path calls `bindMulti`; size-1 Set inside `bindMulti` delegates to `bind` internally | `direct analysis` |
| Bulk `saveShapeProperty` loops per key, one `App.updateConfig()` at end | `updateConfig` fires `onConfigUpdate`; batching the full updated transitions array once avoids N redundant re-renders | `direct analysis` |
| SVG click handler modified to pass mouse event to `selectShape` | The delegated SVG handler in `shapeListPanel.js` already has the event; threading it through enables Ctrl/Cmd detection without touching `app.js` | `direct analysis` |

---

## Phase 1: Filter UI [IN PROGRESS]

- [ ] **1.1 Add filter state variables and helper to `shapeListPanel.js`** ← CURRENT
  - Goal: Establish `filterText` (string, default `''`) and `filterTag` (string|null, default `null`) as module-level variables; add a pure `applyFilters(shapesMap)` helper that returns a filtered array of records matching both constraints (case-insensitive substring on `label` and `key`; exact match on `tag` when `filterTag` is set).
  - Input: existing `shapeListPanel.js`; `App.shapes` Map shape: `{ key, tag, label, el, baseline }`
  - Output: two new variables + `applyFilters()` function in the module scope; no visible change yet
  - Depends on: —

- [ ] 1.2 Inject search input HTML into `createPanelElement()` header
  - Goal: Add a text `<input id="shape-search">` between the drag-handle row and `#shape-list-body`; keep the same inline-style convention already used throughout the panel.
  - Input: `createPanelElement()` in `shapeListPanel.js`
  - Output: search bar renders in the panel header area; no event wiring yet
  - Depends on: 1.1

- [ ] 1.3 Render type-filter pills row in `render()`
  - Goal: After clearing `body`, collect unique `tag` values from `App.shapes` (order: insertion order of the Map); render a horizontal pill row above the list items. The pill matching `filterTag` renders with `background: rgba(110,87,255,0.18)` and `color: var(--accent-primary)`; others render muted. Clicking the active pill clears `filterTag`; clicking a different pill sets it.
  - Input: `render()` function; `filterTag` variable
  - Output: pill row visible when shapes are loaded; pills correctly reflect active filter state on each re-render
  - Depends on: 1.1, 1.2

- [ ] 1.4 Update `render()` to apply filters and show "X of Y" count
  - Goal: Replace the direct `shapes.forEach` iteration in `render()` with `applyFilters(shapes)` to get the visible subset. Update the count display to `"X of Y"` when `filterText !== ''` or `filterTag !== null`; otherwise show `"N"` as before (backward-compat).
  - Input: `render()`, `applyFilters()`, `#shape-count` element
  - Output: list only shows matching rows; count reflects filter state
  - Depends on: 1.1, 1.3

- [ ] 1.5 Wire search input `input` event and pill click events
  - Goal: On each keystroke in `#shape-search`, update `filterText` and call `render()`. On pill click, toggle `filterTag` (set to tag or clear if already active) and call `render()`. Event listeners attached once in `DOMContentLoaded` init (not re-wired on every render).
  - Input: `#shape-search` input, pill elements (delegated click on pills container)
  - Output: live filtering works end-to-end; typing narrows the list; clicking a pill further narrows by type; clicking the same pill again shows all types
  - Depends on: 1.2, 1.3, 1.4

---

## Phase 2: Multi-Select [PENDING]

- [ ] 2.1 Replace `selectedKey` with `selectedKeys` Set in `shapeListPanel.js`
  - Goal: Rename `selectedKey` (string|null) to `selectedKeys` (Set<string>, initialised as `new Set()`). Update all internal reads/writes: `clearSVGHighlights` iterates the set; `deselectAll` calls `selectedKeys.clear()`; `createShapeRowHTML` receives `isSelected = selectedKeys.has(record.key)`.
  - Input: full `shapeListPanel.js`; affects `selectShape`, `deselectAll`, `clearSVGHighlights`, `render`, row hover handlers
  - Output: functionally equivalent single-select still works; internal state is now a Set
  - Depends on: 1.5 (Phase 1 complete)

- [ ] 2.2 Update `selectShape(key, event)` for Ctrl/Cmd multi-select
  - Goal: Add optional `event` parameter. Without modifier (or no event): clear `selectedKeys`, add `key` (existing behavior). With `event.ctrlKey || event.metaKey`: toggle `key` in `selectedKeys` (add if absent, delete if present). After updating set: re-apply SVG highlights for all keys in set, refresh all row border/background styles, scroll active row into view, notify property editor (see 2.5).
  - Input: `selectShape`, `selectedKeys` Set, row click handlers
  - Output: Ctrl/Cmd+click adds/removes from selection; SVG highlights reflect full set
  - Depends on: 2.1

- [ ] 2.3 Thread mouse event from SVG delegated click handler to `selectShape`
  - Goal: In the `svgHost` click listener in `DOMContentLoaded`, change `selectShape(key)` to `selectShape(key, e)` so the modifier is available.
  - Input: SVG host click handler block (~line 244–257 of current file)
  - Output: clicking SVG elements directly also respects Ctrl/Cmd modifier
  - Depends on: 2.2

- [ ] 2.4 Add "Select all [tag]" chip button per type group in `render()`
  - Goal: When rendering the list body, group shape rows by `tag`. Insert a group header before each tag's rows containing: the tag label and a small "Select all" chip button (`data-tag="…"`). Clicking the chip sets `selectedKeys` to the full set of keys sharing that tag, then refreshes highlights and notifies the editor. Delegated click on `#shape-list-body` handles these chips.
  - Input: `render()`, row click delegation in `DOMContentLoaded`
  - Output: visible group headers with "Select all rect" chip; clicking it selects that entire group
  - Depends on: 2.2

- [ ] 2.5 Notify property editor with the full selection Set
  - Goal: After every selection change (single click, Ctrl+click, "Select all" chip), call `App.panels.propertyEditor.bindMulti(selectedKeys)` instead of `propertyEditor.bind(key)`. When `selectedKeys` is empty, call `propertyEditor.unbind()`.
  - Input: `selectShape`, "Select all" chip handler, `deselectAll`
  - Output: property editor receives the current Set on every selection change
  - Depends on: 2.2, 2.4 — and Phase 3 task 3.1 must exist before this wires end-to-end

- [ ] 2.6 Expose `selectedKeys` on `App.panels.shapeList` public API
  - Goal: Update the last line of `DOMContentLoaded` in `shapeListPanel.js` to expose a `selectedKeys` getter: `App.panels.shapeList = { render, selectShape, deselectAll, get selectedKeys() { return selectedKeys; } }`.
  - Input: public API object at bottom of module
  - Output: other modules can read current selection set without importing internals
  - Depends on: 2.1

---

## Phase 3: Bulk Property Editor [PENDING]

- [ ] 3.1 Add `bindMulti(keySet)` to `propertyEditor.js`
  - Goal: New exported function. If `keySet.size === 1`, extract the single key and delegate to existing `bind(key)`. If `keySet.size > 1`: store `boundKeys = new Set(keySet)` (module-level, replaces `boundShapeKey` for multi-select path); set panel header label to `"${keySet.size} shapes"`; build and inject multi-shape controls HTML (see 3.2); wire bulk events (see 3.4); show the panel.
  - Input: `propertyEditor.js`; existing `bind`, `unbind`, `panel` reference
  - Output: `App.panels.propertyEditor.bindMulti` callable; panel renders for multi-selection
  - Depends on: 2.5

- [ ] 3.2 Update `buildControlsHTML` to accept multi-shape value sets
  - Goal: Add a second variant or an options parameter: `buildControlsHTML(baseline, overrides, {multiValues})` where `multiValues` is an object mapping each prop name to either a single consensus value (all shapes agree) or the sentinel `'__mixed__'`. For each control: consensus value renders normally; `'__mixed__'` renders a greyed placeholder — color inputs show `#808080`, text inputs show `"mixed"`, range inputs show midpoint with italic display label `"mixed"`. The `"mixed"` state is purely visual; saving always overwrites all shapes.
  - Input: `buildControlsHTML`; existing control HTML patterns
  - Output: editor shows correct single-value or mixed indicators when 2+ shapes selected
  - Depends on: 3.1

- [ ] 3.3 Add `computeMultiValues(keySet)` helper
  - Goal: Pure function — iterates `keySet`, calls `getActiveStateShapeProperties` per key, merges with each shape's baseline; for each of the five properties (`fill`, `stroke`, `strokeWidth`, `opacity`, `visibility`), returns the consensus value if all shapes agree, else `'__mixed__'`. Returns the `multiValues` object consumed by `buildControlsHTML`.
  - Input: `keySet: Set<string>`, `App.shapes`, `getActiveStateShapeProperties`
  - Output: `{ fill, stroke, strokeWidth, opacity, visibility }` with consensus values or `'__mixed__'`
  - Depends on: 3.1

- [ ] 3.4 Add `saveBulkProperty(keySet, propName, rawValue)` replacing single-key save in bulk path
  - Goal: Iterates `keySet`; builds one updated `transitions` array applying the property override to every shape in the set (using the same immutable-update pattern as `saveShapeProperty`); makes a **single** `App.updateConfig({ transitions: updatedTransitions })` call. Also calls `applyPropertyToElement` on every shape's SVG element for live preview. The original `saveShapeProperty(shapeKey, …)` remains unchanged for single-select path.
  - Input: `saveShapeProperty` logic, `App.config.transitions`, `App.shapes`
  - Output: one config update fires `onConfigUpdate` once; all selected SVG elements preview immediately
  - Depends on: 3.1

- [ ] 3.5 Update `wireControlEvents` to dispatch to bulk or single path
  - Goal: Refactor `wireControlEvents` to accept `(keyOrSet, baseline)` where the first argument is either a string (existing single path) or a Set (bulk path). When a Set: each control's event handler calls `saveBulkProperty(keySet, propName, val)`. The display-sync logic (color picker ↔ text input, range ↔ display span) is unchanged.
  - Input: `wireControlEvents`; all five control groups
  - Output: all control interactions work for both single and multi selections without duplicated handler code
  - Depends on: 3.4

- [ ] 3.6 Add bulk `resetToBaseline` support
  - Goal: When `boundKeys` is a Set (multi path), `resetToBaseline` iterates all keys: restore each SVG element to its baseline properties; build a single updated `transitions` array that removes all shape entries for every key in the set from the active state; call `App.updateConfig` once; then call `bindMulti(boundKeys)` to re-render controls.
  - Input: `resetToBaseline` function, `boundKeys` Set
  - Output: "Reset to baseline" button in multi-select mode clears overrides for all selected shapes in one operation
  - Depends on: 3.1, 3.4

- [ ] 3.7 Update `App.panels.propertyEditor` public API
  - Goal: Change the registered public object to `{ bind, bindMulti, unbind }`.
  - Input: last line of `DOMContentLoaded` in `propertyEditor.js`
  - Output: `shapeListPanel.js` (task 2.5) can call `App.panels.propertyEditor.bindMulti(selectedKeys)` safely
  - Depends on: 3.1

---

## Dependency Graph

```
1.2 -> 1.1
1.3 -> 1.1, 1.2
1.4 -> 1.1, 1.3
1.5 -> 1.2, 1.3, 1.4

2.1 -> 1.5
2.2 -> 2.1
2.3 -> 2.2
2.4 -> 2.2
2.5 -> 2.2, 2.4
2.6 -> 2.1

3.1 -> 2.5
3.2 -> 3.1
3.3 -> 3.1
3.4 -> 3.1
3.5 -> 3.4
3.6 -> 3.1, 3.4
3.7 -> 3.1
```

---

## Parallelization Summary

- **Phase 1:** Sequential — each task builds directly on the previous: state vars → HTML injection → pills → filter logic → event wiring. No parallelism possible.
- **Phase 2:** Mostly sequential — 2.1 is the shared foundation; 2.3 and 2.4 can be done in parallel after 2.2; 2.6 can be done in parallel with 2.2–2.5 (only touches the public API export).
- **Phase 3:** 3.2, 3.3, and 3.4 can be developed in parallel after 3.1; 3.5 waits on 3.4; 3.6 waits on 3.1 + 3.4; 3.7 is a single-line change after 3.1.

---

## Notes

- 2026-04-23: Initial analysis of codebase. `shapeListPanel.js` uses module-level single-select scalar — minimum-invasive upgrade is scalar→Set with same variable scope pattern. `propertyEditor.js` single-key path must remain intact to avoid regressions when selection is exactly one shape.
- 2026-04-23: `App.on` validates known hook names; no new hooks needed — filter/selection state is entirely within `shapeListPanel.js`; property editor is notified via direct panel API call, consistent with existing `App.panels.propertyEditor.bind(key)` pattern.
- 2026-04-23: `App.updateConfig` fires `onConfigUpdate` on every call — Phase 3 bulk save must batch all shape updates into one call to prevent N redundant downstream re-renders.
