# ArchFlow

**ArchFlow** is a browser-based presentation tool for SVG architecture diagrams. Upload any SVG, define named transition states with per-shape visual overrides, then play through them as an animated sequence — or export to PPTX, PDF, or GIF.

No install. No server. No build step. Open `index.html` in any modern browser, including directly from the filesystem.

---

## Getting started

1. Download or clone the repository.
2. Open `index.html` in a modern browser (Chrome, Firefox, Edge, Safari).
3. Click **Choose SVG File** on the welcome screen and select an SVG diagram.

That's it. Your last session is automatically restored the next time you open the file.

---

## Core workflow

ArchFlow has two modes, toggled from the header: **Edit** and **Play**.

### Edit mode

After loading an SVG:

- A **Shape List** panel lists every shape in the diagram. Shapes that have an `id` in the SVG source show that id; unnamed shapes are labelled by type and position (e.g. `rect #1`, `g #2`).
- Click any shape in the list — or click directly on the diagram — to select it. The **Property Editor** panel opens, showing the current fill, stroke, stroke width, opacity, and visibility for that shape.
- Changes in the Property Editor apply only to the **active transition state** (shown in the tab strip at the bottom of the screen). Other states are unaffected.
- **Multi-select:** hold Ctrl (or Cmd on Mac) and click additional shapes in the Shape List to edit their shared properties simultaneously.

### Transition states

Each state is an independent snapshot of property overrides layered on top of the baseline SVG.

- Click **＋ State** in the toolbar to add a new state.
- Click a tab to switch to it. The diagram updates immediately to show that state's overrides.
- **Double-click** a tab to rename it.
- Click **✕** on a tab to delete it. The last remaining state cannot be deleted.
- The **⏱ transition duration slider** (100 ms – 3 000 ms, default 600 ms) controls how long animated transitions take between states.

### Play mode

Switch to Play mode (header button or press `P`) to present the sequence:

- The **playback bar** appears at the bottom: ◀ previous, ▶ play/pause, ▶▶ next, and a progress bar.
- Auto-play advances one state at a time, pausing for `transition duration + 500 ms` before moving on.
- State tabs stay visible — click any tab to jump directly to that state.
- Press `Space` to play/pause; `←` / `→` to step through states manually.

---

## Annotations

Annotations draw an amber arrow and label directly onto the diagram, per state.

1. In Edit mode, click the **✎ Annotate** button in the toolbar.
2. Click on the diagram where you want the **arrowhead** to point.
3. Click a second position for the **label**.
4. Type the label text and press Enter.

Annotations are visible in both Edit and Play mode and are included in all exports. An **Annotations panel** lists every annotation for the active state; items can be deleted from there.

---

## Saving and loading

ArchFlow auto-saves your entire session to browser localStorage after every change. Your work is restored automatically the next time you open the file.

For longer-term storage or sharing:

| Action | How |
|--------|-----|
| **Export Config** | Click **Export Config** in the header. Downloads `archflow-config.json` — a self-contained JSON file that includes the SVG source and all states. |
| **Load Config** | Click **Load Config** and select a previously exported `.json` file to restore a session. |
| **New** | Click **⊕ New** to clear the current project and start fresh. A confirmation dialog appears if there is unsaved content. |

Config files are plain JSON and can be version-controlled or shared with others.

---

## Export

Export the full transition sequence from the header:

### PPTX
Generates a PowerPoint file with one slide per transition state. Each slide is a PNG rendering of the diagram at that state.

### PDF
Generates a PDF with one page per transition state.

### GIF
Opens a settings dialog before rendering:

| Setting | Options | Default |
|---------|---------|---------|
| Frames per second | 5, 10, 12, 15, 24 | 12 fps |
| Hold duration | 0 – 5 000 ms | 500 ms |
| Loop | Infinite, Once, 3× | Infinite |
| Scale | 0.5×, 1×, 2× | 1× |

Click **Export GIF** to start rendering. A progress bar shows completion across all frames.

---

## Zoom and pan

| Action | Result |
|--------|--------|
| Scroll wheel | Zoom in / out (25 % – 800 %) |
| Click and drag on canvas | Pan |
| **−** / **+** buttons (bottom-right) | Step zoom out / in |
| **⊡** button | Reset zoom to fit |

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `E` | Switch to Edit mode |
| `P` | Switch to Play mode |
| `Space` | Play / Pause |
| `→` | Next state |
| `←` | Previous state |
| `?` | Toggle keyboard shortcut reference |

Shortcuts are disabled when focus is inside a text input, textarea, or select element.

---

## Tips

- **Name your SVG elements.** Give important shapes an `id` attribute in your SVG source (e.g. `id="database"`, `id="api-layer"`). ArchFlow uses the `id` as the shape key — named shapes produce cleaner state configs and survive SVG edits better than the auto-numbered fallbacks.
- **Config files are portable.** The exported JSON embeds the full SVG markup, so a single `.json` file is everything needed to restore the session on any machine.
- **Replacing the SVG.** Click the **📁 SVG** button in the Edit toolbar to swap in a new SVG without losing your transition states — as long as shape `id`s are preserved, existing overrides remain valid.
- **Panel positions** (Shape List, Property Editor, Annotations) are saved to localStorage and restored between sessions.
- **Offline.** ArchFlow loads fonts and export libraries from CDN on first use. Once those assets are cached by the browser, the app works fully offline.
