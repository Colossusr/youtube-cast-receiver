const { app, BrowserWindow, Menu, session, shell, webContents } = require('electron')
const fs = require('fs');
const path = require('path');
const iconPath = path.join(__dirname, "build", "icon.png");
const userAgent = 'Mozilla/5.0 (PS4; Leanback Shell) Gecko/20100101 Firefox/65.0 LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)';
const tvUrl = 'https://youtube.com/tv';
const startPage = path.join(__dirname, 'renderer', 'start.html');

// uBlock Origin and SponsorBlock, as unpacked by scripts/fetch-extensions.js.
// A packaged build keeps them outside the asar archive, which Chromium can't
// load an extension out of.
const extensionsDir = app.isPackaged
  ? path.join(process.resourcesPath, 'extensions')
  : path.join(__dirname, 'extensions', 'unpacked');

// the spoofed TV user agent has to apply to every navigation, not just the
// first one, otherwise youtube bounces us the moment it navigates itself
app.userAgentFallback = userAgent;

// a missing or broken extension shouldn't keep youtube from opening, so this
// only ever logs
async function loadExtensions () {
  const loaded = [];
  let names = [];
  try {
    names = fs.readdirSync(extensionsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    // reported just below
  }
  if (names.length === 0) {
    console.warn(`No browser extensions in ${extensionsDir}, run "npm run fetch-extensions" to get them`);
    return loaded;
  }

  for (const name of names) {
    try {
      const extension = await session.defaultSession.extensions.loadExtension(path.join(extensionsDir, name));
      console.log(`Loaded ${extension.name} ${extension.version}`);
      loaded.push(extension);
    } catch (error) {
      console.error(`Could not load the ${name} extension: ${error.message}`);
    }
  }
  return loaded;
}

// Loading an extension only starts it up. uBlock Origin then needs a moment to
// read its filter lists, and lets everything through until it has, which for
// youtube.com/tv, one page that never reloads, would mean no blocking for the
// whole session. Extensions with a background page get polled until their
// shim says they're ready (see extensions/shims), or the page has at least
// finished loading when there is no shim, and youtube waits for that. Not for
// longer than 20 seconds though, an extension isn't worth a stuck start page.
async function waitForExtensions (extensions) {
  const deadline = Date.now() + 20000;
  const isReady = `typeof electronCompatReady === 'function'
    ? electronCompatReady()
    : document.readyState === 'complete'`;

  for (const extension of extensions) {
    const background = extension.manifest.background;
    if (!background || !(background.page || background.scripts)) continue;

    let ready = false;
    while (!ready && Date.now() < deadline) {
      const page = webContents.getAllWebContents().find(contents =>
        contents.getType() === 'backgroundPage' && contents.getURL().startsWith(extension.url));
      ready = Boolean(page && await page.executeJavaScript(isReady).catch(() => false));
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) {
      console.warn(`Gave up waiting on ${extension.name}, opening youtube anyway`);
      return;
    }
  }
}

// The extensions have no toolbar to sit in here, so their settings pages open
// from an Add-ons menu instead. It is the app menu, which stays out of sight
// in fullscreen: F11 leaves fullscreen and Alt brings it up (on macOS it is
// at the top of the screen as usual).
function setMenu (extensions) {
  const addons = [];
  for (const extension of extensions) {
    const options = extension.manifest.options_ui || {};
    const page = options.page || extension.manifest.options_page;
    if (!page) continue;
    // "SponsorBlock for YouTube - Skip Sponsorships" is a bit much for a menu
    const name = extension.name.split(' - ')[0];
    addons.push({ label: `${name} settings`, click: () => openSettings(extension, page) });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    ...(addons.length ? [{ label: 'Add-ons', submenu: addons }] : []),
    { role: 'windowMenu' },
  ]));
}

function openSettings (extension, page) {
  const settings = new BrowserWindow({
    width: 1000,
    height: 760,
    icon: iconPath,
    autoHideMenuBar: true,
    // keeps it in front of the fullscreen TV window
    parent: win || undefined,
  });
  settings.loadURL(extension.url + page);

  // links out of the settings pages belong in the browser, not in an app
  // window that tells every site it is a PS4
  const openOutside = target => {
    if (/^https?:/.test(target)) shell.openExternal(target);
  };
  settings.webContents.setWindowOpenHandler(({ url: target }) => {
    openOutside(target);
    return { action: 'deny' };
  });
  settings.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(extension.url)) return;
    event.preventDefault();
    openOutside(target);
  });
}

let win = null;
// settles once the extensions are ready for youtube, see waitForExtensions
let extensionsReady = Promise.resolve();
// we open youtube.com/tv on our own exactly once; after that the start page's
// Reload link is what tries again, so a dead connection can't put us in a loop
let openedTv = false;

function createWindow () {
    win = new BrowserWindow(
      {
        fullscreen: true,
        icon: iconPath,
        autoHideMenuBar: true,
        backgroundColor: '#15171c'
      });

    // start on the bundled page so the window has something in it from the
    // first frame, including when there is no network at all
    openedTv = false;
    win.loadFile(startPage);

    const contents = win.webContents;
    contents.on('did-finish-load', async () => {
      if (openedTv) return;
      openedTv = true;
      await extensionsReady;
      // the window may have been closed while we waited
      if (!contents.isDestroyed()) contents.loadURL(tvUrl);
    });

    win.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      // -3 is ERR_ABORTED, which is what we get for navigating away ourselves
      if (!isMainFrame || errorCode === -3) return;
      openedTv = true;
      win.loadFile(startPage, { query: { offline: '1' } });
    });

    win.on('closed', () => {
      win = null
    });
 }

 app.whenReady().then(async () => {
    const extensions = await loadExtensions()
    setMenu(extensions)
    // the start page goes up straight away, youtube waits for the extensions
    extensionsReady = waitForExtensions(extensions)
    createWindow()
  
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
  
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
