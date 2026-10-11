// Downloads the browser extensions the app ships with (uBlock Origin and
// SponsorBlock) and unpacks them into extensions/unpacked, ready for
// session.extensions.loadExtension and for electron-builder to bundle.
//
// The versions are pinned in extensions/sources.json and every download has
// to match the checksum recorded there. Each extension also gets a small
// compatibility shim from extensions/shims loaded ahead of its own code,
// because Electron only implements part of the chrome.* extension API.
//
// Runs on `npm install`, or by hand with `npm run fetch-extensions`. Anything
// already unpacked at the right version is left alone.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const extractZip = require('extract-zip');

const extensionsDir = path.join(__dirname, '..', 'extensions');
const unpackedDir = path.join(extensionsDir, 'unpacked');
const sources = require(path.join(extensionsDir, 'sources.json'));

// the shim is copied to the root of each extension under this name
const shimFile = 'electron-compat.js';
const stampFile = '.ycr-extension.json';

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function download (url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// puts a <script> for the shim in front of the first script of every page in
// the extension, background page included
function shimPages (dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const file = path.join(entry.parentPath, entry.name);
    const html = fs.readFileSync(file, 'utf8');
    const firstScript = html.search(/<script\b/i);
    if (firstScript === -1) continue;
    const tag = `<script src="/${shimFile}"></script>\n`;
    fs.writeFileSync(file, html.slice(0, firstScript) + tag + html.slice(firstScript));
  }
}

function shimManifest (dir, source) {
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const background = manifest.background || {};

  if (Array.isArray(background.scripts)) {
    background.scripts.unshift(shimFile);
  }

  // a service worker can't be given a second script through the manifest, so
  // it gets started through a small one that loads the shim and then the
  // original. That one sits next to the original so relative URLs inside the
  // worker still resolve the same way.
  if (background.service_worker) {
    const worker = background.service_worker.replace(/^\.?\//, '');
    const starter = path.posix.join(path.posix.dirname(worker), 'electron-compat-worker.js');
    const original = path.posix.basename(worker);
    const code = background.type === 'module'
      ? `import '/${shimFile}';\nimport './${original}';\n`
      : `importScripts('/${shimFile}', '${original}');\n`;
    fs.writeFileSync(path.join(dir, starter), code);
    background.service_worker = starter;
  }

  // the shim only needs to go where the extension's own code reaches for
  // chrome.* APIs, which is never the page's main world
  if (source.shimContentScripts) {
    for (const script of manifest.content_scripts || []) {
      if (!script.js || (script.world && script.world !== 'ISOLATED')) continue;
      script.js.unshift(shimFile);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

async function fetchExtension (id, source) {
  const target = path.join(unpackedDir, id);
  const shim = fs.readFileSync(path.join(extensionsDir, source.shim));
  const stamp = {
    version: source.version,
    sha256: source.sha256,
    shim: sha256(shim),
  };

  try {
    const existing = JSON.parse(fs.readFileSync(path.join(target, stampFile), 'utf8'));
    if (JSON.stringify(existing) === JSON.stringify(stamp)) {
      console.log(`${source.name} ${source.version} is already unpacked`);
      return;
    }
  } catch {
    // not unpacked yet, or left half done by an earlier run
  }

  console.log(`Downloading ${source.name} ${source.version}`);
  const archive = await download(source.url);
  const checksum = sha256(archive);
  if (checksum !== source.sha256) {
    throw new Error(`${source.name}: ${source.url} has sha256 ${checksum}, ` +
      `but extensions/sources.json expects ${source.sha256}`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `ycr-${id}-`));
  try {
    const archivePath = path.join(workDir, 'extension.zip');
    const extractDir = path.join(workDir, 'extension');
    fs.writeFileSync(archivePath, archive);
    await extractZip(archivePath, { dir: extractDir });

    const unpacked = path.join(extractDir, source.root);
    if (!fs.existsSync(path.join(unpacked, 'manifest.json'))) {
      throw new Error(`${source.name}: no manifest.json at "${source.root}" in ${source.url}`);
    }

    fs.writeFileSync(path.join(unpacked, shimFile), shim);
    shimPages(unpacked);
    shimManifest(unpacked, source);
    fs.writeFileSync(path.join(unpacked, stampFile), JSON.stringify(stamp, null, 2) + '\n');

    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(unpackedDir, { recursive: true });
    fs.cpSync(unpacked, target, { recursive: true });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`Unpacked ${source.name} ${source.version} into ${path.relative(process.cwd(), target)}`);
}

(async () => {
  for (const [id, source] of Object.entries(sources)) {
    await fetchExtension(id, source);
  }
})().catch(error => {
  console.error(`Could not fetch the browser extensions: ${error.message}`);
  if (error.cause) console.error(error.cause);
  process.exitCode = 1;
});
