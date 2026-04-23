/* =============================================================================
   ArchFlow — js/app.js
   Core application namespace, state management, and initialisation.
   Establishes window.App via IIFE; all subsequent scripts attach to this object.
   Loaded first (defer); all other scripts depend on window.App existing.
   ============================================================================= */

window.App = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Pure utilities — declared first so they are hoisted above state init
  // ---------------------------------------------------------------------------

  function generateId() {
    return 'af-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function fireHooks(hookName, payload) {
    hooks[hookName].forEach(function (listener) { listener(payload); });
  }

  // ---------------------------------------------------------------------------
  // Private state
  // ---------------------------------------------------------------------------

  let currentMode   = 'edit';
  let activeStateId = null;

  const config = {
    id:                 generateId(),
    image:              null,
    transitionDuration: 600,
    transitions:        [],
  };

  const shapes = new Map();

  const hooks = {
    onModeChange:   [],
    onSVGLoad:      [],
    onStateChange:  [],
    onConfigUpdate: [],
  };

  // ---------------------------------------------------------------------------
  // Constants (depend on hooks being initialised above)
  // ---------------------------------------------------------------------------

  const ALLOWED_MODES    = ['edit', 'play'];
  const KNOWN_HOOK_NAMES = Object.keys(hooks);

  // ---------------------------------------------------------------------------
  // Mode management
  // ---------------------------------------------------------------------------

  function switchMode(newMode) {
    if (!ALLOWED_MODES.includes(newMode)) {
      throw new Error(
        'App.switchMode: "' + newMode + '" is not a valid mode. ' +
        'Allowed modes: ' + ALLOWED_MODES.join(', ')
      );
    }
    if (currentMode === newMode) return;

    currentMode = newMode;

    // Replace any existing mode-* class without disturbing svg-loaded etc.
    document.body.classList.remove('mode-edit', 'mode-play');
    document.body.classList.add('mode-' + newMode);

    const btnEditMode = document.getElementById('btn-edit-mode');
    const btnPlayMode = document.getElementById('btn-play-mode');

    if (btnEditMode) {
      const isEditActive = newMode === 'edit';
      btnEditMode.setAttribute('aria-pressed', String(isEditActive));
      btnEditMode.classList.toggle('active', isEditActive);
    }

    if (btnPlayMode) {
      const isPlayActive = newMode === 'play';
      btnPlayMode.setAttribute('aria-pressed', String(isPlayActive));
      btnPlayMode.classList.toggle('active', isPlayActive);
    }

    fireHooks('onModeChange', newMode);
  }

  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------

  function updateConfig(patch) {
    if (!patch || typeof patch !== 'object') {
      throw new Error('App.updateConfig: patch must be a non-null object, got ' + typeof patch);
    }
    Object.assign(config, patch);
    fireHooks('onConfigUpdate', config);
  }

  // ---------------------------------------------------------------------------
  // SVG lifecycle notifications
  // ---------------------------------------------------------------------------

  function notifySVGLoaded(svgEl) {
    if (!svgEl) {
      throw new Error('App.notifySVGLoaded: svgEl is required');
    }
    fireHooks('onSVGLoad', svgEl);
  }

  // ---------------------------------------------------------------------------
  // State management
  // ---------------------------------------------------------------------------

  function setActiveState(id) {
    activeStateId = id;
    fireHooks('onStateChange', { id: activeStateId });
  }

  // ---------------------------------------------------------------------------
  // Event subscription
  // ---------------------------------------------------------------------------

  function on(event, fn) {
    if (!KNOWN_HOOK_NAMES.includes(event)) {
      throw new Error(
        'App.on: unknown event "' + event + '". ' +
        'Known events: ' + KNOWN_HOOK_NAMES.join(', ')
      );
    }
    if (typeof fn !== 'function') {
      throw new Error(
        'App.on: listener for "' + event + '" must be a function, got ' + typeof fn
      );
    }
    hooks[event].push(fn);
  }

  // ---------------------------------------------------------------------------
  // SVG-loaded UI state
  // ---------------------------------------------------------------------------

  function markSVGLoaded(isLoaded) {
    document.body.classList.toggle('svg-loaded', isLoaded);

    const editToolbar = document.getElementById('edit-toolbar');
    const emptyState  = document.getElementById('empty-state');

    // hidden attribute drives display; CSS body.svg-loaded rules reinforce it
    if (editToolbar) editToolbar.hidden = !isLoaded;
    if (emptyState)  emptyState.hidden  =  isLoaded;
  }

  // ---------------------------------------------------------------------------
  // Project reset
  // ---------------------------------------------------------------------------

  function resetProject() {
    // Re-initialise config in-place so existing references stay valid
    Object.keys(config).forEach(function (key) { delete config[key]; });
    config.id                 = generateId();
    config.image              = null;
    config.transitionDuration = 600;
    config.transitions        = [];

    // Clear runtime state
    shapes.clear();
    activeStateId = null;

    // Clear the SVG canvas
    var svgHost = document.getElementById('svg-host');
    if (svgHost) {
      svgHost.innerHTML = '';
    } else {
      console.warn('App.resetProject: #svg-host not found — skipping canvas clear');
    }

    // Reset state tabs strip
    var stateTabs = document.getElementById('state-tabs');
    if (stateTabs) {
      stateTabs.innerHTML = '';
      stateTabs.hidden    = true;
    }

    // Reset duration slider and display to 600ms
    var durationDisplay = document.getElementById('duration-display');
    var durationSlider  = document.getElementById('transition-duration');
    if (durationDisplay) durationDisplay.textContent = '600ms';
    if (durationSlider)  durationSlider.value        = '600';

    // Show the empty upload state
    markSVGLoaded(false);

    // Clear localStorage via persist module (if initialised)
    if (window.App && window.App.persist && typeof window.App.persist.clearLocalStorage === 'function') {
      window.App.persist.clearLocalStorage();
    }

    // Reset floating panels
    if (window.App && window.App.panels) {
      if (window.App.panels.propertyEditor && typeof window.App.panels.propertyEditor.unbind === 'function') {
        window.App.panels.propertyEditor.unbind();
      }
      if (window.App.panels.shapeList && typeof window.App.panels.shapeList.render === 'function') {
        window.App.panels.shapeList.render();
      }
    }

    // Re-render state tabs via stateManager (will render empty)
    if (window.App && window.App.stateManager && typeof window.App.stateManager.renderStateTabs === 'function') {
      window.App.stateManager.renderStateTabs();
    }

    // Pause playback if active
    if (window.App && window.App.playback && typeof window.App.playback.pause === 'function') {
      window.App.playback.pause();
    }

    // Switch to edit mode — reset currentMode first so switchMode always runs fully
    currentMode = null;
    switchMode('edit');

    // Notify remaining listeners (e.g. any UI bound to onConfigUpdate)
    fireHooks('onConfigUpdate', config);
  }

  // ---------------------------------------------------------------------------
  // Shortcut tooltip
  // ---------------------------------------------------------------------------

  function toggleShortcutTooltip() {
    const tooltip = document.getElementById('shortcut-tooltip');
    if (!tooltip) return;

    const willBeVisible = tooltip.hidden; // currently hidden → will become visible
    tooltip.hidden = !willBeVisible;
    tooltip.setAttribute('aria-hidden', String(!willBeVisible));
  }

  // ---------------------------------------------------------------------------
  // Global keyboard shortcuts
  // ---------------------------------------------------------------------------

  function handleGlobalKeydown(e) {
    const activeTagName = e.target.tagName.toUpperCase();
    const isTypingInInteractiveField =
      activeTagName === 'INPUT'    ||
      activeTagName === 'TEXTAREA' ||
      activeTagName === 'SELECT';

    if (isTypingInInteractiveField) return;

    switch (e.key) {
      case 'e':
      case 'E':
        switchMode('edit');
        break;

      case 'p':
      case 'P':
        switchMode('play');
        break;

      case '?':
        toggleShortcutTooltip();
        break;

      case ' ':
        e.preventDefault();
        if (window.App.playback && typeof window.App.playback.togglePlayPause === 'function') {
          window.App.playback.togglePlayPause();
        }
        break;

      case 'ArrowRight':
        if (window.App.playback && typeof window.App.playback.next === 'function') {
          window.App.playback.next();
        }
        break;

      case 'ArrowLeft':
        if (window.App.playback && typeof window.App.playback.prev === 'function') {
          window.App.playback.prev();
        }
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Initialisation — called on DOMContentLoaded
  // ---------------------------------------------------------------------------

  function init() {
    const btnEditMode = document.getElementById('btn-edit-mode');
    const btnPlayMode = document.getElementById('btn-play-mode');

    if (!btnEditMode || !btnPlayMode) {
      throw new Error(
        'App.init: required elements #btn-edit-mode and #btn-play-mode not found in DOM. ' +
        'Verify index.html contains the correct IDs.'
      );
    }

    btnEditMode.addEventListener('click', function () { switchMode('edit'); });
    btnPlayMode.addEventListener('click', function () { switchMode('play'); });

    document.addEventListener('keydown', handleGlobalKeydown);

    const durationSlider  = document.getElementById('transition-duration');
    const durationDisplay = document.getElementById('duration-display');

    if (durationSlider && durationDisplay) {
      durationSlider.addEventListener('input', function () {
        const durationMs = Number(durationSlider.value);
        durationDisplay.textContent = durationMs + 'ms';
        updateConfig({ transitionDuration: durationMs });
      });
    }

    currentMode = null;   // allow switchMode to execute fully on first call
    switchMode('edit');
    markSVGLoaded(false);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    get mode()          { return currentMode;   },
    get config()        { return config;         },
    get shapes()        { return shapes;         },
    get activeStateId() { return activeStateId;  },

    switchMode,
    updateConfig,
    notifySVGLoaded,
    setActiveState,
    on,
    markSVGLoaded,
    generateId,
    resetProject,
    init,
  };

})();

// Boot: defer scripts execute before DOMContentLoaded, so this listener fires
// after all deferred scripts have run, giving other files time to attach.
document.addEventListener('DOMContentLoaded', function () {
  window.App.init();
});
