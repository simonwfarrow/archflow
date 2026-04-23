/**
 * ArchFlow — draggable.js
 * Provides App.makeDraggable(panelEl, opts).
 * Uses Pointer Events for unified mouse + touch handling.
 * Attaches immediately — no DOMContentLoaded needed.
 */
(function () {
  'use strict';

  /**
   * Restore a saved {left, top} position from localStorage.
   * @param {string} storageKey
   * @returns {{ left: number, top: number } | null}
   */
  function restorePositionFromStorage(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.left === 'number' &&
        typeof parsed.top === 'number'
      ) {
        return parsed;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Persist a panel position to localStorage.
   * @param {string} storageKey
   * @param {{ left: number, top: number }} position
   */
  function savePositionToStorage(storageKey, position) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(position));
    } catch (e) {
      console.warn('ArchFlow draggable: could not save position to localStorage', e);
    }
  }

  /**
   * Make a panel element draggable via pointer events.
   * @param {HTMLElement} panelEl  - The panel to make draggable.
   * @param {{ handleSelector?: string, storageKey?: string }} [opts]
   */
  function makeDraggable(panelEl, opts) {
    if (!panelEl || !(panelEl instanceof HTMLElement)) {
      console.error('ArchFlow draggable: panelEl must be a valid HTMLElement');
      return;
    }

    const options = Object.assign(
      { handleSelector: '.panel-drag-handle', storageKey: null },
      opts || {}
    );

    const handleEl =
      (options.handleSelector && panelEl.querySelector(options.handleSelector)) ||
      panelEl;

    // Position the panel as fixed so left/top set its viewport position.
    panelEl.style.position = 'fixed';
    handleEl.style.cursor = 'grab';

    if (options.storageKey) {
      const saved = restorePositionFromStorage(options.storageKey);
      if (saved) {
        requestAnimationFrame(function() {
          var maxLeft = window.innerWidth  - panelEl.offsetWidth;
          var maxTop  = window.innerHeight - panelEl.offsetHeight;
          panelEl.style.left = Math.max(0, Math.min(saved.left, maxLeft)) + 'px';
          panelEl.style.top  = Math.max(0, Math.min(saved.top,  maxTop))  + 'px';
        });
      }
    }

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    function onPointerDown(e) {
      // Do not hijack clicks on interactive children inside the handle.
      if (e.target.closest('button, input, select, textarea, a')) return;

      isDragging = true;
      offsetX = e.clientX - panelEl.offsetLeft;
      offsetY = e.clientY - panelEl.offsetTop;

      handleEl.setPointerCapture(e.pointerId);
      handleEl.style.cursor = 'grabbing';
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!isDragging) return;

      const rawLeft = e.clientX - offsetX;
      const rawTop = e.clientY - offsetY;

      const maxLeft = window.innerWidth - panelEl.offsetWidth;
      const maxTop = window.innerHeight - panelEl.offsetHeight;

      const clampedLeft = Math.max(0, Math.min(rawLeft, maxLeft));
      const clampedTop = Math.max(0, Math.min(rawTop, maxTop));

      panelEl.style.left = clampedLeft + 'px';
      panelEl.style.top = clampedTop + 'px';
    }

    function onPointerUp(e) {
      if (!isDragging) return;
      isDragging = false;
      handleEl.style.cursor = 'grab';

      if (handleEl.hasPointerCapture(e.pointerId)) {
        handleEl.releasePointerCapture(e.pointerId);
      }

      if (options.storageKey) {
        savePositionToStorage(options.storageKey, {
          left: parseInt(panelEl.style.left, 10) || 0,
          top: parseInt(panelEl.style.top, 10) || 0,
        });
      }
    }

    handleEl.addEventListener('pointerdown', onPointerDown);
    handleEl.addEventListener('pointermove', onPointerMove);
    handleEl.addEventListener('pointerup', onPointerUp);
    handleEl.addEventListener('pointercancel', onPointerUp);
  }

  // Attach immediately — app.js runs before draggable.js (defer order).
  window.App = window.App || {};
  window.App.makeDraggable = makeDraggable;
}());
