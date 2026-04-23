---
status: complete
phase: 6
updated: 2026-04-22
---

# Implementation Plan: SVG Transition Viewer

## Goal
Build a fully client-side SPA that lets users upload an SVG architecture diagram, define named transition states with per-shape property overrides, and animate through those states in a polished dark-glassmorphism UI.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| Plain HTML + vanilla JS, no build system | Zero tooling friction; SPA delivered as `index.html` + co-located files; CDN for any micro-libs | `ref:initial-design` |
| All assets served from `/workspace` directly | No backend, no bundler; files opened straight in browser | `ref:initial-design` |
| Dark glassmorphism design system | Ultra-modern aesthetic; CSS custom properties keep theming consistent across all panels | `ref:initial-design` |
| All tool panels are floating draggable overlays | Maximises SVG canvas real-estate; panels never permanently obscure the diagram | `ref:initial-design` |
| Config schema `{ id, image, transitions:[{id,name,shapes:[{id,properties:{}}]}] }` | Minimal, flat, human-readable; easy to hand-edit or version-control | `ref:initial-design` |
| Auto-save via debounced `localStorage` mirror + explicit "Export Config" download | Prevents accidental data loss without spamming downloads on every keystroke | `ref:initial-design` |
| CSS `transition` properties applied inline for Play-mode animation | No animation library needed; browser interpolation is native and smooth | `ref:initial-design` |
| Dual Edit / Play mode toggle | Clear mental model; Edit mode exposes authoring tools, Play mode hides them for presentation | `ref:initial-design` |
| Shape auto-key fallback (`tagName-index`) when `id` is absent | Makes the parser robust against SVGs that lack `id` attributes | `ref:initial-design` |

## Phase 1: Project Scaffolding [COMPLETE]
- [x] **1.1 Create `/workspace/index.html`**
- [x] 1.2 Create `/workspace/css/styles.css`
- [x] 1.3 Create `/workspace/js/app.js`

## Phase 2: SVG Upload & Shape Parser [COMPLETE]
- [x] 2.1 File-input handler + SVG inline canvas
- [x] 2.2 SVG DOM walker / shape identifier
- [x] 2.3 Build internal shapes registry (Map)

## Phase 3: Edit Mode UI [COMPLETE]
- [x] 3.1 Floating Shape List panel
- [x] 3.2 Bidirectional SVG ↔ list selection + glow highlight
- [x] 3.3 Floating Property Editor panel
- [x] 3.4 "Add Transition State" button + state strip

## Phase 4: Config / JSON Persistence [COMPLETE]
- [x] 4.1 In-memory config object + schema
- [x] 4.2 Auto-save: debounced localStorage mirror
- [x] 4.3 "Export Config" JSON download
- [x] 4.4 "Load Config" JSON restore flow

## Phase 5: Play Mode [COMPLETE]
- [x] 5.1 Transition list + prev/next/auto-play controls
- [x] 5.2 Apply shape property overrides with CSS transitions
- [x] 5.3 Progress indicator / step counter

## Phase 6: Polish & UX [COMPLETE]
- [x] 6.1 Draggable panel infrastructure (mouse + touch)
- [x] 6.2 Keyboard shortcuts
- [x] 6.3 Responsive layout + panel edge snapping
- [x] 6.4 Transition duration slider
- [x] 6.5 Empty-state illustrations + loading states
- [x] 6.6 Accessibility pass (ARIA labels, focus rings)

## Notes
- 2026-04-22: Initial design spec from user. All decisions from `ref:initial-design`.
- 2026-04-22: SVG `<g>` groups included in shape registry.
- 2026-04-22: `config.image` stores raw SVG markup string (self-contained config).
- 2026-04-22: All phases complete. Code review applied 9 fixes (CRIT-1, CRIT-2, MAJOR-1 through MAJOR-4, MINOR-1, MINOR-4, MINOR-7).
