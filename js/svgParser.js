/* =============================================================================
   ArchFlow — js/svgParser.js
   SVG DOM walker — identifies all shape elements and builds App.shapes registry.
   Attaches App.parseSVG immediately (no DOM access required at definition time).
   ============================================================================= */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /**
   * SVG element tag names that qualify as "shapes" worth tracking.
   * Includes <g> so grouped layers are also represented in the shape list.
   */
  const SHAPE_TAGS = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text', 'g'];

  const SHAPE_TAGS_SELECTOR = SHAPE_TAGS.join(',');

  // ---------------------------------------------------------------------------
  // Baseline capture
  // ---------------------------------------------------------------------------

  /**
   * Reads a single visual property from an SVG element.
   * Prefers the presentation attribute; falls back to computed style.
   * @param  {SVGElement} el
   * @param  {string}     attributeName  e.g. 'fill', 'stroke-width'
   * @param  {string}     cssProperty    e.g. 'fill', 'strokeWidth'
   * @return {string}
   */
  function resolveVisualProperty(el, attributeName, cssProperty) {
    const attributeValue = el.getAttribute(attributeName);
    if (attributeValue !== null && attributeValue !== '') return attributeValue;
    return getComputedStyle(el).getPropertyValue(attributeName) ||
           getComputedStyle(el)[cssProperty]                    ||
           '';
  }

  /**
   * Snapshots the visual state of an element at parse time.
   * Stored so transitions can restore the baseline after playback.
   * @param  {SVGElement} el
   * @return {{ fill, stroke, strokeWidth, opacity, visibility, display }}
   */
  function captureBaseline(el) {
    return {
      fill:        resolveVisualProperty(el, 'fill',         'fill'),
      stroke:      resolveVisualProperty(el, 'stroke',       'stroke'),
      strokeWidth: resolveVisualProperty(el, 'stroke-width', 'strokeWidth'),
      opacity:     resolveVisualProperty(el, 'opacity',      'opacity'),
      visibility:  resolveVisualProperty(el, 'visibility',   'visibility'),
      display:     resolveVisualProperty(el, 'display',      'display'),
    };
  }

  // ---------------------------------------------------------------------------
  // Tree walking
  // ---------------------------------------------------------------------------

  /**
   * Collects every shape element inside svgEl and builds ShapeRecord objects.
   *
   * Auto-numbering: elements without an id get a key of the form 'tagName-N'
   * where N increments per tag type (rect-1, rect-2, g-1, …).
   *
   * @param  {SVGSVGElement} svgEl
   * @param  {Map<string, number>} tagCounters  Mutable counter per tag name
   * @return {Array<ShapeRecord>}
   */
  function walkSVGTree(svgEl, tagCounters) {
    const foundElements = svgEl.querySelectorAll(SHAPE_TAGS_SELECTOR);
    const shapeRecords  = [];

    foundElements.forEach(function (el) {
      // Skip elements inside non-presentational containers
      if (el.closest('defs, clipPath, mask, marker, pattern, symbol')) return;

      const tag      = el.tagName.toLowerCase();
      const trimmedId = (el.id || '').trim();

      let shapeKey;
      let shapeLabel;

      if (trimmedId) {
        shapeKey   = trimmedId;
        shapeLabel = trimmedId;
      } else {
        const previousCount = tagCounters.get(tag) || 0;
        const currentCount  = previousCount + 1;
        tagCounters.set(tag, currentCount);

        shapeKey   = tag + '-' + currentCount;
        shapeLabel = tag + ' #' + currentCount;
      }

      /** @type {ShapeRecord} */
      const shapeRecord = {
        key:      shapeKey,
        el:       el,
        tag:      tag,
        label:    shapeLabel,
        baseline: captureBaseline(el),
      };

      shapeRecords.push(shapeRecord);
    });

    return shapeRecords;
  }

  // ---------------------------------------------------------------------------
  // Main parse function
  // ---------------------------------------------------------------------------

  /**
   * Walks the SVG DOM, rebuilds App.shapes, and triggers any dependent renders.
   * @param  {SVGSVGElement} svgEl  The live SVG element inside #svg-host
   * @return {Map<string, ShapeRecord>}  The populated shapes Map
   */
  function parseSVG(svgEl) {
    if (!svgEl) {
      throw new Error('App.parseSVG: svgEl is required');
    }

    // Clear the existing registry before rebuilding
    window.App.shapes.clear();

    const tagCounters  = new Map();
    const shapeRecords = walkSVGTree(svgEl, tagCounters);

    shapeRecords.forEach(function (record) {
      window.App.shapes.set(record.key, record);
    });

    // Notify the shape-list panel if it exists and is ready to render
    if (
      window.App.panels &&
      window.App.panels.shapeList &&
      typeof window.App.panels.shapeList.render === 'function'
    ) {
      window.App.panels.shapeList.render();
    }

    return window.App.shapes;
  }

  // ---------------------------------------------------------------------------
  // Attach to App namespace (no DOM access required — set immediately)
  // ---------------------------------------------------------------------------

  window.App.parseSVG = parseSVG;

})();
