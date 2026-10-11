// Loaded ahead of uBlock Origin's own scripts in every page of the extension
// (see scripts/fetch-extensions.js).
//
// Electron only implements part of the chrome.* extension API. uBO reaches for
// a handful of the missing namespaces while it starts up and stops dead on the
// first one that isn't there, so they get filled in here with versions that
// accept every call and do nothing. None of them are needed to block anything:
// a fullscreen TV window has no toolbar badge, context menu or keyboard
// shortcut for uBO to drive, its privacy switches only tune Chromium settings,
// and it already copes with webNavigation telling it nothing.
(() => {
  'use strict';

  const noop = () => {};

  // answers through the callback when there is one, otherwise a promise,
  // and always asynchronously, like the real API
  const answer = (...value) => function (...args) {
    const callback = args[args.length - 1];
    if (typeof callback !== 'function') return Promise.resolve(value[0]);
    setTimeout(() => callback(...value));
  };

  const event = () => ({
    addListener: noop,
    removeListener: noop,
    hasListener: () => false,
    hasListeners: () => false,
  });

  const fillIn = (name, api) => {
    if (chrome[name] === undefined) chrome[name] = api;
  };

  fillIn('browserAction', {
    setBadgeBackgroundColor: answer(),
    setBadgeText: answer(),
    setBadgeTextColor: answer(),
    setIcon: answer(),
    setPopup: answer(),
    setTitle: answer(),
    onClicked: event(),
  });

  let menuId = 0;
  fillIn('contextMenus', {
    create: (_properties, callback) => {
      if (typeof callback === 'function') setTimeout(callback);
      return ++menuId;
    },
    remove: answer(),
    removeAll: answer(),
    update: answer(),
    onClicked: event(),
  });

  const setting = () => ({
    get: answer({ value: undefined, levelOfControl: 'not_controllable' }),
    set: answer(),
    clear: answer(),
    onChange: event(),
  });
  fillIn('privacy', {
    network: {
      networkPredictionEnabled: setting(),
      webRTCIPHandlingPolicy: setting(),
    },
    websites: {
      hyperlinkAuditingEnabled: setting(),
    },
  });

  fillIn('webNavigation', {
    getFrame: answer(null),
    // no array on purpose: uBO reads an empty one as "every frame is gone" and
    // drops what it learned about them through webRequest
    getAllFrames: answer(),
    onBeforeNavigate: event(),
    onCommitted: event(),
    onCompleted: event(),
    onCreatedNavigationTarget: event(),
    onDOMContentLoaded: event(),
    onErrorOccurred: event(),
    onHistoryStateUpdated: event(),
    onReferenceFragmentUpdated: event(),
  });

  fillIn('commands', {
    getAll: answer([]),
    onCommand: event(),
  });

  fillIn('windows', {
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
    get: answer(null),
    getAll: answer([]),
    getCurrent: answer(null),
    getLastFocused: answer(null),
    create: answer(null),
    update: answer(null),
    remove: answer(),
    onCreated: event(),
    onFocusChanged: event(),
    onRemoved: event(),
  });

  // Electron's chrome.tabs also lacks insertCSS and removeCSS, which is how uBO
  // hides the page elements its cosmetic filters pick out. tabs.executeScript
  // does exist, so the stylesheet goes in as a <style> element instead. That
  // makes it an author stylesheet rather than a user one, which only matters
  // against a page that forces the same element visible with !important.
  if (chrome.tabs && chrome.tabs.executeScript && !chrome.tabs.insertCSS) {
    // runs in the target frame, next to uBO's content script
    const applyStyle = (css, add) => {
      const styles = self.electronCompatStyles || (self.electronCompatStyles = new Map());
      const elements = styles.get(css) || [];
      if (add) {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement || document).append(style);
        elements.push(style);
        styles.set(css, elements);
      } else if (elements.length !== 0) {
        elements.pop().remove();
        if (elements.length === 0) styles.delete(css);
      }
    };

    const styleCall = add => function (...args) {
      const callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
      const [tabId, details] = args.length > 1 ? args : [undefined, args[0]];
      const injection = {
        // read now: uBO reuses the details object for its next call
        code: `(${applyStyle})(${JSON.stringify(details.code)}, ${add});`,
        matchAboutBlank: details.matchAboutBlank,
        runAt: details.runAt || 'document_start',
      };
      if (details.allFrames) injection.allFrames = true;
      else injection.frameId = details.frameId || 0;
      chrome.tabs.executeScript(tabId, injection, () => {
        if (callback) callback();
        else void chrome.runtime.lastError;
      });
    };

    chrome.tabs.insertCSS = styleCall(true);
    chrome.tabs.removeCSS = styleCall(false);
  }

  // uBO only starts filtering once its filter lists are loaded. Chromium gives
  // it no way to hold requests back until then, so whatever loads before that
  // goes through untouched, and youtube.com/tv never reloads to get a second
  // chance. main.js polls this to open youtube only once uBO is filtering.
  self.electronCompatReady = () => Boolean(
    self.vAPI && self.vAPI.net && self.vAPI.net.suspendableListener
  );

  // The app hands every page the PS4 user agent so youtube.com/tv serves the
  // TV interface. uBO goes by the user agent to tell it is running in
  // Chromium, and without the Chrome token it compiles its filter lists
  // without their Chromium-only parts. Inside the extension's own pages it
  // gets a Chrome user agent back; the pages uBO filters keep the PS4 one.
  if (!/\bChrom(?:e|ium)\/\d+/.test(navigator.userAgent)) {
    const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    const chromium = brands.find(entry => entry.brand === 'Chromium');
    const major = chromium ? chromium.version : '120';
    const userAgent = `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      configurable: true,
      enumerable: true,
      get: () => userAgent,
    });
  }
})();
