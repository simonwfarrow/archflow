# AGENTS.md — ArchFlow

## Overview
- Browser-only SPA: open `index.html` directly in a browser. No server, no install, no build step. Works from `file://`.
- Animates SVG architecture diagrams through named "transition states" with per-shape property overrides (fill, stroke, opacity, etc.).
- All state is persisted to `localStorage` (key `archflow-config-v1`) and can be exported/imported as JSON.

## Architecture

### Module system
- **No ES modules.** Every JS file is an IIFE. `type="module"` must never be added — it breaks `file://` access due to CORS.
- **`window.App` is the only global namespace.** All modules attach sub-namespaces to it (`App.playback`, `App.stateManager`, etc.).
- `app.js` creates `window.App` and **must load first**. All other scripts depend on it existing.

### Script load order (`index.html`)
Scripts use `defer` and execute in declaration order before `DOMContentLoaded` fires. The order is a hard dependency — inserting a new `<script>` in the wrong position breaks the app. Current order:
```
app.js → svgLoader.js → zoom.js → svgParser.js → draggable.js →
shapeListPanel.js → propertyEditor.js → stateManager.js →
annotationLayer.js → annotationEditor.js → persist.js →
playback.js → exportManager.js → gifExport.js
```

### Attachment timing
Some modules attach to `window.App` immediately (synchronous, no DOM needed):
- `App.parseSVG` (svgParser.js)
- `App.loadSVG` (svgLoader.js)
- `App.makeDraggable` (draggable.js)

All other modules attach on `DOMContentLoaded`. Only the immediately-attached functions may be called synchronously from another IIFE body; everything else must be called after DOM is ready.

## Key invariants — never break these

1. **`SHAPE_TAGS` is duplicated** in `svgParser.js`, `exportManager.js`, and `gifExport.js`. All three must stay identical:
   ```js
   ['rect','circle','ellipse','path','polygon','polyline','line','text','g']
   ```

2. **`buildCloneKeyMap()` in `exportManager.js` and `gifExport.js`** must exactly mirror `walkSVGTree()` in `svgParser.js`. These produce the shape key → element map used to apply state overrides onto export clones.

3. **Inline style specificity.** `playback.js` writes `el.style.fill`, `el.style.stroke`, etc. onto live SVG elements. Export modules (exportManager.js, gifExport.js) must clear those before applying presentation attributes on clones, or exports silently show wrong colours. The constant:
   ```js
   const MANAGED_CSS_PROPS = ['fill','stroke','stroke-width','opacity','visibility','display'];
   ```
   marks exactly which properties need clearing.

## Config schema
Stored in `localStorage` and exported/imported as JSON. `config.image` is the **full SVG markup string** — not a URL.

```js
{
  id: string,
  image: string,                  // raw SVG text
  transitionDuration: number,     // milliseconds (default 600)
  transitions: [{
    id: string,
    name: string,
    shapes: [{
      id: string,                 // shape key (see below)
      properties: {
        fill, stroke, strokeWidth, opacity, visibility, display
      }
    }],
    annotations: [{
      tipX, tipY,                 // SVG coords for arrowhead
      labelX, labelY,             // SVG coords for text
      label: string
    }]
  }]
}
```

## Shape keying
- SVG elements **with** an `id` attribute → key = that `id` value.
- SVG elements **without** an `id` → key = `tagName-N` where N increments per tag type in document order (e.g., `rect-1`, `g-2`).
- This key is the link between `App.shapes` (Map), `transition.shapes[].id`, and export clone maps. Any mismatch silently drops overrides.
- Elements inside `defs, clipPath, mask, marker, pattern, symbol` are excluded from the registry.

## Adding a new JS module
1. Write the file as an IIFE in `js/`.
2. Add a `<script src="js/yourModule.js" defer></script>` to `index.html` **in the correct dependency order** — after any module whose `window.App.*` API you call.
3. If you need to expose a function to other modules, attach it to `window.App` (immediately if no DOM needed, otherwise inside `DOMContentLoaded`).
4. Do **not** use `import`/`export` syntax.

## App events and modes

Valid `App.on()` event names (any other value throws at runtime):
- `onModeChange` — fires with `'edit'` or `'play'`
- `onSVGLoad` — fires with the live `<svg>` element
- `onStateChange` — fires with `{ id: activeStateId }`
- `onConfigUpdate` — fires with the full config object

Valid `App.switchMode()` values: `'edit'`, `'play'` (throws on anything else).

CSS body classes driven by mode: `mode-edit`, `mode-play`, `svg-loaded` (separate, controls toolbar visibility).

## External libraries (CDN, loaded as blocking scripts in `<head>`)
| Library | Version | Global |
|---|---|---|
| jsPDF | 2.5.1 | `window.jspdf` |
| pptxgenjs | 3.12.0 | `window.PptxGenJS` |
| gifenc | 1.0.3 | `window.gifenc` (loaded as ESM `import *` then assigned) |

These must be globals before deferred scripts run. Do not move them to `defer` or `type="module"`.

## Annotations
- All annotation ink is amber `#f59e0b` (defined in `annotationLayer.js`).
- Rendered as a `<g id="af-annotation-layer">` injected into the live SVG; arrowhead marker uses `<marker id="af-arrowhead">`.
- Stored per-transition in `transition.annotations[]`.

## Plans directory
`/plans/<YYYY-MM-DD>-<feature-slug>/ROADMAP.md` — used by the Build Orchestrator to track multi-phase work. When starting a new feature, the orchestrator creates this file first and resumes from it on re-entry.
