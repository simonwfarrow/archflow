/**
 * ArchFlow — persist.js
 * Handles localStorage auto-save, JSON config export, and JSON config import.
 * Auto-save is triggered by the onConfigUpdate event (debounced).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'archflow-config-v1';

  // ─── Debounce ─────────────────────────────────────────────────────────────

  /**
   * Return a debounced version of fn that delays execution by delayMs.
   * @param {Function} fn
   * @param {number} delayMs
   * @returns {Function}
   */
  function debounce(fn, delayMs) {
    let timerId = null;
    return function () {
      const args = arguments;
      const ctx  = this;
      clearTimeout(timerId);
      timerId = setTimeout(function () { fn.apply(ctx, args); }, delayMs);
    };
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  /** Serialise App.config to localStorage. */
  function saveToLocalStorage() {
    if (!window.App) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(App.config));
    } catch (e) {
      console.warn('ArchFlow persist: failed to save to localStorage', e);
    }
  }

  // ─── SVG injection helper ─────────────────────────────────────────────────

  /**
   * Parse an SVG markup string, inject it into #svg-host, and notify ArchFlow.
   * @param {string} svgMarkup
   */
  function injectSVGFromMarkup(svgMarkup) {
    if (!window.App || !svgMarkup) return;

    const svgHost = document.getElementById('svg-host');
    if (!svgHost) return;

    try {
      const parser = new DOMParser();
      const doc    = parser.parseFromString(svgMarkup, 'image/svg+xml');

      // Guard: DOMParser signals XML errors with a <parsererror> element.
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        console.error('ArchFlow persist: SVG parse error during injection');
        return;
      }

      const svgEl = doc.querySelector('svg');
      if (!svgEl) {
        console.error('ArchFlow persist: no <svg> element found in stored markup');
        return;
      }

      svgHost.innerHTML = '';
      svgHost.appendChild(document.importNode(svgEl, true));

      const injectedEl = svgHost.querySelector('svg');
      App.markSVGLoaded(true);
      App.parseSVG(injectedEl);
      App.notifySVGLoaded(injectedEl);
    } catch (e) {
      console.error('ArchFlow persist: unexpected error during SVG injection', e);
    }
  }

  // ─── Restore ──────────────────────────────────────────────────────────────

  /**
   * Attempt to restore a previously saved config from localStorage.
   * @returns {boolean} true if a saved config was found and applied.
   */
  function restoreFromLocalStorage() {
    if (!window.App) return false;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      if (!Array.isArray(parsed.transitions))     return false;

      App.updateConfig(parsed);

      if (parsed.image) {
        injectSVGFromMarkup(parsed.image);
      }

      if (App.stateManager) {
        App.stateManager.renderStateTabs();
      }

      const transitions = parsed.transitions;
      if (transitions.length > 0) {
        App.setActiveState(transitions[0].id);
        if (App.stateManager) {
          App.stateManager.selectState(transitions[0].id);
        }
      }

      return true;
    } catch (e) {
      console.warn('ArchFlow persist: failed to restore from localStorage', e);
      return false;
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  /** Trigger a JSON download of the current App.config. */
  function exportConfigAsJSON() {
    if (!window.App) return;

    try {
      const json  = JSON.stringify(App.config, null, 2);
      const blob  = new Blob([json], { type: 'application/json' });
      const url   = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href     = url;
      anchor.download = 'archflow-config.json';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('ArchFlow persist: failed to export config', e);
    }
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  /**
   * Read a .json File, validate it as an ArchFlow config, and apply it.
   * @param {File} file
   */
  function importConfigFromFile(file) {
    if (!window.App) return;
    if (!file)              return;

    if (!file.name.toLowerCase().endsWith('.json')) {
      console.error('ArchFlow persist: importConfigFromFile requires a .json file');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const parsed = JSON.parse(e.target.result);

        if (!parsed || typeof parsed !== 'object') {
          console.error('ArchFlow persist: invalid config — not a JSON object');
          return;
        }
        if (!Array.isArray(parsed.transitions)) {
          console.error('ArchFlow persist: config must contain a transitions array');
          return;
        }

        App.updateConfig(parsed);

        if (parsed.image) {
          injectSVGFromMarkup(parsed.image);
        }

        if (App.stateManager) {
          App.stateManager.renderStateTabs();
        }

        if (parsed.transitions.length > 0) {
          App.setActiveState(parsed.transitions[0].id);
          if (App.stateManager) {
            App.stateManager.selectState(parsed.transitions[0].id);
          }
        }
      } catch (e) {
        console.error('ArchFlow persist: failed to parse imported JSON', e);
      }
    };
    reader.readAsText(file);
  }

  // ─── Clear ────────────────────────────────────────────────────────────────

  /** Remove the ArchFlow entry from localStorage entirely. */
  function clearLocalStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('ArchFlow persist: failed to clear localStorage', e);
    }
  }

  // ─── Reset modal ──────────────────────────────────────────────────────────

  /**
   * Entry point for the "New Architecture" button.
   * Skips confirmation when the project is already blank.
   */
  function confirmAndResetProject() {
    if (!window.App) return;

    var hasContent = App.config.image !== null || App.config.transitions.length > 0;
    if (!hasContent) {
      executeProjectReset();
      return;
    }

    showResetConfirmModal();
  }

  /** Clear storage and delegate the full reset to app.js. */
  function executeProjectReset() {
    clearLocalStorage();
    if (typeof App.resetProject === 'function') {
      App.resetProject();
    }
  }

  /** Reveal the modal with entrance animation. */
  function showResetConfirmModal() {
    var backdrop = document.getElementById('reset-modal-backdrop');
    var modal    = document.getElementById('reset-modal');
    if (!backdrop || !modal) return;

    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    modal.setAttribute('aria-hidden', 'false');

    // Trigger entrance animation on the next frame (after hidden is removed)
    requestAnimationFrame(function () {
      backdrop.classList.add('modal-backdrop--visible');
      modal.classList.add('modal-panel--visible');
    });

    // Focus cancel button — safe default for a destructive dialog
    var cancelBtn = document.getElementById('btn-reset-cancel');
    if (cancelBtn) cancelBtn.focus();
  }

  /** Hide the modal with exit animation, then restore focus. */
  function hideResetConfirmModal() {
    var backdrop = document.getElementById('reset-modal-backdrop');
    var modal    = document.getElementById('reset-modal');
    if (!backdrop || !modal) return;

    backdrop.classList.remove('modal-backdrop--visible');
    modal.classList.remove('modal-panel--visible');

    // Wait for the 220ms exit transition before setting hidden
    setTimeout(function () {
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
      modal.setAttribute('aria-hidden', 'true');
    }, 220);

    // Return focus to the trigger button
    var newBtn = document.getElementById('btn-new-architecture');
    if (newBtn) newBtn.focus();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.App) {
      console.error('ArchFlow: App not initialised');
      return;
    }

    // Auto-save whenever config changes (debounced to avoid thrashing storage).
    App.on('onConfigUpdate', debounce(saveToLocalStorage, 500));

    const exportBtn = document.getElementById('btn-export-config');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportConfigAsJSON);
    }

    const loadBtn   = document.getElementById('btn-load-config');
    const fileInput = document.getElementById('config-file-input');
    if (loadBtn && fileInput) {
      loadBtn.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        importConfigFromFile(file);
        // Reset so the same file can be re-imported.
        fileInput.value = '';
      });
    }

    // Restore previous session — runs after all other modules have registered
    // their DOMContentLoaded handlers (defer order guarantees this).
    restoreFromLocalStorage();

    // ── New Architecture button & reset modal wiring ───────────────────────

    var newArchBtn = document.getElementById('btn-new-architecture');
    if (newArchBtn) {
      newArchBtn.addEventListener('click', confirmAndResetProject);
    }

    var resetCancelBtn  = document.getElementById('btn-reset-cancel');
    var resetConfirmBtn = document.getElementById('btn-reset-confirm');

    if (resetCancelBtn) {
      resetCancelBtn.addEventListener('click', hideResetConfirmModal);
    }
    if (resetConfirmBtn) {
      resetConfirmBtn.addEventListener('click', function () {
        hideResetConfirmModal();
        // Brief delay so the modal exit animation plays before the UI resets
        setTimeout(executeProjectReset, 180);
      });
    }

    // Close modal on backdrop click (click outside the panel)
    var backdropEl = document.getElementById('reset-modal-backdrop');
    if (backdropEl) {
      backdropEl.addEventListener('click', function (e) {
        if (e.target === backdropEl) hideResetConfirmModal();
      });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var bd = document.getElementById('reset-modal-backdrop');
      if (bd && !bd.hidden) {
        e.preventDefault();
        hideResetConfirmModal();
      }
    });

    App.persist = {
      saveToLocalStorage,
      restoreFromLocalStorage,
      exportConfigAsJSON,
      importConfigFromFile,
      clearLocalStorage,
    };
  });
}());
