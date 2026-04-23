/* =============================================================================
   ArchFlow — js/zoom.js
   Pan-and-zoom controls for the SVG canvas.
   Exposes App.zoom ({ zoomIn, zoomOut, reset, getLevel }).
   Wires button clicks, canvas wheel events, and click-drag pan on DOMContentLoaded.
   ============================================================================= */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const MIN_ZOOM    = 0.25;
  const MAX_ZOOM    = 8.0;
  const STEP_FACTOR = 1.25;

  // ---------------------------------------------------------------------------
  // Mutable state
  // ---------------------------------------------------------------------------

  /** @type {number} Current zoom level; 1.0 = fit. Range: MIN_ZOOM – MAX_ZOOM. */
  let level = 1.0;

  /** @type {number} Current horizontal pan offset in CSS pixels. */
  let panX = 0;
  /** @type {number} Current vertical pan offset in CSS pixels. */
  let panY = 0;
  /** @type {boolean} True while the user is actively dragging. */
  let isDragging = false;
  /** @type {number} Drag anchor X — stores (clientX − panX) at mousedown. */
  let dragAnchorX = 0;
  /** @type {number} Drag anchor Y — stores (clientY − panY) at mousedown. */
  let dragAnchorY = 0;

  /**
   * Module-level reference to #canvas-container so reset() can remove .is-panning
   * even when called outside the DOMContentLoaded closure (e.g. during a reload-
   * while-dragging scenario where endDrag early-returns because isDragging is false).
   * @type {HTMLElement|null}
   */
  let canvasContainer = null;

  /**
   * Clamp bounds captured at mousedown to avoid per-frame DOM queries / layout
   * reflows on the hot mousemove path.
   * @type {{maxX: number, maxY: number}|null}
   */
  let dragCache = null;

  // ---------------------------------------------------------------------------
  // Transform application — single writer of transform-related DOM state
  // ---------------------------------------------------------------------------

  /**
   * Applies the current zoom level and pan offsets to the SVG element and
   * updates the zoom-level display.
   * This is the ONLY function that writes `svgEl.style.transform`.
   * Only writes `transform` and `transformOrigin` — never touches the sizing
   * styles set by svgLoader.js (max-width, max-height, width, height, display).
   * No-ops silently when no SVG has been loaded yet.
   */
  function applyTransform() {
    const svgEl = document.querySelector('#svg-host > svg');
    if (!svgEl) return;   // guard: no SVG in the host yet — nothing to transform

    clampPan();   // ensure panX/panY are within bounds before writing transform

    svgEl.style.transform       = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + level + ')';
    svgEl.style.transformOrigin = '50% 50%';

    const svgHostEl = document.getElementById('svg-host');
    if (svgHostEl) {
      // Allow the scaled SVG to overflow its flex container when zoomed in;
      // revert to default (hidden, set by CSS) when at or below fit level.
      svgHostEl.style.overflow = level > 1 ? 'visible' : '';
    }

    if (canvasContainer) {
      canvasContainer.classList.toggle('is-pannable', level > 1);
    }

    const zoomDisplay = document.getElementById('zoom-level-display');
    if (zoomDisplay) {
      zoomDisplay.textContent = Math.round(level * 100) + '%';
    }

    // If a wheel zoom-out mid-drag brings the level back to fit, terminate the
    // drag cleanly here — zoomOut() itself has no visibility into drag state.
    if (level <= 1 && isDragging) {
      isDragging = false;
      if (canvasContainer) canvasContainer.classList.remove('is-panning');
    }
  }

  // ---------------------------------------------------------------------------
  // Pan helpers — private, not exposed on window.App.zoom
  // ---------------------------------------------------------------------------

  /**
   * Clamps panX/panY so the SVG always overlaps the canvas viewport by at
   * least half of the viewport dimension on each axis.
   * No-ops silently when required elements are absent or SVG is not zoomed.
   */
  function clampPan() {
    if (level <= 1) { panX = 0; panY = 0; return; }
    const svgEl    = document.querySelector('#svg-host > svg');
    const canvasEl = document.getElementById('canvas-container');
    if (!svgEl || !canvasEl) return;

    const containerW = canvasEl.clientWidth;
    const containerH = canvasEl.clientHeight;
    const scaledW    = svgEl.clientWidth  * level;
    const scaledH    = svgEl.clientHeight * level;
    const maxX       = Math.max(0, (scaledW - containerW) / 2);
    const maxY       = Math.max(0, (scaledH - containerH) / 2);

    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  /**
   * Zeroes the pan offset and re-applies the combined transform.
   * Always call this instead of manually mutating panX/panY to zero.
   */
  function resetPan() {
    panX = 0;
    panY = 0;
    applyTransform();
  }

  // ---------------------------------------------------------------------------
  // Public controls
  // ---------------------------------------------------------------------------

  /**
   * Increases zoom level by STEP_FACTOR, clamped to MAX_ZOOM, then applies.
   */
  function zoomIn() {
    level = Math.min(MAX_ZOOM, level * STEP_FACTOR);
    applyTransform();
  }

  /**
   * Decreases zoom level by STEP_FACTOR, clamped to MIN_ZOOM, then applies.
   */
  function zoomOut() {
    level = Math.max(MIN_ZOOM, level / STEP_FACTOR);
    applyTransform();
  }

  /**
   * Resets zoom level to 1.0 (fit), clears drag state, and zeroes pan.
   * resetPan() internally calls applyTransform() — no separate call needed.
   */
  function reset() {
    level      = 1.0;
    isDragging = false;
    if (canvasContainer) canvasContainer.classList.remove('is-panning');
    resetPan();   // zeroes pan and calls applyTransform()
  }

  /**
   * Returns the current zoom level.
   * @return {number}
   */
  function getLevel() {
    return level;
  }

  // ---------------------------------------------------------------------------
  // Drag handlers — named functions so removeEventListener can correctly detach
  // ---------------------------------------------------------------------------

  /**
   * Moves the SVG pan position in response to pointer movement during an active drag.
   * Guards against stale state (isDragging can become false via applyTransform mid-drag)
   * and delegates cleanup to onDragEnd in that case.
   */
  function onDragMove(e) {
    if (!isDragging) { onDragEnd(); return; }
    panX = e.clientX - dragAnchorX;
    panY = e.clientY - dragAnchorY;
    if (dragCache) {
      panX = Math.max(-dragCache.maxX, Math.min(dragCache.maxX, panX));
      panY = Math.max(-dragCache.maxY, Math.min(dragCache.maxY, panY));
    }
    const svgEl = document.querySelector('#svg-host > svg');
    // Performance: use cached clamp bounds; write transform directly to avoid full applyTransform overhead during drag
    if (svgEl) svgEl.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + level + ')';
  }

  /**
   * Terminates the active drag gesture and detaches the document-level listeners
   * that were installed at mousedown.
   */
  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    dragCache  = null;
    if (canvasContainer) canvasContainer.classList.remove('is-panning');
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup',   onDragEnd);
  }

  // ---------------------------------------------------------------------------
  // DOM wiring — runs on DOMContentLoaded
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    // Assign to module-level var first so reset() and applyTransform() can use it
    canvasContainer = document.getElementById('canvas-container');

    const btnZoomIn    = document.getElementById('btn-zoom-in');
    const btnZoomOut   = document.getElementById('btn-zoom-out');
    const btnZoomReset = document.getElementById('btn-zoom-reset');

    if (!btnZoomIn || !btnZoomOut || !btnZoomReset || !canvasContainer) {
      console.warn(
        'ArchFlow zoom.js: one or more required elements not found — ' +
        'zoom controls will not be active. ' +
        'Expected: #btn-zoom-in, #btn-zoom-out, #btn-zoom-reset, #canvas-container'
      );
      return;
    }

    btnZoomIn.addEventListener('click',    zoomIn);
    btnZoomOut.addEventListener('click',   zoomOut);
    btnZoomReset.addEventListener('click', reset);

    // Wheel zoom on the canvas — must be non-passive to call preventDefault()
    canvasContainer.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    }, { passive: false });

    // Click-and-drag pan — only active when level > 1.
    // Drag handlers are attached to document so gestures survive the pointer
    // leaving the container edge (eliminates the old mouseleave safety-net need).
    canvasContainer.addEventListener('mousedown', function (e) {
      if (level <= 1) return;
      if (e.button !== 0) return;   // left button only

      // Cache clamp bounds at drag start — avoids per-frame DOM queries and
      // layout reflows on the hot mousemove path (M3 fix).
      const svgEl      = document.querySelector('#svg-host > svg');
      const containerW = canvasContainer.clientWidth;
      const containerH = canvasContainer.clientHeight;
      dragCache = svgEl
        ? {
            maxX: Math.max(0, (svgEl.clientWidth  * level - containerW) / 2),
            maxY: Math.max(0, (svgEl.clientHeight * level - containerH) / 2),
          }
        : { maxX: 0, maxY: 0 };

      isDragging  = true;
      dragAnchorX = e.clientX - panX;
      dragAnchorY = e.clientY - panY;
      canvasContainer.classList.add('is-panning');

      // Attach drag handlers to document for the duration of this gesture
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragEnd);
    });

    // Reset zoom (and pan, via resetPan inside reset()) whenever a new SVG is loaded
    window.App.on('onSVGLoad', function () {
      reset();
      var widget = document.getElementById('zoom-widget');
      if (widget) widget.hidden = false;
    });

    // Hide the widget when SVG is unloaded (e.g. resetProject); reset clears pan too
    window.App.on('onConfigUpdate', function (config) {
      if (!config.image) {
        var widget = document.getElementById('zoom-widget');
        if (widget) widget.hidden = true;
        reset();
      }
    });

    window.App.zoom = {
      zoomIn:   zoomIn,
      zoomOut:  zoomOut,
      reset:    reset,
      getLevel: getLevel,
    };
  });

})();
