/**
 * ArchFlow — playback.js
 * Play-mode engine: applies transition states to the live SVG with CSS transitions,
 * drives auto-play, and keeps the playback bar UI in sync.
 */
(function () {
  'use strict';

  let isPlaying    = false;
  let playTimerId  = null;

  // ─── SVG application ──────────────────────────────────────────────────────

  /**
   * Apply a property map to a single SVG element.
   * @param {SVGElement} el
   * @param {Object} properties  Values from either baseline or state overrides.
   */
  function applyPropertiesToElement(el, properties) {
    if (!el || !properties) return;
    if (properties.fill        != null) el.style.fill = properties.fill;
    if (properties.stroke      != null) el.style.stroke = properties.stroke;
    if (properties.strokeWidth != null) el.style.setProperty('stroke-width', String(properties.strokeWidth));
    if (properties.opacity     != null) el.style.opacity    = properties.opacity;
    if (properties.visibility  != null) el.style.visibility = properties.visibility;
  }

  /**
   * Reset all shapes to baseline then apply overrides from the given state.
   * Each modified element receives a CSS transition for smooth animation.
   * @param {string} stateId
   */
  function applyStateToSVG(stateId) {
    if (!window.App) return;

    const transition = App.config.transitions.find(function (t) { return t.id === stateId; });
    if (!transition) {
      console.error('ArchFlow playback: applyStateToSVG — unknown stateId:', stateId);
      return;
    }

    const dur = App.config.transitionDuration || 600;
    const transitionValue =
      'fill ' + dur + 'ms ease, ' +
      'stroke ' + dur + 'ms ease, ' +
      'stroke-width ' + dur + 'ms ease, ' +
      'opacity ' + dur + 'ms ease';

    // Step 1: reset every shape to its captured baseline.
    App.shapes.forEach(function (record) {
      record.el.style.transition = transitionValue;
      applyPropertiesToElement(record.el, record.baseline);
    });

    // Step 2: apply state-specific overrides on top.
    (transition.shapes || []).forEach(function (shapeEntry) {
      const record = App.shapes.get(shapeEntry.id);
      if (!record) return;
      applyPropertiesToElement(record.el, shapeEntry.properties);
    });

    // Step 3: render annotations for this transition on top of shape overrides.
    if (App.annotationLayer) {
      App.annotationLayer.render(transition.annotations || []);
    }
  }

  // ─── Navigation helpers ───────────────────────────────────────────────────

  /**
   * Return the 0-based index of the active state within transitions array.
   * @returns {number}  -1 if not found.
   */
  function getCurrentStateIndex() {
    if (!window.App) return -1;
    return App.config.transitions.findIndex(function (t) {
      return t.id === App.activeStateId;
    });
  }

  /**
   * Navigate to a specific state by index, apply it to the SVG, and sync UI.
   * @param {number} index
   */
  function goToState(index) {
    if (!window.App) return;

    const transitions = App.config.transitions;
    if (!transitions || transitions.length === 0) return;

    if (index < 0 || index >= transitions.length) {
      console.error('ArchFlow playback: goToState index out of bounds:', index);
      return;
    }

    const stateId = transitions[index].id;
    App.setActiveState(stateId);
    applyStateToSVG(stateId);
    updatePlaybackUI();

    // Keep the state tab strip in sync without triggering propertyEditor.unbind
    // (we are in play mode so the editor is hidden anyway via CSS).
    if (App.stateManager && typeof App.stateManager.selectState === 'function') {
      App.stateManager.selectState(stateId);
    }
  }

  /**
   * Advance to the next state, wrapping around to the first if at the end.
   */
  function next() {
    if (!window.App) return;
    const transitions = App.config.transitions;
    if (!transitions || transitions.length === 0) return;

    const idx = getCurrentStateIndex();
    goToState(idx + 1 >= transitions.length ? 0 : idx + 1);
  }

  /**
   * Go back to the previous state, wrapping around to the last if at the start.
   */
  function prev() {
    if (!window.App) return;
    const transitions = App.config.transitions;
    if (!transitions || transitions.length === 0) return;

    const idx = getCurrentStateIndex();
    goToState(idx - 1 < 0 ? transitions.length - 1 : idx - 1);
  }

  // ─── Auto-play ────────────────────────────────────────────────────────────

  /** Begin auto-advancing states at transitionDuration + 500 ms per step. */
  function play() {
    if (!window.App) return;
    if (!App.config.transitions || App.config.transitions.length === 0) return;

    isPlaying = true;
    updatePlayPauseButton();

    const interval = (App.config.transitionDuration || 600) + 500;
    playTimerId = setInterval(next, interval);
  }

  /** Stop auto-play and update the play/pause button. */
  function pause() {
    isPlaying = false;
    if (playTimerId !== null) {
      clearInterval(playTimerId);
      playTimerId = null;
    }
    updatePlayPauseButton();
  }

  /** Toggle between play and pause. */
  function togglePlayPause() {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  // ─── UI sync ──────────────────────────────────────────────────────────────

  /** Update the play/pause button glyph and aria-label. */
  function updatePlayPauseButton() {
    const btn = document.getElementById('btn-play-pause');
    if (!btn) return;
    // ▐▐ pause  vs  ▶ play
    btn.innerHTML   = isPlaying ? '&#9646;&#9646;' : '&#9654;';
    btn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  /**
   * Sync the playback bar counter and progress fill with the current state index.
   */
  function updatePlaybackUI() {
    if (!window.App) return;

    const transitions  = App.config.transitions;
    const counterEl    = document.getElementById('pb-counter');
    const progressFill = document.getElementById('pb-progress-fill');
    const progressTrack = document.getElementById('pb-progress-track');

    if (!transitions || transitions.length === 0) {
      if (counterEl)     counterEl.textContent = '— / —';
      if (progressFill)  progressFill.style.width = '0%';
      if (progressTrack) progressTrack.setAttribute('aria-valuenow', '0');
      return;
    }

    const idx          = getCurrentStateIndex();
    const displayIdx   = idx >= 0 ? idx : 0;
    const progressPct  = ((displayIdx + 1) / transitions.length) * 100;

    if (counterEl)    counterEl.textContent = (displayIdx + 1) + ' / ' + transitions.length;
    if (progressFill) progressFill.style.width = progressPct + '%';
    if (progressTrack) {
      progressTrack.setAttribute('aria-valuenow', String(Math.round(progressPct)));
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.App) {
      console.error('ArchFlow: App not initialised');
      return;
    }

    const playPauseBtn = document.getElementById('btn-play-pause');
    const nextBtn      = document.getElementById('btn-next');
    const prevBtn      = document.getElementById('btn-prev');

    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
    if (nextBtn)      nextBtn.addEventListener('click', next);
    if (prevBtn)      prevBtn.addEventListener('click', prev);

    App.on('onModeChange', function (mode) {
      const playbackBar = document.getElementById('playback-bar');
      const stateTabs   = document.getElementById('state-tabs');

      if (mode === 'play') {
        if (playbackBar) playbackBar.hidden = false;
        if (stateTabs && App.config.transitions.length > 0) {
          stateTabs.hidden = false;
        }
        updatePlaybackUI();

        // Auto-navigate to first state if none is active yet.
        if (App.config.transitions.length > 0 && App.activeStateId == null) {
          goToState(0);
        }
      } else {
        pause();
        if (playbackBar) playbackBar.hidden = true;
      }
    });

    App.on('onStateChange', function () {
      updatePlaybackUI();
    });

    App.playback = {
      next,
      prev,
      play,
      pause,
      togglePlayPause,
      goToState,
      applyStateToSVG,
    };
  });
}());
