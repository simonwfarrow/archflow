---
status: in-progress
phase: 1
updated: 2026-04-23
---

# Implementation Plan

## Goal
Restyle ArchFlow from dark glassmorphism to an e-ink / monochromatic architect theme with warm paper tones, ink typography, subtle layered shadows, and precise hover effects.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| Fonts: Syne (display) + DM Sans (UI) + Space Mono (labels) | Syne has distinctive geometric character suited to technical/architectural work; DM Sans is clean and legible; Space Mono evokes precision drawing tools | codebase-explore |
| Palette: warm paper #f7f5f0 base, ink black #111111, mid-grays | Mirrors e-ink display aesthetics — no saturation, high contrast, warm not cold | codebase-explore |
| Remove blur/glow/gradient mesh background | E-ink has no backlight; all depth must come from shadows and borders, not light emission | codebase-explore |
| Replace animated mesh with static subtle grid | Architect paper grid evokes drafting boards; static to match e-ink no-animation philosophy | codebase-explore |
| Retain glass-panel class name, restyle to paper surface | Avoids touching JS structural logic; only visual properties change | codebase-explore |

## Phase 1: Foundation — CSS + HTML [IN PROGRESS]
- [ ] **1.1 Update font imports in index.html (Syne + DM Sans + Space Mono)** ← CURRENT
- [ ] 1.2 Rewrite CSS custom properties (:root tokens) in styles.css
- [ ] 1.3 Rewrite all component CSS (panels, mode bar, toolbar, tabs, playback, modal, empty state)

## Phase 2: JS Inline Style Updates [PENDING]
- [ ] 2.1 Update hardcoded hex/rgba colors in stateManager.js
- [ ] 2.2 Update hardcoded hex/rgba colors in shapeListPanel.js
- [ ] 2.3 Update hardcoded hex/rgba colors in propertyEditor.js
- [ ] 2.4 Check and update playback.js and persist.js inline styles

## Phase 3: Review [PENDING]
- [ ] 3.1 Code review pass for correctness, philosophy adherence, and visual coherence

## Notes
- 2026-04-23: Initial plan created based on full codebase exploration
