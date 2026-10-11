// Loaded ahead of SponsorBlock's own code in its service worker, its content
// script and its pages (see scripts/fetch-extensions.js).
//
// SponsorBlock keeps its settings in chrome.storage.sync. Electron has no
// sync storage: the object is there, but every call on it fails, so the
// settings never load and the extension sits waiting on them forever. This
// swaps in a sync area that lives inside chrome.storage.local instead, under
// its own key prefix so the two areas stay apart just like in Chrome, with
// change events still reported against the area they belong to.
//
// Everything is changed on Chromium's own chrome.storage object rather than a
// replacement for it: Chromium sets chrome.storage back to that object when it
// refreshes a page's extension APIs, which happens when the page opened before
// the extension finished installing.
(() => {
  'use strict';

  const storage = chrome.storage;
  const local = storage.local;
  const prefix = 'storage.sync/';

  // the real local storage, before any of it is swapped out below
  const real = {
    get: local.get.bind(local),
    set: local.set.bind(local),
    remove: local.remove.bind(local),
    getBytesInUse: local.getBytesInUse.bind(local),
    onChanged: storage.onChanged,
  };

  const isSyncKey = key => key.startsWith(prefix);
  const toSyncKey = key => prefix + key;
  const fromSyncKey = key => key.slice(prefix.length);

  // the storage APIs take an optional trailing callback and return a promise
  // when it is left off; keep both styles working
  const settle = (promise, callback) => {
    if (typeof callback !== 'function') return promise;
    promise.then(callback, error => {
      console.error(error);
      callback();
    });
  };

  // splits one batch of local changes into the plain local ones and the ones
  // that are really sync storage
  const split = changes => {
    const plain = {};
    const synced = {};
    let hasPlain = false;
    let hasSynced = false;
    for (const [key, change] of Object.entries(changes)) {
      if (isSyncKey(key)) {
        synced[fromSyncKey(key)] = change;
        hasSynced = true;
      } else {
        plain[key] = change;
        hasPlain = true;
      }
    }
    return { plain: hasPlain ? plain : null, synced: hasSynced ? synced : null };
  };

  // an onChanged event that sits on top of the real chrome.storage.onChanged;
  // relay gets (listener, changes, areaName) and decides what to pass on
  const changeEvent = relay => {
    const wrappers = new Map();
    return {
      addListener (listener) {
        if (wrappers.has(listener)) return;
        const wrapper = (changes, areaName) => relay(listener, changes, areaName);
        wrappers.set(listener, wrapper);
        real.onChanged.addListener(wrapper);
      },
      removeListener (listener) {
        const wrapper = wrappers.get(listener);
        if (!wrapper) return;
        wrappers.delete(listener);
        real.onChanged.removeListener(wrapper);
      },
      hasListener: listener => wrappers.has(listener),
      hasListeners: () => wrappers.size > 0,
    };
  };

  const allKeys = () => real.get(null).then(items => Object.keys(items));

  const sync = {
    // Chrome's documented sync limits, for anything that reads them
    QUOTA_BYTES: 102400,
    QUOTA_BYTES_PER_ITEM: 8192,
    MAX_ITEMS: 512,
    MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
    MAX_WRITE_OPERATIONS_PER_MINUTE: 120,

    get (keys, callback) {
      if (typeof keys === 'function') [keys, callback] = [null, keys];
      let request = null;
      if (typeof keys === 'string') {
        request = [toSyncKey(keys)];
      } else if (Array.isArray(keys)) {
        request = keys.map(toSyncKey);
      } else if (keys) {
        // an object of keys with their default values
        request = {};
        for (const [key, value] of Object.entries(keys)) request[toSyncKey(key)] = value;
      }
      return settle(real.get(request).then(items => {
        const result = {};
        for (const [key, value] of Object.entries(items)) {
          if (isSyncKey(key)) result[fromSyncKey(key)] = value;
        }
        return result;
      }), callback);
    },

    getKeys (callback) {
      return settle(allKeys().then(keys => keys.filter(isSyncKey).map(fromSyncKey)), callback);
    },

    set (items, callback) {
      const stored = {};
      for (const [key, value] of Object.entries(items)) stored[toSyncKey(key)] = value;
      return settle(real.set(stored), callback);
    },

    remove (keys, callback) {
      return settle(real.remove([].concat(keys).map(toSyncKey)), callback);
    },

    clear (callback) {
      return settle(allKeys().then(keys => real.remove(keys.filter(isSyncKey))), callback);
    },

    getBytesInUse (keys, callback) {
      if (typeof keys === 'function') [keys, callback] = [null, keys];
      const request = keys == null
        ? allKeys().then(all => all.filter(isSyncKey))
        : Promise.resolve([].concat(keys).map(toSyncKey));
      return settle(request.then(stored => real.getBytesInUse(stored)), callback);
    },

    onChanged: changeEvent((listener, changes, areaName) => {
      if (areaName !== 'local') return;
      const { synced } = split(changes);
      if (synced) listener(synced);
    }),
  };

  const replace = (object, key, value) => Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });

  replace(storage, 'sync', sync);

  replace(storage, 'onChanged', changeEvent((listener, changes, areaName) => {
    if (areaName !== 'local') {
      listener(changes, areaName);
      return;
    }
    const { plain, synced } = split(changes);
    if (plain) listener(plain, 'local');
    if (synced) listener(synced, 'sync');
  }));

  // and the local area minus the keys that belong to the sync area above
  replace(local, 'get', (keys, callback) => {
    if (typeof keys === 'function') [keys, callback] = [null, keys];
    if (keys != null) return settle(real.get(keys), callback);
    return settle(real.get(null).then(items => {
      for (const key of Object.keys(items)) {
        if (isSyncKey(key)) delete items[key];
      }
      return items;
    }), callback);
  });

  replace(local, 'getKeys', callback =>
    settle(allKeys().then(keys => keys.filter(key => !isSyncKey(key))), callback));

  replace(local, 'clear', callback =>
    settle(allKeys().then(keys => real.remove(keys.filter(key => !isSyncKey(key)))), callback));

  replace(local, 'onChanged', changeEvent((listener, changes, areaName) => {
    if (areaName !== 'local') return;
    const { plain } = split(changes);
    if (plain) listener(plain);
  }));

  // The options page also asks about permissions and incognito access, which
  // Electron has no API for, and stops drawing at the first question. Electron
  // grants an extension what its manifest asks for and nothing more, so the
  // manifest has the answers; there is no incognito here at all.
  const answer = (value, callback) => {
    if (typeof callback !== 'function') return Promise.resolve(value);
    setTimeout(() => callback(value));
  };
  if (!chrome.permissions) {
    const manifest = chrome.runtime.getManifest();
    const granted = new Set([...(manifest.permissions || []), ...(manifest.host_permissions || [])]);
    chrome.permissions = {
      contains: ({ permissions = [], origins = [] }, callback) =>
        answer([...permissions, ...origins].every(entry => granted.has(entry)), callback),
      getAll: callback => answer({ permissions: manifest.permissions || [], origins: manifest.host_permissions || [] }, callback),
      request: (_permissions, callback) => answer(false, callback),
      remove: (_permissions, callback) => answer(false, callback),
      onAdded: { addListener () {}, removeListener () {}, hasListener: () => false },
      onRemoved: { addListener () {}, removeListener () {}, hasListener: () => false },
    };
  }
  if (chrome.extension && !chrome.extension.isAllowedIncognitoAccess) {
    chrome.extension.isAllowedIncognitoAccess = callback => answer(false, callback);
  }
})();
