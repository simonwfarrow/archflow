/**
 * ArchFlow — annotationEditor.js
 * Annotation authoring UI: two-click placement workflow (arrow tip → label
 * position), a floating per-transition annotations panel, and a text-input
 * overlay for entering annotation labels.
 * Attaches to App.annotationEditor on DOMContentLoaded.
 */
(function () {
  'use strict';

  // ─── Module-level private state ─────────────────────────────────────────────

  /** @type {'idle'|'waiting-tip'|'waiting-label'} Current authoring workflow step. */
  let annotateState = 'idle';

  /** @type {{x: number, y: number}|null} First click: SVG coords for the arrow tip. */
  let pendingTip = null;

  /** @type {{x: number, y: number}|null} Second click: SVG coords for the label position. */
  let pendingLabel = null;

  /** @type {HTMLElement|null} The floating annotations panel DOM element. */
  let panel = null;

  /** @type {HTMLElement|null} The scrollable body child of the annotations panel. */
  let panelBody = null;

  /** @type {HTMLElement|null} The count badge element inside the drag handle. */
  let badgeEl = null;

  // ─── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Sanitise a string for safe insertion as innerHTML text.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Truncate a string to maxLen characters, appending '…' when trimmed.
   * @param {string} str
   * @param {number} maxLen
   * @returns {string}
   */
  function truncate(str, maxLen) {
    if (str == null) return '';
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '\u2026';
  }

  // ─── SVG coordinate conversion ──────────────────────────────────────────────

  /**
   * Convert a mouse event's screen coordinates to SVG user-space coordinates.
   * Returns null when no SVG is present or the transform matrix is unavailable.
   * @param {MouseEvent} e
   * @returns {{x: number, y: number}|null}
   */
  function svgCoordsFromEvent(e) {
    const svgEl = document.querySelector('#svg-host > svg');
    if (!svgEl) return null;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  // ─── Capture overlay ────────────────────────────────────────────────────────

  /**
   * Handle clicks on the full-viewport capture overlay.
   * First click records the arrow tip; second click records the label position
   * and opens the text-input overlay.
   * @param {MouseEvent} e
   */
  function handleCaptureClick(e) {
    if (annotateState === 'waiting-tip') {
      const coords = svgCoordsFromEvent(e);
      if (!coords) return;

      pendingTip    = { x: coords.x, y: coords.y };
      annotateState = 'waiting-label';

      const capture = document.getElementById('af-annotate-capture');
      if (capture) capture.setAttribute('aria-label', 'Click to place label');

      renderAnnotationsPanel();
      return;
    }

    if (annotateState === 'waiting-label') {
      const coords = svgCoordsFromEvent(e);
      if (!coords) return;

      pendingLabel = { x: coords.x, y: coords.y };

      const capture = document.getElementById('af-annotate-capture');
      if (capture) capture.style.display = 'none';

      showTextInputOverlay(e.clientX, e.clientY);
    }
  }

  // ─── Text input overlay ─────────────────────────────────────────────────────

  /**
   * Position and reveal the annotation text-input overlay near the given screen point.
   * @param {number} screenX
   * @param {number} screenY
   */
  function showTextInputOverlay(screenX, screenY) {
    const overlay = document.getElementById('af-annotation-text-overlay');
    if (!overlay) return;

    overlay.style.left = Math.min(screenX, window.innerWidth  - 280) + 'px';
    overlay.style.top  = Math.min(screenY + 12, window.innerHeight - 120) + 'px';
    overlay.removeAttribute('hidden');

    const input = document.getElementById('af-annotation-text-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  /**
   * Hide and clear the annotation text-input overlay.
   */
  function hideTextInputOverlay() {
    const overlay = document.getElementById('af-annotation-text-overlay');
    if (overlay) overlay.setAttribute('hidden', '');

    const input = document.getElementById('af-annotation-text-input');
    if (input) input.value = '';
  }

  // ─── Annotation CRUD ────────────────────────────────────────────────────────

  /**
   * Confirm and persist the pending annotation with the given text.
   * Deactivates annotate mode after saving.
   * @param {string} text
   */
  function confirmAnnotation(text) {
    if (!text.trim()) return;

    if (!pendingTip || !pendingLabel || !App.activeStateId) {
      deactivateAnnotateMode();
      return;
    }

    const activeTransition = App.config.transitions.find(function (t) {
      return t.id === App.activeStateId;
    });

    if (!activeTransition) {
      deactivateAnnotateMode();
      return;
    }

    const annotation = {
      id:     App.generateId(),
      text:   text.trim(),
      labelX: pendingLabel.x,
      labelY: pendingLabel.y,
      arrow: {
        fromX: pendingLabel.x,
        fromY: pendingLabel.y,
        toX:   pendingTip.x,
        toY:   pendingTip.y,
      },
    };

    const updatedAnnotations = (activeTransition.annotations || []).concat([annotation]);

    const updatedTransitions = App.config.transitions.map(function (t) {
      return t.id !== App.activeStateId
        ? t
        : Object.assign({}, t, { annotations: updatedAnnotations });
    });

    App.updateConfig({ transitions: updatedTransitions });
    App.annotationLayer.render(updatedAnnotations);
    deactivateAnnotateMode();
  }

  /**
   * Remove the annotation with the given ID from the active transition.
   * @param {string} annotationId
   */
  function deleteAnnotation(annotationId) {
    if (!App.activeStateId) return;

    const activeTransition = App.config.transitions.find(function (t) {
      return t.id === App.activeStateId;
    });
    if (!activeTransition) return;

    const updatedAnnotations = (activeTransition.annotations || []).filter(function (a) {
      return a.id !== annotationId;
    });

    const updatedTransitions = App.config.transitions.map(function (t) {
      return t.id !== App.activeStateId
        ? t
        : Object.assign({}, t, { annotations: updatedAnnotations });
    });

    App.updateConfig({ transitions: updatedTransitions });
    App.annotationLayer.render(updatedAnnotations);
    renderAnnotationsPanel();
  }

  // ─── Mode management ────────────────────────────────────────────────────────

  /**
   * Enter annotation authoring mode — reveals the capture overlay and arms first click.
   * No-ops when no transition state is currently selected.
   */
  function activateAnnotateMode() {
    if (!App.activeStateId) return;

    annotateState = 'waiting-tip';

    const capture = document.getElementById('af-annotate-capture');
    if (capture) {
      capture.style.display = 'block';
      capture.setAttribute('aria-label', 'Click on the diagram where the arrow should point');
    }

    const btn = document.getElementById('btn-annotate');
    if (btn) {
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('active');
    }

    renderAnnotationsPanel();
  }

  /**
   * Exit annotation authoring mode — resets all pending state and hides all overlays.
   */
  function deactivateAnnotateMode() {
    annotateState = 'idle';
    pendingTip    = null;
    pendingLabel  = null;

    const capture = document.getElementById('af-annotate-capture');
    if (capture) capture.style.display = 'none';

    hideTextInputOverlay();

    const btn = document.getElementById('btn-annotate');
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('active');
    }
  }

  // ─── Annotations panel ──────────────────────────────────────────────────────

  /**
   * Build a contextual hint row HTML fragment reflecting the current annotateState.
   * Returns an empty string when the workflow is idle.
   * @returns {string}
   */
  function buildHintRow() {
    if (annotateState === 'waiting-tip') {
      return '<div style="padding:6px 12px;font-size:11px;' +
             'color:var(--accent-primary);font-style:italic;">' +
             'Click the diagram element to annotate</div>';
    }
    if (annotateState === 'waiting-label') {
      return '<div style="padding:6px 12px;font-size:11px;' +
             'color:var(--accent-primary);font-style:italic;">' +
             'Click where to place the label</div>';
    }
    return '';
  }

  /**
   * Rebuild the annotations panel HTML and re-wire delete-button click handlers.
   * Hides the panel entirely when in play mode or when no SVG has been loaded.
   */
  function renderAnnotationsPanel() {
    if (!panel || !panelBody) return;

    if (App.mode === 'play') {
      panel.hidden = true;
      return;
    }
    if (!document.body.classList.contains('svg-loaded')) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;

    const activeTransition = App.config.transitions.find(function (t) {
      return t.id === App.activeStateId;
    });
    const annotations = (activeTransition && activeTransition.annotations) || [];

    const hintHtml = buildHintRow();

    let listHtml = '';
    if (annotations.length === 0 && annotateState === 'idle') {
      listHtml =
        '<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);">' +
        'No annotations \u2014 click Annotate to add one</div>';
    } else {
      listHtml = annotations.map(function (ann) {
        const label  = escapeHtml(truncate(ann.text, 22));
        const safeId = escapeHtml(ann.id);
        return (
          '<div style="display:flex;align-items:center;justify-content:space-between;' +
          'padding:5px 10px 5px 12px;border-bottom:1px solid var(--border-subtle);">' +
          '<span style="font-size:12px;color:var(--text-primary);flex:1;min-width:0;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + label + '</span>' +
          '<button class="af-ann-delete-btn" data-annotation-id="' + safeId + '" type="button"' +
          ' style="flex-shrink:0;margin-left:6px;padding:2px 5px;font-size:11px;cursor:pointer;' +
          'border:1px solid var(--border-glass);border-radius:var(--radius-btn);' +
          'background:transparent;color:var(--text-muted);"' +
          ' aria-label="Delete annotation">&#10005;</button>' +
          '</div>'
        );
      }).join('');
    }

    // Update the badge count in the static drag handle
    if (badgeEl) badgeEl.textContent = annotations.length;
    // Update dynamic body content
    panelBody.innerHTML = hintHtml + listHtml;

    // Wire delete button click handlers after innerHTML replaces DOM nodes
    panelBody.querySelectorAll('.af-ann-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteAnnotation(btn.dataset.annotationId);
      });
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.App) {
      console.error('ArchFlow annotationEditor: App not initialised — annotationEditor will not mount');
      return;
    }

    // 1. Capture overlay ─────────────────────────────────────────────────────
    const capture = document.createElement('div');
    capture.id = 'af-annotate-capture';
    capture.style.cssText = 'position:fixed;inset:0;z-index:500;cursor:crosshair;display:none;';
    capture.setAttribute('aria-label', 'Click on the diagram where the arrow should point');
    capture.addEventListener('click', handleCaptureClick);
    document.body.appendChild(capture);

    // Escape key exits annotate mode from anywhere
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && annotateState !== 'idle') deactivateAnnotateMode();
    });

    // 2. Annotations panel ───────────────────────────────────────────────────
    const panelsHost = document.getElementById('panels-host');

    panel = document.createElement('div');
    panel.id = 'af-annotations-panel';
    panel.className = 'glass-panel panel-floating edit-panel';
    panel.setAttribute('hidden', '');
    panel.style.cssText = [
      'position:fixed',
      'top:72px',
      'left:270px',
      'width:220px',
      'min-height:60px',
      'max-height:50vh',
      'z-index:800',
      'display:flex',
      'flex-direction:column',
    ].join(';');

    const dragHandle = document.createElement('div');
    dragHandle.className = 'panel-drag-handle';
    dragHandle.style.cssText = [
      'padding:10px 12px 8px',
      'cursor:grab',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'border-bottom:1px solid var(--border-subtle)',
      'flex-shrink:0',
      'user-select:none',
    ].join(';');
    dragHandle.innerHTML =
      '<span style="font-weight:600;font-size:12px;text-transform:uppercase;' +
      'letter-spacing:0.06em;color:var(--text-secondary);">' +
      '&#9998; Annotations' +
      '<span id="af-ann-count-badge" style="display:inline-block;min-width:18px;' +
      'padding:1px 5px;font-size:11px;font-weight:700;background:var(--accent-primary);' +
      'color:#fff;border-radius:9px;margin-left:6px;text-align:center;">0</span>' +
      '</span>';
    badgeEl = dragHandle.querySelector('#af-ann-count-badge');
    panel.appendChild(dragHandle);

    panelBody = document.createElement('div');
    panelBody.id = 'af-annotations-body';
    panelBody.style.cssText = 'overflow-y:auto;flex:1;';
    panel.appendChild(panelBody);

    if (panelsHost) {
      panelsHost.appendChild(panel);
    } else {
      console.warn('ArchFlow annotationEditor: #panels-host not found — annotations panel appended to body');
      document.body.appendChild(panel);
    }

    App.makeDraggable(panel, {
      handleSelector: '.panel-drag-handle',
      storageKey: 'archflow-panel-annotations',
    });

    // 3. Text input overlay ──────────────────────────────────────────────────
    const textOverlayWrapper = document.createElement('div');
    textOverlayWrapper.innerHTML =
      '<div id="af-annotation-text-overlay" hidden' +
      '     role="dialog" aria-modal="true" aria-label="Enter annotation text"' +
      '     style="position:fixed;z-index:850;min-width:240px;padding:12px;' +
      '            background:var(--bg-panel);border:1px solid var(--border-glass);' +
      '            border-radius:var(--radius-panel);box-shadow:var(--shadow-panel);' +
      '            font-family:var(--font-ui);">' +
      '  <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;' +
      '                letter-spacing:0.06em;color:var(--text-secondary);margin-bottom:6px;">' +
      '    Annotation text' +
      '  </label>' +
      '  <input id="af-annotation-text-input" type="text" placeholder="Label text\u2026" maxlength="80"' +
      '         style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:13px;' +
      '                font-family:var(--font-ui);border:1px solid var(--border-glass);' +
      '                border-radius:var(--radius-btn);background:#fff;color:var(--text-primary);' +
      '                outline:none;">' +
      '  <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">' +
      '    <button id="af-annotation-text-cancel" type="button"' +
      '            style="padding:4px 10px;font-size:12px;font-family:var(--font-ui);' +
      '                   border:1px solid var(--border-glass);border-radius:var(--radius-btn);' +
      '                   background:transparent;cursor:pointer;color:var(--text-secondary);">' +
      '      Cancel' +
      '    </button>' +
      '    <button id="af-annotation-text-confirm" type="button"' +
      '            style="padding:4px 12px;font-size:12px;font-family:var(--font-ui);' +
      '                   border:1px solid transparent;border-radius:var(--radius-btn);' +
      '                   background:var(--accent-primary);color:#fff;cursor:pointer;">' +
      '      Add' +
      '    </button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(textOverlayWrapper.firstChild);

    // 4. Wire #btn-annotate toggle ───────────────────────────────────────────
    const btnAnnotate = document.getElementById('btn-annotate');
    if (btnAnnotate) {
      btnAnnotate.addEventListener('click', function () {
        if (annotateState !== 'idle') {
          deactivateAnnotateMode();
        } else {
          activateAnnotateMode();
        }
      });
    }

    // 5. Wire text overlay confirm / cancel buttons ──────────────────────────
    const btnConfirm = document.getElementById('af-annotation-text-confirm');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', function () {
        const input = document.getElementById('af-annotation-text-input');
        confirmAnnotation(input ? input.value : '');
      });
    }

    const btnCancel = document.getElementById('af-annotation-text-cancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', function () {
        deactivateAnnotateMode();
      });
    }

    // 6. Wire text input keyboard shortcuts ──────────────────────────────────
    const textInput = document.getElementById('af-annotation-text-input');
    if (textInput) {
      textInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmAnnotation(textInput.value);
        } else if (e.key === 'Escape') {
          deactivateAnnotateMode();
        }
      });
    }

    // 7. App event hooks ─────────────────────────────────────────────────────
    App.on('onStateChange',  renderAnnotationsPanel);
    App.on('onConfigUpdate', renderAnnotationsPanel);
    App.on('onModeChange',   function (mode) {
      if (mode === 'play') deactivateAnnotateMode();
      renderAnnotationsPanel();
    });
    App.on('onSVGLoad', renderAnnotationsPanel);

    // 8. Expose public API ───────────────────────────────────────────────────
    App.annotationEditor = {
      activateAnnotateMode:   activateAnnotateMode,
      deactivateAnnotateMode: deactivateAnnotateMode,
      renderAnnotationsPanel: renderAnnotationsPanel,
    };
  });

}());
