/**
 * ArchFlow — annotationLayer.js
 * Manages inline SVG annotation rendering: injects a persistent <defs> arrowhead
 * marker and a <g id="af-annotation-layer"> group into the live SVG, then exposes
 * render(annotations) / clear() to draw or wipe per-transition arrow+label pairs.
 * Attaches to App.annotationLayer on DOMContentLoaded.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Amber/gold brand colour used for all annotation ink.
  const ANNOTATION_COLOUR = '#f59e0b';

  // ─── Private state ──────────────────────────────────────────────────────────

  /** @type {SVGGElement|null} The live <g id="af-annotation-layer"> element. */
  let annotationLayerGroup = null;

  // ─── SVG setup ──────────────────────────────────────────────────────────────

  /**
   * Ensure the SVG <defs> block contains the af-arrowhead marker.
   * Creates <defs> if absent; skips injection when the marker already exists.
   * @param {SVGSVGElement} svgEl
   */
  function ensureArrowheadMarker(svgEl) {
    let defs = svgEl.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'defs');
      svgEl.insertBefore(defs, svgEl.firstChild);
    }

    if (defs.querySelector('#af-arrowhead')) return;

    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id',           'af-arrowhead');
    marker.setAttribute('markerWidth',  '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX',         '7');
    marker.setAttribute('refY',         '3');
    marker.setAttribute('orient',       'auto');
    marker.setAttribute('markerUnits',  'strokeWidth');

    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', '0 0, 8 3, 0 6');
    polygon.setAttribute('fill',   ANNOTATION_COLOUR);

    marker.appendChild(polygon);
    defs.appendChild(marker);
  }

  /**
   * Ensure a <g id="af-annotation-layer"> exists as the last child of the SVG.
   * Creates and appends it when absent; clears its children when already present.
   * @param {SVGSVGElement} svgEl
   * @returns {SVGGElement}
   */
  function ensureAnnotationLayerGroup(svgEl) {
    let group = svgEl.querySelector('#af-annotation-layer');

    if (group) {
      group.innerHTML = '';
      // Re-append to guarantee it is the last child (on top of all other elements).
      svgEl.appendChild(group);
      return group;
    }

    group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('id', 'af-annotation-layer');
    svgEl.appendChild(group);
    return group;
  }

  // ─── SVG load hook ──────────────────────────────────────────────────────────

  /**
   * Called when a new SVG is loaded into #svg-host.
   * Bootstraps <defs> + arrowhead marker and the annotation layer group.
   * @param {SVGSVGElement} svgEl
   */
  function onSVGLoad(svgEl) {
    if (!svgEl) {
      console.error('ArchFlow annotationLayer: onSVGLoad received a falsy svgEl');
      return;
    }

    ensureArrowheadMarker(svgEl);
    annotationLayerGroup = ensureAnnotationLayerGroup(svgEl);
  }

  // ─── Annotation rendering helpers ───────────────────────────────────────────

  /**
   * Return true when the annotation object carries the minimum required fields.
   * @param {Object} annotation
   * @returns {boolean}
   */
  function isValidAnnotation(annotation) {
    if (!annotation || typeof annotation !== 'object') return false;
    if (!annotation.id || typeof annotation.text !== 'string') return false;
    if (annotation.labelX == null || annotation.labelY == null) return false;

    const arrow = annotation.arrow;
    if (!arrow || typeof arrow !== 'object') return false;
    if (arrow.fromX == null || arrow.fromY == null) return false;
    if (arrow.toX   == null || arrow.toY   == null) return false;

    return true;
  }

  /**
   * Create and return an SVG <line> element representing the annotation arrow.
   * @param {Object} annotation
   * @returns {SVGLineElement}
   */
  function createArrowLine(annotation) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1',           String(annotation.arrow.fromX));
    line.setAttribute('y1',           String(annotation.arrow.fromY));
    line.setAttribute('x2',           String(annotation.arrow.toX));
    line.setAttribute('y2',           String(annotation.arrow.toY));
    line.setAttribute('stroke',       ANNOTATION_COLOUR);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('marker-end',   'url(#af-arrowhead)');
    line.setAttribute('class',        'af-annotation-arrow');
    line.setAttribute('data-annotation-id', String(annotation.id));
    return line;
  }

  /**
   * Compute an approximate background rect for the given text string.
   * Uses a fixed character-width heuristic; avoids layout queries so it
   * works before the elements are painted.
   * @param {string} text
   * @param {number} labelX   Centre x of the label.
   * @param {number} labelY   Centre y of the label.
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  function approximateLabelBbox(text, labelX, labelY) {
    const charWidth  = 6.8;   // px per character at font-size 12
    const lineHeight = 16;    // px — slightly taller than font-size 12
    const paddingX   = 6;
    const paddingY   = 3;

    const textWidth  = text.length * charWidth + paddingX * 2;
    const textHeight = lineHeight + paddingY * 2;

    return {
      x:      labelX - textWidth  / 2,
      y:      labelY - textHeight / 2,
      width:  textWidth,
      height: textHeight,
    };
  }

  /**
   * Create and return the background <rect> for a label.
   * @param {Object} annotation
   * @returns {SVGRectElement}
   */
  function createLabelBackground(annotation) {
    const bbox = approximateLabelBbox(annotation.text, annotation.labelX, annotation.labelY);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x',      String(bbox.x));
    rect.setAttribute('y',      String(bbox.y));
    rect.setAttribute('width',  String(bbox.width));
    rect.setAttribute('height', String(bbox.height));
    rect.setAttribute('fill',   'rgba(15,23,42,0.82)');
    rect.setAttribute('rx',     '3');
    rect.setAttribute('class',  'af-annotation-bg');
    return rect;
  }

  /**
   * Create and return the <text> element for a label.
   * @param {Object} annotation
   * @returns {SVGTextElement}
   */
  function createLabelText(annotation) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x',                  String(annotation.labelX));
    text.setAttribute('y',                  String(annotation.labelY));
    text.setAttribute('fill',               '#f1f5f9');
    text.setAttribute('font-size',          '12');
    text.setAttribute('font-family',        'DM Sans, sans-serif');
    text.setAttribute('text-anchor',        'middle');
    text.setAttribute('dominant-baseline',  'middle');
    text.setAttribute('class',              'af-annotation-label');
    text.setAttribute('data-annotation-id', String(annotation.id));
    text.textContent = annotation.text;
    return text;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Wipe and rebuild the annotation layer from the given array.
   * No-ops silently when no SVG is loaded or the layer group is absent.
   * @param {Array<Object>} annotations  Array of annotation objects to render.
   */
  function render(annotations) {
    if (!annotationLayerGroup) return;

    annotationLayerGroup.innerHTML = '';

    if (!Array.isArray(annotations)) return;

    annotations.forEach(function (annotation) {
      if (!isValidAnnotation(annotation)) return;

      annotationLayerGroup.appendChild(createArrowLine(annotation));
      annotationLayerGroup.appendChild(createLabelBackground(annotation));
      annotationLayerGroup.appendChild(createLabelText(annotation));
    });
  }

  /**
   * Wipe all children from the annotation layer group.
   * No-ops silently when no SVG is loaded or the layer group is absent.
   */
  function clear() {
    if (!annotationLayerGroup) return;
    annotationLayerGroup.innerHTML = '';
  }

  /**
   * Render annotations into any SVG element — for use by the export pipeline.
   * Does NOT touch the live DOM or module-level state; operates solely on svgEl.
   * @param {SVGSVGElement}  svgEl        Target SVG element to render into.
   * @param {Array<Object>}  annotations  Annotation objects to draw.
   */
  function renderInto(svgEl, annotations) {
    if (!svgEl || !(svgEl instanceof SVGElement)) {
      console.warn('ArchFlow annotationLayer.renderInto: svgEl must be an SVGElement');
      return;
    }

    const safeAnnotations = Array.isArray(annotations) ? annotations : [];

    ensureArrowheadMarker(svgEl);
    const group = ensureAnnotationLayerGroup(svgEl);

    safeAnnotations.forEach(function (annotation) {
      if (!isValidAnnotation(annotation)) return;

      group.appendChild(createArrowLine(annotation));
      group.appendChild(createLabelBackground(annotation));
      group.appendChild(createLabelText(annotation));
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.App) {
      console.error('ArchFlow annotationLayer: App not initialised — annotationLayer will not mount');
      return;
    }

    App.on('onSVGLoad', onSVGLoad);

    App.annotationLayer = { render, clear, renderInto };
  });
}());
