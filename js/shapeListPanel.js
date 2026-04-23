/**
 * ArchFlow — shapeListPanel.js
 * Floating, draggable glass panel that lists all parsed SVG shapes.
 * Supports shape selection which highlights the SVG element and opens
 * the property editor.
 */
(function () {
  'use strict';

  /** @type {HTMLElement|null} */
  let panel = null;

  /** @type {Set<string>} */
  let selectedKeys = new Set();

  /**
   * Reverse lookup map rebuilt on each render(): SVGElement → shapeKey.
   * Used for efficient O(1) hit-testing in the SVG click delegate.
   * @type {Map<SVGElement, string>}
   */
  const elToKeyMap = new Map();

  /** @type {string} */
  let filterText = '';

  /** @type {string|null} */
  let filterTag = null;

  // ─── Utilities ────────────────────────────────────────────────────────────

  /**
   * Returns a debounced version of fn that fires after delayMs of inactivity.
   * @param {Function} fn
   * @param {number} delayMs
   * @returns {Function}
   */
  function debounce(fn, delayMs) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx  = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, delayMs);
    };
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    if (str == null) return '';
    return String(str).replace(/"/g, '&quot;');
  }

  /**
   * Returns a filtered array of ShapeRecord objects from the given shapes map.
   * Applies the current filterTag and filterText module-level filter state.
   * Pure function — reads filter state but never mutates it or the map.
   * @param {Map<string, object>} shapesMap
   * @returns {Array<object>}
   */
  function applyFilters(shapesMap) {
    const noTagFilter  = filterTag  === null;
    const noTextFilter = filterText === '';

    if (noTagFilter && noTextFilter) return Array.from(shapesMap.values());

    const needle   = filterText.toLowerCase();
    const filtered = [];

    shapesMap.forEach(function (record) {
      const tagMatch  = noTagFilter  || record.tag === filterTag;
      const textMatch = noTextFilter ||
        record.label.toLowerCase().includes(needle) ||
        record.key.toLowerCase().includes(needle);

      if (tagMatch && textMatch) filtered.push(record);
    });

    return filtered;
  }

  // ─── Panel creation ────────────────────────────────────────────────────────

  function createPanelElement() {
    const el = document.createElement('div');
    el.id = 'panel-shape-list';
    el.className = 'glass-panel panel-floating edit-panel';
    el.style.cssText =
      'position:fixed; top:72px; left:16px; width:240px; min-height:80px;' +
      ' max-height:60vh; display:flex; flex-direction:column; z-index:800;';
    el.hidden = true;
    el.innerHTML =
      '<div class="panel-drag-handle" style="padding:12px 14px 8px; cursor:grab;' +
      ' display:flex; align-items:center; justify-content:space-between;' +
      ' border-bottom:1px solid var(--border-subtle); flex-shrink:0;">' +
        '<span style="font-family:var(--font-ui); font-size:12px; font-weight:600;' +
        ' color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.08em;">Shapes</span>' +
        '<span id="shape-count" style="font-family:var(--font-mono); font-size:11px;' +
        ' color:var(--text-muted);">0</span>' +
      '</div>' +
      '<div id="shape-filter-bar" style="padding:6px 10px; border-bottom:1px solid var(--border-subtle); flex-shrink:0;">' +
        '<input id="shape-search" type="text" placeholder="Search shapes\u2026" autocomplete="off"' +
        ' style="width:100%; box-sizing:border-box; background:rgba(0,0,0,0.04);' +
        ' border:1px solid var(--border-subtle); border-radius:6px; padding:5px 10px;' +
        ' font-family:var(--font-mono); font-size:11px; color:var(--text-primary);' +
        ' outline:none; transition:border-color 150ms;">' +
      '</div>' +
      '<div id="shape-type-pills" style="display:flex; flex-wrap:wrap; gap:4px;' +
      ' padding:5px 10px 4px; border-bottom:1px solid var(--border-subtle); flex-shrink:0;"></div>' +
      '<div id="shape-list-body" style="overflow-y:auto; flex:1; padding:6px 0;"></div>';
    return el;
  }

  // ─── Row HTML ──────────────────────────────────────────────────────────────

  /**
   * Returns HTML string for one shape row.
   * @param {{ key: string, tag: string, label: string }} shapeRecord
   * @param {boolean} isSelected
   * @returns {string}
   */
  function createShapeRowHTML(shapeRecord, isSelected) {
    const selectedStyle = isSelected
      ? 'background:rgba(0,0,0,0.06); border-left-color:var(--accent-primary);'
      : '';
    return (
      '<div class="shape-row" data-key="' + escapeAttr(shapeRecord.key) + '"' +
      ' style="padding:7px 14px; cursor:pointer; display:flex; align-items:center;' +
      ' gap:8px; transition:background 150ms; font-family:var(--font-ui);' +
      ' font-size:13px; color:var(--text-primary); border-left:3px solid transparent;' +
      ' ' + selectedStyle + '">' +
        '<span class="shape-tag-badge" style="font-family:var(--font-mono); font-size:10px;' +
        ' color:var(--text-muted); background:rgba(0,0,0,0.05); padding:2px 5px;' +
        ' border-radius:4px; flex-shrink:0;">' + escapeHtml(shapeRecord.tag) + '</span>' +
        '<span class="shape-label" style="flex:1; overflow:hidden; text-overflow:ellipsis;' +
        ' white-space:nowrap;">' + escapeHtml(shapeRecord.label) + '</span>' +
      '</div>'
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  /**
   * Re-render the full shape list from App.shapes.
   * Rebuilds the reverse element→key map for SVG click delegation.
   * Applies active filterText / filterTag to determine visible rows.
   * Groups visible rows by tag; only groups with visible rows are shown.
   */
  function render() {
    if (!window.App) return;

    const body    = document.getElementById('shape-list-body');
    const countEl = document.getElementById('shape-count');
    if (!body || !countEl) return;

    const shapes = App.shapes;

    // ── Rebuild type-filter pills (before clearing body) ─────────────────────
    const pillsContainer = document.getElementById('shape-type-pills');
    if (pillsContainer) {
      const tags = [];
      if (shapes) {
        shapes.forEach(function (record) {
          if (!tags.includes(record.tag)) tags.push(record.tag);
        });
      }

      pillsContainer.style.display = tags.length > 0 ? 'flex' : 'none';

      pillsContainer.innerHTML = tags.map(function (tag) {
        const isActive = filterTag === tag;
        return '<span class="type-pill" data-tag="' + escapeAttr(tag) + '"' +
          ' style="font-family:var(--font-mono); font-size:10px; padding:2px 8px;' +
          ' border-radius:12px; cursor:pointer; transition:background 150ms, color 150ms;' +
          ' border:1px solid ' + (isActive ? 'rgba(0,0,0,0.4)' : 'var(--border-subtle)') + ';' +
          ' background:' + (isActive ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.04)') + ';' +
          ' color:' + (isActive ? 'var(--accent-primary)' : 'var(--text-muted)') + ';">' +
          escapeHtml(tag) + '</span>';
      }).join('');
    }

    elToKeyMap.clear();

    if (!shapes || shapes.size === 0) {
      body.innerHTML =
        '<p style="padding:12px 14px; font-family:var(--font-ui); font-size:12px;' +
        ' color:var(--text-muted);">No shapes found</p>';
      countEl.textContent = '0';
      return;
    }

    // Rebuild reverse map from ALL shapes so SVG click delegation still works
    // even when a filter hides some rows.
    shapes.forEach(function (record) {
      elToKeyMap.set(record.el, record.key);
    });

    // Apply text/tag filters to determine the visible row subset.
    const visibleRecords = applyFilters(shapes);
    const isFiltering    = filterText !== '' || filterTag !== null;
    countEl.textContent  = isFiltering
      ? visibleRecords.length + ' of ' + shapes.size
      : String(shapes.size);

    // Group visible records by tag (insertion order preserved by Map).
    // Only groups that contain at least one visible record appear.
    const groupsByTag = new Map();
    visibleRecords.forEach(function (record) {
      if (!groupsByTag.has(record.tag)) groupsByTag.set(record.tag, []);
      groupsByTag.get(record.tag).push(record);
    });

    // Build HTML: one group header + rows per tag.
    let html = '';
    groupsByTag.forEach(function (records, tag) {
      html +=
        '<div class="type-group-header" data-group-tag="' + escapeAttr(tag) + '"' +
        ' style="display:flex; align-items:center; justify-content:space-between;' +
        ' padding:5px 14px 3px; margin-top:4px;">' +
          '<span style="font-family:var(--font-mono); font-size:10px; color:var(--text-muted);' +
          ' text-transform:uppercase; letter-spacing:0.06em;">' + escapeHtml(tag) + '</span>' +
          '<button class="select-all-chip" data-chip-tag="' + escapeAttr(tag) + '"' +
          ' style="font-family:var(--font-mono); font-size:9px; padding:1px 7px;' +
          ' border-radius:10px; border:1px solid var(--border-subtle);' +
          ' background:rgba(0,0,0,0.04); color:var(--text-muted);' +
          ' cursor:pointer; transition:background 150ms, color 150ms, border-color 150ms;">' +
          'select all</button>' +
        '</div>';
      records.forEach(function (record) {
        html += createShapeRowHTML(record, selectedKeys.has(record.key));
      });
    });
    body.innerHTML = html;

    // Wire row click and hover handlers.
    body.querySelectorAll('.shape-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        selectShape(row.dataset.key, e);
      });
      row.addEventListener('mouseenter', function () {
        if (!selectedKeys.has(row.dataset.key)) {
          row.style.background = 'rgba(0,0,0,0.04)';
        }
      });
      row.addEventListener('mouseleave', function () {
        if (!selectedKeys.has(row.dataset.key)) {
          row.style.background = '';
        }
      });
    });

    // Wire "select all" chip hover handlers.
    body.querySelectorAll('.select-all-chip').forEach(function (chip) {
      chip.addEventListener('mouseenter', function () {
        chip.style.background    = 'rgba(0,0,0,0.08)';
        chip.style.color         = 'var(--accent-primary)';
        chip.style.borderColor   = 'rgba(0,0,0,0.3)';
      });
      chip.addEventListener('mouseleave', function () {
        chip.style.background    = 'rgba(0,0,0,0.04)';
        chip.style.color         = 'var(--text-muted)';
        chip.style.borderColor   = 'var(--border-subtle)';
      });
    });
  }

  // ─── Selection helpers ─────────────────────────────────────────────────────

  /** Remove .svg-selected from all known shape elements. */
  function clearSVGHighlights() {
    if (!window.App || !App.shapes) return;
    App.shapes.forEach(function (record) {
      record.el.classList.remove('svg-selected');
    });
  }

  /**
   * Sync SVG highlights and row styles to the current selectedKeys set.
   * Scrolls the triggerKey row into view when it is part of the selection.
   * @param {string} [triggerKey]
   */
  function refreshSelectionUI(triggerKey) {
    clearSVGHighlights();

    if (window.App && App.shapes) {
      selectedKeys.forEach(function (key) {
        const record = App.shapes.get(key);
        if (record && record.el) record.el.classList.add('svg-selected');
      });
    }

    const body = document.getElementById('shape-list-body');
    if (!body) return;

    body.querySelectorAll('.shape-row').forEach(function (row) {
      const isActive = selectedKeys.has(row.dataset.key);
      row.style.background      = isActive ? 'rgba(0,0,0,0.06)' : '';
      row.style.borderLeftColor = isActive ? 'var(--accent-primary)' : 'transparent';
    });

    if (triggerKey && selectedKeys.has(triggerKey)) {
      const targetRow = body.querySelector('[data-key="' + escapeAttr(triggerKey) + '"]');
      if (targetRow) targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /**
   * Notify the property editor of the current selection state.
   * Handles zero-select (unbind), single-select (bind), and multi-select (bindMulti).
   * Guards bindMulti with a typeof check — it is added in Phase 3.
   * @param {string} [lastKey]  Key most recently clicked; used as bind fallback when bindMulti is absent.
   */
  function notifyPropertyEditor(lastKey) {
    if (!window.App || !App.panels || !App.panels.propertyEditor) return;
    const pe = App.panels.propertyEditor;

    if (selectedKeys.size === 0) {
      if (typeof pe.unbind === 'function') pe.unbind();
      return;
    }

    if (selectedKeys.size === 1) {
      if (typeof pe.bind === 'function') {
        pe.bind(selectedKeys.values().next().value);
      }
      return;
    }

    // Multi-select: prefer bindMulti; fall back to bind with last-clicked key.
    if (typeof pe.bindMulti === 'function') {
      pe.bindMulti(new Set(selectedKeys));
    } else if (typeof pe.bind === 'function') {
      const fallbackKey = lastKey || selectedKeys.values().next().value;
      pe.bind(fallbackKey);
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  /**
   * Select a shape by key. Ctrl/Cmd+click adds to or removes from the selection;
   * a plain click replaces the selection with just this key.
   * @param {string} key
   * @param {MouseEvent} [event]
   */
  function selectShape(key, event) {
    if (!window.App) return;
    if (!key || !App.shapes.has(key)) {
      console.error('ArchFlow shapeList: selectShape called with invalid key:', key);
      return;
    }

    const addToSelection = event && (event.ctrlKey || event.metaKey);

    if (addToSelection) {
      if (selectedKeys.has(key)) {
        selectedKeys.delete(key);
      } else {
        selectedKeys.add(key);
      }
    } else {
      selectedKeys.clear();
      selectedKeys.add(key);
    }

    refreshSelectionUI(key);
    notifyPropertyEditor(key);
  }

  /**
   * Clear all selections: removes SVG highlight, resets row styles, closes property editor.
   */
  function deselectAll() {
    clearSVGHighlights();
    selectedKeys.clear();

    const body = document.getElementById('shape-list-body');
    if (body) {
      body.querySelectorAll('.shape-row').forEach(function (row) {
        row.style.background      = '';
        row.style.borderLeftColor = 'transparent';
      });
    }

    if (
      window.App &&
      App.panels &&
      App.panels.propertyEditor &&
      typeof App.panels.propertyEditor.unbind === 'function'
    ) {
      App.panels.propertyEditor.unbind();
    }
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
      console.error('ArchFlow shapeList: #panels-host not found');
      return;
    }

    panel = createPanelElement();
    host.appendChild(panel);

    App.makeDraggable(panel, {
      handleSelector: '.panel-drag-handle',
      storageKey: 'archflow-panel-shapelist',
    });

    // Delegated click handler on the SVG host: walk up DOM to find shape element.
    const svgHost = document.getElementById('svg-host');
    if (svgHost) {
      svgHost.addEventListener('click', function (e) {
        if (!App.shapes || App.shapes.size === 0) return;

        let el = e.target;
        while (el && el !== svgHost) {
          const key = elToKeyMap.get(el);
          if (key) {
            selectShape(key, e);
            return;
          }
          el = el.parentElement;
        }
      });
    }

    App.on('onSVGLoad', function () {
      filterText = '';
      filterTag  = null;
      const searchInput = document.getElementById('shape-search');
      if (searchInput) searchInput.value = '';
      deselectAll();         // clear stale selection before rendering new shape list
      panel.hidden = false;
      render();
    });

    // ── Search input: live filter on every keystroke ──────────────────────────
    const searchInput = document.getElementById('shape-search');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(function () {
        filterText = searchInput.value;
        render();
      }, 120));
      searchInput.addEventListener('focus', function () {
        searchInput.style.borderColor = 'var(--accent-primary)';
      });
      searchInput.addEventListener('blur', function () {
        searchInput.style.borderColor = 'var(--border-subtle)';
      });
    }

    // ── Delegated click on panel: pills toggle filter; chips select all by tag ─
    panel.addEventListener('click', function (e) {
      const pill = e.target.closest('.type-pill');
      if (pill) {
        const tag = pill.dataset.tag;
        filterTag = (filterTag === tag) ? null : tag;
        render();
        return;
      }

      const chip = e.target.closest('.select-all-chip');
      if (chip) {
        const tag = chip.dataset.chipTag;
        if (!tag || !window.App || !App.shapes) return;
        const visibleOfTag = applyFilters(App.shapes).filter(function(r) { return r.tag === tag; });
        selectedKeys.clear();
        visibleOfTag.forEach(function(r) { selectedKeys.add(r.key); });
        refreshSelectionUI(null);
        notifyPropertyEditor(null);
      }
    });

    App.panels.shapeList = {
      render,
      selectShape,
      deselectAll,
      get selectedKeys() { return selectedKeys; },
    };
  });
}());
