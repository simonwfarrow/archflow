/**
 * pngZipExport.js — PNG ZIP export module for ArchFlow
 *
 * Renders every transition state to a PNG via App.export.renderStateToPNG,
 * bundles them into a ZIP archive using JSZip, and triggers a browser download.
 *
 * Attaches: window.App.pngZipExport = { exportPngZip }
 *
 * IIFE — no import/export, no class keyword, no type="module".
 * Must load after exportManager.js (which exposes App.export.renderStateToPNG).
 */
(function () {
  'use strict';

  // ── Utility helpers ──────────────────────────────────────────────────────────

  /**
   * Yield control to the browser event loop so the progress modal can repaint
   * between renders.
   * @returns {Promise<void>}
   */
  function yieldToUI() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /**
   * Sanitize a transition name into a safe filename fragment:
   * lowercase, non-alphanumeric chars replaced with `-`, multiple dashes
   * collapsed, leading/trailing dashes removed.
   *
   * @param {string} name
   * @returns {string}
   */
  function sanitizeFilename(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // ── Progress modal helpers ───────────────────────────────────────────────────

  /**
   * Show the shared export progress modal with the PNG ZIP heading.
   * Resets the bar to 0 % and the counter to "0 / N".
   *
   * @param {number} total  Total number of states to export.
   */
  function showExportProgress(total) {
    const backdrop     = document.getElementById('export-modal-backdrop');
    const modal        = document.getElementById('export-modal');
    const modalLabel   = document.getElementById('export-modal-label');
    const progressFill = document.getElementById('export-progress-fill');
    const counter      = document.getElementById('export-progress-counter');

    if (!backdrop) return;

    if (modalLabel)   modalLabel.textContent   = 'Exporting PNG ZIP\u2026';
    if (progressFill) progressFill.style.width = '0%';
    if (counter)      counter.textContent      = '0 / ' + (total || 0);

    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    if (modal) modal.setAttribute('aria-hidden', 'false');

    // Add visibility classes on the next frame so CSS transition fires
    // (hidden must be removed first so the element is rendered before animating)
    requestAnimationFrame(function () {
      backdrop.classList.add('modal-backdrop--visible');
      if (modal) modal.classList.add('modal-panel--visible');
    });
  }

  /**
   * Update the progress bar fill and counter text.
   *
   * @param {number} current  Number of states completed so far.
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
   * Sets `hidden` after the 220 ms CSS transition completes.
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

  // ── Button-disable helper ────────────────────────────────────────────────────

  /**
   * Enable or disable all export buttons to prevent concurrent exports.
   *
   * @param {boolean} disabled
   */
  function setButtonsDisabled(disabled) {
    var ids = [
      'btn-export-pptx',
      'btn-export-pdf',
      'btn-export-gif',
      'btn-export-png-zip',
    ];
    ids.forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.disabled = disabled;
    });
  }

  // ── Core export function ─────────────────────────────────────────────────────

  /**
   * Render every transition state to PNG and bundle them into a ZIP archive,
   * then trigger a browser download of `archflow-states.zip`.
   *
   * @returns {Promise<void>}
   */
  async function exportPngZip() {
    // ── Guard clauses (Law of the Early Exit) ──────────────────────────────────
    if (!window.JSZip) {
      console.error('ArchFlow pngZipExport: JSZip is not loaded. Add the JSZip CDN script before pngZipExport.js.');
      return;
    }

    if (!window.App) {
      console.error('ArchFlow pngZipExport: window.App is not defined. Ensure app.js has loaded.');
      return;
    }

    if (!App.config || !App.config.transitions || App.config.transitions.length === 0) {
      console.warn('ArchFlow pngZipExport: No transitions to export. Load an SVG and create at least one state.');
      return;
    }

    if (!App.export || typeof App.export.renderStateToPNG !== 'function') {
      console.error('ArchFlow pngZipExport: App.export.renderStateToPNG is not available. Ensure exportManager.js has loaded successfully.');
      return;
    }

    // ── Setup ──────────────────────────────────────────────────────────────────
    const transitions = App.config.transitions;
    const total       = transitions.length;

    setButtonsDisabled(true);
    showExportProgress(total);

    try {
      const zip = new JSZip();

      for (let i = 0; i < transitions.length; i++) {
        const transition = transitions[i];

        updateExportProgress(i, total);
        await yieldToUI();

        const pngDataUrl = await App.export.renderStateToPNG(transition.id);

        // Strip the data URL prefix — JSZip expects raw base64
        const base64data = pngDataUrl.split(',')[1];

        if (!base64data) {
          throw new Error('pngZipExport: renderStateToPNG returned an invalid data URL for state "' + transition.id + '"');
        }

        // Build zero-padded filename: e.g. "01-my-state.png"
        const padded        = String(i + 1).padStart(2, '0');
        const safeName      = sanitizeFilename(transition.name);
        const filename      = padded + (safeName ? '-' + safeName : '') + '.png';

        zip.file(filename, base64data, { base64: true });

        updateExportProgress(i + 1, total);
        await yieldToUI();
      }

      const blob = await zip.generateAsync({ type: 'blob' });

      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'archflow-states.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);

    } catch (err) {
      console.error('ArchFlow pngZipExport: PNG ZIP export failed', err);
      alert('PNG ZIP export failed: ' + (err && err.message ? err.message : 'unknown error'));
      // finally block still runs; do not re-throw
    } finally {
      hideExportProgress();
      setButtonsDisabled(false);
    }
  }

  // ── Module attachment (synchronous, at module scope) ─────────────────────────
  window.App = window.App || {};
  window.App.pngZipExport = { exportPngZip: exportPngZip };

  // ── DOM wiring ───────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('btn-export-png-zip');

    if (!btn) {
      console.warn('ArchFlow pngZipExport: #btn-export-png-zip not found in DOM. Add it to index.html to enable PNG ZIP export.');
      return;
    }

    btn.addEventListener('click', function () {
      exportPngZip();
    });
  });

}());
