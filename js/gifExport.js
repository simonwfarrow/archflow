/**
 * ArchFlow — gifExport.js
 * GIF export pipeline — samples live SVG frames as ImageData, encodes them into
 * a GIF file, and triggers a browser download via App.gifExport.exportGIF.
 */
(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────

  /**
   * SVG element tags treated as "shapes" — must mirror svgParser.js SHAPE_TAGS
   * and exportManager.js SHAPE_TAGS so clone keying resolves identically.
   */
  const SHAPE_TAGS = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text', 'g'];
  const SHAPE_TAGS_SELECTOR = SHAPE_TAGS.join(',');
  const NON_PRESENTATIONAL_CONTAINERS = 'defs, clipPath, mask, marker, pattern, symbol';

  /** XML namespace URI for xlink attributes on SVG elements. */
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  /**
   * CSS properties written by playback.js onto live element inline styles.
   * Cleared from clone elements so presentation attributes set in step 4 win
   * (inline style has higher specificity than presentation attributes in CSS).
   */
  const MANAGED_CSS_PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'visibility', 'display'];

  // ─── Sanitization helpers (mirrored from exportManager.js) ──────────────────
  // exportManager.js declares these as IIFE-private functions, so they cannot be
  // called cross-module.  Any behavioural change to the originals must be kept in
  // sync here.

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

  /**
   * Convert a Blob to a base64 data URL via FileReader.
   *
   * @param  {Blob} blob
   * @returns {Promise<string>}
   */
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader   = new FileReader();
      reader.onload  = function (e) { resolve(e.target.result); };
      reader.onerror = function () {
        reject(new Error('ArchFlow gifExport: FileReader failed during blob→dataURL conversion'));
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Replace every external http/https href on <image> elements with an inlined
   * base64 data URI to prevent canvas tainting.
   * Elements whose fetch fails are removed silently (a warning is logged).
   *
   * @param  {SVGSVGElement} clonedSvg
   * @returns {Promise<void>}
   */
  async function inlineExternalImages(clonedSvg) {
    const imgEls = Array.from(clonedSvg.querySelectorAll('image'));

    await Promise.all(imgEls.map(async function (imgEl) {
      const href = imgEl.getAttribute('href') ||
                   imgEl.getAttributeNS(XLINK_NS, 'href') || '';

      if (!href || href.startsWith('data:')) return;
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
          'ArchFlow gifExport: could not inline external <image> (removing from frame):',
          href, fetchErr.message
        );
        imgEl.remove();
      }
    }));
  }

  /**
   * Remove @font-face and @import rules from all <style> elements in the clone,
   * plus any CSS rule block containing an external url() reference.
   * These rules trigger cross-origin fetches that taint the canvas.
   *
   * @param {SVGSVGElement} clonedSvg
   */
  function stripExternalStyleRules(clonedSvg) {
    if (!clonedSvg) return;
    clonedSvg.querySelectorAll('style').forEach(function (styleEl) {
      let css = styleEl.textContent || '';
      css = css.replace(/@font-face\s*\{[^}]*\}/gi, '');
      css = css.replace(/@import\s+[^;]+;/gi, '');
      css = css.replace(/[^{}]*\{[^}]*url\(\s*['"]?(https?:\/\/|\/\/)[^)'"]*['"]?\s*\)[^}]*\}/gi, '');
      styleEl.textContent = css;
    });
  }

  /**
   * Remove <use> elements whose href points to an external (non-fragment)
   * resource.  External sprite references taint the canvas via Blob URL.
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
   * Remove <feImage> filter primitives whose href points to an external resource.
   * Cross-origin feImage references taint the canvas via Blob URL.
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
   * "none" so the canvas renderer never attempts cross-origin fetches.
   * Operates only on style= attributes — <style> elements are handled by
   * stripExternalStyleRules.
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
   * String-level sweep of a serialised SVG to neutralise any external URL
   * references that survived DOM-level sanitisation (e.g. produced by
   * XMLSerializer namespace expansion on elements not reachable via
   * querySelector).
   *
   * @param  {string} svgString  The serialised SVG markup string.
   * @returns {string}           A sanitised copy with external refs neutralised.
   */
  function postSerialiseStringSanitise(svgString) {
    if (!svgString) return svgString;

    let result = svgString.replace(
      /url\(\s*(['"]?)(https?:\/\/|\/\/)[^)'"]*\1\s*\)/gi,
      'url($1none$1)'
    );

    result = result.replace(
      /\s+xlink:href=["'](https?:\/\/|\/\/)[^"']*["']/gi,
      ''
    );

    result = result.replace(
      /(\s+href=["'])(https?:\/\/|\/\/)[^"']*(?=["'])/gi,
      '$1#removed'
    );

    return result;
  }

  /**
   * Remove all <foreignObject> elements from the clone.
   * A <foreignObject> anywhere in an SVG drawn onto a canvas unconditionally
   * taints the canvas, regardless of its content.
   *
   * @param {SVGSVGElement} clonedSvg
   */
  function removeAllForeignObjects(clonedSvg) {
    if (!clonedSvg) return;
    clonedSvg.querySelectorAll('foreignObject').forEach(function (el) {
      el.remove();
    });
  }

  // ─── Frame sampler ──────────────────────────────────────────────────────────

  /**
   * Sample the live SVG at its current visual state and return the rasterised
   * frame as an ImageData object.
   *
   * Reads live computed style (not config-stored baseline/override state), so
   * calling this function mid-transition captures the browser's interpolated
   * values at that exact instant — enabling smooth GIF frame sequences.
   *
   * Algorithm:
   *  1. Clone `#svg-host > svg` with cloneNode(true)
   *  2. Build Map<shapeKey, clonedEl> using the same keying algorithm as
   *     svgParser.js / exportManager.buildCloneKeyMap
   *  3. Clear managed inline-style props from cloned elements so presentation
   *     attributes set in step 4 are not overridden by playback.js residue
   *  4. Read getComputedStyle from each live shape element; write fill, stroke,
   *     stroke-width, opacity, visibility as presentation attributes on clone
 *  5. Inject annotation marks via annotationLayer.renderInto using the
 *     annotations array passed to this function — renders state-specific
 *     marks onto the cloned frame for accurate GIF output
   *  6. Strip CSS transition declarations from every cloned element — static
   *     image output; no transitions required
   *  7. DOM-level sanitisation pipeline: removeAllForeignObjects →
   *     stripExternalStyleRules → removeExternalUseRefs →
   *     removeExternalFeImageRefs → sanitiseInlineStyleURLs
   *  8. Inline external <image> hrefs as base64 data URIs (async)
   *  9. Serialise clone → postSerialiseStringSanitise → ensure xmlns attribute
   * 10. Blob URL → <img> → <canvas> (width × height) → ctx.getImageData
   * 11. Revoke Blob URL; resolve with ImageData
   *
 * @param  {number} width   Output canvas width in pixels.
 * @param  {number} height  Output canvas height in pixels.
 * @param  {Array}  [annotations=[]]  Annotation marks to render into this frame.
 * @returns {Promise<ImageData>}
 */
  async function sampleLiveComputedFrame(width, height, annotations) {

    // ── Guards ─────────────────────────────────────────────────────────────────

    if (!window.App) {
      throw new Error('gifExport.sampleLiveComputedFrame: window.App is not initialised');
    }

    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new Error(
        'gifExport.sampleLiveComputedFrame: width and height must be positive finite numbers, ' +
        'got width=' + width + ', height=' + height
      );
    }

    const svgHost = document.getElementById('svg-host');
    if (!svgHost) {
      throw new Error('gifExport.sampleLiveComputedFrame: #svg-host element not found in DOM');
    }

    const liveSvg = svgHost.querySelector('svg');
    if (!liveSvg) {
      throw new Error(
        'gifExport.sampleLiveComputedFrame: no <svg> found inside #svg-host — load an SVG first'
      );
    }

    // ── Step 1: Clone the live SVG ─────────────────────────────────────────────

    const clone = liveSvg.cloneNode(true);

    // ── Step 2: Build shape-key → cloned-element map ───────────────────────────
    // App.shapes keys and buildCloneKeyMap keys are produced by the same
    // algorithm, so a direct Map.get(key) resolves the correct clone element.

    const cloneKeyMap = buildCloneKeyMap(clone);

    // ── Step 3: Clear managed inline-style properties from the clone ──────────
    // cloneNode(true) preserves el.style.* values written by playback.js.
    // Inline styles have higher CSS specificity than presentation attributes,
    // so removing them here allows the setAttribute calls in step 4 to take
    // effect when the SVG is rendered by the canvas image renderer.

    App.shapes.forEach(function (record, key) {
      const clonedEl = cloneKeyMap.get(key);
      if (!clonedEl) return;
      MANAGED_CSS_PROPS.forEach(function (cssProp) {
        clonedEl.style.removeProperty(cssProp);
      });
    });

    // ── Step 4: Stamp live computed style as presentation attributes ──────────
    // getComputedStyle reads from the LIVE element — the browser's fully
    // resolved values at this exact instant, including mid-transition frames.

    App.shapes.forEach(function (record, key) {
      const clonedEl = cloneKeyMap.get(key);
      if (!clonedEl) return;

      const computed    = getComputedStyle(record.el);
      const fill        = computed.getPropertyValue('fill');
      const stroke      = computed.getPropertyValue('stroke');
      const strokeWidth = computed.getPropertyValue('stroke-width');
      const opacity     = computed.getPropertyValue('opacity');
      const visibility  = computed.getPropertyValue('visibility');
      const display     = computed.getPropertyValue('display');

      if (fill)        clonedEl.setAttribute('fill',         fill);
      if (stroke)      clonedEl.setAttribute('stroke',       stroke);
      if (strokeWidth) clonedEl.setAttribute('stroke-width', strokeWidth);
      if (opacity)     clonedEl.setAttribute('opacity',      opacity);
      if (visibility)  clonedEl.setAttribute('visibility',   visibility);
      if (display)     clonedEl.setAttribute('display',      display);
    });

    // ── Step 5: Inject annotation marks into the cloned frame ────────────────
    // Renders the annotation marks passed into this function so GIF frames
    // include per-state annotations.  Falls back to an empty array when none
    // are provided, preserving the structural baseline of the live SVG.

    if (App.annotationLayer && typeof App.annotationLayer.renderInto === 'function') {
      App.annotationLayer.renderInto(clone, annotations || []);
    }

    // ── Step 6: Strip CSS transition declarations from every cloned element ────
    // Transition rules are meaningless on a static raster frame and can confuse
    // some SVG renderers.

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

    // ── Step 7: DOM-level sanitisation pipeline ────────────────────────────────

    removeAllForeignObjects(clone);
    stripExternalStyleRules(clone);
    removeExternalUseRefs(clone);
    removeExternalFeImageRefs(clone);
    sanitiseInlineStyleURLs(clone);

    // ── Step 8: Inline external <image> hrefs as base64 data URIs ─────────────

    await inlineExternalImages(clone);

    // ── Step 9: Serialise → string-level sanitise → ensure SVG xmlns ──────────

    let svgString = new XMLSerializer().serializeToString(clone);
    svgString = postSerialiseStringSanitise(svgString);

    if (!svgString.includes('xmlns=')) {
      svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // ── Step 10–11: Blob URL → <img> → <canvas> → ImageData + cleanup ─────────

    return new Promise(function (resolve, reject) {
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(svgBlob);
      const img     = new Image();

      img.onload = function () {
        try {
          const canvas  = document.createElement('canvas');
          canvas.width  = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');

          // White background prevents transparent SVG regions rendering as black
          // when the ImageData is later quantised to a GIF colour palette.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);

          ctx.drawImage(img, 0, 0, width, height);

          const imageData = ctx.getImageData(0, 0, width, height);

          URL.revokeObjectURL(blobUrl);
          resolve(imageData);
        } catch (drawError) {
          URL.revokeObjectURL(blobUrl);
          reject(new Error(
            'gifExport.sampleLiveComputedFrame: canvas draw failed: ' + drawError.message
          ));
        }
      };

      img.onerror = function () {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(
          'gifExport.sampleLiveComputedFrame: failed to load serialised SVG as an image'
        ));
      };

      img.src = blobUrl;
    });
  }

  // ─── SVG dimension resolver (mirrored from exportManager.js) ────────────────

  /**
   * Resolve the base pixel dimensions of an SVG element.
   * Priority order: viewBox (w, h) → width/height attributes → 800 × 600 fallback.
   *
   * Mirrors exportManager.js resolveSVGDimensions exactly — kept in sync manually
   * because that function is IIFE-private and cannot be called cross-module.
   *
   * @param  {SVGSVGElement} svgEl
   * @returns {{ width: number, height: number }}
   */
  function resolveSVGDimensions(svgEl) {
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

  // ─── Sleep helper ────────────────────────────────────────────────────────────

  /**
   * Pause execution for `ms` milliseconds.
   * @param  {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ─── Transition frame capturer ───────────────────────────────────────────────

  /**
   * Capture the animated transition between two states as a sequence of ImageData
   * frames suitable for GIF encoding.
   *
   * Algorithm:
   *  1.  Suppress CSS transitions on all live shape elements (set transition = 'none').
   *  2.  Apply fromStateId immediately via App.playback.applyStateToSVG — which
   *      internally re-enables transitions, so transitions are suppressed again
   *      afterwards to ensure the from-state is committed with no animation.
   *  3.  Force a browser reflow (read getBoundingClientRect) so the browser flushes
   *      pending style recalculations and commits the from-state layout.
   *  4.  Restore CSS transitions on all shape elements by setting the same
   *      transition string that applyStateToSVG builds (fill/stroke/stroke-width/
   *      opacity each with transitionDuration ms ease).
   *  5.  Trigger the CSS transition by calling applyStateToSVG(toStateId).
   *      applyStateToSVG re-sets the same transition value, then applies to-state
   *      properties.  The browser interpolates from committed from-state to new
   *      to-state values, producing the CSS animation.
   *  6.  Sample transitionFrameCount frames at frameInterval ms intervals using a
   *      sleep → sampleLiveComputedFrame chain.
   *  7.  Wait for any remaining transition duration that was not covered by the
   *      sampling sleeps, ensuring the final state is fully settled.
   *  8.  Sample holdFrameCount hold frames of the steady final (to) state, with
   *      frameInterval ms gaps between captures.
   *  9.  Return the complete frame array.
   *
   * Edge case — transitionDuration === 0: forces transitionFrameCount = 1 so at
   * least one frame of the to-state is always captured.
   *
   * @param  {string} fromStateId   ID of the transition to start from.
   * @param  {string} toStateId     ID of the transition to animate towards.
   * @param  {number} fps           Frames per second (must be > 0).
   * @param  {number} holdMs        Duration in ms to hold the final frame (>= 0).
   * @param  {number} scaleFactor   Multiplier applied to SVG base dimensions (> 0).
   * @returns {Promise<Array<{ imageData: ImageData, delay: number }>>}
   *          Resolves with transition frames followed by hold frames.
   *          Each entry's `delay` is the GIF frame duration in milliseconds.
   */
  async function captureTransitionFrames(fromStateId, toStateId, fps, holdMs, scaleFactor) {

    // ── Guards ─────────────────────────────────────────────────────────────────

    if (!window.App) {
      throw new Error('gifExport.captureTransitionFrames: window.App is not initialised');
    }

    if (!App.playback || typeof App.playback.applyStateToSVG !== 'function') {
      throw new Error(
        'gifExport.captureTransitionFrames: App.playback.applyStateToSVG is not available — ' +
        'ensure playback.js has initialised via DOMContentLoaded'
      );
    }

    const transitions = App.config.transitions;

    if (!transitions.find(function (t) { return t.id === fromStateId; })) {
      throw new Error(
        'gifExport.captureTransitionFrames: unknown fromStateId "' + fromStateId + '"'
      );
    }

    if (!transitions.find(function (t) { return t.id === toStateId; })) {
      throw new Error(
        'gifExport.captureTransitionFrames: unknown toStateId "' + toStateId + '"'
      );
    }

    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error(
        'gifExport.captureTransitionFrames: fps must be a positive finite number, got ' + fps
      );
    }

    if (!Number.isFinite(holdMs) || holdMs < 0) {
      throw new Error(
        'gifExport.captureTransitionFrames: holdMs must be a non-negative finite number, got ' + holdMs
      );
    }

    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      throw new Error(
        'gifExport.captureTransitionFrames: scaleFactor must be a positive finite number, got ' + scaleFactor
      );
    }

    const svgHost = document.getElementById('svg-host');
    if (!svgHost) {
      throw new Error('gifExport.captureTransitionFrames: #svg-host element not found in DOM');
    }

    const liveSvg = svgHost.querySelector('svg');
    if (!liveSvg) {
      throw new Error(
        'gifExport.captureTransitionFrames: no <svg> found inside #svg-host — load an SVG first'
      );
    }

    // ── Look up destination state annotations ─────────────────────────────────

    var toState = transitions.find(function(t) { return t.id === toStateId; });
    var toStateAnnotations = (toState && toState.annotations) || [];

    // ── Resolve output dimensions ──────────────────────────────────────────────

    const baseDims = resolveSVGDimensions(liveSvg);
    const width    = Math.round(baseDims.width  * scaleFactor);
    const height   = Math.round(baseDims.height * scaleFactor);

    // ── Compute frame timing ───────────────────────────────────────────────────

    const frameInterval      = Math.round(1000 / fps);
    const transitionDuration = App.config.transitionDuration || 0;

    // Edge case: transitionDuration === 0 — yield at least one frame of to-state.
    const transitionFrameCount = transitionDuration > 0
      ? Math.ceil(transitionDuration / frameInterval)
      : 1;

    const holdFrameCount = Math.ceil(holdMs / frameInterval);

    // ── Pause auto-play so the playback timer cannot mutate the DOM mid-capture ─

    if (typeof App.playback.pause === 'function') {
      App.playback.pause();
    }

    // ── Build the CSS transition string (mirrors applyStateToSVG in playback.js) ─
    // Using the live transitionDuration value so our restore in step 4 exactly
    // matches what applyStateToSVG will set during step 5.

    const dur             = App.config.transitionDuration || 600;
    const transitionValue =
      'fill '         + dur + 'ms ease, ' +
      'stroke '       + dur + 'ms ease, ' +
      'stroke-width ' + dur + 'ms ease, ' +
      'opacity '      + dur + 'ms ease';

    // ── Step 1: Suppress CSS transitions on all shape elements ────────────────

    App.shapes.forEach(function (record) {
      record.el.style.transition = 'none';
    });

    // ── Step 2: Apply fromStateId immediately (no animation) ──────────────────
    // applyStateToSVG re-enables transitions internally before setting properties,
    // so we suppress them again immediately after it returns.

    App.playback.applyStateToSVG(fromStateId);

    App.shapes.forEach(function (record) {
      record.el.style.transition = 'none';
    });

    // ── Step 3: Force browser reflow ──────────────────────────────────────────
    // Reading a layout property forces the browser to flush pending style
    // recalculations and commit the from-state values as the layout baseline.
    // This is what makes step 5 animate FROM from-state TO to-state.

    void liveSvg.getBoundingClientRect();

    // ── Step 4: Restore CSS transitions on all shape elements ─────────────────
    // Transitions must be active BEFORE applyStateToSVG changes property values
    // in step 5, so the browser interpolates between the committed from-state
    // and the incoming to-state values.

    App.shapes.forEach(function (record) {
      record.el.style.transition = transitionValue;
    });

    // ── Step 5: Trigger the CSS transition by applying toStateId ─────────────
    // applyStateToSVG sets the same transitionValue then applies to-state
    // properties.  Because transitions were already active (step 4) and the
    // browser committed the from-state layout (step 3), the property changes
    // trigger a CSS animation.

    App.playback.applyStateToSVG(toStateId);

    // ── Steps 6–8: Sample frames ──────────────────────────────────────────────

    const frames = [];

    // Transition frames — sampled at frameInterval ms intervals while the CSS
    // animation runs.  Each sleep gives the browser time to advance the animation
    // before sampleLiveComputedFrame reads the live computed styles.

    for (var i = 0; i < transitionFrameCount; i++) {
      await sleep(frameInterval);
      const imageData = await sampleLiveComputedFrame(width, height, toStateAnnotations);
      frames.push({ imageData: imageData, delay: frameInterval });
    }

    // Ensure the full CSS transition has elapsed before capturing hold frames.
    // transitionFrameCount * frameInterval ms have already passed (from the sleeps
    // above, ignoring sampleLiveComputedFrame overhead which is sub-frameInterval).
    const timeAlreadyElapsedMs   = transitionFrameCount * frameInterval;
    const remainingTransitionMs  = transitionDuration - timeAlreadyElapsedMs;
    if (remainingTransitionMs > 0) {
      await sleep(remainingTransitionMs);
    }

    // Hold frames — the to-state is now fully settled; sample the static final frame.
    // Each frame is captured then we sleep frameInterval ms before the next capture
    // so the GIF encoder receives evenly-spaced frames with accurate delay values.

    for (var j = 0; j < holdFrameCount; j++) {
      const holdImageData = await sampleLiveComputedFrame(width, height, toStateAnnotations);
      frames.push({ imageData: holdImageData, delay: frameInterval });
      if (j < holdFrameCount - 1) {
        await sleep(frameInterval);
      }
    }

    return frames;
  }

  // ─── Export progress modal helpers ──────────────────────────────────────────
  // Mirrors exportManager.js showExportProgress / updateExportProgress /
  // hideExportProgress, which are IIFE-private there and cannot be called
  // cross-module.  DOM element IDs are identical across both modules.

  /**
   * Show the export progress modal, set its heading, and reset the bar to 0%.
   *
   * @param {string} label  Heading text, e.g. "Capturing GIF frames…"
   * @param {number} total  Total number of segments (used for "0 / N" counter).
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

    requestAnimationFrame(function () {
      backdrop.classList.add('modal-backdrop--visible');
      if (modal) modal.classList.add('modal-panel--visible');
    });
  }

  /**
   * Update the progress bar fill and counter to reflect completed work.
   *
   * @param {number} current  Number of segments completed so far (1-based).
   * @param {number} total    Total number of segments being captured.
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

  // ─── Full-sequence frame orchestrator ────────────────────────────────────────

  /**
   * Capture GIF frames for all transition states in sequence and return them as
   * a flat array ready for GIF encoding.
   *
   * Iterates App.config.transitions in order, calling captureTransitionFrames for
   * each consecutive pair (transitions[i] → transitions[i+1]).  A single-state
   * diagram is handled as a special case: no animation is possible, so only hold
   * frames at that one state are captured.
   *
   * Side-effects (all restored in the finally block):
   *  - Pauses App.playback auto-play timer.
   *  - Resets App.zoom to 1.0 for consistent rasterisation dimensions; original
   *    level is approximated back via zoomIn / zoomOut steps on exit.
   *
   * @param  {{ fps: number, holdMs: number, loopCount: number, scaleFactor: number }} settings
   *   fps         — frames per second for sampling (must be > 0)
   *   holdMs      — hold duration in ms after each to-state settles (>= 0)
   *   loopCount   — consumed by the downstream GIF encoder; ignored here
   *   scaleFactor — multiplier applied to SVG base dimensions (> 0)
   * @returns {Promise<Array<{ imageData: ImageData, delay: number }>>}
   *   Flat array of all captured frames across all transition segments.
   */
  async function captureAllStatesFrames(settings) {

    // ── Guards ─────────────────────────────────────────────────────────────────

    if (!window.App) {
      throw new Error('gifExport.captureAllStatesFrames: window.App is not initialised');
    }

    if (!settings || typeof settings !== 'object') {
      throw new Error('gifExport.captureAllStatesFrames: settings must be a non-null object');
    }

    const { fps, holdMs, scaleFactor } = settings;
    // loopCount belongs to the downstream GIF encoder; not consumed during frame capture

    if (!App.config.transitions || App.config.transitions.length === 0) {
      throw new Error(
        'gifExport.captureAllStatesFrames: no transition states loaded — ' +
        'add at least one state before exporting'
      );
    }

    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error(
        'gifExport.captureAllStatesFrames: fps must be a positive finite number, got ' + fps
      );
    }

    if (!Number.isFinite(holdMs) || holdMs < 0) {
      throw new Error(
        'gifExport.captureAllStatesFrames: holdMs must be a non-negative finite number, got ' + holdMs
      );
    }

    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      throw new Error(
        'gifExport.captureAllStatesFrames: scaleFactor must be a positive finite number, got ' + scaleFactor
      );
    }

    if (!App.playback || typeof App.playback.applyStateToSVG !== 'function') {
      throw new Error(
        'gifExport.captureAllStatesFrames: App.playback.applyStateToSVG is not available — ' +
        'ensure playback.js has initialised via DOMContentLoaded'
      );
    }

    const svgHost = document.getElementById('svg-host');
    if (!svgHost) {
      throw new Error('gifExport.captureAllStatesFrames: #svg-host element not found in DOM');
    }

    const liveSvg = svgHost.querySelector('svg');
    if (!liveSvg) {
      throw new Error(
        'gifExport.captureAllStatesFrames: no <svg> found inside #svg-host — load an SVG first'
      );
    }

    // ── Stop auto-play so the timer cannot mutate the DOM mid-capture ──────────

    if (typeof App.playback.pause === 'function') {
      App.playback.pause();
    }

    var wasPlaying = App.playback && typeof App.playback.isPlaying === 'boolean' && App.playback.isPlaying;

    // ── Save current zoom level and normalise to 1.0 ──────────────────────────
    // Zoom is a CSS transform (scale) applied to the SVG element; it does not
    // affect the rasterised canvas size but can introduce sub-pixel artefacts.
    // Reset to 1.0 for clean capture; restore original level in finally block.

    const savedZoomLevel = (App.zoom && typeof App.zoom.getLevel === 'function')
      ? App.zoom.getLevel()
      : 1.0;

    if (App.zoom && typeof App.zoom.reset === 'function') {
      App.zoom.reset();
    }

    // ── Resolve output pixel dimensions from SVG viewBox × scaleFactor ─────────

    const baseDims      = resolveSVGDimensions(liveSvg);
    const width         = Math.round(baseDims.width  * scaleFactor);
    const height        = Math.round(baseDims.height * scaleFactor);
    const frameInterval = Math.round(1000 / fps);

    const transitions = App.config.transitions;

    // ── Show progress modal ───────────────────────────────────────────────────
    // total = number of animation segments (N transitions → N-1 segments),
    // or 1 for the single-state edge case.

    const progressTotal = transitions.length === 1 ? 1 : transitions.length;
    showExportProgress('Capturing GIF frames\u2026', progressTotal);

    const frames = [];

    try {

      if (transitions.length === 1) {

        // ── Single-state edge case: no animation — hold frames only ──────────
        // Suppress CSS transitions so applyStateToSVG commits the state
        // immediately with no interpolation; then sample hold frames.

        const holdFrameCount = Math.max(1, Math.ceil(holdMs / frameInterval));

        App.shapes.forEach(function (record) {
          record.el.style.transition = 'none';
        });
        App.playback.applyStateToSVG(transitions[0].id);
        App.shapes.forEach(function (record) {
          record.el.style.transition = 'none';
        });
        void liveSvg.getBoundingClientRect(); // force reflow to commit state

        for (var k = 0; k < holdFrameCount; k++) {
          const holdImageData = await sampleLiveComputedFrame(width, height);
          frames.push({ imageData: holdImageData, delay: frameInterval });
          if (k < holdFrameCount - 1) {
            await sleep(frameInterval);
          }
        }

        updateExportProgress(1, 1);

      } else {

        // ── Multi-state: animate through every consecutive transition pair ────
        // Capture hold frames for transitions[0] first so the initial state is
        // visible in the output — the loop below only ever uses it as a silent
        // "from" anchor and would otherwise skip its hold entirely.

        App.shapes.forEach(function (record) {
          record.el.style.transition = 'none';
        });
        App.playback.applyStateToSVG(transitions[0].id);
        App.shapes.forEach(function (record) {
          record.el.style.transition = 'none';
        });
        void liveSvg.getBoundingClientRect(); // force reflow to commit state

        const firstHoldCount = Math.max(1, Math.ceil(holdMs / frameInterval));

        for (var h = 0; h < firstHoldCount; h++) {
          const firstHoldImageData = await sampleLiveComputedFrame(width, height, transitions[0].annotations || []);
          frames.push({ imageData: firstHoldImageData, delay: frameInterval });
          if (h < firstHoldCount - 1) {
            await sleep(frameInterval);
          }
        }

        updateExportProgress(1, progressTotal);

        for (var i = 0; i < transitions.length - 1; i++) {
          const fromId       = transitions[i].id;
          const toId         = transitions[i + 1].id;
          const segmentFrames = await captureTransitionFrames(fromId, toId, fps, holdMs, scaleFactor);

          segmentFrames.forEach(function (frame) { frames.push(frame); });
          updateExportProgress(i + 2, progressTotal);
        }

      }

    } finally {

      hideExportProgress();

      // ── Restore original zoom level ────────────────────────────────────────
      // App.zoom exposes no setLevel(); approximate by stepping from reset
      // (1.0) via zoomIn / zoomOut.  Users can only reach zoom levels through
      // those same step functions, so any saved level is a discrete multiple of
      // STEP_FACTOR from 1.0 — the while loop therefore terminates exactly.

      if (App.zoom && typeof App.zoom.reset === 'function') {
        App.zoom.reset(); // anchor at 1.0 before stepping toward saved level

        if (savedZoomLevel > 1.0 && typeof App.zoom.zoomIn === 'function') {
          while (App.zoom.getLevel() < savedZoomLevel) {
            App.zoom.zoomIn();
          }
        } else if (savedZoomLevel < 1.0 && typeof App.zoom.zoomOut === 'function') {
          while (App.zoom.getLevel() > savedZoomLevel) {
            App.zoom.zoomOut();
          }
        }
      }

      if (wasPlaying && typeof App.playback.play === 'function') {
        App.playback.play();
      }

    }

    return frames;
  }

  // ─── GIF encoder ─────────────────────────────────────────────────────────────

  /**
   * Encode a sequence of ImageData frames into a complete GIF file using the
   * gifenc library (expected at `window.gifenc`).
   *
   * Strategy: a single global palette is quantised from the first frame.  This
   * is faster than per-frame quantisation and produces good results for SVG
   * diagrams which typically have a limited colour gamut.
   *
   * This function is synchronous — gifenc encoding is entirely CPU-bound with
   * no I/O.  Do NOT create a Blob or trigger a download here; that belongs in
   * the download helper (phase 4.2).
   *
   * @param  {Array<{ imageData: ImageData, delay: number }>} frames
   *   Ordered frame sequence.  Each entry's `delay` is the display duration in
   *   milliseconds (gifenc divides by 10 internally to produce centiseconds).
   * @param  {number} width      Output GIF width in pixels (positive integer).
   * @param  {number} height     Output GIF height in pixels (positive integer).
   * @param  {number} loopCount  -1 = play once, 0 = loop forever, N > 0 = N+1 plays.
   * @returns {Uint8Array}       Complete GIF file bytes (safe copy from gifenc).
   */
  function encodeGIF(frames, width, height, loopCount) {

    // ── Guards ───────────────────────────────────────────────────────────────

    if (!window.gifenc) {
      throw new Error(
        'gifExport.encodeGIF: window.gifenc is not available — ' +
        'ensure the gifenc <script> has loaded before calling encodeGIF'
      );
    }

    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error(
        'gifExport.encodeGIF: frames must be a non-empty array, got ' +
        (Array.isArray(frames) ? 'empty array' : typeof frames)
      );
    }

    if (!Number.isFinite(width) || !Number.isInteger(width) || width <= 0) {
      throw new Error(
        'gifExport.encodeGIF: width must be a positive integer, got ' + width
      );
    }

    if (!Number.isFinite(height) || !Number.isInteger(height) || height <= 0) {
      throw new Error(
        'gifExport.encodeGIF: height must be a positive integer, got ' + height
      );
    }

    if (!Number.isFinite(loopCount) || !Number.isInteger(loopCount) || loopCount < -1) {
      throw new Error(
        'gifExport.encodeGIF: loopCount must be an integer >= -1 ' +
        '(-1 = play once, 0 = loop forever, N > 0 = N+1 plays), got ' + loopCount
      );
    }

    // ── Derive a single global palette from the first frame ──────────────────
    // quantize reads the full RGBA Uint8ClampedArray from ImageData.data and
    // returns an rgb565-format palette array.  The first frame is used as the
    // palette source because SVG diagrams have a limited colour gamut and a
    // single global palette avoids the per-frame quantisation cost.

    const firstFramePixels = frames[0].imageData.data;
    const globalPalette    = window.gifenc.quantize(firstFramePixels, 256, { format: 'rgb565' });

    // ── Initialise the GIF encoder ───────────────────────────────────────────

    const gif = window.gifenc.GIFEncoder({ auto: true, initialCapacity: 4096 });

    // ── Write each frame ─────────────────────────────────────────────────────
    // palette and repeat are written only on the first frame; they are stored
    // in the GIF logical screen descriptor and do not need repeating per-frame.

    for (var i = 0; i < frames.length; i++) {
      const frame         = frames[i];
      const indexedPixels = window.gifenc.applyPalette(
        frame.imageData.data,
        globalPalette,
        'rgb565'
      );

      gif.writeFrame(indexedPixels, width, height, {
        palette: i === 0 ? globalPalette : undefined,
        delay:   frame.delay,
        repeat:  i === 0 ? loopCount    : undefined
      });
    }

    // ── Finalise and return raw GIF bytes ────────────────────────────────────
    // finish() writes the GIF trailer; bytes() returns a safe Uint8Array copy.

    gif.finish();
    return gif.bytes();
  }

  // ─── GIF export orchestrator ─────────────────────────────────────────────────

  /**
   * Orchestrate the full GIF export pipeline: capture all state frames, encode
   * them into a GIF file, and trigger a browser download.
   *
   * captureAllStatesFrames handles progress display internally; showExportProgress
   * is NOT called here.  hideExportProgress is called in the finally block as a
   * belt-and-suspenders guarantee — it covers encodeGIF / download failures that
   * occur after captureAllStatesFrames has already hidden the modal, and is
   * idempotent when called redundantly.
   *
   * @param  {{ fps: number, holdMs: number, loopCount: number, scaleFactor: number }} settings
   *   All fields are pre-validated by the upstream UI layer before this call.
   *   fps > 0, holdMs >= 0, scaleFactor > 0, loopCount integer >= -1.
   * @returns {Promise<void>}
   */
  async function exportGIF(settings) {
    try {

      // ── Step 1: Capture all state frames ──────────────────────────────────────
      // captureAllStatesFrames pauses playback, resets zoom, shows / hides the
      // progress modal internally, and returns a flat { imageData, delay } array
      // ordered across all animation segments.

      const frames = await captureAllStatesFrames(settings);

      if (!frames || frames.length === 0) {
        throw new Error('gifExport.exportGIF: no frames were captured — try increasing Hold Duration above 0 ms for single-state diagrams');
      }

      // ── Step 2: Derive canvas dimensions from the first frame ─────────────────
      // sampleLiveComputedFrame stamps width × height onto every ImageData it
      // produces, so frames[0].imageData always reflects the scaled output size.

      const width  = frames[0].imageData.width;
      const height = frames[0].imageData.height;

      // ── Step 3: Encode frames into a GIF Uint8Array ───────────────────────────

      const bytes = encodeGIF(frames, width, height, settings.loopCount);

      // ── Step 4: Wrap encoded bytes in a GIF Blob ──────────────────────────────

      const blob = new Blob([bytes], { type: 'image/gif' });

      // ── Step 5: Trigger browser download via temporary <a> element ────────────
      // Mirrors the Blob + <a download> pattern from exportManager.js
      // triggerSvgDownload (line ~700): create object URL, create <a>, set href
      // and download, append to body, click, remove from body, then revoke the
      // URL after 5 s — giving the browser enough time to begin the download
      // before the object URL is released.

      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'archflow-animation.gif';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);

    } catch (err) {
      throw err;
    } finally {
      hideExportProgress();
    }
  }

  // ─── Modal + button wiring ───────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {

    // ── Element references ────────────────────────────────────────────────────

    const btnExportGif     = document.getElementById('btn-export-gif');
    const gifModalBackdrop = document.getElementById('gif-settings-modal-backdrop');
    const gifSettingsModal = document.getElementById('gif-settings-modal');
    const gifCancelBtn     = document.getElementById('gif-cancel-btn');
    const gifExportBtn     = document.getElementById('gif-export-btn');
    const gifFpsEl         = document.getElementById('gif-fps');
    const gifHoldEl        = document.getElementById('gif-hold-ms');
    const gifLoopEl        = document.getElementById('gif-loop');
    const gifScaleEl       = document.getElementById('gif-scale');

    // ── Guard: #btn-export-gif absent in minimal / test configurations ─────────

    if (!btnExportGif) {
      console.warn('ArchFlow gifExport: #btn-export-gif not found in DOM — GIF modal wiring skipped');
      return;
    }

    if (!gifModalBackdrop || !gifSettingsModal || !gifCancelBtn || !gifExportBtn || !gifFpsEl || !gifHoldEl || !gifLoopEl || !gifScaleEl) {
      console.warn('gifExport: one or more GIF settings modal elements are missing from the DOM');
      return;
    }

    // ── Helpers: open / close the GIF settings modal ──────────────────────────

    function openGifModal() {
      gifModalBackdrop.hidden = false;
      gifModalBackdrop.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function () {
        gifModalBackdrop.classList.add('modal-backdrop--visible');
        gifSettingsModal.classList.add('modal-panel--visible');
      });
    }

    function closeGifModal() {
      gifModalBackdrop.classList.remove('modal-backdrop--visible');
      gifSettingsModal.classList.remove('modal-panel--visible');
      gifModalBackdrop.setAttribute('aria-hidden', 'true');
      setTimeout(function () { gifModalBackdrop.hidden = true; }, 220);
    }

    // ── Helpers: disable / enable all export buttons ──────────────────────────
    // exportManager.js does not expose disableExportButtons / enableExportButtons
    // on App.export — they are IIFE-private locals inside its DOMContentLoaded
    // callback.  Collect all three export buttons here and manage them directly.

    const allExportButtons = [
      btnExportGif,
      document.getElementById('btn-export-pdf'),
      document.getElementById('btn-export-pptx'),
    ].filter(Boolean);

    function disableAllExportButtons() {
      allExportButtons.forEach(function (btn) { btn.disabled = true; });
    }

    function enableAllExportButtons() {
      allExportButtons.forEach(function (btn) { btn.disabled = false; });
    }

    // ── Wire: GIF button → open modal ─────────────────────────────────────────

    btnExportGif.addEventListener('click', function () {
      openGifModal();
    });

    // ── Wire: Cancel button → close modal ─────────────────────────────────────

    gifCancelBtn.addEventListener('click', function () {
      closeGifModal();
    });

    // ── Wire: Export button → read settings, close modal, run export ──────────

    gifExportBtn.addEventListener('click', function () {
      if (!window.gifenc) {
        alert('GIF export library has not finished loading. Please wait a moment and try again.');
        return;
      }

      const fps         = parseInt(gifFpsEl.value,   10);
      const holdMs      = parseInt(gifHoldEl.value,  10);
      const loopCount   = parseInt(gifLoopEl.value,  10);
      const scaleFactor = parseFloat(gifScaleEl.value);

      if ([fps, holdMs, loopCount, scaleFactor].some(isNaN)) {
        alert('Please enter valid numbers for all GIF settings.');
        return;
      }

      closeGifModal();
      disableAllExportButtons();

      exportGIF({ fps, holdMs, loopCount, scaleFactor })
        .catch(function (err) {
          console.error('ArchFlow gifExport: export failed', err);
          alert('GIF export failed: ' + (err && err.message ? err.message : 'unknown error'));
        })
        .finally(function () {
          enableAllExportButtons();
        });
    });

  });

  // ─── Public surface ──────────────────────────────────────────────────────────

  window.App           = window.App || {};
  window.App.gifExport = { exportGIF };

}());
