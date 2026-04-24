/**
 * ArchFlow — exportManager.js
 * Renders each transition state to PNG, then packages them into PPTX or PDF.
 * Provides a progress modal UI during multi-state exports.
 */
(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────

  /**
   * Must exactly match svgParser.js — determines which elements are shapes.
   */
  const SHAPE_TAGS = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text', 'g'];
  const SHAPE_TAGS_SELECTOR    = SHAPE_TAGS.join(',');
  const NON_PRESENTATIONAL_CONTAINERS = 'defs, clipPath, mask, marker, pattern, symbol';

  /**
   * CSS properties managed by playback/baselines.
   * Cleared from inline styles before applying presentation attributes so that
   * el.setAttribute(...) wins over any residual el.style.* set by playback.js.
   */
  const MANAGED_CSS_PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'visibility', 'display'];

  /**
   * XML namespace URI for the xlink namespace — used when reading/writing
   * xlink:href attributes on SVG elements.
   */
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  // ─── Clone key algorithm ────────────────────────────────────────────────────
  // Must mirror svgParser.js walkSVGTree exactly so keys resolve to the same
  // elements across both the live registry and the exported clone.

  /**
   * Build a Map<shapeKey, clonedElement> from a cloned SVG, using the identical
   * keying algorithm that svgParser.js applies to the live document.
   *
   * @param  {SVGSVGElement} clonedSvg
   * @returns {Map<string, SVGElement>}
   */
  function buildCloneKeyMap(clonedSvg) {
    const foundElements = clonedSvg.querySelectorAll(SHAPE_TAGS_SELECTOR);
    const tagCounters   = new Map();
    const cloneKeyMap   = new Map();

    foundElements.forEach(function (el) {
      if (el.closest(NON_PRESENTATIONAL_CONTAINERS)) return;

      const tag       = el.tagName.toLowerCase();
      const trimmedId = (el.id || '').trim();

      let shapeKey;
      if (trimmedId) {
        shapeKey = trimmedId;
      } else {
        const previousCount = tagCounters.get(tag) || 0;
        const currentCount  = previousCount + 1;
        tagCounters.set(tag, currentCount);
        shapeKey = tag + '-' + currentCount;
      }

      cloneKeyMap.set(shapeKey, el);
    });

    return cloneKeyMap;
  }

  // ─── SVG dimension resolver ─────────────────────────────────────────────────

  /**
   * Resolve the pixel dimensions to use for the export canvas.
   * Priority: viewBox (w, h) → width/height attrs → 800×600 fallback.
   *
   * @param  {SVGSVGElement} svgEl
   * @returns {{ width: number, height: number }}
   */
  function resolveSVGDimensions(svgEl) {
    if (!svgEl) return { width: 800, height: 600 };

    const viewBoxAttr = svgEl.getAttribute('viewBox');
    if (viewBoxAttr) {
      const parts = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(isFinite) && parts[2] > 0 && parts[3] > 0) {
        return { width: parts[2], height: parts[3] };
      }
    }

    const parsedWidth  = parseFloat(svgEl.getAttribute('width'));
    const parsedHeight = parseFloat(svgEl.getAttribute('height'));
    if (isFinite(parsedWidth) && isFinite(parsedHeight) && parsedWidth > 0 && parsedHeight > 0) {
      return { width: parsedWidth, height: parsedHeight };
    }

    return { width: 800, height: 600 };
  }

  // ─── Presentation attribute writer ─────────────────────────────────────────

  /**
   * Apply a set of visual properties to a cloned SVG element as presentation
   * attributes (not el.style.*), so XMLSerializer captures them correctly.
   * Only sets attributes whose values are non-null and non-empty strings.
   *
   * @param {SVGElement} el
   * @param {{ fill?, stroke?, strokeWidth?, opacity?, visibility?, display? }} props
   */
  function applyPropertiesAsAttributes(el, props) {
    if (!el || !props) return;

    if (props.fill        != null && props.fill        !== '') el.setAttribute('fill',         String(props.fill));
    if (props.stroke      != null && props.stroke      !== '') el.setAttribute('stroke',       String(props.stroke));
    if (props.strokeWidth != null && props.strokeWidth !== '') el.setAttribute('stroke-width', String(props.strokeWidth));
    if (props.opacity     != null && props.opacity     !== '') el.setAttribute('opacity',      String(props.opacity));
    if (props.visibility  != null && props.visibility  !== '') el.setAttribute('visibility',   String(props.visibility));
    if (props.display     != null && props.display     !== '') el.setAttribute('display',      String(props.display));
  }

  // ─── Yield helper ───────────────────────────────────────────────────────────

  /**
   * Yield control to the browser event loop so the progress modal can repaint
   * between state renders.
   * @returns {Promise<void>}
   */
  function yieldToUI() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  // ─── Canvas-taint prevention helpers ───────────────────────────────────────

  /**
   * Convert a Blob to a base64 data URL using FileReader.
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload  = function (e) { resolve(e.target.result); };
      reader.onerror = function ()  { reject(new Error('ArchFlow exportManager: FileReader failed during blob conversion')); };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Replace every external http/https href on <image> elements with an inlined
   * base64 data URI, preventing canvas tainting.
   *
   * If a resource cannot be fetched (network error, CORS block) the <image>
   * element is removed so the export can still complete — a warning is logged.
   *
   * @param {SVGSVGElement} clonedSvg
   * @returns {Promise<void>}
   */
  async function inlineExternalImages(clonedSvg) {
    const imgEls   = Array.from(clonedSvg.querySelectorAll('image'));

    await Promise.all(imgEls.map(async function (imgEl) {
      const href = imgEl.getAttribute('href') ||
                   imgEl.getAttributeNS(XLINK_NS, 'href') || '';

      // Already a data URI or no href — nothing to do
      if (!href || href.startsWith('data:')) return;

      // Only handle absolute http/https or protocol-relative URLs; relative paths are safe inside a Blob
      if (!/^(https?:\/\/|\/\/)/i.test(href)) return;

      try {
        const response = await fetch(href, { mode: 'cors' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const blob    = await response.blob();
        const dataUrl = await blobToDataUrl(blob);

        imgEl.setAttribute('href', dataUrl);
        if (imgEl.hasAttributeNS(XLINK_NS, 'href')) {
          imgEl.removeAttributeNS(XLINK_NS, 'href');
        }
      } catch (fetchErr) {
        console.warn(
          'ArchFlow exportManager: could not inline external <image> (removing from export):',
          href, fetchErr.message
        );
        imgEl.remove();
      }
    }));
  }

  /**
   * Remove @font-face and @import rules from all <style> elements inside the
   * cloned SVG. These rules trigger cross-origin font fetches that taint the
   * canvas when the SVG is drawn via a Blob URL.
   *
   * @param {SVGSVGElement} clonedSvg
   */
  function stripExternalStyleRules(clonedSvg) {
    if (!clonedSvg) return;
    clonedSvg.querySelectorAll('style').forEach(function (styleEl) {
      let css = styleEl.textContent || '';

      // Remove @font-face { … } blocks (handles multi-line)
      css = css.replace(/@font-face\s*\{[^}]*\}/gi, '');

      // Remove @import statements
      css = css.replace(/@import\s+[^;]+;/gi, '');

      // Remove any rule containing an external url() reference (catches background-image, fill, etc.)
      css = css.replace(/[^{}]*\{[^}]*url\(\s*['"]?(https?:\/\/|\/\/)[^)'"]*['"]?\s*\)[^}]*\}/gi, '');

      styleEl.textContent = css;
    });
  }

  /**
   * Remove <use> elements whose href or xlink:href points to an external
   * resource (i.e. contains "://" or starts with "//") rather than a pure
   * in-document fragment like "#icon-name". External sprite references taint
   * the canvas when the SVG is rendered via a Blob URL.
   *
   * @param {SVGSVGElement} clonedSvg
   */
  function removeExternalUseRefs(clonedSvg) {
    if (!clonedSvg) return;
    clonedSvg.querySelectorAll('use').forEach(function (useEl) {
      const href = useEl.getAttribute('href') ||
                   useEl.getAttributeNS(XLINK_NS, 'href') || '';
      const isExternalRef = /^(https?:\/\/|\/\/)/.test(href) ||
                            (href.includes('://') && !href.startsWith('#'));
      if (isExternalRef) useEl.remove();
    });
  }

  /**
   * Remove <feImage> filter primitives whose href or xlink:href points to an
   * external resource. feImage elements that reference cross-origin URLs cause
   * canvas tainting when the SVG is drawn onto a canvas via a Blob URL.
   *
   * @param {SVGSVGElement} clonedSvg
   */
  function removeExternalFeImageRefs(clonedSvg) {
    if (!clonedSvg) return;
    clonedSvg.querySelectorAll('feImage').forEach(function (feEl) {
      const href = feEl.getAttribute('href') ||
                   feEl.getAttributeNS(XLINK_NS, 'href') || '';
      const isExternalRef = /^(https?:\/\/|\/\/)/.test(href) ||
                            (href.includes('://') && !href.startsWith('#'));
      if (isExternalRef) feEl.remove();
    });
  }

  /**
   * Replace external url(...) references inside inline style attributes with
   * "none" so the canvas renderer does not attempt to fetch cross-origin
   * resources. Operates only on style attributes (not on <style> elements —
   * those are handled by stripExternalStyleRules).
   *
   * @param {SVGSVGElement} clonedSvg
   */
  function sanitiseInlineStyleURLs(clonedSvg) {
    if (!clonedSvg) return;
    clonedSvg.querySelectorAll('[style]').forEach(function (el) {
      const styleValue = el.getAttribute('style') || '';
      if (!styleValue) return;
      const sanitised = styleValue.replace(
        /url\(\s*['"]?(https?:\/\/|\/\/)[^)'"]*['"]?\s*\)/gi,
        'none'
      );
      if (sanitised !== styleValue) el.setAttribute('style', sanitised);
    });
  }

  /**
   * Final string-level sweep of a serialised SVG string to remove any
   * external URL references that survived DOM-level sanitisation (e.g. those
   * produced by XMLSerializer namespace expansion or attributes on elements
   * not reachable via standard querySelector).
   *
   * Handles:
   *  - url('https://…') and url("https://…") in style values
   *  - xlink:href="https://…" and href="https://…" on any element
   *    (but preserves fragment-only refs like href="#foo")
   *
   * @param {string} svgString  The serialised SVG markup string.
   * @returns {string}          A sanitised copy with external refs neutralised.
   */
  function postSerialiseStringSanitise(svgString) {
    if (!svgString) return svgString;

    // Replace external url(...) values in style attributes / CSS text
    let result = svgString.replace(
      /url\(\s*(['"]?)(https?:\/\/|\/\/)[^)'"]*\1\s*\)/gi,
      'url($1none$1)'
    );

    // Remove xlink:href="https://…" or xlink:href="//…" attributes (leave fragment refs intact)
    result = result.replace(
      /\s+xlink:href=["'](https?:\/\/|\/\/)[^"']*["']/gi,
      ''
    );

    // Remove href="https://…" or href="//…" attributes that are not fragment-only
    result = result.replace(
      /(\s+href=["'])(https?:\/\/|\/\/)[^"']*(?=["'])/gi,
      '$1#removed'
    );

    return result;
  }

  // ─── SVG → PNG renderer ────────────────────────────────────────────────────

  /**
   * Render a single transition state to a PNG data URL.
   *
   * Pure async function — reads App state and produces an image with no
   * observable side effects on the live DOM.
   *
   * Algorithm:
 *  1. Clone `#svg-host > svg` with cloneNode(true)
 *  2. Walk clone to build Map<shapeKey, clonedEl> (mirrors svgParser.js)
 *  3. Clear managed inline-style properties from tracked shapes (so presentation
 *     attributes set in steps 4–5 are not overridden by playback.js residue)
 *  4. Apply App.shapes baselines via setAttribute
 *  5. Apply transition-specific overrides via setAttribute
 *  5.5 Render per-transition annotations into the clone via annotationLayer.renderInto
 *      (no-op when annotationLayer module is absent or transition has no annotations)
 *  6. Strip CSS transition declarations from all clone elements
 *  7. Strip all external resource references that would taint the canvas:
 *       a. stripExternalStyleRules — removes @font-face, @import, and external url() rules
 *       b. removeExternalUseRefs  — removes <use> elements with non-fragment external hrefs
 *       c. removeExternalFeImageRefs — removes <feImage> elements with external hrefs
 *       d. sanitiseInlineStyleURLs  — replaces external url() in inline style attributes
 *  8. Inline external <image> hrefs as base64 data URIs (prevents canvas tainting)
 *  9. Resolve canvas dimensions from viewBox / width+height attrs
 * 10. Serialise clone → postSerialiseStringSanitise → ensure xmlns → Blob URL → Image → Canvas → PNG
   *
   * @param  {string} stateId  ID of the transition state to render.
   * @returns {Promise<string>}  Resolves with a PNG data URL.
   */
  async function renderStateToPNG(stateId) {

    // ── Guards ────────────────────────────────────────────────────────────────

    if (!window.App) {
      throw new Error('renderStateToPNG: window.App is not initialised');
    }

    const transition = App.config.transitions.find(function (t) { return t.id === stateId; });
    if (!transition) {
      throw new Error('renderStateToPNG: unknown stateId "' + stateId + '"');
    }

    const svgHost = document.getElementById('svg-host');
    if (!svgHost) {
      throw new Error('renderStateToPNG: #svg-host element not found in DOM');
    }

    const liveSvg = svgHost.querySelector('svg');
    if (!liveSvg) {
      throw new Error('renderStateToPNG: no <svg> found inside #svg-host — load an SVG first');
    }

    // ── Step 1: Clone the live SVG ────────────────────────────────────────────

    const clone = liveSvg.cloneNode(true);

    // ── Step 2: Build shape-key → cloned-element map ──────────────────────────

    const cloneKeyMap = buildCloneKeyMap(clone);

    // ── Step 3: Clear managed inline-style properties ─────────────────────────
    // playback.js sets el.style.fill etc., which have higher CSS specificity
    // than presentation attributes. Removing them allows our setAttribute
    // calls in steps 4–5 to take effect correctly in the serialised SVG.

    App.shapes.forEach(function (record, key) {
      const clonedEl = cloneKeyMap.get(key);
      if (!clonedEl) return;
      MANAGED_CSS_PROPS.forEach(function (cssProp) {
        clonedEl.style.removeProperty(cssProp);
      });
    });

    // ── Step 4: Apply baselines as presentation attributes ────────────────────

    App.shapes.forEach(function (record, key) {
      const clonedEl = cloneKeyMap.get(key);
      if (!clonedEl) return;
      applyPropertiesAsAttributes(clonedEl, record.baseline);
    });

    // ── Step 5: Apply state overrides on top ──────────────────────────────────

    if (!Array.isArray(transition.shapes)) {
      throw new Error(
        'renderStateToPNG: transition "' + stateId + '" has no shapes array — config may be malformed'
      );
    }

    transition.shapes.forEach(function (shapeEntry) {
      const clonedEl = cloneKeyMap.get(shapeEntry.id);
      if (!clonedEl) return;
      applyPropertiesAsAttributes(clonedEl, shapeEntry.properties);
    });

    // ── Step 5.5: Render annotations into the clone ───────────────────────────
    // State overrides are already applied, so annotations are stamped on top of
    // the finalised shape state. This ensures annotations appear in the exported
    // PNG exactly as the user sees them in the live view.
    // Guard clause first — annotationLayer is an optional module whose load
    // order relative to exportManager is not guaranteed.

    if (App.annotationLayer && App.annotationLayer.renderInto) {
      App.annotationLayer.renderInto(clone, transition.annotations || []);
    }

    // ── Step 6: Strip CSS transition declarations from every cloned element ────

    clone.querySelectorAll('*').forEach(function (el) {
      const existingStyle = el.getAttribute('style') || '';
      if (!existingStyle) return;

      const retainedDeclarations = existingStyle
        .split(';')
        .map(function (decl) { return decl.trim(); })
        .filter(function (decl) { return decl !== '' && !/^transition\s*:/i.test(decl); });

      if (retainedDeclarations.length === 0) {
        el.removeAttribute('style');
      } else {
        el.setAttribute('style', retainedDeclarations.join('; '));
      }
    });

    // ── Step 7: Strip external CSS rules that would taint the canvas ──────────

    removeAllForeignObjects(clone);
    stripExternalStyleRules(clone);
    removeExternalUseRefs(clone);
    removeExternalFeImageRefs(clone);
    sanitiseInlineStyleURLs(clone);

    // ── Step 8: Inline external <image> hrefs to prevent canvas tainting ──────

    await inlineExternalImages(clone);

    // ── Step 9: Resolve canvas dimensions ────────────────────────────────────

    const dimensions   = resolveSVGDimensions(clone);
    const canvasWidth  = dimensions.width;
    const canvasHeight = dimensions.height;

    // ── Step 10: Serialise → ensure xmlns → Blob URL → Image → Canvas → PNG ──

    let svgString = new XMLSerializer().serializeToString(clone);
    svgString = postSerialiseStringSanitise(svgString);

    if (!svgString.includes('xmlns=')) {
      svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    return new Promise(function (resolve, reject) {
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(svgBlob);
      const img     = new Image();

      img.onload = function () {
        try {
          // Use document.createElement (NOT OffscreenCanvas) for file:// compat
          const canvas    = document.createElement('canvas');
          canvas.width    = canvasWidth;
          canvas.height   = canvasHeight;

          const ctx = canvas.getContext('2d');

          // Fill with white before drawing — prevents transparent SVG backgrounds
          // rendering as black in some PDF/PPTX viewers.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);

          ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

          URL.revokeObjectURL(blobUrl);
          resolve(canvas.toDataURL('image/png'));
        } catch (drawError) {
          URL.revokeObjectURL(blobUrl);
          reject(new Error(
            'renderStateToPNG: canvas draw failed for stateId "' + stateId + '": ' + drawError.message
          ));
        }
      };

      img.onerror = function () {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(
          'renderStateToPNG: failed to load serialised SVG as an image for stateId "' + stateId + '"'
        ));
      };

      img.src = blobUrl;
    });
  }

  // ─── Progress modal ─────────────────────────────────────────────────────────

  /**
   * Show the export progress modal, set its heading, and reset the bar to 0%.
   *
   * @param {string} label  Heading text, e.g. "Exporting as PowerPoint…"
   * @param {number} total  Total number of states (used for "0 / N" counter).
   */
  function showExportProgress(label, total) {
    const backdrop     = document.getElementById('export-modal-backdrop');
    const modal        = document.getElementById('export-modal');
    const modalLabel   = document.getElementById('export-modal-label');
    const progressFill = document.getElementById('export-progress-fill');
    const counter      = document.getElementById('export-progress-counter');

    if (!backdrop) return;

    if (modalLabel)   modalLabel.textContent   = label;
    if (progressFill) progressFill.style.width = '0%';
    if (counter)      counter.textContent      = '0 / ' + (total || 0);

    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    if (modal) modal.setAttribute('aria-hidden', 'false');

    // Add visibility classes on the next frame so the CSS transition fires
    // (hidden must be removed first so the element is rendered before animating)
    requestAnimationFrame(function () {
      backdrop.classList.add('modal-backdrop--visible');
      if (modal) modal.classList.add('modal-panel--visible');
    });
  }

  /**
   * Update the progress bar fill and counter to reflect completed work.
   *
   * @param {number} current  Number of states completed so far (1-based).
   * @param {number} total    Total number of states being exported.
   */
  function updateExportProgress(current, total) {
    const progressFill = document.getElementById('export-progress-fill');
    const counter      = document.getElementById('export-progress-counter');

    if (progressFill) progressFill.style.width = ((current / total) * 100) + '%';
    if (counter)      counter.textContent      = current + ' / ' + total;
  }

  /**
   * Hide the export progress modal with an exit animation.
   * Sets `hidden` after the 220 ms transition completes.
   */
  function hideExportProgress() {
    const backdrop = document.getElementById('export-modal-backdrop');
    const modal    = document.getElementById('export-modal');

    if (!backdrop) return;

    backdrop.classList.remove('modal-backdrop--visible');
    if (modal) modal.classList.remove('modal-panel--visible');

    setTimeout(function () {
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
      if (modal) modal.setAttribute('aria-hidden', 'true');
    }, 220);
  }

  // ─── PPTX export ────────────────────────────────────────────────────────────

  /**
   * Export all transition states as a wide-format PPTX file.
   *
   * Each state is rendered to PNG and added as a full-bleed slide image.
   * Requires PptxGenJS to be loaded on window before calling.
   *
   * @returns {Promise<void>}
   */
  async function exportPPTX() {
    if (!window.PptxGenJS) {
      throw new Error('ArchFlow exportManager: PptxGenJS is not available — ensure the CDN script loaded before exportManager.js.');
    }

    if (!window.App) {
      throw new Error('ArchFlow exportManager: window.App is not initialised');
    }

    const transitions = App.config.transitions;
    if (!transitions || transitions.length === 0) {
      throw new Error('ArchFlow exportManager: no transition states configured — nothing to export');
    }

    const pptx    = new PptxGenJS();
    pptx.layout   = 'LAYOUT_WIDE';

    // ── Resolve SVG dimensions for letterbox placement ────────────────────────
    // LAYOUT_WIDE is 13.33" × 7.5". Scale the SVG uniformly to fit inside the
    // slide on whichever axis constrains more (scale-to-fit), then centre the
    // result so it is letterboxed (landscape SVG) or pillarboxed (portrait SVG).
    const SLIDE_W_IN = 13.33;  // LAYOUT_WIDE width in inches
    const SLIDE_H_IN = 7.5;    // LAYOUT_WIDE height in inches

    const svgHost = document.getElementById('svg-host');
    const liveSvg = svgHost ? svgHost.querySelector('svg') : null;
    const svgDims = resolveSVGDimensions(liveSvg);

    const scale  = Math.min(SLIDE_W_IN / svgDims.width, SLIDE_H_IN / svgDims.height);
    const imgW   = svgDims.width  * scale;
    const imgH   = svgDims.height * scale;
    const imgX   = (SLIDE_W_IN - imgW) / 2;
    const imgY   = (SLIDE_H_IN - imgH) / 2;

    const total = transitions.length;

    for (let i = 0; i < total; i++) {
      const transition = transitions[i];
      const pngDataUrl = await renderStateToPNG(transition.id);

      const slide = pptx.addSlide();
      slide.addImage({ data: pngDataUrl, x: imgX, y: imgY, w: imgW, h: imgH });

      updateExportProgress(i + 1, total);
      await yieldToUI();
    }

    await pptx.writeFile({ fileName: 'archflow-states.pptx' });
  }

  // ─── PDF export ─────────────────────────────────────────────────────────────

  /**
   * Export all transition states as a multi-page PDF file.
   *
   * Page orientation is derived from the SVG viewBox dimensions.
   * Each state is rendered to PNG and added as a full-page image.
   * Requires jsPDF (window.jspdf.jsPDF) to be loaded before calling.
   *
   * @returns {Promise<void>}
   */
  async function exportPDF() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('ArchFlow exportManager: jsPDF is not available — ensure the CDN script loaded before exportManager.js.');
    }

    if (!window.App) {
      throw new Error('ArchFlow exportManager: window.App is not initialised');
    }

    const transitions = App.config.transitions;
    if (!transitions || transitions.length === 0) {
      throw new Error('ArchFlow exportManager: no transition states configured — nothing to export');
    }

    // Resolve SVG dimensions to set page orientation and format
    const svgHost    = document.getElementById('svg-host');
    const liveSvg    = svgHost ? svgHost.querySelector('svg') : null;
    const svgDims    = resolveSVGDimensions(liveSvg);
    const isLandscape = svgDims.width > svgDims.height;

    const jsPDF = window.jspdf.jsPDF;
    const doc   = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit:        'px',
      format:      [svgDims.width, svgDims.height],
    });

    // Use the page dimensions reported by jsPDF to fill each page exactly,
    // accounting for any internal unit scaling the library applies.
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const total = transitions.length;

    for (let i = 0; i < total; i++) {
      const transition = transitions[i];
      const pngDataUrl = await renderStateToPNG(transition.id);

      if (i > 0) {
        doc.addPage();
      }
      doc.addImage(pngDataUrl, 'PNG', 0, 0, pageW, pageH);

      updateExportProgress(i + 1, total);
      await yieldToUI();
    }

    doc.save('archflow-states.pdf');
  }

  /**
   * Remove all <foreignObject> elements from a cloned SVG.
   *
   * Any SVG drawn onto a canvas that contains a <foreignObject> element
   * unconditionally taints the canvas, regardless of the content inside it.
   * draw.io wraps <foreignObject> in a <switch> with a plain <text> fallback,
   * so removing the element causes the switch to degrade to the text label —
   * the export still renders legible content.
   *
   * @param {SVGSVGElement} clonedSvg
   */
  function removeAllForeignObjects(clonedSvg) {
    if (!clonedSvg) return;
    clonedSvg.querySelectorAll('foreignObject').forEach(function (el) {
      el.remove();
    });
  }

  // ─── Diagnostic helpers ─────────────────────────────────────────────────────

  /**
   * Trigger a browser download of an SVG string as a .svg file.
   * Uses a temporary <a> element; compatible with file:// origins.
   *
   * @param {string} svgString  The SVG markup to download.
   * @param {string} filename   The suggested filename (e.g. "raw-clone.svg").
   */
  function triggerSvgDownload(svgString, filename) {
    if (!svgString || !filename) return;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /**
   * Diagnostic helper: mirrors the sanitisation pipeline used by renderStateToPNG
   * and downloads two SVG files — the raw clone and the sanitised output — so
   * that any remaining cross-origin references causing canvas tainting can be
   * identified by inspecting the downloaded files.
   *
   * Also logs a structured console report of every suspicious URL-like pattern
   * that survives sanitisation, grouped by type.
   *
   * Usage from the browser console:
   *   App.export.dumpSanitisedSVG('your-state-id')
   *
   * @param  {string} stateId  The transition state ID to diagnose.
   * @returns {Promise<void>}
   */
  async function dumpSanitisedSVG(stateId) {
    if (!stateId) throw new Error('dumpSanitisedSVG: stateId is required');
    if (!window.App) throw new Error('dumpSanitisedSVG: window.App is not initialised');

    const svgHost = document.getElementById('svg-host');
    if (!svgHost) throw new Error('dumpSanitisedSVG: #svg-host not found');

    const liveSvg = svgHost.querySelector('svg');
    if (!liveSvg) throw new Error('dumpSanitisedSVG: no <svg> inside #svg-host — load an SVG first');

    // Step 1: Clone
    const clone = liveSvg.cloneNode(true);

    // Download the raw clone immediately, before any sanitisation
    let rawString = new XMLSerializer().serializeToString(clone);
    if (!rawString.includes('xmlns=')) {
      rawString = rawString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    triggerSvgDownload(rawString, 'archflow-raw-' + stateId + '.svg');
    console.info('ArchFlow dumpSanitisedSVG: raw clone downloaded as archflow-raw-' + stateId + '.svg');

    // Step 2: Run the full sanitisation pipeline (mirrors renderStateToPNG steps 6–8)
    // NOTE: state overrides (steps 3–5) and annotations (step 5.5) are intentionally
    // omitted here — this helper diagnoses sanitisation tainting only.
    // Strip CSS transition declarations (step 6)
    clone.querySelectorAll('*').forEach(function (el) {
      const existingStyle = el.getAttribute('style') || '';
      if (!existingStyle) return;
      const retained = existingStyle
        .split(';')
        .map(function (d) { return d.trim(); })
        .filter(function (d) { return d !== '' && !/^transition\s*:/i.test(d); });
      if (retained.length === 0) {
        el.removeAttribute('style');
      } else {
        el.setAttribute('style', retained.join('; '));
      }
    });

    // Step 7: DOM-level sanitisation
    removeAllForeignObjects(clone);
    stripExternalStyleRules(clone);
    removeExternalUseRefs(clone);
    removeExternalFeImageRefs(clone);
    sanitiseInlineStyleURLs(clone);

    // Step 8: Inline external <image> hrefs
    await inlineExternalImages(clone);

    // Step 9 / 10: Serialise and apply string-level safety net
    let sanitisedString = new XMLSerializer().serializeToString(clone);
    sanitisedString = postSerialiseStringSanitise(sanitisedString);
    if (!sanitisedString.includes('xmlns=')) {
      sanitisedString = sanitisedString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Download the sanitised SVG
    triggerSvgDownload(sanitisedString, 'archflow-sanitised-' + stateId + '.svg');
    console.info('ArchFlow dumpSanitisedSVG: sanitised SVG downloaded as archflow-sanitised-' + stateId + '.svg');

    // Step 3: Scan sanitised string for suspicious patterns and report to console
    var suspiciousFinds = [];

    var patterns = [
      { label: 'Absolute URLs (https?://)',  re: /https?:\/\/[^\s"'<>)\\]+/gi },
      { label: 'Protocol-relative URLs (//)', re: /(?<!=["'])\/\/[a-zA-Z][^\s"'<>)\\]*/g },
      { label: 'url() references',            re: /url\([^)]+\)/gi },
      { label: 'href= attributes',            re: /\shref=["'][^#"'][^"']*["']/gi },
      { label: 'xlink:href= attributes',      re: /xlink:href=["'][^"']+["']/gi },
      { label: 'src= attributes',             re: /\ssrc=["'][^"']+["']/gi },
    ];

    patterns.forEach(function (p) {
      var matches = sanitisedString.match(p.re);
      if (matches && matches.length > 0) {
        suspiciousFinds.push({ type: p.label, matches: matches });
      }
    });

    if (suspiciousFinds.length === 0) {
      console.info(
        'ArchFlow dumpSanitisedSVG: ✅ No suspicious URL-like patterns found in sanitised SVG for stateId "' + stateId + '".\n' +
        'The taint may be caused by a browser security quirk unrelated to URL content (e.g. CORS on the Blob URL itself — unlikely).'
      );
    } else {
      console.warn('ArchFlow dumpSanitisedSVG: ⚠️  Suspicious patterns found in sanitised SVG for stateId "' + stateId + '":');
      suspiciousFinds.forEach(function (finding) {
        console.group(finding.type + ' (' + finding.matches.length + ' match' + (finding.matches.length === 1 ? '' : 'es') + ')');
        finding.matches.slice(0, 20).forEach(function (m) { console.log(m); });
        if (finding.matches.length > 20) {
          console.log('…and ' + (finding.matches.length - 20) + ' more (see downloaded SVG for full list)');
        }
        console.groupEnd();
      });
    }
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.App) {
      console.error('ArchFlow exportManager: window.App is not initialised — skipping export wiring');
      return;
    }

    const btnExportPptx = document.getElementById('btn-export-pptx');
    const btnExportPdf  = document.getElementById('btn-export-pdf');

    if (!btnExportPptx || !btnExportPdf) {
      console.warn(
        'ArchFlow exportManager: export buttons (#btn-export-pptx, #btn-export-pdf) not found in DOM. ' +
        'Add them to index.html to enable export. App.export is still attached for programmatic use.'
      );
      App.export = { exportPPTX, exportPDF, renderStateToPNG, dumpSanitisedSVG };
      return;
    }

    const allExportButtons = [btnExportPptx, btnExportPdf, document.getElementById('btn-export-gif'), document.getElementById('btn-export-png-zip')].filter(Boolean);

    /** Disable all export buttons to prevent concurrent exports. */
    function disableExportButtons() {
      allExportButtons.forEach(function (btn) { btn.disabled = true; });
    }

    /** Re-enable all export buttons after an export completes or fails. */
    function enableExportButtons() {
      allExportButtons.forEach(function (btn) { btn.disabled = false; });
    }

    btnExportPptx.addEventListener('click', async function () {
      const total = (App.config.transitions || []).length;
      disableExportButtons();
      showExportProgress('Exporting as PowerPoint\u2026', total);
      try {
        await exportPPTX();
      } catch (err) {
        console.error('ArchFlow exportManager: PPTX export failed', err);
      } finally {
        hideExportProgress();
        enableExportButtons();
      }
    });

    btnExportPdf.addEventListener('click', async function () {
      const total = (App.config.transitions || []).length;
      disableExportButtons();
      showExportProgress('Exporting as PDF\u2026', total);
      try {
        await exportPDF();
      } catch (err) {
        console.error('ArchFlow exportManager: PDF export failed', err);
      } finally {
        hideExportProgress();
        enableExportButtons();
      }
    });

    App.export = { exportPPTX, exportPDF, renderStateToPNG, dumpSanitisedSVG };
  });

}());
