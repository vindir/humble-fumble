// ==UserScript==
// @name         Humble Bundle Library Resource & Key Downloader
// @namespace    https://www.humblebundle.com/violentmonkey/library-downloader
// @version      5.5.1
// @description  Forces binary downloads of PDFs, eBooks, audio, games, and keys into real OS bundle/type subfolders without opening files in browser tabs.
// @author       HumbleLibraryTools
// @homepageURL  https://github.com/vindir/humble-fumble
// @supportURL   https://github.com/vindir/humble-fumble/issues
// @downloadURL  https://raw.githubusercontent.com/vindir/humble-fumble/main/humble_fumble.user.js
// @updateURL    https://raw.githubusercontent.com/vindir/humble-fumble/main/humble_fumble.user.js
// @match        *://*.humblebundle.com/home/library*
// @match        *://*.humblebundle.com/downloads*
// @match        *://*.humblebundle.com/home/keys*
// @match        *://*.humblebundle.com/home/purchases*
// @inject-into  auto
// @connect      humble.com
// @connect      humblebundle.com
// @connect      akamaihd.net
// @connect      googleapis.com
// @connect      amazonaws.com
// @connect      *
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const pageWin = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;

  const STORAGE_KEYS = {
    DOWNLOADED_MAP: 'hb_dl_completed_resources_v4',
    PAGE_STATUS_MAP: 'hb_dl_completed_pages_v4',
    SAVED_KEYS_VAULT: 'hb_dl_saved_keys_vault_v4',
  };

  const KNOWN_BUNDLE_NAMES = {
    'c7a551c0-0c6a-47ac-b109-0faa227a198f': 'Rhythm is Gonna Get You VR Bundle',
    'c7a551c0-0d6a-4155-9d5b-acf1f9840e86': 'CRPG Pack: Isometric Immersion',
  };

  const FILE_EXTENSIONS = [
    'epub', 'pdf', 'mobi', 'prc', 'cbz', 'cbr', 'djvu', 'azw3', 'txt', 'rtf',
    'mp3', 'flac', 'ogg', 'wav', 'm4a', 'm4b', 'aac',
    'zip', '7z', 'rar', 'tar.gz', 'tgz', 'tar', 'gz', 'bz2', 'iso',
    'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'appimage', 'bin', 'apk', 'torrent'
  ];

  const SERVICE_KEY_TYPES = [
    { id: 'steam_key', rx: /\bsteam\b/i },
    { id: 'gog_key', rx: /\bgog\b|good old games/i },
    { id: 'manning_key', rx: /\bmanning\b/i },
    { id: 'kobo_key', rx: /\bkobo\b/i },
    { id: 'epic_key', rx: /epic\s*games|\bepic\b/i },
    { id: 'ea_origin_key', rx: /\borigin\b|\bea\s+app\b/i },
    { id: 'ubisoft_key', rx: /\bubisoft\b|\buplay\b/i },
    { id: 'other_key', rx: /\b(reveal|redeem|claim)\s*(your\s+)?(key|code)\b|\blicense\s*key\b/i }
  ];

  const ALL_CATALOG_TYPES = [...FILE_EXTENSIONS, ...SERVICE_KEY_TYPES.map((s) => s.id)];

  const state = {
    bundleId: '',
    bundleName: '',
    normalizedBundleName: '',
    resources: [],
    resourceById: new Map(),
    selectedResourceIds: new Set(),
    selectedTypesDropdown: new Set(),
    rootDirHandle: null,
    showAllStandardTypes: false,
    isDownloading: false,
    captureActive: false,
    blockTabOpenUntil: 0,
    capturedUrlResolver: null,
  };

  const politeWait = (ms) => new Promise((r) => setTimeout(r, ms));
  const isBlockingTabs = () => Boolean(state.captureActive || Date.now() < state.blockTabOpenUntil);

  function deliverCapturedUrl(url) {
    if (!url || typeof url !== 'string') return;
    state.blockTabOpenUntil = Date.now() + 3500;
    if (state.capturedUrlResolver) {
      const resolve = state.capturedUrlResolver;
      state.capturedUrlResolver = null;
      state.captureActive = false;
      resolve(url);
    }
  }

  function isNonDownloadUrl(url = '') {
    return /support\.humblebundle\.com|zendesk\.com|\/hc\/[a-z-]+|humblebundle\.com\/(home|store|bundles|membership|games|books|software|login|user|account|about|terms|privacy|help|support)\b/i.test(
      String(url)
    );
  }

  function isDownloadLikeUrl(url = '') {
    if (!url || typeof url !== 'string' || isNonDownloadUrl(url)) return false;
    return /dl\.humble|akamaihd\.net|googleapis\.com|amazonaws\.com|download|signed|\.pdf|\.epub|\.mobi|\.prc|\.cbz|\.cbr|\.zip|\.mp3|\.flac|\.ogg|\.wav|\.exe|\.dmg|\.pkg|\.tar\.gz|\.torrent/i.test(
      url
    );
  }

  function findUrlInJson(obj, depth = 0) {
    if (!obj || depth > 5) return null;
    if (typeof obj === 'string') return /^https?:\/\//i.test(obj) && isDownloadLikeUrl(obj) ? obj : null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const u = findUrlInJson(item, depth + 1);
        if (u) return u;
      }
      return null;
    }
    if (typeof obj === 'object') {
      for (const k of ['url', 'web', 'download_url', 'downloadUrl', 'signed_url', 'signedUrl', 'file_url']) {
        const v = obj[k];
        if (typeof v === 'string' && /^https?:\/\//i.test(v) && isDownloadLikeUrl(v)) return v;
        if (v && typeof v === 'object') {
          const n = findUrlInJson(v, depth + 1);
          if (n) return n;
        }
      }
      for (const v of Object.values(obj)) {
        const u = findUrlInJson(v, depth + 1);
        if (u) return u;
      }
    }
    return null;
  }

  // Install direct hooks on window and unsafeWindow (NO <script> element injection)
  function installDirectInterceptors() {
    const wins = pageWin !== window ? [window, pageWin] : [window];
    wins.forEach((w) => {
      if (!w || w.__hbHooksV54) return;
      w.__hbHooksV54 = true;

      try {
        const origOpen = w.open;
        w.open = function (url) {
          if (isBlockingTabs() && typeof url === 'string' && url) {
            let full = url;
            try { full = new URL(url, location.origin).href; } catch (_) {}
            deliverCapturedUrl(full);
            return { closed: false, close() {}, focus() {}, location: { href: full } };
          }
          return origOpen.apply(this, arguments);
        };
      } catch (_) {}

      try {
        if (w.HTMLAnchorElement && w.HTMLAnchorElement.prototype) {
          const origClick = w.HTMLAnchorElement.prototype.click;
          w.HTMLAnchorElement.prototype.click = function () {
            const href = this.href || this.getAttribute('href') || '';
            if (isBlockingTabs() && href && !href.startsWith('javascript:')) {
              deliverCapturedUrl(href);
              return;
            }
            return origClick.apply(this, arguments);
          };
        }
      } catch (_) {}

      try {
        if (w.navigation && typeof w.navigation.addEventListener === 'function') {
          w.navigation.addEventListener('navigate', (e) => {
            if (!isBlockingTabs() || !e.destination || !e.destination.url) return;
            const dest = e.destination.url;
            if (isDownloadLikeUrl(dest) || dest !== location.href) {
              if (e.cancelable) e.preventDefault();
              deliverCapturedUrl(dest);
            }
          });
        }
      } catch (_) {}

      try {
        if (typeof w.fetch === 'function') {
          const origFetch = w.fetch;
          w.fetch = async function (...args) {
            const res = await origFetch.apply(this, args);
            if (isBlockingTabs()) {
              try {
                const clone = res.clone();
                if ((clone.headers.get('content-type') || '').toLowerCase().includes('json')) {
                  clone.json().then((d) => {
                    const u = findUrlInJson(d, 0);
                    if (u) deliverCapturedUrl(u);
                  }).catch(() => {});
                }
              } catch (_) {}
            }
            return res;
          };
        }
      } catch (_) {}
    });

    window.addEventListener(
      'click',
      (e) => {
        if (!isBlockingTabs()) return;
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (a) {
          const href = a.href || a.getAttribute('href') || '';
          if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            deliverCapturedUrl(href);
          }
        }
      },
      true
    );
  }

  // Real OS Subfolder Engine (File System Access API + IndexedDB)
  const IDB_CFG = { DB: 'hb_dl_fs_v5', STORE: 'handles', KEY: 'root_dir' };
  const hasFsa = () => Boolean(typeof window.showDirectoryPicker === 'function' || typeof pageWin.showDirectoryPicker === 'function');

  function openIdb() {
    return new Promise((resolve, reject) => {
      const idb = pageWin.indexedDB || window.indexedDB;
      if (!idb) return reject(new Error('No IDB'));
      const req = idb.open(IDB_CFG.DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_CFG.STORE)) req.result.createObjectStore(IDB_CFG.STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadSavedDirHandle() {
    if (!hasFsa()) return null;
    try {
      const db = await openIdb();
      return await new Promise((resolve) => {
        const req = db.transaction(IDB_CFG.STORE, 'readonly').objectStore(IDB_CFG.STORE).get(IDB_CFG.KEY);
        req.onsuccess = () => {
          state.rootDirHandle = req.result || null;
          updateBaseFolderButtonUI();
          resolve(state.rootDirHandle);
        };
        req.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  }

  async function pickBaseDirHandle() {
    const picker = (pageWin.showDirectoryPicker || window.showDirectoryPicker).bind(pageWin.showDirectoryPicker ? pageWin : window);
    const handle = await picker({ id: 'hb_library_root', mode: 'readwrite', startIn: 'downloads' });
    if (handle) {
      state.rootDirHandle = handle;
      updateBaseFolderButtonUI();
      try {
        const db = await openIdb();
        db.transaction(IDB_CFG.STORE, 'readwrite').objectStore(IDB_CFG.STORE).put(handle, IDB_CFG.KEY);
      } catch (_) {}
    }
    return handle;
  }

  async function ensureVerifiedDirHandle() {
    if (!hasFsa()) return null;
    if (state.rootDirHandle) {
      try {
        let p = await state.rootDirHandle.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted') p = await state.rootDirHandle.requestPermission({ mode: 'readwrite' });
        if (p === 'granted') return state.rootDirHandle;
      } catch (_) {}
    }
    return await pickBaseDirHandle();
  }

  async function writeToOsSubfolder(rootHandle, bundleDir, extDir, fileNameOnly, content) {
    const bDir = await rootHandle.getDirectoryHandle(bundleDir, { create: true });
    const eDir = await bDir.getDirectoryHandle(extDir, { create: true });
    const fHandle = await eDir.getFileHandle(fileNameOnly, { create: true });
    const w = await fHandle.createWritable();
    await w.write(content);
    await w.close();
  }

  // ZIP-BEGIN (fallback for browsers without showDirectoryPicker: Firefox, Safari)
  // shortcut: STORE-only, no zip64, so each part must stay under 4 GiB; runDownloadQueue splits parts at ZIP_PART_LIMIT.
  const ZIP_PART_LIMIT = 1024 * 1024 * 1024;
  const CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let crc = 0xffffffff;
    for (let i = 0; i < u8.length; i++) crc = CRC32_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // entries: [{ relativePath: 'Bundle/epub/a.epub', dataUint8: Uint8Array }]
  function buildStructuredZipBlob(entries) {
    const enc = new TextEncoder();
    const local = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.relativePath);
      const data = e.dataUint8;
      const crc = crc32(data);
      const size = data.length;
      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8 names
      lv.setUint16(12, 0x0021, true); // DOS date 1980-01-01
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, name.length, true);
      lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(14, 0x0021, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      local.push(lh, data);
      central.push(ch);
      offset += lh.length + size;
    }
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, central.reduce((n, a) => n + a.length, 0), true);
    ev.setUint32(16, offset, true);
    return new Blob([...local, ...central, eocd], { type: 'application/zip' });
  }
  // ZIP-END

  function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function safeSetClipboard(text) {
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(text); return; } } catch (_) {}
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
  }

  function safeGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, undefined);
        if (v !== undefined) return v;
      }
    } catch (_) {}
    try {
      const r = localStorage.getItem(key);
      return r !== null ? JSON.parse(r) : fallback;
    } catch (_) { return fallback; }
  }

  function safeSet(key, val) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, val); } catch (_) {}
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  const isResourceDownloaded = (bId, rId) => Boolean(safeGet(STORAGE_KEYS.DOWNLOADED_MAP, {})?.[bId]?.[rId]);

  function markResourceDownloaded(bId, rId, meta = {}) {
    const map = safeGet(STORAGE_KEYS.DOWNLOADED_MAP, {});
    if (!map[bId]) map[bId] = {};
    map[bId][rId] = { downloadedAt: new Date().toISOString(), ...meta };
    safeSet(STORAGE_KEYS.DOWNLOADED_MAP, map);
    checkAndUpdatePageCompletionState();
  }

  const getSavedKeysVault = () => safeGet(STORAGE_KEYS.SAVED_KEYS_VAULT, []) || [];

  function saveKeyToVault(rec) {
    if (!rec || !rec.keyValue) return;
    const v = getSavedKeysVault();
    const idx = v.findIndex((k) => k.bundleId === rec.bundleId && k.resourceId === rec.resourceId);
    if (idx !== -1) v[idx] = { ...v[idx], ...rec };
    else v.push({ ...rec, savedAt: new Date().toISOString() });
    safeSet(STORAGE_KEYS.SAVED_KEYS_VAULT, v);
    renderKeysSection();
  }

  function normalizeForPath(str, fallback = 'unclassified') {
    if (!str || typeof str !== 'string') return fallback;
    return (
      str
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^#\s*/, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/['"`\u2018\u2019\u201C\u201D]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[._]+|[._]+$/g, '')
        .slice(0, 100) || fallback
    );
  }

  function isBulkHeaderOrSummaryRow(rowEl, titleText = '') {
    if (/^all\s+\d+\s+items?\b|^\d+\s+items?\b|\bbulk\s*download\b|\bdownload\s+all\b/i.test(String(titleText).trim())) return true;
    if (!rowEl) return false;
    return /\ball\s+\d+\s+items?\b|\bbulk\s*download\b/i.test((rowEl.innerText || rowEl.textContent || '').trim());
  }

  function detectStrictExtension(url = '', label = '') {
    if (url && isNonDownloadUrl(url)) return null;
    if (url && !url.startsWith('javascript:')) {
      try {
        const u = new URL(url, location.origin);
        const pq = (decodeURIComponent(u.pathname) + ' ' + decodeURIComponent(u.search)).toLowerCase();
        if (/\.tar\.gz\b/i.test(pq)) return 'tar.gz';
        for (const ext of FILE_EXTENSIONS) {
          if (new RegExp('(?:\\.|format=|ext=|type=|_)' + ext.replace('.', '\\.') + '(?:[^a-z0-9]|$)', 'i').test(pq)) return ext;
        }
      } catch (_) {}
    }
    const clean = String(label || '').trim().toLowerCase();
    if (!clean) return null;
    if (/\.tar\.gz\b|\btar\.gz\b/i.test(clean)) return 'tar.gz';
    for (const ext of FILE_EXTENSIONS) {
      if (new RegExp('(^|[^a-z0-9])\\.?' + ext.replace('.', '\\.') + '([^a-z0-9]|$)', 'i').test(clean)) return ext;
    }
    return /\bbittorrent\b|\bmagnet:/i.test(clean) ? 'torrent' : null;
  }

  function inspectReactFiber(el) {
    const meta = { urlsByExt: {}, directUrl: null, title: null, ext: null, keyValue: null };
    if (!el || typeof el !== 'object') return meta;
    function walk(obj, d) {
      if (!obj || typeof obj !== 'object' || d > 5 || obj instanceof Node || obj instanceof Window) return;
      if (Array.isArray(obj)) { obj.forEach((x) => walk(x, d + 1)); return; }
      const fmt = obj.name || obj.format || obj.file_type || obj.fileType || obj.ext || '';
      const u = (typeof obj.url === 'string' ? obj.url : obj.url?.web) || obj.download_url || obj.downloadUrl || obj.signed_url || obj.signedUrl || null;
      if (u && typeof u === 'string' && /^https?:\/\//i.test(u) && !isNonDownloadUrl(u)) {
        const de = detectStrictExtension('', String(fmt)) || detectStrictExtension(u, '');
        if (de) meta.urlsByExt[de] = u;
        if (!meta.directUrl) meta.directUrl = u;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'children' || k.startsWith('_')) continue;
        const lk = k.toLowerCase();
        if (typeof v === 'string') {
          const sv = v.trim();
          if (!meta.directUrl && /^https?:\/\//i.test(sv) && !isNonDownloadUrl(sv)) {
            meta.directUrl = sv;
            const ue = detectStrictExtension(sv, '');
            if (ue && !meta.urlsByExt[ue]) meta.urlsByExt[ue] = sv;
          }
          if (!meta.ext && /^(format|ext|extension|filetype|file_type|selectedformat)$/i.test(lk)) meta.ext = detectStrictExtension('', sv) || meta.ext;
          if (!meta.title && /^(human_name|humanname|title|product_name|productname|book_title)$/i.test(lk) && sv.length > 2 && !isBulkHeaderOrSummaryRow(null, sv)) meta.title = sv;
          if (!meta.keyValue && /^(redeemed_key_val|key_val|keyvalue|serial|code)$/i.test(lk) && /^[A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6}$/i.test(sv)) meta.keyValue = sv;
        } else if (v && typeof v === 'object') walk(v, d + 1);
      }
    }
    try {
      let c = el;
      for (let d = 0; c && c !== document.body && d < 5; d++, c = c.parentElement) {
        for (const k of Object.keys(c)) {
          if (k.startsWith('__reactProps$')) walk(c[k], 0);
          else if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
            for (let f = c[k], s = 0; f && s < 9; s++, f = f.return) if (f.memoizedProps) walk(f.memoizedProps, 0);
          }
        }
      }
    } catch (_) {}
    return meta;
  }

  function findRowContainer(el) {
    let c = el.parentElement;
    for (let s = 0; c && c !== document.body && s < 7; s++, c = c.parentElement) {
      const tag = c.tagName.toLowerCase();
      if (tag === 'tr' || tag === 'li' || tag === 'article') return c;
      if (Array.from(c.querySelectorAll('button, a[href], [role="button"]')).filter((b) => /^download$/i.test((b.textContent || '').trim())).length > 1) break;
      const cls = (typeof c.className === 'string' ? c.className : '').toLowerCase();
      if (/\b(row|item|card|product|book|subproduct|entry|resource|key-redeemer)\b/.test(cls)) return c;
      if (c.parentElement && c.parentElement.children.length >= 2 && c.children.length >= 2 && c.offsetHeight < 260) return c;
    }
    return el.parentElement;
  }

  function extractRowTitle(rowEl, reactTitle = null) {
    if (reactTitle && reactTitle.length > 2 && !isBulkHeaderOrSummaryRow(null, reactTitle)) return reactTitle;
    if (!rowEl) return state.bundleName || 'Bundle_Resource';
    if (rowEl.getAttribute?.('data-human-name')) return rowEl.getAttribute('data-human-name').trim();
    for (const c of rowEl.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"], strong, p, span, div')) {
      if (c.closest('#hb-dl-root-host, .hb-dl-inline-wrap, button, a, select') || c.querySelector('button, a, select, input')) continue;
      const t = (c.textContent || '').replace(/\u2713\s*Downloaded/gi, '').trim();
      if (t.length < 2 || t.length > 180) continue;
      if (/^(epub|pdf|mobi|prc|cbz|cbr|mp3|flac|wav|zip|exe|dmg|torrent|download|bulk\s*download|reveal|redeem|claim|steam|gog|manning|kobo|ebook|audio|keys?|\d+(\.\d+)?\s*(kb|mb|gb|bytes)|all\s+\d+\s+items?)$/i.test(t)) continue;
      return t.split('\n')[0].trim();
    }
    return state.bundleName || 'Bundle_Resource';
  }

  function registerResource(res) {
    const ex = state.resourceById.get(res.id);
    if (ex) {
      ex.url = res.url || ex.url;
      ex.domElement = res.domElement || ex.domElement;
      ex.selectElement = res.selectElement || ex.selectElement;
      if (res.selectOptionValue !== undefined) ex.selectOptionValue = res.selectOptionValue;
      ex.keyValue = res.keyValue || ex.keyValue;
      return ex;
    }
    state.resourceById.set(res.id, res);
    state.resources = Array.from(state.resourceById.values());
    return res;
  }

  function scanPageResources() {
    if (!document.body) return;
    const m = location.href.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    state.bundleId = m ? m[1].toLowerCase() : 'humble_library';
    state.bundleName = KNOWN_BUNDLE_NAMES[state.bundleId] || (() => {
      for (const s of ['main h1', 'main h2', '.bundle-title', '.hib-text h1', 'header h1', 'h1']) {
        for (const el of document.querySelectorAll(s)) {
          if (el.closest('#hb-dl-root-host')) continue;
          const t = (el.textContent || '').replace(/^#\s*/, '').replace(/\u2713\s*All.*Downloaded/gi, '').trim();
          if (t.length > 2 && !/^(humble\s*bundle|library|my\s*library|purchases|keys|all\s+\d+\s+items?)$/i.test(t)) return t;
        }
      }
      return 'Humble_Bundle_' + state.bundleId.slice(0, 12);
    })();
    state.normalizedBundleName = normalizeForPath(state.bundleName, 'Humble_Bundle');

    const handledEls = new WeakSet();
    const handledRowExts = new WeakMap();
    const markRowExt = (r, e) => { if (r) { if (!handledRowExts.has(r)) handledRowExts.set(r, new Set()); handledRowExts.get(r).add(e); } };
    const hasRowExt = (r, e) => Boolean(r && handledRowExts.has(r) && handledRowExts.get(r).has(e));

    document.querySelectorAll('a[href], button, [role="button"], .js-download-button, .download-button, .keyfield, .js-keyfield').forEach((el, idx) => {
      if (handledEls.has(el) || el.closest('#hb-dl-root-host, .hb-dl-inline-wrap, nav, header, footer')) return;
      const tag = el.tagName.toLowerCase();
      const anchor = tag === 'a' ? el : el.closest('a[href]') || el.querySelector('a[href]');
      const rawHref = anchor ? anchor.getAttribute('href') || '' : el.getAttribute('data-url') || '';
      let fullUrl = null;
      if (rawHref && !rawHref.startsWith('javascript:') && rawHref !== '#') {
        try { fullUrl = new URL(rawHref, location.origin).href; } catch (_) {}
      }
      if (fullUrl && isNonDownloadUrl(fullUrl)) { handledEls.add(el); return; }

      const ownText = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\u2713\s*Downloaded/gi, '').trim();
      if (!ownText && !fullUrl && !el.hasAttribute('download')) return;
      if (/\bbulk\s*download\b|\bdownload\s+all\b|^all\s+\d+\s+items?\b|^(next|previous|prev|search|filter|sort|log\s*in|close|cancel|back|help|support)$/i.test(ownText)) {
        handledEls.add(el);
        return;
      }

      const rowEl = findRowContainer(el);
      const rMeta = inspectReactFiber(el);
      const title = extractRowTitle(rowEl, rMeta.title);
      if (isBulkHeaderOrSummaryRow(rowEl, title)) { handledEls.add(el); return; }

      if (tag !== 'a' && !fullUrl && !/\bdownload\b/i.test(ownText) && detectStrictExtension('', ownText) && rowEl) {
        const sibDl = Array.from(rowEl.querySelectorAll('button, a[href], [role="button"]')).find((b) => b !== el && /\bdownload\b/i.test(b.textContent || ''));
        if (sibDl) { handledEls.add(el); return; }
      }

      const rowText = rowEl ? (rowEl.innerText || rowEl.textContent || '').replace(/\u2713\s*Downloaded/gi, '').trim() : ownText;
      const normTitle = normalizeForPath(title, 'Resource_' + (idx + 1));

      let ext = rMeta.ext || detectStrictExtension(fullUrl || '', ownText);
      const isExplicitDl = /\bdownload\b/i.test(ownText) || el.hasAttribute('download') || el.classList.contains('js-download-button') || Boolean(fullUrl && isDownloadLikeUrl(fullUrl));
      if (!ext && isExplicitDl && rowText) ext = detectStrictExtension(fullUrl || '', rowText);
      if (tag === 'a' && fullUrl && !isExplicitDl && !detectStrictExtension(fullUrl, '')) return;

      if (ext) {
        const finalExt = ext.toLowerCase();
        if (hasRowExt(rowEl, finalExt)) return;
        markRowExt(rowEl, finalExt);
        handledEls.add(el);
        if (anchor) handledEls.add(anchor);
        const res = registerResource({
          id: 'file_' + normTitle + '_' + finalExt,
          kind: 'file',
          productTitle: title,
          typeOrExt: finalExt,
          url: fullUrl || rMeta.urlsByExt[finalExt] || rMeta.directUrl || null,
          fileName: normTitle + '.' + finalExt,
          domElement: anchor || el,
        });
        injectInlineCheckbox(el, res);
        return;
      }

      if (/\b(reveal|redeem|claim)\b/i.test(ownText) || el.classList.contains('keyfield') || /^[A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6}$/i.test(ownText)) {
        const keySvc = (SERVICE_KEY_TYPES.find((s) => s.rx.test(ownText + ' ' + rowText)) || { id: 'steam_key' }).id;
        if (hasRowExt(rowEl, keySvc)) return;
        markRowExt(rowEl, keySvc);
        handledEls.add(el);
        const keyMatch = rMeta.keyValue || (rowText.match(/\b([A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6})\b/) || [])[1] || null;
        const res = registerResource({
          id: 'key_' + normTitle + '_' + keySvc,
          kind: 'key',
          productTitle: title,
          typeOrExt: keySvc,
          fileName: normTitle + '_' + keySvc + '.txt',
          domElement: el,
          wrapperElement: rowEl,
          keyValue: keyMatch,
        });
        if (keyMatch) saveKeyToVault({ bundleId: state.bundleId, bundleName: state.bundleName, resourceId: res.id, productTitle: title, serviceType: keySvc, keyValue: keyMatch });
        injectInlineCheckbox(el, res);
      }
    });

    refreshToolbarAndPanel();
    checkAndUpdatePageCompletionState();
  }

  function injectInlineCheckbox(targetEl, res) {
    if (!targetEl || !targetEl.parentElement) return;
    const parent = targetEl.parentElement;
    const safeId = String(res.id).replace(/["\\]/g, '\\$&');
    const existing = parent.querySelector('.hb-dl-inline-wrap[data-resource-id="' + safeId + '"]');
    const done = isResourceDownloaded(state.bundleId, res.id);
    if (existing) {
      const cb = existing.querySelector('input.hb-dl-inline-cb');
      if (cb) cb.checked = state.selectedResourceIds.has(res.id);
      const b = existing.querySelector('.hb-dl-item-badge');
      if (b) b.style.display = done ? 'inline-block' : 'none';
      return;
    }
    const wrap = document.createElement('span');
    wrap.className = 'hb-dl-inline-wrap';
    wrap.dataset.resourceId = res.id;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'hb-dl-inline-cb';
    cb.checked = state.selectedResourceIds.has(res.id);
    wrap.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) state.selectedResourceIds.add(res.id);
      else state.selectedResourceIds.delete(res.id);
      syncCheckboxesUI();
    });
    const tag = document.createElement('span');
    tag.className = 'hb-dl-inline-tag';
    tag.textContent = res.typeOrExt.toUpperCase();
    const badge = document.createElement('span');
    badge.className = 'hb-dl-item-badge';
    badge.textContent = '\u2713 Downloaded';
    badge.style.display = done ? 'inline-block' : 'none';
    wrap.append(cb, tag, badge);
    parent.insertBefore(wrap, targetEl);
  }

  function syncCheckboxesUI() {
    document.querySelectorAll('.hb-dl-inline-wrap[data-resource-id]').forEach((w) => {
      const rid = w.dataset.resourceId;
      const cb = w.querySelector('input.hb-dl-inline-cb');
      if (cb) cb.checked = state.selectedResourceIds.has(rid);
      const b = w.querySelector('.hb-dl-item-badge');
      if (b) b.style.display = isResourceDownloaded(state.bundleId, rid) ? 'inline-block' : 'none';
    });
    document.querySelectorAll('.hb-dl-panel-row-cb').forEach((cb) => {
      cb.checked = state.selectedResourceIds.has(cb.dataset.resourceId);
    });
    updateExecuteButtonLabel();
  }

  function checkAndUpdatePageCompletionState() {
    const total = state.resources.length;
    const doneCount = state.resources.filter((r) => isResourceDownloaded(state.bundleId, r.id)).length;
    const allDone = total > 0 && doneCount === total;
    if (total > 0) {
      const pm = safeGet(STORAGE_KEYS.PAGE_STATUS_MAP, {});
      pm[state.bundleId] = { complete: allDone, updatedAt: new Date().toISOString() };
      safeSet(STORAGE_KEYS.PAGE_STATUS_MAP, pm);
    }
    const badge = document.getElementById('hb-dl-page-complete-badge');
    if (badge) {
      badge.className = 'hb-dl-page-badge ' + (allDone ? 'hb-dl-page-badge-complete' : 'hb-dl-page-badge-partial');
      badge.textContent = allDone ? 'All Downloaded (' + doneCount + '/' + total + ')' : doneCount + ' / ' + total + ' Downloaded';
    }
  }

  const getTargetResources = (allowed = null) =>
    state.resources.filter((r) => {
      if (!state.selectedResourceIds.has(r.id) && !state.selectedTypesDropdown.has(r.typeOrExt)) return false;
      return allowed && allowed.size > 0 ? allowed.has(r.typeOrExt) : true;
    });

  function getOrganizedPathParts(res, resolvedUrl = null) {
    const bundleFolder = normalizeForPath(state.bundleName, 'Humble_Bundle');
    const subFolder = normalizeForPath(res.typeOrExt, 'other');
    let baseName = res.fileName || normalizeForPath(res.productTitle, 'item') + '.' + res.typeOrExt;
    if (resolvedUrl && /^https?:\/\//i.test(resolvedUrl)) {
      try {
        const uLeaf = decodeURIComponent(new URL(resolvedUrl).pathname).split('/').pop() || '';
        if (uLeaf && /\.[a-z0-9]{2,8}$/i.test(uLeaf)) baseName = uLeaf;
      } catch (_) {}
    }
    const cleanFileName = String(baseName).split('/').pop().split('\\').pop().replace(/[<>:"/\\|?*]/g, '_');
    return { bundleFolder, subFolder, cleanFileName, displayPath: bundleFolder + '/' + subFolder + '/' + cleanFileName };
  }

  function fetchBinaryBlobViaGM(url, onProgress) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'blob',
          onprogress: (e) => { if (onProgress && e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100) + '%'); },
          onload: (r) => (r.status >= 200 && r.status < 300 && r.response ? resolve(new Blob([r.response], { type: 'application/octet-stream' })) : reject(new Error('HTTP ' + r.status))),
          onerror: () => reject(new Error('Network error')),
        });
        return;
      }
      fetch(url).then((r) => r.blob()).then((b) => new Blob([b], { type: 'application/octet-stream' })).then(resolve).catch(reject);
    });
  }

  async function resolveDownloadUrl(res) {
    if (!res.url && res.domElement) {
      const a = res.domElement.tagName === 'A' ? res.domElement : res.domElement.closest('a[href]') || res.domElement.querySelector('a[href]');
      if (a && a.href && !a.href.startsWith('javascript:') && !isNonDownloadUrl(a.href)) res.url = a.href;
    }
    if (!res.url && res.domElement) {
      const m = inspectReactFiber(res.domElement);
      res.url = m.urlsByExt[res.typeOrExt] || m.directUrl || null;
    }
    if (!res.url && res.domElement) {
      res.url = await new Promise((resolve) => {
        const t = setTimeout(() => { state.capturedUrlResolver = null; state.captureActive = false; resolve(null); }, 6000);
        state.capturedUrlResolver = (u) => { clearTimeout(t); state.captureActive = false; resolve(u); };
        state.captureActive = true;
        state.blockTabOpenUntil = Date.now() + 7000;
        res.domElement.click();
      });
    }
    if (!res.url) throw new Error('Could not resolve URL for ' + res.productTitle);
    return res.url;
  }

  function promptPreDownloadModal() {
    scanPageResources();
    const candidates = getTargetResources();
    if (candidates.length === 0) {
      setStatusMessage('No resources selected. Check items or choose types from "Filter Types" first.', 'warn');
      return;
    }
    const counts = {};
    candidates.forEach((r) => { counts[r.typeOrExt] = (counts[r.typeOrExt] || 0) + 1; });
    const doneCount = candidates.filter((r) => isResourceDownloaded(state.bundleId, r.id)).length;
    const defaultCount = candidates.length - doneCount;

    document.getElementById('hb-dl-modal-backdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'hb-dl-modal-backdrop';
    backdrop.className = 'hb-dl-modal-backdrop';

    const chipsHtml = Object.entries(counts)
      .map(([ext, c]) => '<label class="hb-dl-modal-type-chip"><input type="checkbox" class="hb-dl-confirm-ext-cb" value="' + escapeHtml(ext) + '" checked /><span><strong>' + escapeHtml(ext.toUpperCase()) + '</strong> (' + c + ')</span></label>')
      .join('');
    const fsa = hasFsa();
    const rootName = !fsa ? 'Structured .ZIP archive (this browser has no folder picker)' : state.rootDirHandle ? state.rootDirHandle.name : 'Select on Start (one-time prompt)';

    backdrop.innerHTML =
      '<div class="hb-dl-modal"><h3>Confirm Target Extensions &amp; Subfolder Creation</h3>' +
      '<div class="hb-dl-modal-folder-box"><div><div style="font-size:12px;">Base Folder: <strong style="color:#4ade80;">' + escapeHtml(rootName) + '</strong></div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Creates real subfolders: <code>' + escapeHtml(state.normalizedBundleName) + '/&lt;ext&gt;/&lt;filename&gt;</code></div></div>' +
      (fsa ? '<button type="button" id="hb-dl-modal-pick-btn" class="hb-dl-btn">Choose Base Folder</button>' : '') + '</div>' +
      '<div class="hb-dl-modal-type-grid">' + chipsHtml + '</div>' +
      '<div style="margin:10px 0;font-size:12px;"><div style="color:#94a3b8;font-size:11px;margin-bottom:5px;">Default behavior skips ' + doneCount + ' already-downloaded item(s).</div>' +
      '<label style="cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="hb-dl-force-redownload-cb" />' +
      '<span>Force download of items already marked as downloaded in GM Storage</span></label></div>' +
      '<div class="hb-dl-modal-actions"><button type="button" id="hb-dl-modal-cancel" class="hb-dl-btn">Cancel</button>' +
      '<button type="button" id="hb-dl-modal-start" class="hb-dl-btn hb-dl-btn-primary" ' + (defaultCount === 0 ? 'disabled' : '') + '>Start Download (' + defaultCount + ')</button></div></div>';

    document.documentElement.appendChild(backdrop);

    const getQueue = () => {
      const exts = new Set(Array.from(backdrop.querySelectorAll('.hb-dl-confirm-ext-cb:checked')).map((c) => c.value));
      const force = Boolean(backdrop.querySelector('#hb-dl-force-redownload-cb')?.checked);
      return getTargetResources(exts).filter((r) => (force ? true : !isResourceDownloaded(state.bundleId, r.id)));
    };

    backdrop.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
      const q = getQueue();
      const btn = backdrop.querySelector('#hb-dl-modal-start');
      btn.textContent = 'Start Download (' + q.length + ')';
      btn.disabled = q.length === 0;
    }));
    backdrop.querySelector('#hb-dl-modal-pick-btn')?.addEventListener('click', async () => { try { await pickBaseDirHandle(); promptPreDownloadModal(); } catch (_) {} });
    backdrop.querySelector('#hb-dl-modal-cancel').addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#hb-dl-modal-start').addEventListener('click', async () => {
      const q = getQueue();
      if (q.length === 0) return;
      let dirHandle = null;
      if (hasFsa()) {
        try { dirHandle = await ensureVerifiedDirHandle(); } catch (_) {
          setStatusMessage('Please select a base folder (e.g. Downloads) so subfolders can be created.', 'warn');
          return;
        }
      }
      backdrop.remove();
      await runDownloadQueue(q, dirHandle);
    });
  }

  async function runDownloadQueue(queue, rootDirHandle) {
    if (state.isDownloading || queue.length === 0) return;
    state.isDownloading = true;
    updateExecuteButtonLabel();
    let ok = 0, fail = 0;
    const zipEntries = [];
    const zipPending = [];
    let zipBytes = 0, zipPart = 0;

    const flushZip = () => {
      if (zipEntries.length === 0) return;
      zipPart++;
      triggerBlobDownload(buildStructuredZipBlob(zipEntries), state.normalizedBundleName + (zipPart > 1 ? '_part' + zipPart : '') + '.zip');
      zipPending.forEach((p) => markResourceDownloaded(state.bundleId, p.id, { path: p.path }));
      zipEntries.length = 0;
      zipPending.length = 0;
      zipBytes = 0;
    };

    // Folder mode writes now; zip mode queues and only marks "downloaded" once the zip is handed to the browser.
    const saveContent = async (res, bundleFolder, subFolder, fileName, displayPath, content) => {
      if (rootDirHandle) {
        await writeToOsSubfolder(rootDirHandle, bundleFolder, subFolder, fileName, content);
        markResourceDownloaded(state.bundleId, res.id, { path: displayPath });
        return;
      }
      const data = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(await content.arrayBuffer());
      zipEntries.push({ relativePath: displayPath, dataUint8: data });
      zipPending.push({ id: res.id, path: displayPath });
      zipBytes += data.length;
      if (zipBytes >= ZIP_PART_LIMIT) flushZip();
    };

    for (let i = 0; i < queue.length; i++) {
      const res = queue[i];
      try {
        if (res.kind === 'key') {
          if (!res.keyValue && res.domElement) {
            res.domElement.click();
            await politeWait(1200);
            const txt = (res.wrapperElement || res.domElement.parentElement || res.domElement).innerText || '';
            res.keyValue = (txt.match(/\b([A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6})\b/) || [])[1] || 'REVEALED_ON_PAGE';
          }
          const { bundleFolder, subFolder, cleanFileName, displayPath } = getOrganizedPathParts(res);
          const body = 'Bundle: ' + state.bundleName + '\nProduct: ' + res.productTitle + '\nKey: ' + res.keyValue + '\n';
          await saveContent(res, bundleFolder, subFolder, cleanFileName, displayPath, body);
          saveKeyToVault({ bundleId: state.bundleId, bundleName: state.bundleName, resourceId: res.id, productTitle: res.productTitle, serviceType: res.typeOrExt, keyValue: res.keyValue });
          ok++;
        } else {
          const dlUrl = await resolveDownloadUrl(res);
          const { bundleFolder, subFolder, cleanFileName, displayPath } = getOrganizedPathParts(res, dlUrl);
          setStatusMessage('[' + (i + 1) + '/' + queue.length + '] Saving ' + displayPath + '...', 'info');
          const blob = await fetchBinaryBlobViaGM(dlUrl, (pct) => setStatusMessage('[' + (i + 1) + '/' + queue.length + '] ' + displayPath + ' (' + pct + ')', 'info'));
          await saveContent(res, bundleFolder, subFolder, cleanFileName, displayPath, blob);
          ok++;
        }
      } catch (e) { console.error('[HB-DL] Failed item:', res.productTitle, e); fail++; }
      syncCheckboxesUI();
      if (i < queue.length - 1) await politeWait(1200 + Math.floor(Math.random() * 1000));
    }

    try { flushZip(); } catch (e) {
      console.error('[HB-DL] Could not build zip:', e);
      fail += zipEntries.length;
      ok -= zipEntries.length;
    }

    state.isDownloading = false;
    updateExecuteButtonLabel();
    syncCheckboxesUI();
    const target = rootDirHandle ? '"' + state.normalizedBundleName + '/<type>/" subfolders' : '"' + state.normalizedBundleName + '.zip" (' + zipPart + ' file' + (zipPart === 1 ? '' : 's') + ')';
    setStatusMessage('Finished: ' + ok + ' saved into ' + target + (fail ? ' (' + fail + ' failed).' : '.'), fail ? 'warn' : 'success');
  }

  function injectStyles() {
    const st = document.createElement('style');
    st.textContent =
      '#hb-dl-root-host{position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;background:#161922!important;color:#f8fafc!important;border-bottom:3px solid #cb272c!important;padding:9px 16px!important;font-family:sans-serif!important;font-size:13px!important;box-shadow:0 4px 16px rgba(0,0,0,.6)!important}' +
      '.hb-dl-top-row{display:flex!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between!important;gap:10px!important}' +
      '.hb-dl-brand,.hb-dl-controls{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important}' +
      '.hb-dl-bundle-title{font-weight:700!important;font-size:14px!important;color:#fff!important}' +
      '.hb-dl-folder-preview{font-family:monospace!important;font-size:11px!important;background:#262b38!important;color:#7dd3fc!important;padding:3px 7px!important;border-radius:4px!important}' +
      '.hb-dl-page-badge{padding:3px 9px!important;border-radius:99px!important;font-weight:700!important;font-size:11px!important}' +
      '.hb-dl-page-badge-complete{background:#166534!important;color:#dcfce7!important}.hb-dl-page-badge-partial{background:#334155!important;color:#e2e8f0!important}' +
      '.hb-dl-split-group{position:relative!important;display:inline-flex!important}' +
      '.hb-dl-btn{cursor:pointer!important;border:1px solid #475569!important;background:#293040!important;color:#f8fafc!important;padding:6px 11px!important;font-size:12px!important;font-weight:600!important;border-radius:5px!important}' +
      '.hb-dl-btn-primary{background:#cb272c!important;border-color:#ef4444!important;color:#fff!important}' +
      '.hb-dl-dropdown-menu{display:none;position:absolute!important;top:calc(100% + 5px)!important;right:0!important;width:290px!important;max-height:360px!important;overflow-y:auto!important;background:#1e2330!important;border:1px solid #64748b!important;border-radius:6px!important;padding:10px!important;z-index:2147483647!important}' +
      '.hb-dl-dropdown-menu.open{display:block!important}.hb-dl-dropdown-item{display:flex!important;justify-content:space-between!important;padding:4px 6px!important;cursor:pointer!important;font-size:12px!important}' +
      '.hb-dl-status-line{margin-top:5px!important;font-size:12px!important;color:#cbd5e1!important}.hb-dl-status-warn{color:#fbbf24!important}.hb-dl-status-success{color:#4ade80!important}' +
      '#hb-dl-drawer{display:none;margin-top:10px!important;border-top:1px solid #334155!important;padding-top:10px!important;max-height:380px!important;overflow-y:auto!important}' +
      '#hb-dl-drawer.open{display:grid!important;grid-template-columns:1.2fr 1fr!important;gap:12px!important}' +
      '.hb-dl-box{background:#11141c!important;border:1px solid #2e3646!important;border-radius:6px!important;padding:10px!important}' +
      '.hb-dl-table{width:100%!important;border-collapse:collapse!important;font-size:12px!important}.hb-dl-table th,.hb-dl-table td{text-align:left!important;padding:5px 7px!important;border-bottom:1px solid #262b38!important}' +
      '.hb-dl-inline-wrap{display:inline-flex!important;align-items:center!important;gap:5px!important;margin-right:6px!important;padding:2px 6px!important;background:#161922!important;border:1px solid #38bdf8!important;border-radius:4px!important;vertical-align:middle!important}' +
      '.hb-dl-inline-tag{font-size:10px!important;font-weight:700!important;color:#38bdf8!important}.hb-dl-item-badge{font-size:10px!important;font-weight:700!important;background:#166534!important;color:#dcfce7!important;padding:1px 5px!important;border-radius:3px!important}' +
      '.hb-dl-modal-backdrop{position:fixed!important;inset:0!important;background:rgba(0,0,0,.75)!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;font-family:sans-serif!important}' +
      '.hb-dl-modal{background:#1e222d!important;color:#f8fafc!important;border:1px solid #64748b!important;border-radius:8px!important;width:540px!important;max-width:92vw!important;padding:18px!important}' +
      '.hb-dl-modal-folder-box{display:flex!important;justify-content:space-between!important;align-items:center!important;background:#141720!important;padding:10px!important;border-radius:6px!important;margin:10px 0!important}' +
      '.hb-dl-modal-type-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(135px,1fr))!important;gap:8px!important;margin:10px 0!important}' +
      '.hb-dl-modal-type-chip{display:flex!important;align-items:center!important;gap:6px!important;background:#282e3d!important;padding:6px 8px!important;border-radius:5px!important;font-size:12px!important}' +
      '.hb-dl-modal-actions{display:flex!important;justify-content:flex-end!important;gap:8px!important;margin-top:12px!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  function updateBaseFolderButtonUI() {
    const btn = document.getElementById('hb-dl-pick-root-dir-btn');
    if (!btn) return;
    if (!hasFsa()) { btn.style.display = 'none'; return; }
    btn.textContent = state.rootDirHandle ? 'Base Folder: ' + state.rootDirHandle.name + '/' : 'Set Base Folder';
  }

  function ensureToolbarMounted() {
    if (document.getElementById('hb-dl-root-host')) return;
    const bar = document.createElement('div');
    bar.id = 'hb-dl-root-host';
    bar.innerHTML =
      '<div class="hb-dl-top-row"><div class="hb-dl-brand"><span class="hb-dl-bundle-title" id="hb-dl-bundle-title-text">Humble Bundle Downloader</span>' +
      '<span class="hb-dl-folder-preview" id="hb-dl-folder-preview-text"></span><span class="hb-dl-page-badge hb-dl-page-badge-partial" id="hb-dl-page-complete-badge">0 / 0 Downloaded</span></div>' +
      '<div class="hb-dl-controls"><div class="hb-dl-split-group"><button type="button" id="hb-dl-execute-btn" class="hb-dl-btn hb-dl-btn-primary">Download Selected (0)</button>' +
      '<button type="button" id="hb-dl-dropdown-toggle" class="hb-dl-btn hb-dl-btn-primary">Filter Types (0)</button><div id="hb-dl-type-dropdown" class="hb-dl-dropdown-menu"></div></div>' +
      '<button type="button" id="hb-dl-pick-root-dir-btn" class="hb-dl-btn">Set Base Folder</button><button type="button" id="hb-dl-rescan-btn" class="hb-dl-btn">Rescan Page</button>' +
      '<button type="button" id="hb-dl-clear-selection-btn" class="hb-dl-btn">Clear</button><button type="button" id="hb-dl-toggle-drawer-btn" class="hb-dl-btn">Resources &amp; Keys (0)</button></div></div>' +
      '<div id="hb-dl-status-msg" class="hb-dl-status-line">Ready (0 selected by default).</div>' +
      '<div id="hb-dl-drawer"><div class="hb-dl-box"><h4>Discovered Bundle Resources</h4><div id="hb-dl-resource-table-wrap"></div></div>' +
      '<div class="hb-dl-box"><h4 style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><span>Saved Keys Section</span><span>' +
      '<button type="button" id="hb-dl-export-keys-json" class="hb-dl-btn" style="padding:3px 8px;font-size:11px;">Export JSON</button> ' +
      '<button type="button" id="hb-dl-export-keys-csv" class="hb-dl-btn" style="padding:3px 8px;font-size:11px;">Export CSV</button></span></h4><div id="hb-dl-keys-table-wrap"></div></div></div>';
    document.documentElement.appendChild(bar);
    updateBaseFolderButtonUI();

    const toggle = document.getElementById('hb-dl-dropdown-toggle');
    const menu = document.getElementById('hb-dl-type-dropdown');
    toggle.addEventListener('click', (e) => { e.stopPropagation(); renderTypeDropdownMenu(); menu.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== toggle) menu.classList.remove('open'); });
    document.getElementById('hb-dl-execute-btn').addEventListener('click', promptPreDownloadModal);
    document.getElementById('hb-dl-pick-root-dir-btn').addEventListener('click', () => pickBaseDirHandle().catch(() => {}));
    document.getElementById('hb-dl-rescan-btn').addEventListener('click', () => { scanPageResources(); setStatusMessage('Rescanned: ' + state.resources.length + ' resources found.', 'info'); });
    document.getElementById('hb-dl-clear-selection-btn').addEventListener('click', () => { state.selectedResourceIds.clear(); state.selectedTypesDropdown.clear(); refreshToolbarAndPanel(); syncCheckboxesUI(); });
    document.getElementById('hb-dl-toggle-drawer-btn').addEventListener('click', () => { document.getElementById('hb-dl-drawer').classList.toggle('open'); renderResourcesTable(); renderKeysSection(); });
    document.getElementById('hb-dl-export-keys-json').addEventListener('click', () => exportKeys('json'));
    document.getElementById('hb-dl-export-keys-csv').addEventListener('click', () => exportKeys('csv'));
  }

  // Writes into <base>/<Bundle>/keys/ when a base folder is set, otherwise downloads the file.
  async function exportKeys(kind) {
    const vault = getSavedKeysVault();
    if (vault.length === 0) { setStatusMessage('No keys saved yet.', 'warn'); return; }
    const isCsv = kind === 'csv';
    // Leading = + - @ would be run as a formula by spreadsheets, so prefix those cells with '.
    const cell = (v) => '"' + String(v == null ? '' : v).replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
    const body = isCsv
      ? 'Bundle,Product,Service,Key,SavedAt\n' + vault.map((k) => [k.bundleName, k.productTitle, k.serviceType, k.keyValue, k.savedAt].map(cell).join(',')).join('\n')
      : JSON.stringify(vault, null, 2);
    const name = 'humble_keys_vault.' + kind;
    if (state.rootDirHandle) {
      try {
        const dir = await ensureVerifiedDirHandle();
        await writeToOsSubfolder(dir, state.normalizedBundleName || 'Humble_Library', 'keys', name, body);
        setStatusMessage('Exported ' + name + ' into "' + (state.normalizedBundleName || 'Humble_Library') + '/keys/".', 'success');
        return;
      } catch (_) {}
    }
    triggerBlobDownload(new Blob([body], { type: isCsv ? 'text/csv' : 'application/json' }), name);
    setStatusMessage('Exported ' + name + '.', 'success');
  }

  function updateExecuteButtonLabel() {
    const execBtn = document.getElementById('hb-dl-execute-btn');
    const toggleBtn = document.getElementById('hb-dl-dropdown-toggle');
    const drawerBtn = document.getElementById('hb-dl-toggle-drawer-btn');
    if (execBtn) { execBtn.textContent = state.isDownloading ? 'Downloading...' : 'Download Selected (' + getTargetResources().length + ')'; execBtn.disabled = state.isDownloading; }
    if (toggleBtn) toggleBtn.textContent = 'Filter Types (' + state.selectedTypesDropdown.size + ')';
    if (drawerBtn) drawerBtn.textContent = 'Resources & Keys (' + state.resources.length + ')';
  }

  function refreshToolbarAndPanel() {
    ensureToolbarMounted();
    const t = document.getElementById('hb-dl-bundle-title-text');
    const f = document.getElementById('hb-dl-folder-preview-text');
    if (t) t.textContent = state.bundleName || 'Humble Bundle Library';
    if (f) f.textContent = state.normalizedBundleName + '/<type>/';
    updateBaseFolderButtonUI();
    renderTypeDropdownMenu();
    renderResourcesTable();
    renderKeysSection();
    updateExecuteButtonLabel();
  }

  function renderTypeDropdownMenu() {
    const menu = document.getElementById('hb-dl-type-dropdown');
    if (!menu) return;
    const counts = {};
    state.resources.forEach((r) => { counts[r.typeOrExt] = (counts[r.typeOrExt] || 0) + 1; });
    const pageTypes = Object.keys(counts).sort();
    const list = pageTypes.length > 0 && !state.showAllStandardTypes ? pageTypes : Array.from(new Set([...pageTypes, ...ALL_CATALOG_TYPES]));
    menu.innerHTML =
      '<div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:11px;"><span>Select Extensions / Types</span>' +
      '<a href="#" id="hb-dl-toggle-all-types" style="color:#7dd3fc;">' + (state.showAllStandardTypes ? 'Page Only' : 'Show All Types') + '</a></div>' +
      list.map((k) => '<label class="hb-dl-dropdown-item"><span><input type="checkbox" class="hb-dl-type-cb" value="' + escapeHtml(k) + '" ' + (state.selectedTypesDropdown.has(k) ? 'checked' : '') + ' /> <strong>' + escapeHtml(k.toUpperCase()) + '</strong></span><span>' + (counts[k] || 0) + '</span></label>').join('');
    menu.querySelector('#hb-dl-toggle-all-types')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); state.showAllStandardTypes = !state.showAllStandardTypes; renderTypeDropdownMenu(); });
    menu.querySelectorAll('.hb-dl-type-cb').forEach((cb) => cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) state.selectedTypesDropdown.add(cb.value);
      else state.selectedTypesDropdown.delete(cb.value);
      updateExecuteButtonLabel();
    }));
  }

  function renderResourcesTable() {
    const wrap = document.getElementById('hb-dl-resource-table-wrap');
    if (!wrap) return;
    if (state.resources.length === 0) { wrap.innerHTML = '<div style="color:#94a3b8;font-size:12px;">No resources scanned yet. Click "Rescan Page".</div>'; return; }
    wrap.innerHTML = '<table class="hb-dl-table"><thead><tr><th>Sel</th><th>Title</th><th>Type</th><th>Subfolder Path</th></tr></thead><tbody>' +
      state.resources.map((r) => '<tr><td><input type="checkbox" class="hb-dl-panel-row-cb" data-resource-id="' + escapeHtml(r.id) + '" ' + (state.selectedResourceIds.has(r.id) ? 'checked' : '') + ' /></td><td>' + escapeHtml(r.productTitle) + '</td><td>' + escapeHtml(r.typeOrExt.toUpperCase()) + '</td><td><code>' + escapeHtml(getOrganizedPathParts(r, r.url).displayPath) + '</code></td></tr>').join('') + '</tbody></table>';
    wrap.querySelectorAll('.hb-dl-panel-row-cb').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) state.selectedResourceIds.add(cb.dataset.resourceId);
      else state.selectedResourceIds.delete(cb.dataset.resourceId);
      syncCheckboxesUI();
    }));
  }

  function renderKeysSection() {
    const wrap = document.getElementById('hb-dl-keys-table-wrap');
    if (!wrap) return;
    const vault = getSavedKeysVault();
    if (vault.length === 0) { wrap.innerHTML = '<div style="color:#94a3b8;font-size:12px;">No keys saved yet.</div>'; return; }
    wrap.innerHTML = '<table class="hb-dl-table"><thead><tr><th>Product</th><th>Service</th><th>Key</th><th></th></tr></thead><tbody>' +
      vault.slice().reverse().map((k) => '<tr><td>' + escapeHtml(k.productTitle) + '</td><td>' + escapeHtml(k.serviceType) + '</td><td><code>' + escapeHtml(k.keyValue) + '</code></td><td><button type="button" class="hb-dl-btn hb-dl-copy-key-btn" data-key-val="' + escapeHtml(k.keyValue) + '" style="padding:2px 6px;font-size:11px;">Copy</button></td></tr>').join('') + '</tbody></table>';
    wrap.querySelectorAll('.hb-dl-copy-key-btn').forEach((btn) => btn.addEventListener('click', () => {
      safeSetClipboard(btn.dataset.keyVal);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
    }));
  }

  function setStatusMessage(msg, level = 'info') {
    const el = document.getElementById('hb-dl-status-msg');
    if (el) { el.className = 'hb-dl-status-line ' + (level === 'warn' ? 'hb-dl-status-warn' : level === 'success' ? 'hb-dl-status-success' : ''); el.textContent = msg; }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Adding nodes to Humble's React tree before hydration ends throws React error #418 and forces a re-render
  // that deletes our checkboxes. Wait until React has mounted its root and the DOM has been quiet for 1s.
  // shortcut: if React's root marker is not visible to the script (isolated world), falls back to a 6s wait.
  function whenPageSettled() {
    return new Promise((resolve) => {
      const start = Date.now();
      let lastMutation = start;
      const obs = new MutationObserver(() => { lastMutation = Date.now(); });
      obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      const hasReactRoot = () =>
        [document, document.documentElement, document.body, ...Array.from(document.body ? document.body.children : [])]
          .some((n) => n && Object.keys(n).some((k) => k.startsWith('__reactContainer$')));
      let rootSeenAt = 0;
      const timer = setInterval(() => {
        const now = Date.now();
        const age = now - start;
        // Hydration itself does not mutate the DOM, so time the quiet period from when the root first appears.
        if (!rootSeenAt && hasReactRoot()) rootSeenAt = now;
        const ready = rootSeenAt || age > 6000;
        if ((ready && now - Math.max(lastMutation, rootSeenAt) > 1000) || age > 20000) {
          clearInterval(timer);
          obs.disconnect();
          resolve();
        }
      }, 250);
    });
  }

  function initOnce() {
    installDirectInterceptors();
    whenPageSettled().then(() => {
      injectStyles();
      ensureToolbarMounted();
      loadSavedDirHandle();
      scanPageResources();
      setTimeout(scanPageResources, 1800);
      window.addEventListener('popstate', () => setTimeout(scanPageResources, 800));
    });
  }

  if (document.readyState === 'complete') initOnce();
  else window.addEventListener('load', initOnce, { once: true });
})();
