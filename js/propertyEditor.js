/**
 * ArchFlow — propertyEditor.js
 * Floating, draggable glass panel for editing per-shape properties
 * within the currently active transition state.
 */
(function () {
  'use strict';

  /** @type {HTMLElement|null} */
  let panel = null;

  /** @type {string|null} */
  let boundShapeKey = null;

  /** @type {Set<string>} Keys bound in multi-select mode. Empty in single-select mode. */
  let boundKeys = new Set();

  // ─── Utilities ────────────────────────────────────────────────────────────

  function escapeAttr(str) {
    if (str == null) return '';
    return String(str).replace(/"/g, '&quot;');
  }

  /**
   * Normalise an arbitrary colour value into a 6-digit hex string suitable
   * for <input type="color">.  Falls back to #000000 for unrecognised values.
   * @param {string|undefined|null} color
   * @returns {string}
   */
  function normalizeColorForInput(color) {
    if (!color || typeof color !== 'string') return '#000000';
    var trimmed = color.trim();
    if (trimmed === 'none' || trimmed === 'transparent') return '#000000';
    // Fast path: already a valid 6-digit hex
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
    // Expand 3-digit hex
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      return '#' + trimmed[1]+trimmed[1]+trimmed[2]+trimmed[2]+trimmed[3]+trimmed[3];
    }
    // Resolve any CSS color string via a temporary DOM element
    var probe = document.createElement('div');
    probe.style.color = trimmed;
    document.body.appendChild(probe);
    var resolved = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    var m = resolved.match(/\d+/g);
    if (!m || m.length < 3) return '#000000';
    return '#' + [m[0], m[1], m[2]].map(function(n) {
      return ('0' + parseInt(n, 10).toString(16)).slice(-2);
    }).join('');
  }

  // ─── State accessors ──────────────────────────────────────────────────────

  /**
   * Return the property overrides for shapeKey in the active transition state.
   * @param {string} shapeKey
   * @returns {Object}
   */
  function getActiveStateShapeProperties(shapeKey) {
    if (!window.App) return {};
    const activeState = App.config.transitions.find(function (t) {
      return t.id === App.activeStateId;
    });
    if (!activeState) return {};
    const shapeEntry = activeState.shapes.find(function (s) {
      return s.id === shapeKey;
    });
    return (shapeEntry && shapeEntry.properties) ? shapeEntry.properties : {};
  }

  /**
   * Compute per-property consensus values across all shapes in keySet.
   * Returns '__mixed__' for any property where shapes disagree.
   * @param {Set<string>} keySet
   * @returns {{ fill: string, stroke: string, strokeWidth: *, opacity: *, visibility: string }}
   */
  function computeMultiValues(keySet) {
    const consensus = {};
    if (!window.App || !App.shapes) return consensus;
    const PROPS = ['fill', 'stroke', 'strokeWidth', 'opacity', 'visibility'];
    PROPS.forEach(function (prop) { consensus[prop] = undefined; });

    keySet.forEach(function (key) {
      const record = App.shapes.get(key);
      if (!record) return;

      const overrides = getActiveStateShapeProperties(key);
      const baseline  = record.baseline;

      // Effective values (same resolution as buildControlsHTML single-select path)
      const effective = {
        fill:        overrides.fill        !== undefined ? overrides.fill        : (baseline.fill        || '#000000'),
        stroke:      overrides.stroke      !== undefined ? overrides.stroke      : (baseline.stroke      || '#000000'),
        strokeWidth: parseFloat(overrides.strokeWidth !== undefined ? overrides.strokeWidth
                     : (baseline.strokeWidth != null ? baseline.strokeWidth : 1)),
        opacity:     parseFloat(overrides.opacity     !== undefined ? overrides.opacity
                     : (baseline.opacity     != null ? baseline.opacity     : 1)),
        visibility:  (function(v) { return v === 'hidden' ? 'hidden' : 'visible'; })(
          overrides.visibility !== undefined ? overrides.visibility : baseline.visibility
        ),
      };

      PROPS.forEach(function (prop) {
        if (consensus[prop] === undefined) {
          consensus[prop] = effective[prop];
        } else if (consensus[prop] !== '__mixed__' && consensus[prop] !== effective[prop]) {
          consensus[prop] = '__mixed__';
        }
      });
    });

    return consensus;
  }

  // ─── Property persistence ─────────────────────────────────────────────────

  /**
   * Normalise a raw property value to the canonical stored type.
   * @param {string} propName
   * @param {*} rawValue
   * @returns {*}
   */
  function normalizePropertyValue(propName, rawValue) {
    if (propName === 'visibility') return rawValue ? 'visible' : 'hidden';
    if (propName === 'opacity')    return parseFloat(rawValue);
    if (propName === 'strokeWidth') return parseFloat(rawValue);
    return rawValue;
  }

  /**
   * Apply a single property override to the live SVG element for immediate preview.
   * @param {SVGElement} el
   * @param {string} propName
   * @param {*} propValue  Normalised value.
   */
  function applyPropertyToElement(el, propName, propValue) {
    switch (propName) {
      case 'fill':        el.style.fill = propValue;                                      break;
      case 'stroke':      el.style.stroke = propValue;                                    break;
      case 'strokeWidth': el.style.setProperty('stroke-width', String(propValue));        break;
      case 'opacity':     el.style.opacity = propValue;                                   break;
      case 'visibility':  el.style.visibility = propValue;                                break;
    }
  }

  /**
   * Persist a property change to the active transition state and preview on SVG.
   * @param {string} shapeKey
   * @param {string} propName
   * @param {*} rawValue
   */
  function saveShapeProperty(shapeKey, propName, rawValue) {
    if (!window.App) return;
    if (!App.activeStateId) {
      console.warn('ArchFlow propertyEditor: cannot save property — no active state');
      return;
    }

    const propValue = normalizePropertyValue(propName, rawValue);

    // Build an immutable copy of transitions with the updated shape entry.
    const updatedTransitions = App.config.transitions.map(function (t) {
      if (t.id !== App.activeStateId) return t;

      const existingIdx = t.shapes.findIndex(function (s) { return s.id === shapeKey; });
      let updatedShapes;

      if (existingIdx >= 0) {
        updatedShapes = t.shapes.map(function (s, idx) {
          if (idx !== existingIdx) return s;
          return Object.assign({}, s, {
            properties: Object.assign({}, s.properties, { [propName]: propValue }),
          });
        });
      } else {
        updatedShapes = t.shapes.concat([{ id: shapeKey, properties: { [propName]: propValue } }]);
      }

      return Object.assign({}, t, { shapes: updatedShapes });
    });

    App.updateConfig({ transitions: updatedTransitions });

    // Live SVG preview.
    const record = App.shapes.get(shapeKey);
    if (record && record.el) {
      applyPropertyToElement(record.el, propName, propValue);
    }
  }

  /**
   * Persist a property change to the active transition state for ALL shapes in keySet.
   * Fires App.updateConfig exactly once to avoid redundant re-renders.
   * @param {Set<string>} keySet
   * @param {string} propName
   * @param {*} rawValue
   */
  function saveBulkProperty(keySet, propName, rawValue) {
    if (!window.App) return;
    if (!App.activeStateId) {
      console.warn('ArchFlow propertyEditor: cannot save bulk property — no active state');
      return;
    }
    if (!keySet || keySet.size === 0) return;

    const propValue = normalizePropertyValue(propName, rawValue);

    const updatedTransitions = App.config.transitions.map(function (t) {
      if (t.id !== App.activeStateId) return t;

      // Apply override for every key in keySet in one pass.
      let shapes = t.shapes.slice();

      keySet.forEach(function (shapeKey) {
        const existingIdx = shapes.findIndex(function (s) { return s.id === shapeKey; });
        if (existingIdx >= 0) {
          shapes = shapes.map(function (s, idx) {
            if (idx !== existingIdx) return s;
            return Object.assign({}, s, {
              properties: Object.assign({}, s.properties, { [propName]: propValue }),
            });
          });
        } else {
          shapes = shapes.concat([{ id: shapeKey, properties: { [propName]: propValue } }]);
        }
      });

      return Object.assign({}, t, { shapes: shapes });
    });

    App.updateConfig({ transitions: updatedTransitions });

    // Live SVG preview for all selected elements.
    keySet.forEach(function (key) {
      const record = App.shapes.get(key);
      if (record && record.el) applyPropertyToElement(record.el, propName, propValue);
    });
  }

  // ─── Controls HTML ────────────────────────────────────────────────────────

  /**
   * Build the inner HTML of the property editor body.
   * Merges baseline values with any active-state overrides.
   * In multi-select mode, options.multiValues provides pre-computed consensus values.
   * @param {Object|null} baseline
   * @param {Object} overrides
   * @param {{ multiValues?: Object }=} options
   * @returns {string}
   */
  function buildControlsHTML(baseline, overrides, options) {
    const multiValues = options && options.multiValues;

    let fill, stroke, strokeWidth, opacity, visRaw;
    let fillMixed = false, strokeMixed = false, swMixed = false, opMixed = false, visMixed = false;

    if (multiValues) {
      fillMixed   = multiValues.fill        === '__mixed__';
      strokeMixed = multiValues.stroke      === '__mixed__';
      swMixed     = multiValues.strokeWidth === '__mixed__';
      opMixed     = multiValues.opacity     === '__mixed__';
      visMixed    = multiValues.visibility  === '__mixed__';

      fill        = fillMixed   ? 'mixed' : multiValues.fill;
      stroke      = strokeMixed ? 'mixed' : multiValues.stroke;
      strokeWidth = swMixed     ? 5       : multiValues.strokeWidth;
      opacity     = opMixed     ? 0.5     : multiValues.opacity;
      visRaw      = visMixed    ? undefined : multiValues.visibility;
    } else {
      fill        = overrides.fill        !== undefined ? overrides.fill        : (baseline.fill        || '#000000');
      stroke      = overrides.stroke      !== undefined ? overrides.stroke      : (baseline.stroke      || '#000000');
      strokeWidth = overrides.strokeWidth !== undefined ? overrides.strokeWidth : (baseline.strokeWidth != null ? baseline.strokeWidth : 1);
      opacity     = overrides.opacity     !== undefined ? overrides.opacity     : (baseline.opacity     != null ? baseline.opacity     : 1);
      visRaw      = overrides.visibility  !== undefined ? overrides.visibility  : baseline.visibility;
    }

    const isVisible = !visMixed && visRaw !== 'hidden' && visRaw !== false;

    const safeFill   = fillMixed   ? '#808080' : normalizeColorForInput(fill);
    const safeStroke = strokeMixed ? '#808080' : normalizeColorForInput(stroke);
    const swVal      = swMixed     ? 5         : (parseFloat(strokeWidth) || 0);
    const opVal      = opMixed     ? 0.5       : parseFloat(opacity);

    const rowStyle =
      'display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;';
    const labelStyle =
      'font-family:var(--font-ui); font-size:12px; color:var(--text-secondary);';
    const textInputStyle =
      'width:70px; background:rgba(0,0,0,0.04); border:1px solid var(--border-subtle);' +
      ' border-radius:4px; padding:2px 6px; font-family:var(--font-mono); font-size:11px;' +
      ' color:var(--text-primary); outline:none;';
    const textInputMixedStyle = textInputStyle + ' font-style:italic; color:var(--text-muted);';
    const rangeStyle =
      'width:80px; accent-color:var(--accent-primary);';
    const displayStyle =
      'font-family:var(--font-mono); font-size:11px; color:var(--text-secondary);' +
      ' min-width:36px; text-align:right;';
    const displayMixedStyle =
      'font-family:var(--font-mono); font-size:11px; color:var(--text-muted);' +
      ' min-width:36px; text-align:right; font-style:italic;';

    return (
      // Fill
      '<div style="' + rowStyle + '">' +
        '<label for="prop-fill" style="' + labelStyle + '">Fill</label>' +
        '<div style="display:flex; align-items:center; gap:6px;">' +
          '<input type="color" id="prop-fill" value="' + escapeAttr(safeFill) + '"' +
          ' style="width:28px; height:22px; border:none; border-radius:4px; cursor:pointer; background:none;">' +
          '<input type="text" id="prop-fill-text" value="' + escapeAttr(fill) + '" maxlength="20"' +
          ' style="' + (fillMixed ? textInputMixedStyle : textInputStyle) + '">' +
        '</div>' +
      '</div>' +

      // Stroke
      '<div style="' + rowStyle + '">' +
        '<label for="prop-stroke" style="' + labelStyle + '">Stroke</label>' +
        '<div style="display:flex; align-items:center; gap:6px;">' +
          '<input type="color" id="prop-stroke" value="' + escapeAttr(safeStroke) + '"' +
          ' style="width:28px; height:22px; border:none; border-radius:4px; cursor:pointer; background:none;">' +
          '<input type="text" id="prop-stroke-text" value="' + escapeAttr(stroke) + '" maxlength="20"' +
          ' style="' + (strokeMixed ? textInputMixedStyle : textInputStyle) + '">' +
        '</div>' +
      '</div>' +

      // Stroke width
      '<div style="' + rowStyle + '">' +
        '<label for="prop-stroke-width" style="' + labelStyle + '">Stroke W</label>' +
        '<div style="display:flex; align-items:center; gap:6px;">' +
          '<input type="range" id="prop-stroke-width" min="0" max="20" step="0.5"' +
          ' value="' + swVal + '" style="' + rangeStyle + '">' +
          '<span id="prop-stroke-width-display" style="' + (swMixed ? displayMixedStyle : displayStyle) + '">' +
            (swMixed ? 'mixed' : swVal) +
          '</span>' +
        '</div>' +
      '</div>' +

      // Opacity
      '<div style="' + rowStyle + '">' +
        '<label for="prop-opacity" style="' + labelStyle + '">Opacity</label>' +
        '<div style="display:flex; align-items:center; gap:6px;">' +
          '<input type="range" id="prop-opacity" min="0" max="1" step="0.05"' +
          ' value="' + opVal + '" style="' + rangeStyle + '">' +
          '<span id="prop-opacity-display" style="' + (opMixed ? displayMixedStyle : displayStyle) + '">' +
            (opMixed ? 'mixed' : Math.round(opVal * 100) + '%') +
          '</span>' +
        '</div>' +
      '</div>' +

      // Visibility
      '<div style="' + rowStyle + ' margin-bottom:16px;">' +
        '<label for="prop-visibility" style="' + labelStyle + '">Visible</label>' +
        '<input type="checkbox" id="prop-visibility"' +
        (!visMixed && isVisible ? ' checked' : '') +
        (visMixed ? ' data-mixed="true"' : '') +
        ' style="width:16px; height:16px; accent-color:var(--accent-primary); cursor:pointer;">' +
      '</div>' +

      // Reset button
      '<button id="prop-reset-baseline"' +
      ' style="width:100%; padding:7px 0; border-radius:6px; border:1px solid var(--border-subtle);' +
      ' background:rgba(0,0,0,0.04); font-family:var(--font-ui); font-size:12px;' +
      ' color:var(--text-secondary); cursor:pointer; transition:background 150ms, color 150ms, border-color 150ms;">' +
        'Reset to baseline' +
      '</button>'
    );
  }

  // ─── Event wiring ─────────────────────────────────────────────────────────

  /**
   * Wire all control change events after injecting control HTML.
   * Accepts either a single shape key (string) or a Set of keys for multi-select.
   * @param {string|Set<string>} keyOrSet
   * @param {Object|null} baseline  Used only in single-select mode for reset.
   */
  function wireControlEvents(keyOrSet, baseline) {
    const isBulk = keyOrSet instanceof Set;

    function save(prop, val) {
      if (isBulk) {
        saveBulkProperty(keyOrSet, prop, val);
      } else {
        saveShapeProperty(keyOrSet, prop, val);
      }
    }

    const fillInput  = document.getElementById('prop-fill');
    const fillText   = document.getElementById('prop-fill-text');
    if (fillInput && fillText) {
      fillInput.addEventListener('input', function () {
        fillText.value = fillInput.value;
        save('fill', fillInput.value);
      });
      fillText.addEventListener('change', function () {
        const val = fillText.value.trim();
        fillInput.value = normalizeColorForInput(val);
        save('fill', val);
      });
    }

    const strokeInput = document.getElementById('prop-stroke');
    const strokeText  = document.getElementById('prop-stroke-text');
    if (strokeInput && strokeText) {
      strokeInput.addEventListener('input', function () {
        strokeText.value = strokeInput.value;
        save('stroke', strokeInput.value);
      });
      strokeText.addEventListener('change', function () {
        const val = strokeText.value.trim();
        strokeInput.value = normalizeColorForInput(val);
        save('stroke', val);
      });
    }

    const swInput   = document.getElementById('prop-stroke-width');
    const swDisplay = document.getElementById('prop-stroke-width-display');
    if (swInput && swDisplay) {
      swInput.addEventListener('input', function () {
        const val = parseFloat(swInput.value);
        swDisplay.textContent = val;
        save('strokeWidth', val);
      });
    }

    const opInput   = document.getElementById('prop-opacity');
    const opDisplay = document.getElementById('prop-opacity-display');
    if (opInput && opDisplay) {
      opInput.addEventListener('input', function () {
        const val = parseFloat(opInput.value);
        opDisplay.textContent = Math.round(val * 100) + '%';
        save('opacity', val);
      });
    }

    const visInput = document.getElementById('prop-visibility');
    if (visInput) {
      if (visInput.dataset.mixed === 'true') visInput.indeterminate = true;
      visInput.addEventListener('change', function () {
        save('visibility', visInput.checked);
        visInput.indeterminate = false; // once changed, it's no longer mixed
      });
    }

    const resetBtn = document.getElementById('prop-reset-baseline');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (isBulk) {
          resetBulkToBaseline(keyOrSet);
        } else {
          resetToBaseline(keyOrSet, baseline);
        }
      });
      resetBtn.addEventListener('mouseenter', function () {
        resetBtn.style.background    = 'rgba(139,37,0,0.08)';
        resetBtn.style.color         = 'var(--accent-warning)';
        resetBtn.style.borderColor   = 'rgba(139,37,0,0.25)';
      });
      resetBtn.addEventListener('mouseleave', function () {
        resetBtn.style.background    = 'rgba(0,0,0,0.04)';
        resetBtn.style.color         = 'var(--text-secondary)';
        resetBtn.style.borderColor   = 'var(--border-subtle)';
      });
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Bind the editor to a shape: render controls and show the panel.
   * @param {string} shapeKey
   */
  function bind(shapeKey) {
    if (!window.App) return;
    if (!shapeKey || !App.shapes.has(shapeKey)) {
      console.error('ArchFlow propertyEditor: bind called with invalid shapeKey:', shapeKey);
      return;
    }

    boundShapeKey = shapeKey;
    const record = App.shapes.get(shapeKey);

    const labelEl = document.getElementById('prop-editor-shape-label');
    if (labelEl) labelEl.textContent = record.label;

    const body = document.getElementById('prop-editor-body');
    if (!body) return;

    const overrides = getActiveStateShapeProperties(shapeKey);
    body.innerHTML = buildControlsHTML(record.baseline, overrides);
    wireControlEvents(shapeKey, record.baseline);

    panel.hidden = false;
  }

  /**
   * Bind the editor to multiple shapes: render merged controls and show the panel.
   * Delegates to bind() when keySet has exactly one element.
   * @param {Set<string>} keySet
   */
  function bindMulti(keySet) {
    if (!window.App) return;
    if (!keySet || !(keySet instanceof Set) || keySet.size === 0) {
      unbind();
      return;
    }
    if (keySet.size === 1) {
      bind(keySet.values().next().value);
      return;
    }

    boundShapeKey = null;
    boundKeys = new Set(keySet);

    const labelEl = document.getElementById('prop-editor-shape-label');
    if (labelEl) labelEl.textContent = keySet.size + ' shapes';

    const body = document.getElementById('prop-editor-body');
    if (!body) return;

    const multiValues = computeMultiValues(boundKeys);
    body.innerHTML = buildControlsHTML(null, {}, { multiValues: multiValues });
    wireControlEvents(boundKeys, null);

    panel.hidden = false;
  }

  /** Unbind: hide the panel and clear its contents. */
  function unbind() {
    boundShapeKey = null;
    boundKeys = new Set();
    if (panel) panel.hidden = true;

    const body = document.getElementById('prop-editor-body');
    if (body) body.innerHTML = '';

    const labelEl = document.getElementById('prop-editor-shape-label');
    if (labelEl) labelEl.textContent = '';
  }

  /**
   * Remove all overrides for the bound shape from the active state,
   * restore baseline properties on the SVG element, and refresh controls.
   * @param {string} shapeKey
   * @param {Object} baseline
   */
  function resetToBaseline(shapeKey, baseline) {
    if (!window.App) return;
    if (!App.activeStateId) return;

    const record = App.shapes.get(shapeKey);
    if (!record) return;

    // Apply baseline directly to SVG element.
    if (baseline.fill        !== undefined) record.el.style.fill = baseline.fill;
      else record.el.style.fill = '';
    if (baseline.stroke      !== undefined) record.el.style.stroke = baseline.stroke;
      else record.el.style.stroke = '';
    if (baseline.strokeWidth !== undefined) record.el.style.setProperty('stroke-width', String(baseline.strokeWidth));
      else record.el.style.removeProperty('stroke-width');
    if (baseline.opacity !== undefined && baseline.opacity !== '')
      record.el.style.opacity = baseline.opacity;
    else
      record.el.style.opacity = '';

    if (baseline.visibility !== undefined && baseline.visibility !== '')
      record.el.style.visibility = baseline.visibility;
    else
      record.el.style.visibility = '';

    // Remove shape entry from active transition state.
    const updatedTransitions = App.config.transitions.map(function (t) {
      if (t.id !== App.activeStateId) return t;
      return Object.assign({}, t, {
        shapes: t.shapes.filter(function (s) { return s.id !== shapeKey; }),
      });
    });

    App.updateConfig({ transitions: updatedTransitions });

    // Re-render controls to reflect the now-baseline values.
    bind(shapeKey);
  }

  /**
   * Remove all overrides for every shape in keySet from the active state,
   * restore baseline on each SVG element, and refresh the multi-select editor.
   * @param {Set<string>} keySet
   */
  function resetBulkToBaseline(keySet) {
    if (!window.App) return;
    if (!App.activeStateId) return;

    keySet.forEach(function (key) {
      const record = App.shapes.get(key);
      if (!record) return;
      const b = record.baseline;
      if (b.fill        !== undefined) record.el.style.fill = b.fill; else record.el.style.fill = '';
      if (b.stroke      !== undefined) record.el.style.stroke = b.stroke; else record.el.style.stroke = '';
      if (b.strokeWidth !== undefined) record.el.style.setProperty('stroke-width', String(b.strokeWidth)); else record.el.style.removeProperty('stroke-width');
      if (b.opacity !== undefined && b.opacity !== '')
        record.el.style.opacity = b.opacity;
      else
        record.el.style.opacity = '';
      if (b.visibility !== undefined && b.visibility !== '')
        record.el.style.visibility = b.visibility;
      else
        record.el.style.visibility = '';
    });

    const updatedTransitions = App.config.transitions.map(function (t) {
      if (t.id !== App.activeStateId) return t;
      return Object.assign({}, t, {
        shapes: t.shapes.filter(function (s) { return !keySet.has(s.id); }),
      });
    });

    App.updateConfig({ transitions: updatedTransitions });
    bindMulti(keySet);
  }

  // ─── Panel creation ────────────────────────────────────────────────────────

  function createPanelElement() {
    const el = document.createElement('div');
    el.id = 'panel-property-editor';
    el.className = 'glass-panel panel-floating edit-panel';
    el.style.cssText = 'position:fixed; top:72px; right:16px; width:260px; z-index:800;';
    el.hidden = true;
    el.innerHTML =
      '<div class="panel-drag-handle" style="padding:12px 14px 8px; cursor:grab;' +
      ' display:flex; align-items:center; justify-content:space-between;' +
      ' border-bottom:1px solid var(--border-subtle);">' +
        '<span style="font-family:var(--font-ui); font-size:12px; font-weight:600;' +
        ' color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.08em;">Properties</span>' +
        '<span id="prop-editor-shape-label" style="font-family:var(--font-mono); font-size:11px;' +
        ' color:var(--accent-primary); max-width:120px; overflow:hidden;' +
        ' text-overflow:ellipsis; white-space:nowrap;"></span>' +
      '</div>' +
      '<div id="prop-editor-body" style="padding:14px;"></div>';
    return el;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.App) {
      console.error('ArchFlow: App not initialised');
      return;
    }

    App.panels = App.panels || {};

    const host = document.getElementById('panels-host');
    if (!host) {
      console.error('ArchFlow propertyEditor: #panels-host not found');
      return;
    }

    panel = createPanelElement();
    host.appendChild(panel);

    App.makeDraggable(panel, {
      handleSelector: '.panel-drag-handle',
      storageKey: 'archflow-panel-propeditor',
    });

    App.panels.propertyEditor = { bind, bindMulti, unbind };
  });
}());
