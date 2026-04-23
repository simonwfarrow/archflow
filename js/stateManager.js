/**
 * ArchFlow — stateManager.js
 * Manages transition states: creating, selecting, renaming, deleting,
 * and rendering the state tab strip.
 */
(function () {
  'use strict';

  // ─── Utilities ────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    if (str == null) return '';
    return String(str).replace(/"/g, '&quot;');
  }

  // ─── Tab strip sync ────────────────────────────────────────────────────────

  /**
   * Sync inline active styles on existing tab DOM nodes without a full re-render.
   * Used by selectState() to avoid a flash of unstyled tabs.
   * @param {string} activeStateId
   */
  function syncTabActiveStyles(activeStateId) {
    const container = document.getElementById('state-tabs');
    if (!container) return;

    container.querySelectorAll('.state-tab').forEach(function (tab) {
      const isActive = tab.dataset.stateId === activeStateId;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.setAttribute('tabindex', isActive ? '0' : '-1');

      if (isActive) {
        tab.style.background   = '#1a1a1a';
        tab.style.color        = '#ffffff';
        tab.style.borderColor  = 'transparent';
        tab.style.boxShadow    = '0 1px 4px rgba(0,0,0,0.2)';
      } else {
        tab.style.background   = '';
        tab.style.color        = '';
        tab.style.borderColor  = '';
        tab.style.boxShadow    = '';
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Create a new transition state, add it to config, render tabs, and select it.
   * @returns {{ id: string, name: string, shapes: [] }}
   */
  function createNewState() {
    if (!window.App) return null;

    const id   = App.generateId();
    const name = 'State ' + (App.config.transitions.length + 1);
    const newState = { id: id, name: name, shapes: [] };

    App.updateConfig({ transitions: App.config.transitions.concat([newState]) });
    renderStateTabs();
    selectState(id);

    return newState;
  }

  /**
   * Activate a transition state by id: updates App, syncs tab strip, unbinds editor.
   * @param {string} stateId
   */
  function selectState(stateId) {
    if (!window.App) return;

    const matchingTransition = App.config.transitions.find(function (t) {
      return t.id === stateId;
    });
    if (!matchingTransition) {
      console.error('ArchFlow stateManager: selectState called with invalid stateId:', stateId);
      return;
    }

    App.setActiveState(stateId);
    syncTabActiveStyles(stateId);

    // Apply the state's property overrides to the live SVG so the diagram
    // matches the active state whenever switching in edit mode.
    if (
      window.App.playback &&
      typeof window.App.playback.applyStateToSVG === 'function'
    ) {
      window.App.playback.applyStateToSVG(stateId);
    }

    // Deselect shape when the active state changes.
    if (
      App.panels &&
      App.panels.propertyEditor &&
      typeof App.panels.propertyEditor.unbind === 'function'
    ) {
      App.panels.propertyEditor.unbind();
    }
  }

  /**
   * Fully re-render the #state-tabs container from App.config.transitions.
   * Wires click (select) and double-click (rename) handlers.
   */
  function renderStateTabs() {
    if (!window.App) return;

    const container = document.getElementById('state-tabs');
    if (!container) return;

    const transitions = App.config.transitions;
    if (!transitions || transitions.length === 0) {
      container.hidden = true;
      return;
    }

    container.hidden = false;

    let html = '';
    transitions.forEach(function (transition) {
      const isActive = transition.id === App.activeStateId;
      const activeInline = isActive
        ? 'background:#1a1a1a;' +
          ' color:#ffffff; border-color:transparent; box-shadow:0 1px 4px rgba(0,0,0,0.2);'
        : '';

      const showClose = transitions.length > 1;
      const closeBtn = showClose
        ? '<span class="state-tab-close" title="Delete state"' +
          ' data-delete-id="' + escapeAttr(transition.id) + '"' +
          ' style="font-size:10px; margin-left:6px; opacity:0.5; cursor:pointer;' +
          ' padding:2px 4px; border-radius:3px;">✕</span>'
        : '';

      html +=
        '<div class="state-tab' + (isActive ? ' active' : '') + '"' +
        ' data-state-id="' + escapeAttr(transition.id) + '"' +
        ' role="tab"' +
        ' aria-selected="' + isActive + '"' +
        ' tabindex="' + (isActive ? '0' : '-1') + '"' +
        ' style="' + activeInline + '">' +
          escapeHtml(transition.name) +
          closeBtn +
        '</div>';
    });

    container.innerHTML = html;

    // Wire close buttons.
    container.querySelectorAll('.state-tab-close').forEach(function(closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteState(closeBtn.dataset.deleteId);
      });
    });

    // Wire event handlers on freshly rendered tabs.
    container.querySelectorAll('.state-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        selectState(tab.dataset.stateId);
      });

      tab.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        // Look up the current name from config — textContent includes ✕ from the close button.
        const targetId = tab.dataset.stateId;
        const existingTransition = App.config.transitions.find(function (t) { return t.id === targetId; });
        const currentName = existingTransition ? existingTransition.name : '';
        const newName = prompt('Rename state:', currentName);
        if (!newName || !newName.trim()) return;

        const updatedTransitions = App.config.transitions.map(function (t) {
          if (t.id !== targetId) return t;
          return Object.assign({}, t, { name: newName.trim() });
        });
        App.updateConfig({ transitions: updatedTransitions });
        renderStateTabs();
      });
    });
  }

  /**
   * Delete a transition state.  Refuses to delete the last remaining state.
   * Selects an adjacent state if the deleted one was active.
   * @param {string} stateId
   */
  function deleteState(stateId) {
    if (!window.App) return;

    const transitions = App.config.transitions;
    if (transitions.length <= 1) {
      console.warn('ArchFlow stateManager: cannot delete the last remaining state');
      return;
    }

    const stateIndex = transitions.findIndex(function (t) { return t.id === stateId; });
    if (stateIndex === -1) {
      console.error('ArchFlow stateManager: deleteState called with invalid stateId:', stateId);
      return;
    }

    const wasActive = App.activeStateId === stateId;
    const updatedTransitions = transitions.filter(function (t) { return t.id !== stateId; });

    App.updateConfig({ transitions: updatedTransitions });

    // Re-render tabs before selecting so syncTabActiveStyles operates on fresh DOM.
    renderStateTabs();

    if (wasActive) {
      const nextIndex = Math.min(stateIndex, updatedTransitions.length - 1);
      selectState(updatedTransitions[nextIndex].id);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.App) {
      console.error('ArchFlow: App not initialised');
      return;
    }

    const addStateBtn = document.getElementById('btn-add-state');
    if (addStateBtn) {
      addStateBtn.addEventListener('click', createNewState);
    }

    // Auto-create first state when SVG loads (if none exist yet).
    App.on('onSVGLoad', function () {
      if (!App.config.transitions || App.config.transitions.length === 0) {
        createNewState();
      }
    });

    App.stateManager = { createNewState, selectState, renderStateTabs, deleteState };
  });
}());
