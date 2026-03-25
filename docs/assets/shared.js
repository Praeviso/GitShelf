(function (root, factory) {
  const api = factory();
  root.PDF2BookShared = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  let uniqueIdCounter = 0;

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const PROGRESS_TONES = {
    idle: 'info',
    reading: 'info',
    uploading: 'info',
    committing: 'info',
    queued: 'info',
    running: 'info',
    done: 'success',
    success: 'success',
    error: 'error',
  };

  function nextId(prefix) {
    uniqueIdCounter += 1;
    return `${prefix || 'pdf2book'}-${uniqueIdCounter}`;
  }

  function prefersReducedMotion(targetWindow) {
    return Boolean(
      targetWindow &&
        typeof targetWindow.matchMedia === 'function' &&
        targetWindow.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function getScrollBehavior(targetWindow) {
    return prefersReducedMotion(targetWindow) ? 'auto' : 'smooth';
  }

  function getProgressTone(stage) {
    return PROGRESS_TONES[stage] || 'info';
  }

  function isElementHidden(element) {
    if (!element || element.hidden) return true;

    const targetWindow = element.ownerDocument && element.ownerDocument.defaultView;
    if (!targetWindow || typeof targetWindow.getComputedStyle !== 'function') {
      return false;
    }

    const styles = targetWindow.getComputedStyle(element);
    return styles.display === 'none' || styles.visibility === 'hidden';
  }

  function getFocusableElements(rootElement) {
    if (!rootElement || typeof rootElement.querySelectorAll !== 'function') {
      return [];
    }

    return Array.from(rootElement.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (element) => !isElementHidden(element)
    );
  }

  function trapFocusKey(event, rootElement) {
    if (!event || event.key !== 'Tab') {
      return false;
    }

    const focusableElements = getFocusableElements(rootElement);
    if (focusableElements.length === 0) {
      return false;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeElement =
      rootElement && rootElement.ownerDocument
        ? rootElement.ownerDocument.activeElement
        : null;

    if (event.shiftKey && (activeElement === first || activeElement === rootElement)) {
      event.preventDefault();
      last.focus();
      return true;
    }

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }

    return false;
  }

  function setExpandedState(control, expanded, controlledId) {
    if (!control) return;

    control.setAttribute('aria-expanded', String(Boolean(expanded)));

    if (controlledId) {
      control.setAttribute('aria-controls', controlledId);
    }
  }

  return {
    FOCUSABLE_SELECTOR,
    getFocusableElements,
    getProgressTone,
    getScrollBehavior,
    nextId,
    prefersReducedMotion,
    setExpandedState,
    trapFocusKey,
  };
});
