// ==UserScript==
// @name         Humble Bundle Library Resource & Key Downloader
// @namespace    https://www.humblebundle.com/violentmonkey/library-downloader
// @version      5.0.0
// @description  Download Humble Bundle library files (EPUB, PDF, MOBI, audio, games) and service keys (Steam, GOG, Manning, Kobo) into real OS bundle/type subfolders with GM storage tracking.
// @author       HumbleLibraryTools
// @match        *://*.humblebundle.com/home/library*
// @match        *://*.humblebundle.com/downloads*
// @match        *://*.humblebundle.com/home/keys*
// @match        *://*.humblebundle.com/home/purchases*
// @match        *://*.humblebundle.com/*
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
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const hostWin =
    typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;

  /********************************************************************
   * 0. PAGE-WORLD BRIDGE (REACT FIBER PROBE & NATIVE DOWNLOAD BLOCKER)
   ********************************************************************/
  function injectPageWorldBridge() {
    if (document.getElementById('hb-dl-page-world-bridge')) return;
    const script = document.createElement('script');
    script.id = 'hb-dl-page-world-bridge';
    script.textContent = `
      (function () {
        if (window.__hbDlBridgeInstalled) return;
        window.__hbDlBridgeInstalled = true;
        window.__hbCaptureMode = false;

        // 1. Prevent React 18/19 NotFoundError when userscript injects checkboxes
        const origRemoveChild = Node.prototype.removeChild;
        Node.prototype.removeChild = function (child) {
          if (child && child.parentNode !== this) return child;
          return origRemoveChild.apply(this, arguments);
        };
        const origInsertBefore = Node.prototype.insertBefore;
        Node.prototype.insertBefore = function (newNode, refNode) {
          if (refNode && refNode.parentNode !== this) return this.appendChild(newNode);
          return origInsertBefore.apply(this, arguments);
        };

        function emitCapturedUrl(url, filename) {
          if (!url || typeof url !== 'string') return;
          window.dispatchEvent(new CustomEvent('hb-dl-captured-url', {
            detail: { url: url, filename: filename || '' }
          }));
        }

        function findDownloadUrlInJson(obj, depth) {
          if (!obj || depth > 6) return null;
          if (typeof obj === 'string') {
            if (/^https?:\\/\\//i.test(obj) && /dl\\.humble|download|signed|s3\\.|googleapis|akamai|\\.pdf|\\.epub|\\.mobi|\\.cbz|\\.zip|\\.mp3|\\.flac|\\.exe|\\.dmg|\\.torrent/i.test(obj)) {
              if (!/support\\.humblebundle\\.com/i.test(obj)) return obj;
            }
            return null;
          }
          if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
              const f = findDownloadUrlInJson(obj[i], depth + 1);
              if (f) return f;
            }
            return null;
          }
          if (typeof obj === 'object') {
            const pKeys = ['url', 'web', 'download_url', 'downloadUrl', 'signed_url', 'signedUrl', 'file_url', 'fileUrl', 'href'];
            for (let i = 0; i < pKeys.length; i++) {
              const k = pKeys[i];
              if (typeof obj[k] === 'string' && /^https?:\\/\\//i.test(obj[k]) && !/support\\.humblebundle\\.com/i.test(obj[k])) {
                return obj[k];
              }
              if (obj[k] && typeof obj[k] === 'object') {
                const n = findDownloadUrlInJson(obj[k], depth + 1);
                if (n) return n;
              }
            }
            const vals = Object.values(obj);
            for (let i = 0; i < vals.length; i++) {
              const f = findDownloadUrlInJson(vals[i], depth + 1);
              if (f) return f;
            }
          }
          return null;
        }

        window.addEventListener('hb-dl-set-capture', function (e) {
          window.__hbCaptureMode = Boolean(e.detail && e.detail.active);
        });

        // 2. Block native bare downloads when __hbCaptureMode is active
        const origAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          const href = this.href || this.getAttribute('href') || '';
          if (window.__hbCaptureMode && href && !href.startsWith('javascript:')) {
            emitCapturedUrl(href, this.getAttribute('download') || '');
            return;
          }
          return origAnchorClick.apply(this, arguments);
        };

        const origDispatchEvent = EventTarget.prototype.dispatchEvent;
        EventTarget.prototype.dispatchEvent = function (evt) {
          if (
            window.__hbCaptureMode &&
            this instanceof HTMLAnchorElement &&
            evt &&
            (evt.type === 'click' || evt.type === 'mousedown')
          ) {
            const href = this.href || this.getAttribute('href') || '';
            if (href && !href.startsWith('javascript:')) {
              if (evt.cancelable) evt.preventDefault();
              emitCapturedUrl(href, this.getAttribute('download') || '');
              return false;
            }
          }
          return origDispatchEvent.apply(this, arguments);
        };

        window.addEventListener('click', function (e) {
          if (!window.__hbCaptureMode) return;
          const anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
          if (anchor) {
            const href = anchor.href || anchor.getAttribute('href') || '';
            if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
              e.preventDefault();
              e.stopImmediatePropagation();
              emitCapturedUrl(href, anchor.getAttribute('download') || '');
            }
          }
        }, true);

        const origWinOpen = window.open;
        window.open = function (url) {
          if (window.__hbCaptureMode && typeof url === 'string' && url) {
            try {
              emitCapturedUrl(new URL(url, location.origin).href, '');
            } catch (_) {
              emitCapturedUrl(url, '');
            }
            return { close: function(){}, focus: function(){}, closed: false };
          }
          return origWinOpen.apply(this, arguments);
        };

        const iframeSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
        if (iframeSrcDesc && iframeSrcDesc.set) {
          Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
            configurable: true,
            enumerable: true,
            get: iframeSrcDesc.get,
            set: function (val) {
              if (window.__hbCaptureMode && typeof val === 'string' && val && /^https?:\\/\\//i.test(val)) {
                emitCapturedUrl(val, '');
                return;
              }
              return iframeSrcDesc.set.call(this, val);
            }
          });
        }

        if (window.navigation && typeof window.navigation.addEventListener === 'function') {
          window.navigation.addEventListener('navigate', function (e) {
            if (!window.__hbCaptureMode || !e.destination || !e.destination.url) return;
            const destUrl = e.destination.url;
            if (/dl\\.humble|download|signed|\\.pdf|\\.epub|\\.mobi|\\.cbz|\\.zip|\\.mp3|\\.flac|\\.exe|\\.dmg|\\.torrent/i.test(destUrl)) {
              if (e.cancelable) e.preventDefault();
              emitCapturedUrl(destUrl, '');
            }
          });
        }

        // 3. Hook fetch & XHR in true page world
        const origFetch = window.fetch;
        if (typeof origFetch === 'function') {
          window.fetch = async function (...args) {
            const response = await origFetch.apply(this, args);
            try {
              const clone = response.clone();
              const ct = (clone.headers.get('content-type') || '').toLowerCase();
              if (ct.includes('json')) {
                const data = await clone.json();
                window.dispatchEvent(new CustomEvent('hb-dl-page-json', { detail: data }));
                if (window.__hbCaptureMode) {
                  const dlUrl = findDownloadUrlInJson(data, 0);
                  if (dlUrl) {
                    emitCapturedUrl(dlUrl, '');
                    return new Promise(function () {});
                  }
                }
              }
            } catch (_) {}
            return response;
          };
        }

        const origXhrOpen = XMLHttpRequest.prototype.open;
        const origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__hbUrl = url;
          return origXhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
          this.addEventListener('readystatechange', function () {
            if (this.readyState === 4 && this.status >= 200 && this.status < 300) {
              try {
                const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
                if (ct.includes('json') && this.responseText) {
                  const data = JSON.parse(this.responseText);
                  window.dispatchEvent(new CustomEvent('hb-dl-page-json', { detail: data }));
                  if (window.__hbCaptureMode) {
                    const dlUrl = findDownloadUrlInJson(data, 0);
                    if (dlUrl) {
                      emitCapturedUrl(dlUrl, '');
                    }
                  }
                }
              } catch (_) {}
            }
          });
          return origXhrSend.apply(this, arguments);
        };

        // 4. Synchronous React Fiber Probe in true Page World
        window.addEventListener('hb-dl-probe-node', function (e) {
          const probeId = e.detail && e.detail.probeId;
          if (!probeId) return;
          const el = document.querySelector('[data-hb-dl-probe="' + probeId + '"]');
          if (!el) return;

          const meta = {
            urlsByExt: {},
            directUrl: null,
            title: null,
            ext: null,
            keyValue: null,
            expirationDate: null,
            serviceType: null
          };

          const EXTS = ['epub','pdf','mobi','prc','cbz','cbr','djvu','azw3','txt','mp3','flac','ogg','wav','m4a','m4b','zip','7z','rar','tar.gz','iso','exe','msi','dmg','pkg','deb','rpm','sh','appimage','bin','apk','torrent'];

          function matchExt(str) {
            if (!str || typeof str !== 'string') return null;
            const s = str.toLowerCase().trim();
            if (/\\.tar\\.gz\\b|\\btar\\.gz\\b/.test(s)) return 'tar.gz';
            for (let i = 0; i < EXTS.length; i++) {
              const ext = EXTS[i];
              const rx = new RegExp('(^|[^a-z0-9])\\\\.?' + ext.replace('.', '\\\\.') + '([^a-z0-9]|$)', 'i');
              if (rx.test(s)) return ext;
            }
            return null;
          }

          function scanObj(obj, depth) {
            if (!obj || typeof obj !== 'object' || depth > 5) return;
            if (obj instanceof Node || obj instanceof Window) return;

            if (Array.isArray(obj)) {
              for (let i = 0; i < obj.length; i++) scanObj(obj[i], depth + 1);
              return;
            }

            const fmtCandidate = obj.name || obj.format || obj.file_type || obj.fileType || obj.ext || obj.extension || '';
            const urlCandidate = (typeof obj.url === 'string' ? obj.url : (obj.url && obj.url.web)) || obj.download_url || obj.downloadUrl || obj.signed_url || obj.signedUrl || obj.file_url || obj.href || null;

            if (urlCandidate && typeof urlCandidate === 'string' && /^https?:\\/\\//i.test(urlCandidate) && !/support\\.humblebundle\\.com/i.test(urlCandidate)) {
              const detected = matchExt(fmtCandidate) || matchExt(urlCandidate);
              if (detected) {
                meta.urlsByExt[detected] = urlCandidate;
              }
              if (!meta.directUrl) {
                meta.directUrl = urlCandidate;
              }
            }

            for (const [k, v] of Object.entries(obj)) {
              if (k === 'children' || k.startsWith('_')) continue;
              const lk = k.toLowerCase();
              if (typeof v === 'string') {
                const sv = v.trim();
                if (!meta.directUrl && /^https?:\\/\\//i.test(sv) && !/humblebundle\\.com\\/(home|store|bundles|hc|articles)/i.test(sv) && !/support\\.humblebundle\\.com/i.test(sv)) {
                  meta.directUrl = sv;
                  const uExt = matchExt(sv);
                  if (uExt && !meta.urlsByExt[uExt]) meta.urlsByExt[uExt] = sv;
                }
                if (!meta.ext && /^(format|ext|extension|filetype|file_type|selectedformat)$/i.test(lk)) {
                  const fExt = matchExt(sv);
                  if (fExt) meta.ext = fExt;
                }
                if (!meta.title && /^(human_name|humanname|title|product_name|productname|book_title|booktitle)$/i.test(lk)) {
                  if (sv.length > 2 && !/^all\\s+\\d+\\s+items?$/i.test(sv) && !/^(download|bulk\\s*download|pdf|epub|mobi|cbz)$/i.test(sv)) {
                    meta.title = sv;
                  }
                }
                if (!meta.keyValue && /^(redeemed_key_val|key_val|keyvalue|serial|code)$/i.test(lk)) {
                  if (/^[A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6}$/i.test(sv)) {
                    meta.keyValue = sv;
                  }
                }
                if (!meta.expirationDate && /expir|deadline/i.test(lk) && sv) {
                  meta.expirationDate = sv;
                }
              } else if (v && typeof v === 'object') {
                scanObj(v, depth + 1);
              }
            }
          }

          try {
            let curr = el;
            let domSteps = 0;
            while (curr && curr !== document.body && domSteps < 5) {
              const keys = Object.keys(curr);
              for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (k.startsWith('__reactProps$')) {
                  scanObj(curr[k], 0);
                } else if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
                  let fiber = curr[k];
                  let fSteps = 0;
                  while (fiber && fSteps < 10) {
                    if (fiber.memoizedProps) scanObj(fiber.memoizedProps, 0);
                    if (fiber.memoizedState && fiber.memoizedState.memoizedState) {
                      scanObj(fiber.memoizedState, 0);
                    }
                    fiber = fiber.return;
                    fSteps++;
                  }
                }
              }
              curr = curr.parentElement;
              domSteps++;
            }
          } catch (_) {}

          el.setAttribute('data-hb-dl-react-meta', JSON.stringify(meta));
        });
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
  }

  injectPageWorldBridge();

  /********************************************************************
   * 1. REAL OS SUBFOLDER ENGINE (FILE SYSTEM ACCESS API + INDEXEDDB)
   ********************************************************************/
  const IDB_CONFIG = {
    DB_NAME: 'hb_dl_filesystem_handles_v5',
    STORE_NAME: 'handles',
    ROOT_KEY: 'base_download_dir',
  };

  function hasFileSystemAccessSupport() {
    return Boolean(
      typeof window.showDirectoryPicker === 'function' ||
        (hostWin && typeof hostWin.showDirectoryPicker === 'function')
    );
  }

  function openHandlesDb() {
    return new Promise((resolve, reject) => {
      const idb = hostWin.indexedDB || window.indexedDB;
      if (!idb) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = idb.open(IDB_CONFIG.DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_CONFIG.STORE_NAME)) {
          db.createObjectStore(IDB_CONFIG.STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadSavedRootDirectoryHandle() {
    if (!hasFileSystemAccessSupport()) return null;
    try {
      const db = await openHandlesDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_CONFIG.STORE_NAME, 'readonly');
        const req = tx.objectStore(IDB_CONFIG.STORE_NAME).get(IDB_CONFIG.ROOT_KEY);
        req.onsuccess = () => {
          state.rootDirHandle = req.result || null;
          updateBaseFolderButtonUI();
          resolve(state.rootDirHandle);
        };
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function saveRootDirectoryHandle(handle) {
    state.rootDirHandle = handle;
    updateBaseFolderButtonUI();
    try {
      const db = await openHandlesDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_CONFIG.STORE_NAME, 'readwrite');
        tx.objectStore(IDB_CONFIG.STORE_NAME).put(handle, IDB_CONFIG.ROOT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[HB-DL] Could not persist directory handle in IndexedDB:', e);
    }
  }

  /**
   * Must be invoked directly inside a user click event handler so transient user activation is active.
   */
  async function pickNewRootDirectoryHandle() {
    const picker =
      typeof hostWin.showDirectoryPicker === 'function'
        ? hostWin.showDirectoryPicker.bind(hostWin)
        : window.showDirectoryPicker.bind(window);

    const handle = await picker({
      id: 'hb_library_root_dir',
      mode: 'readwrite',
      startIn: 'downloads',
    });
    if (handle) {
      await saveRootDirectoryHandle(handle);
    }
    return handle;
  }

  /**
   * Verifies readwrite permission on the cached handle or prompts the user to pick a base folder.
   * Call this as the very first statement inside the "Start Download" click handler.
   */
  async function ensureVerifiedRootDirectoryHandle() {
    if (!hasFileSystemAccessSupport()) return null;

    if (state.rootDirHandle) {
      try {
        let perm = await state.rootDirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await state.rootDirHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
          return state.rootDirHandle;
        }
      } catch (_) {}
    }

    return await pickNewRootDirectoryHandle();
  }

  /**
   * Creates real OS subdirectories `<rootDir>/<bundleFolder>/<subFolder>/<cleanFileName>`
   * and writes `blobOrText` directly into the file without flattening folder names into the filename.
   */
  async function writeToRealOsSubfolders(
    rootDirHandle,
    bundleFolder,
    subFolder,
    cleanFileName,
    blobOrText
  ) {
    const bundleDir = await rootDirHandle.getDirectoryHandle(bundleFolder, { create: true });
    const typeDir = await bundleDir.getDirectoryHandle(subFolder, { create: true });
    const fileHandle = await typeDir.getFileHandle(cleanFileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blobOrText);
    await writable.close();
  }

  /********************************************************************
   * 2. PURE-JS STORED ZIP ARCHIVE BUILDER (FALLBACK FOR FIREFOX)
   ********************************************************************/
  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(uint8) {
    let crc = 0xffffffff;
    for (let i = 0; i < uint8.length; i++) {
      crc = CRC32_TABLE[(crc ^ uint8[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Builds a valid uncompressed (.zip) Blob preserving `<Bundle>/<ext>/<file>` folders
   * for browsers like Firefox that lack `window.showDirectoryPicker`.
   */
  function buildStructuredZipBlob(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.relativePath);
      const dataBytes = entry.dataUint8;
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local file header (30 bytes + name)
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8 flag
      lv.setUint16(8, 0, true);      // STORE (0)
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x2100, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      // Central directory header (46 bytes + name)
      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); // UTF-8 flag
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x2100, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);

      localParts.push(localHeader, dataBytes);
      centralParts.push(centralHeader);
      offset += localHeader.length + size;
    }

    const centralSize = centralParts.reduce((acc, arr) => acc + arr.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
  }

  /********************************************************************
   * 3. SAFE GM_* WRAPPERS
   ********************************************************************/
  function safeAddStyle(cssText) {
    let styleEl = document.getElementById('hb-dl-v5-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'hb-dl-v5-styles';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = cssText;
  }

  function safeGetValue(key, defaultValue) {
    try {
      if (typeof GM_getValue === 'function') {
        const val = GM_getValue(key, undefined);
        return val !== undefined ? val : defaultValue;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : defaultValue;
    } catch (_) {
      return defaultValue;
    }
  }

  function safeSetValue(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function safeSetClipboard(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
        return;
      }
    } catch (_) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  /********************************************************************
   * 4. CONFIGURATION & CONSTANTS
   ********************************************************************/
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
    'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'appimage', 'bin', 'apk',
    'torrent', 'unitypackage', 'blend', 'psd'
  ];

  const SERVICE_KEY_TYPES = [
    { id: 'steam_key', label: 'Steam Key', patterns: [/\bsteam\b/i] },
    { id: 'gog_key', label: 'GOG Key', patterns: [/\bgog\b/i, /good old games/i] },
    { id: 'manning_key', label: 'Manning Key', patterns: [/\bmanning\b/i] },
    { id: 'kobo_key', label: 'Kobo Key', patterns: [/\bkobo\b/i] },
    { id: 'epic_key', label: 'Epic Games Key', patterns: [/epic\s*games/i, /\bepic\b/i] },
    { id: 'ea_origin_key', label: 'EA / Origin Key', patterns: [/\borigin\b/i, /\bea\s+app\b/i] },
    { id: 'ubisoft_key', label: 'Ubisoft Key', patterns: [/\bubisoft\b/i, /\buplay\b/i] },
    { id: 'other_key', label: 'Other Service Key', patterns: [/\b(reveal|redeem|claim)\s*(your\s+)?(key|code)\b/i, /\bservice\s*key\b/i, /\blicense\s*key\b/i] }
  ];

  const ALL_CATALOG_TYPES = [
    ...FILE_EXTENSIONS,
    ...SERVICE_KEY_TYPES.map((s) => s.id),
  ];

  const state = {
    bundleId: '',
    bundleName: '',
    normalizedBundleName: '',
    resources: [],                    // Array of discovered Resource objects
    resourceById: new Map(),          // Map<id, Resource>
    apiUrlLookup: new Map(),          // Map<normTitle_ext, url>
    selectedResourceIds: new Set(),   // Default empty (0 selected)
    selectedTypesDropdown: new Set(), // Default empty (0 selected)
    rootDirHandle: null,              // Cached FileSystemDirectoryHandle for real OS subfolders
    showAllStandardTypes: false,
    isDownloading: false,
    capturedUrlResolver: null,
    probeCounter: 0,
    lastUrl: location.href,
  };

  window.addEventListener('hb-dl-captured-url', (e) => {
    if (state.capturedUrlResolver && e.detail && e.detail.url) {
      const resolve = state.capturedUrlResolver;
      state.capturedUrlResolver = null;
      resolve(e.detail.url);
    }
  });

  window.addEventListener('hb-dl-page-json', (e) => {
    if (e.detail) {
      try {
        indexUrlsFromArbitraryJson(e.detail);
      } catch (_) {}
    }
  });

  /********************************************************************
   * 5. GM STORAGE HELPERS
   ********************************************************************/
  function getDownloadedMap() {
    const v4 = safeGetValue(STORAGE_KEYS.DOWNLOADED_MAP, null);
    if (v4) return v4;
    return safeGetValue('hb_dl_completed_resources_v3', {}) || {};
  }

  function markResourceDownloaded(bundleId, resourceId, metadata = {}) {
    const map = getDownloadedMap();
    if (!map[bundleId]) map[bundleId] = {};
    map[bundleId][resourceId] = {
      downloadedAt: new Date().toISOString(),
      ...metadata,
    };
    safeSetValue(STORAGE_KEYS.DOWNLOADED_MAP, map);
    checkAndUpdatePageCompletionState();
  }

  function isResourceDownloaded(bundleId, resourceId) {
    const map = getDownloadedMap();
    return Boolean(map[bundleId] && map[bundleId][resourceId]);
  }

  function getPageStatusMap() {
    const v4 = safeGetValue(STORAGE_KEYS.PAGE_STATUS_MAP, null);
    if (v4) return v4;
    return safeGetValue('hb_dl_completed_pages_v3', {}) || {};
  }

  function setPageCompletedStatus(bundleId, isComplete, summary = {}) {
    const pageMap = getPageStatusMap();
    pageMap[bundleId] = {
      complete: isComplete,
      updatedAt: new Date().toISOString(),
      ...summary,
    };
    safeSetValue(STORAGE_KEYS.PAGE_STATUS_MAP, pageMap);
  }

  function getSavedKeysVault() {
    const v4 = safeGetValue(STORAGE_KEYS.SAVED_KEYS_VAULT, null);
    if (v4) return v4;
    return safeGetValue('hb_dl_saved_keys_vault_v3', []) || [];
  }

  function saveKeyToVault(keyRecord) {
    if (!keyRecord || !keyRecord.keyValue) return;
    const vault = getSavedKeysVault();
    const existingIdx = vault.findIndex(
      (k) => k.bundleId === keyRecord.bundleId && k.resourceId === keyRecord.resourceId
    );
    if (existingIdx !== -1) {
      vault[existingIdx] = { ...vault[existingIdx], ...keyRecord, updatedAt: new Date().toISOString() };
    } else {
      vault.push({ ...keyRecord, savedAt: new Date().toISOString() });
    }
    safeSetValue(STORAGE_KEYS.SAVED_KEYS_VAULT, vault);
    renderKeysSection();
  }

  /********************************************************************
   * 6. BUNDLE IDENTIFICATION & PATH NORMALIZATION
   ********************************************************************/
  function extractBundleId() {
    const uuidMatch = location.href.match(
      /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
    );
    if (uuidMatch) return uuidMatch[1].toLowerCase();

    const params = new URLSearchParams(location.search);
    if (params.get('key')) return `order_${params.get('key')}`;

    return location.pathname.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'humble_library';
  }

  function scrapeBundleName(bundleId) {
    if (KNOWN_BUNDLE_NAMES[bundleId]) {
      return KNOWN_BUNDLE_NAMES[bundleId];
    }

    const headingSelectors = [
      'main h1',
      'main h2',
      '[data-automation-id="bundle-title"]',
      '.bundle-title',
      '.hib-text h1',
      '.paper-header h1',
      'header h1',
      'h1',
    ];

    for (const sel of headingSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.closest('#hb-dl-root-host')) continue;
        const cleaned = (el.textContent || '')
          .replace(/^#\s*/, '')
          .replace(/✓\s*All.*Downloaded/gi, '')
          .trim();
        if (
          cleaned &&
          cleaned.length > 2 &&
          !/^(humble\s*bundle|library|my\s*library|purchases|keys|all\s+\d+\s+items?)$/i.test(cleaned)
        ) {
          return cleaned;
        }
      }
    }

    if (document.title) {
      const titleCleaned = document.title
        .replace(/\s*[|\-–]\s*Humble Bundle.*$/i, '')
        .replace(/^Humble Bundle\s*[\-–|]\s*/i, '')
        .trim();
      if (titleCleaned && !/^(Humble Bundle|Library)$/i.test(titleCleaned)) {
        return titleCleaned;
      }
    }

    return `Humble_Bundle_${bundleId.slice(0, 12)}`;
  }

  function normalizeForPath(str, fallback = 'unclassified') {
    if (!str || typeof str !== 'string') return fallback;
    const normalized = str
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^#\s*/, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/['"`’‘“”]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._]+|[._]+$/g, '');
    return normalized.slice(0, 100) || fallback;
  }

  /********************************************************************
   * 7. STRICT VALIDATION & EXTENSION DETECTION
   ********************************************************************/
  function isNonDownloadWebpageUrl(url = '') {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase().trim();
    if (
      /support\.humblebundle\.com/i.test(lower) ||
      /zendesk\.com/i.test(lower) ||
      /\/hc\/[a-z-]+(\/articles\/|\b)/i.test(lower) ||
      /humblebundle\.com\/(home|store|bundles|membership|games|books|software|login|signup|user|account|about|terms|privacy|cookie|faq|help|support)\b/i.test(lower)
    ) {
      return true;
    }
    return false;
  }

  function isBulkHeaderOrSummaryRow(rowEl, titleText = '') {
    const cleanTitle = String(titleText || '').trim();
    if (
      /^all\s+\d+\s+items?\b/i.test(cleanTitle) ||
      /^\d+\s+items?\b/i.test(cleanTitle) ||
      /\bbulk\s*download\b/i.test(cleanTitle) ||
      /\bdownload\s+all\b/i.test(cleanTitle)
    ) {
      return true;
    }

    if (!rowEl) return false;
    const rowText = (rowEl.innerText || rowEl.textContent || '')
      .replace(/✓\s*Downloaded/gi, '')
      .trim();

    if (/\ball\s+\d+\s+items?\b/i.test(rowText) || /\bbulk\s*download\b/i.test(rowText)) {
      return true;
    }

    return false;
  }

  function detectStrictExtension(url = '', label = '') {
    if (url && isNonDownloadWebpageUrl(url)) {
      return null;
    }

    if (url && typeof url === 'string' && !url.startsWith('javascript:')) {
      try {
        const parsed = new URL(url, location.origin);
        const pathAndQuery = `${decodeURIComponent(parsed.pathname)} ${decodeURIComponent(parsed.search)}`.toLowerCase();
        if (/\.tar\.gz\b/i.test(pathAndQuery)) return 'tar.gz';
        for (const ext of FILE_EXTENSIONS) {
          const escaped = ext.replace('.', '\\.');
          const rx = new RegExp(`(?:\\.|format=|ext=|type=|_)${escaped}(?:[^a-z0-9]|$)`, 'i');
          if (rx.test(pathAndQuery)) return ext;
        }
      } catch (_) {}
    }

    const cleanLabel = String(label || '').trim().toLowerCase();
    if (!cleanLabel) return null;

    if (/\.tar\.gz\b|\btar\.gz\b/i.test(cleanLabel)) return 'tar.gz';
    for (const ext of FILE_EXTENSIONS) {
      const escaped = ext.replace('.', '\\.');
      const rx = new RegExp(`(^|[^a-z0-9])\\.?${escaped}([^a-z0-9]|$)`, 'i');
      if (rx.test(cleanLabel)) {
        return ext;
      }
    }

    if (/\bbittorrent\b|\bmagnet:/i.test(cleanLabel)) return 'torrent';

    return null;
  }

  function detectKeyServiceType(contextText = '') {
    for (const service of SERVICE_KEY_TYPES) {
      if (service.patterns.some((rx) => rx.test(contextText))) {
        return service.id;
      }
    }
    return null;
  }

  function probeReactElementInPageWorld(el) {
    const empty = {
      urlsByExt: {},
      directUrl: null,
      title: null,
      ext: null,
      keyValue: null,
      expirationDate: null,
      serviceType: null,
    };
    if (!el || !(el instanceof Element)) return empty;

    injectPageWorldBridge();
    const probeId = `p_${++state.probeCounter}`;
    el.setAttribute('data-hb-dl-probe', probeId);
    window.dispatchEvent(new CustomEvent('hb-dl-probe-node', { detail: { probeId } }));
    el.removeAttribute('data-hb-dl-probe');

    const rawMeta = el.getAttribute('data-hb-dl-react-meta');
    if (rawMeta) {
      el.removeAttribute('data-hb-dl-react-meta');
      try {
        return { ...empty, ...JSON.parse(rawMeta) };
      } catch (_) {}
    }
    return empty;
  }

  function findSingleItemRowContainer(el) {
    let curr = el.parentElement;
    let steps = 0;
    while (curr && curr !== document.body && steps < 7) {
      const tag = curr.tagName.toLowerCase();
      if (tag === 'tr' || tag === 'li' || tag === 'article') return curr;

      const dlButtonsInside = Array.from(curr.querySelectorAll('button, a[href], [role="button"]')).filter((b) => {
        const t = (b.textContent || '').trim();
        return /^download$/i.test(t) || b.classList.contains('js-download-button');
      });
      if (dlButtonsInside.length > 1) {
        break;
      }

      const cls = (curr.className && typeof curr.className === 'string' ? curr.className : '').toLowerCase();
      if (/\b(row|item|card|product|book|subproduct|entry|resource|key-redeemer)\b/.test(cls)) {
        return curr;
      }

      if (
        curr.parentElement &&
        curr.parentElement.children.length >= 2 &&
        curr.children.length >= 2 &&
        curr.offsetHeight > 22 &&
        curr.offsetHeight < 260
      ) {
        return curr;
      }
      curr = curr.parentElement;
      steps++;
    }
    return el.parentElement;
  }

  function extractItemTitleFromRow(rowEl, reactTitle = null) {
    if (reactTitle && reactTitle.length > 2 && !isBulkHeaderOrSummaryRow(null, reactTitle)) {
      return reactTitle;
    }
    if (!rowEl) return state.bundleName || 'Bundle_Resource';

    if (rowEl.getAttribute?.('data-human-name')) {
      return rowEl.getAttribute('data-human-name').trim();
    }

    const candidates = rowEl.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"], [class*="heading"], strong, p, span, div'
    );

    for (const cand of candidates) {
      if (cand.closest('#hb-dl-root-host, .hb-dl-inline-wrap, button, a, select')) continue;
      if (cand.querySelector('button, a, select, input')) continue;

      const txt = (cand.textContent || '').replace(/✓\s*Downloaded/gi, '').trim();
      if (!txt || txt.length < 2 || txt.length > 180) continue;

      if (
        /^(epub|pdf|mobi|prc|cbz|cbr|mp3|flac|wav|zip|exe|dmg|torrent|download|bulk\s*download|reveal|redeem|claim|steam|gog|manning|kobo|ebook|audio|keys?|\d+(\.\d+)?\s*(kb|mb|gb|bytes)|all\s+\d+\s+items?)$/i.test(
          txt
        )
      ) {
        continue;
      }
      return txt.split('\n')[0].trim();
    }

    return state.bundleName || 'Bundle_Resource';
  }

  function extractExpirationDate(containerEl) {
    if (!containerEl) return null;
    const text = (containerEl.innerText || containerEl.textContent || '').trim();
    if (!text) return null;

    const expPatterns = [
      /(?:redemption\s+deadline\s+is|must\s+be\s+redeemed\s+by|expires?\s+(?:on|by|in)?|valid\s+until|redeem\s+before)[:\s]+([^\n.]+(?:\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d+\s*days?)[^\n.]*)/i,
      /((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}[^.\n]*)/i,
    ];

    for (const pattern of expPatterns) {
      const match = text.match(pattern);
      if (match && /expir|deadline|redeem|before|until/i.test(text)) {
        return match[0].trim().replace(/\s+/g, ' ');
      }
    }
    return null;
  }

  /********************************************************************
   * 8. ROW-AWARE RESOURCE SCANNER (DEDUPLICATED & STRICT)
   ********************************************************************/
  function registerResource(resource) {
    const existing = state.resourceById.get(resource.id);
    if (existing) {
      existing.url = resource.url || existing.url;
      existing.domElement = resource.domElement || existing.domElement;
      existing.selectElement = resource.selectElement || existing.selectElement;
      existing.selectOptionValue = resource.selectOptionValue ?? existing.selectOptionValue;
      existing.keyValue = resource.keyValue || existing.keyValue;
      existing.isRevealed = Boolean(resource.isRevealed || existing.isRevealed);
      existing.expirationDate = resource.expirationDate || existing.expirationDate;
      return existing;
    }
    state.resourceById.set(resource.id, resource);
    state.resources = Array.from(state.resourceById.values());
    return resource;
  }

  function indexUrlsFromArbitraryJson(node, parentTitle = null, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 9) return;
    if (Array.isArray(node)) {
      node.forEach((item) => indexUrlsFromArbitraryJson(item, parentTitle, depth + 1));
      return;
    }

    const currentTitle =
      node.human_name ||
      node.humanName ||
      node.title ||
      node.product_name ||
      node.productName ||
      node.name ||
      parentTitle;

    const rawUrl =
      (typeof node.url === 'string' ? node.url : node.url?.web) ||
      node.download_url ||
      node.downloadUrl ||
      node.signed_url ||
      node.signedUrl ||
      node.file_url ||
      null;

    const rawFormat =
      node.format ||
      node.file_type ||
      node.fileType ||
      node.ext ||
      node.extension ||
      node.name ||
      '';

    if (rawUrl && typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl) && !isNonDownloadWebpageUrl(rawUrl)) {
      const ext = detectStrictExtension(rawUrl, String(rawFormat));
      if (ext && currentTitle) {
        const normTitle = normalizeForPath(currentTitle, 'Bundle_File');
        state.apiUrlLookup.set(`${normTitle}_${ext}`, rawUrl);
        const existing = state.resourceById.get(`file_${normTitle}_${ext}`);
        if (existing && !existing.url) {
          existing.url = rawUrl;
        }
      }
    }

    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') {
        indexUrlsFromArbitraryJson(v, currentTitle, depth + 1);
      }
    }
  }

  function scanPageResources() {
    if (!document.body) return;

    const currentBundleId = extractBundleId();
    if (currentBundleId !== state.bundleId) {
      state.bundleId = currentBundleId;
    }
    state.bundleName = scrapeBundleName(state.bundleId);
    state.normalizedBundleName = normalizeForPath(state.bundleName, 'Humble_Bundle');

    document
      .querySelectorAll('script#__NEXT_DATA__, script#user-home-json-data, script[type="application/json"]')
      .forEach((scr) => {
        if (scr.__hbParsedV5) return;
        scr.__hbParsedV5 = true;
        try {
          indexUrlsFromArbitraryJson(JSON.parse(scr.textContent));
        } catch (_) {}
      });

    const handledElements = new WeakSet();
    const handledRowExts = new WeakMap();

    function markRowExtHandled(rowEl, ext) {
      if (!rowEl) return;
      if (!handledRowExts.has(rowEl)) handledRowExts.set(rowEl, new Set());
      handledRowExts.get(rowEl).add(ext);
    }

    function isRowExtHandled(rowEl, ext) {
      return Boolean(rowEl && handledRowExts.has(rowEl) && handledRowExts.get(rowEl).has(ext));
    }

    // --- PASS 1: Individual Item Rows with a <select> Format Picker ---
    document.querySelectorAll('select').forEach((selectEl, sIdx) => {
      if (selectEl.closest('#hb-dl-root-host, nav, header, footer')) return;
      const rowEl = findSingleItemRowContainer(selectEl);
      const reactMeta = probeReactElementInPageWorld(rowEl || selectEl);
      const title = extractItemTitleFromRow(rowEl, reactMeta.title);

      if (isBulkHeaderOrSummaryRow(rowEl, title)) {
        handledElements.add(selectEl);
        rowEl?.querySelectorAll('button, a, select, [role="button"]').forEach((el) => handledElements.add(el));
        return;
      }

      const options = Array.from(selectEl.options || []);
      const formatOptions = options
        .map((opt) => ({
          opt,
          ext: detectStrictExtension(opt.value, opt.textContent || ''),
        }))
        .filter((o) => Boolean(o.ext));

      if (formatOptions.length === 0) return;

      const normTitle = normalizeForPath(title, `Item_${sIdx + 1}`);
      const downloadBtn = Array.from(
        (rowEl || selectEl.parentElement).querySelectorAll('button, a[href], [role="button"], .js-download-button')
      ).find((b) => b !== selectEl && !/\bbulk\s*download\b/i.test(b.textContent || ''));

      const triggerEl = downloadBtn || selectEl;
      handledElements.add(selectEl);
      if (downloadBtn) handledElements.add(downloadBtn);

      formatOptions.forEach(({ opt, ext }) => {
        if (isRowExtHandled(rowEl, ext)) return;
        markRowExtHandled(rowEl, ext);

        const id = `file_${normTitle}_${ext}`;
        const resolvedUrl =
          (/^https?:\/\//i.test(opt.value) ? opt.value : null) ||
          reactMeta.urlsByExt?.[ext] ||
          state.apiUrlLookup.get(`${normTitle}_${ext}`) ||
          (formatOptions.length === 1 ? reactMeta.directUrl : null) ||
          null;

        const res = registerResource({
          id,
          kind: 'file',
          productTitle: title,
          formatLabel: ext.toUpperCase(),
          typeOrExt: ext,
          url: resolvedUrl,
          fileName: `${normTitle}.${ext}`,
          domElement: triggerEl,
          selectElement: selectEl,
          selectOptionValue: opt.value,
          expirationDate: null,
          keyValue: null,
          isRevealed: true,
        });

        injectInlineCheckboxForElement(triggerEl, res);
      });
    });

    // --- PASS 2: Scan Download Buttons, Direct Format Links, and Key Blocks ---
    const candidates = Array.from(
      document.querySelectorAll(
        'a[href], button, [role="button"], .js-download-button, .download-button, .js-start-download, .keyfield, .js-keyfield'
      )
    );

    candidates.forEach((el, idx) => {
      if (handledElements.has(el)) return;
      if (el.closest('#hb-dl-root-host, .hb-dl-inline-wrap, nav, header, footer')) return;

      const tag = el.tagName.toLowerCase();
      const anchorEl = tag === 'a' ? el : el.closest('a[href]');
      const rawHref = anchorEl ? anchorEl.getAttribute('href') || '' : el.getAttribute('data-url') || '';

      let fullUrl = null;
      if (rawHref && !rawHref.startsWith('javascript:') && rawHref !== '#') {
        try {
          fullUrl = new URL(rawHref, location.origin).href;
        } catch (_) {}
      }

      if (fullUrl && isNonDownloadWebpageUrl(fullUrl)) {
        handledElements.add(el);
        return;
      }

      const ownText = (
        el.innerText ||
        el.textContent ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        ''
      )
        .replace(/✓\s*Downloaded/gi, '')
        .trim();

      if (!ownText && !fullUrl && !el.hasAttribute('download')) {
        return;
      }
      if (
        /\bbulk\s*download\b/i.test(ownText) ||
        /\bdownload\s+all\b/i.test(ownText) ||
        /^all\s+\d+\s+items?\b/i.test(ownText) ||
        /^(next|previous|prev|page\s*\d+|search|filter|sort|log\s*in|sign\s*out|account|settings|close|cancel|back|view\s*all|help|support|instructions)$/i.test(
          ownText
        )
      ) {
        handledElements.add(el);
        return;
      }

      const rowEl = findSingleItemRowContainer(el);
      const reactMeta = probeReactElementInPageWorld(el);
      const title = extractItemTitleFromRow(rowEl, reactMeta.title);

      if (isBulkHeaderOrSummaryRow(rowEl, title)) {
        handledElements.add(el);
        return;
      }

      const rowText = rowEl
        ? (rowEl.innerText || rowEl.textContent || '').replace(/✓\s*Downloaded/gi, '').trim()
        : ownText;
      const normTitle = normalizeForPath(title, `Resource_${idx + 1}`);

      const isFormatOnlyButton =
        tag !== 'a' &&
        !fullUrl &&
        !/\bdownload\b/i.test(ownText) &&
        Boolean(detectStrictExtension('', ownText));

      if (isFormatOnlyButton && rowEl) {
        const siblingDownloadBtn = Array.from(
          rowEl.querySelectorAll('button, a[href], [role="button"], .js-download-button')
        ).find(
          (b) =>
            b !== el &&
            !handledElements.has(b) &&
            (/\bdownload\b/i.test(b.textContent || '') ||
              b.hasAttribute('download') ||
              b.classList.contains('js-download-button'))
        );
        if (siblingDownloadBtn) {
          handledElements.add(el);
          return;
        }
      }

      // --- A. Check if this is a File Download Control ---
      let detectedExt =
        reactMeta.ext ||
        detectStrictExtension(fullUrl || '', ownText);

      const isExplicitDownloadControl =
        /\bdownload\b/i.test(ownText) ||
        el.hasAttribute('download') ||
        el.classList.contains('js-download-button') ||
        el.classList.contains('download-button') ||
        (fullUrl && /dl\.humble\.com|humblebundle-a\.akamaihd\.net|storage\.googleapis\.com|s3\.amazonaws\.com/i.test(fullUrl));

      if (!detectedExt && isExplicitDownloadControl && rowText) {
        detectedExt = detectStrictExtension(fullUrl || '', rowText);
      }

      if (
        tag === 'a' &&
        fullUrl &&
        !isExplicitDownloadControl &&
        !detectStrictExtension(fullUrl, '')
      ) {
        return;
      }

      if (detectedExt) {
        const finalExt = detectedExt.toLowerCase();
        if (isRowExtHandled(rowEl, finalExt)) {
          handledElements.add(el);
          return;
        }
        markRowExtHandled(rowEl, finalExt);
        handledElements.add(el);

        const resolvedUrl =
          fullUrl ||
          reactMeta.urlsByExt?.[finalExt] ||
          reactMeta.directUrl ||
          state.apiUrlLookup.get(`${normTitle}_${finalExt}`) ||
          null;

        const id = `file_${normTitle}_${finalExt}`;

        const res = registerResource({
          id,
          kind: 'file',
          productTitle: title,
          formatLabel: finalExt.toUpperCase(),
          typeOrExt: finalExt,
          url: resolvedUrl,
          fileName: `${normTitle}.${finalExt}`,
          domElement: el,
          expirationDate: null,
          keyValue: null,
          isRevealed: true,
        });

        injectInlineCheckboxForElement(el, res);
        return;
      }

      // --- B. Check if this is a Service Key Control ---
      const isKeyControl =
        /\b(reveal|redeem|claim)\b/i.test(ownText) ||
        el.classList.contains('keyfield') ||
        el.classList.contains('js-keyfield') ||
        /^[A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6}$/i.test(ownText);

      if (isKeyControl) {
        const keyService =
          reactMeta.serviceType ||
          detectKeyServiceType(`${ownText} ${rowText}`) ||
          'steam_key';

        if (isRowExtHandled(rowEl, keyService)) {
          handledElements.add(el);
          return;
        }
        markRowExtHandled(rowEl, keyService);
        handledElements.add(el);

        const id = `key_${normTitle}_${keyService}`;
        const keyMatch =
          reactMeta.keyValue ||
          (rowText.match(/\b([A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6})\b/) || [])[1] ||
          null;
        const expDate = reactMeta.expirationDate || extractExpirationDate(rowEl);

        const res = registerResource({
          id,
          kind: 'key',
          productTitle: title,
          formatLabel: keyService.replace('_key', '').toUpperCase() + ' KEY',
          typeOrExt: keyService,
          url: null,
          fileName: `${normTitle}_${keyService}.txt`,
          domElement: el,
          wrapperElement: rowEl,
          expirationDate: expDate,
          keyValue: keyMatch,
          isRevealed: Boolean(keyMatch),
        });

        if (keyMatch) {
          saveKeyToVault({
            bundleId: state.bundleId,
            bundleName: state.bundleName,
            resourceId: res.id,
            productTitle: res.productTitle,
            serviceType: res.typeOrExt,
            keyValue: keyMatch,
            expirationDate: expDate,
          });
        }

        injectInlineCheckboxForElement(el, res);
      }
    });

    refreshToolbarAndPanel();
    checkAndUpdatePageCompletionState();
    annotateLibraryBundleLinks();
  }

  /********************************************************************
   * 9. INLINE CHECKBOXES & DOWNLOADED BADGES
   ********************************************************************/
  function safeAttrSelector(val) {
    return String(val).replace(/["\\]/g, '\\$&');
  }

  function injectInlineCheckboxForElement(targetEl, resource) {
    if (!targetEl || !targetEl.parentElement) return;

    const parent = targetEl.parentElement;
    const existing = parent.querySelector(
      `.hb-dl-inline-wrap[data-resource-id="${safeAttrSelector(resource.id)}"]`
    );
    const alreadyDownloaded = isResourceDownloaded(state.bundleId, resource.id);

    if (existing) {
      const cb = existing.querySelector('input.hb-dl-inline-cb');
      if (cb) cb.checked = state.selectedResourceIds.has(resource.id);
      const badge = existing.querySelector('.hb-dl-item-badge');
      if (badge) badge.style.display = alreadyDownloaded ? 'inline-block' : 'none';
      return;
    }

    const wrap = document.createElement('span');
    wrap.className = 'hb-dl-inline-wrap';
    wrap.dataset.resourceId = resource.id;
    wrap.dataset.resourceType = resource.typeOrExt;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'hb-dl-inline-cb';
    checkbox.title = `Select ${resource.productTitle} (${resource.typeOrExt.toUpperCase()}) for download`;
    checkbox.checked = state.selectedResourceIds.has(resource.id);

    wrap.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        state.selectedResourceIds.add(resource.id);
      } else {
        state.selectedResourceIds.delete(resource.id);
      }
      syncAllCheckboxesUI();
    });

    const typeTag = document.createElement('span');
    typeTag.className = 'hb-dl-inline-tag';
    typeTag.textContent = resource.typeOrExt.toUpperCase();

    const dlBadge = document.createElement('span');
    dlBadge.className = 'hb-dl-item-badge';
    dlBadge.textContent = '✓ Downloaded';
    dlBadge.style.display = alreadyDownloaded ? 'inline-block' : 'none';

    wrap.appendChild(checkbox);
    wrap.appendChild(typeTag);
    wrap.appendChild(dlBadge);

    if (resource.expirationDate) {
      const expTag = document.createElement('span');
      expTag.className = 'hb-dl-exp-tag';
      expTag.textContent = `⏳ ${resource.expirationDate}`;
      wrap.appendChild(expTag);
    }

    parent.insertBefore(wrap, targetEl);
  }

  function syncAllCheckboxesUI() {
    document.querySelectorAll('.hb-dl-inline-wrap[data-resource-id]').forEach((wrap) => {
      const rid = wrap.dataset.resourceId;
      const cb = wrap.querySelector('input.hb-dl-inline-cb');
      if (cb) cb.checked = state.selectedResourceIds.has(rid);
      const badge = wrap.querySelector('.hb-dl-item-badge');
      if (badge) {
        badge.style.display = isResourceDownloaded(state.bundleId, rid) ? 'inline-block' : 'none';
      }
    });

    document.querySelectorAll('.hb-dl-panel-row-cb').forEach((cb) => {
      const rid = cb.dataset.resourceId;
      cb.checked = state.selectedResourceIds.has(rid);
    });

    updateExecuteButtonLabel();
  }

  /********************************************************************
   * 10. PAGE COMPLETION BADGE & LIBRARY LINK ANNOTATIONS
   ********************************************************************/
  function checkAndUpdatePageCompletionState() {
    const total = state.resources.length;
    const downloadedCount = state.resources.filter((r) =>
      isResourceDownloaded(state.bundleId, r.id)
    ).length;

    const allDownloaded = total > 0 && downloadedCount === total;
    if (total > 0) {
      setPageCompletedStatus(state.bundleId, allDownloaded, {
        bundleName: state.bundleName,
        downloadedCount,
        totalCount: total,
      });
    }

    const pageBadge = document.getElementById('hb-dl-page-complete-badge');
    if (pageBadge) {
      if (allDownloaded) {
        pageBadge.className = 'hb-dl-page-badge hb-dl-page-badge-complete';
        pageBadge.textContent = `★ Everything Downloaded (${downloadedCount}/${total})`;
      } else {
        pageBadge.className = 'hb-dl-page-badge hb-dl-page-badge-partial';
        pageBadge.textContent = `${downloadedCount} / ${total} Downloaded`;
      }
    }

    const headerEl = document.querySelector('main h1, .bundle-title, h1');
    if (headerEl && !headerEl.closest('#hb-dl-root-host')) {
      let headerBadge = document.getElementById('hb-dl-native-header-badge');
      if (allDownloaded) {
        if (!headerBadge) {
          headerBadge = document.createElement('span');
          headerBadge.id = 'hb-dl-native-header-badge';
          headerBadge.className = 'hb-dl-native-complete-badge';
          headerEl.appendChild(headerBadge);
        }
        headerBadge.textContent = '✓ All Bundle Resources Downloaded';
      } else if (headerBadge) {
        headerBadge.remove();
      }
    }
  }

  function annotateLibraryBundleLinks() {
    const pageMap = getPageStatusMap();
    document
      .querySelectorAll('a[href*="/home/library/"], a[href*="/downloads?key="]')
      .forEach((link) => {
        if (link.querySelector('.hb-dl-link-complete-badge')) return;
        const href = link.getAttribute('href') || '';
        const uuidMatch = href.match(
          /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
        );
        const keyMatch = href.match(/[?&]key=([^&]+)/);
        const id = uuidMatch
          ? uuidMatch[1].toLowerCase()
          : keyMatch
          ? `order_${keyMatch[1]}`
          : null;

        if (id && pageMap[id] && pageMap[id].complete) {
          const badge = document.createElement('span');
          badge.className = 'hb-dl-link-complete-badge';
          badge.textContent = '✓ All Downloaded';
          link.appendChild(badge);
        }
      });
  }

  /********************************************************************
   * 11. DOWNLOAD ENGINE (REAL OS SUBFOLDERS + BLOB FETCHER)
   ********************************************************************/
  function getEffectiveTargetResources(allowedExtensionsOrTypes = null) {
    return state.resources.filter((r) => {
      const isDirectlyChecked = state.selectedResourceIds.has(r.id);
      const isTypeSelected = state.selectedTypesDropdown.has(r.typeOrExt);
      if (!isDirectlyChecked && !isTypeSelected) return false;

      if (allowedExtensionsOrTypes && allowedExtensionsOrTypes.size > 0) {
        return allowedExtensionsOrTypes.has(r.typeOrExt);
      }
      return true;
    });
  }

  /**
   * Returns the 3 separate path components so the bundle folder and resource type
   * are created as directories, and NEVER concatenated into the filename.
   */
  function getOrganizedPathParts(resource) {
    const bundleFolder = normalizeForPath(state.bundleName, 'Humble_Bundle');
    const subFolder = normalizeForPath(resource.typeOrExt, 'other');
    const cleanFileName = String(resource.fileName || `${normalizeForPath(resource.productTitle)}.${resource.typeOrExt}`)
      .split('/')
      .pop()
      .split('\\')
      .pop()
      .replace(/[<>:"/\\|?*]/g, '_');

    return {
      bundleFolder,
      subFolder,
      cleanFileName,
      displayPath: `${bundleFolder}/${subFolder}/${cleanFileName}`,
    };
  }

  function fetchUrlAsBlobViaGM(url, onProgressText) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error('Missing download URL'));
        return;
      }

      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'blob',
          onprogress: (e) => {
            if (onProgressText && e.lengthComputable && e.total > 0) {
              const pct = Math.round((e.loaded / e.total) * 100);
              const mbLoaded = (e.loaded / 1048576).toFixed(1);
              const mbTotal = (e.total / 1048576).toFixed(1);
              onProgressText(`${pct}% (${mbLoaded} / ${mbTotal} MB)`);
            }
          },
          onload: (res) => {
            if (res.status >= 200 && res.status < 300 && res.response) {
              resolve(res.response);
            } else {
              reject(new Error(`HTTP ${res.status} fetching ${url}`));
            }
          },
          onerror: (err) => reject(new Error(err?.error || 'GM_xmlhttpRequest network error')),
          ontimeout: () => reject(new Error('GM_xmlhttpRequest timed out')),
        });
        return;
      }

      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  async function resolveResourceDownloadUrl(resource) {
    if (resource.selectElement && resource.selectOptionValue !== undefined) {
      resource.selectElement.value = resource.selectOptionValue;
      resource.selectElement.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
    }

    const normTitle = normalizeForPath(resource.productTitle);
    if (!resource.url) {
      resource.url = state.apiUrlLookup.get(`${normTitle}_${resource.typeOrExt}`) || null;
    }

    if (!resource.url && resource.domElement) {
      const meta = probeReactElementInPageWorld(resource.domElement);
      resource.url = meta.urlsByExt?.[resource.typeOrExt] || meta.directUrl || null;
    }

    if (!resource.url && resource.domElement) {
      const capturedUrl = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          state.capturedUrlResolver = null;
          window.dispatchEvent(new CustomEvent('hb-dl-set-capture', { detail: { active: false } }));
          resolve(null);
        }, 6000);

        state.capturedUrlResolver = (url) => {
          clearTimeout(timer);
          window.dispatchEvent(new CustomEvent('hb-dl-set-capture', { detail: { active: false } }));
          resolve(url);
        };

        window.dispatchEvent(new CustomEvent('hb-dl-set-capture', { detail: { active: true } }));
        resource.domElement.click();
      });

      if (capturedUrl) {
        resource.url = capturedUrl;
      }
    }

    if (!resource.url) {
      throw new Error(`Could not resolve download URL for "${resource.productTitle}"`);
    }
    return resource.url;
  }

  async function revealKeyResource(resource, timeoutMs = 10000) {
    if (resource.isRevealed && resource.keyValue) {
      return resource.keyValue;
    }

    if (resource.domElement) {
      resource.domElement.click();
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        await new Promise((r) => setTimeout(r, 350));
        const container = resource.wrapperElement || resource.domElement.parentElement || resource.domElement;
        const text = (container.innerText || container.textContent || '').trim();
        const keyMatch = (text.match(/\b([A-Z0-9]{4,7}(?:-[A-Z0-9]{4,7}){2,6})\b/) || [])[1];
        if (keyMatch) {
          resource.isRevealed = true;
          resource.keyValue = keyMatch;
          resource.expirationDate = extractExpirationDate(container) || resource.expirationDate;
          return keyMatch;
        }
      }
    }

    throw new Error(`Could not reveal key for "${resource.productTitle}"`);
  }

  function triggerSingleFileDownload(blob, fileNameOnly) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileNameOnly;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }

  /********************************************************************
   * 12. PRE-DOWNLOAD MODAL (DEFAULT SKIP + FORCE OVERRIDE + BASE FOLDER)
   ********************************************************************/
  function promptPreDownloadFilterModal() {
    scanPageResources();
    const initialCandidates = getEffectiveTargetResources();

    if (initialCandidates.length === 0) {
      setStatusMessage(
        'No resources selected. Check individual items on the page, or open "▾ Filter Types / Extensions" to select formats (e.g., EPUB, PDF).',
        'warn'
      );
      return;
    }

    const typeCounts = {};
    initialCandidates.forEach((r) => {
      typeCounts[r.typeOrExt] = (typeCounts[r.typeOrExt] || 0) + 1;
    });

    const alreadyDownloadedCount = initialCandidates.filter((r) =>
      isResourceDownloaded(state.bundleId, r.id)
    ).length;
    const defaultQueueCount = initialCandidates.length - alreadyDownloadedCount;

    const existingModal = document.getElementById('hb-dl-confirm-modal-backdrop');
    if (existingModal) existingModal.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'hb-dl-confirm-modal-backdrop';
    backdrop.className = 'hb-dl-modal-backdrop';

    const typeCheckboxesHtml = Object.entries(typeCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([ext, count]) => `
        <label class="hb-dl-modal-type-chip">
          <input type="checkbox" class="hb-dl-confirm-ext-cb" value="${escapeHtml(ext)}" checked />
          <span><strong>${escapeHtml(ext.toUpperCase())}</strong> (${count} selected)</span>
        </label>
      `
      )
      .join('');

    const fsaSupported = hasFileSystemAccessSupport();
    const currentRootName = state.rootDirHandle ? state.rootDirHandle.name : null;

    backdrop.innerHTML = `
      <div class="hb-dl-modal">
        <h3>Confirm Target Extensions &amp; Subfolder Creation</h3>
        <div class="hb-dl-modal-folder-box">
          <div>
            <div style="font-weight:600;font-size:12px;color:#e2e8f0;">
              ${
                fsaSupported
                  ? currentRootName
                    ? `📂 Base Folder: <code style="color:#4ade80;">${escapeHtml(currentRootName)}/</code>`
                    : `📂 Base Folder: <span style="color:#fbbf24;">Select on Start (one-time prompt)</span>`
                  : `📦 Folder Mode: <span style="color:#7dd3fc;">Structured .ZIP Archive (Browser lacks FileSystem API)</span>`
              }
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px;">
              Creates real subfolders: <code>${escapeHtml(state.normalizedBundleName)}/&lt;ext_or_type&gt;/&lt;filename&gt;</code>
            </div>
          </div>
          ${
            fsaSupported
              ? `<button type="button" id="hb-dl-modal-pick-folder" class="hb-dl-btn" style="padding:5px 10px;font-size:11px;">
                  ${currentRootName ? 'Change Base Folder' : 'Choose Base Folder'}
                 </button>`
              : ''
          }
        </div>

        <p class="hb-dl-modal-sub">
          Verify which file extensions or service key types to target in this run:
        </p>
        <div class="hb-dl-modal-type-grid">
          ${typeCheckboxesHtml}
        </div>
        <div class="hb-dl-modal-options">
          <div style="margin-bottom:6px;color:#94a3b8;font-size:11px;">
            Default behavior skips ${alreadyDownloadedCount} item(s) already marked as downloaded in GM Storage.
          </div>
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
            <input type="checkbox" id="hb-dl-force-redownload-cb" />
            <span>Force download of items already marked as downloaded in GM Storage</span>
          </label>
        </div>
        <div class="hb-dl-modal-actions">
          <button type="button" id="hb-dl-modal-cancel" class="hb-dl-btn">Cancel</button>
          <button type="button" id="hb-dl-modal-start" class="hb-dl-btn hb-dl-btn-primary" ${defaultQueueCount === 0 ? 'disabled' : ''}>
            Start Download (${defaultQueueCount})
          </button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(backdrop);

    backdrop.querySelector('#hb-dl-modal-pick-folder')?.addEventListener('click', async () => {
      try {
        await pickNewRootDirectoryHandle();
        promptPreDownloadFilterModal();
      } catch (_) {}
    });

    const computeFilteredQueue = () => {
      const checkedExts = new Set(
        Array.from(backdrop.querySelectorAll('.hb-dl-confirm-ext-cb:checked')).map((cb) => cb.value)
      );
      const forceRedownload = Boolean(
        backdrop.querySelector('#hb-dl-force-redownload-cb')?.checked
      );
      return getEffectiveTargetResources(checkedExts).filter((r) =>
        forceRedownload ? true : !isResourceDownloaded(state.bundleId, r.id)
      );
    };

    const updateStartBtnCount = () => {
      const filtered = computeFilteredQueue();
      const startBtn = backdrop.querySelector('#hb-dl-modal-start');
      startBtn.textContent = `Start Download (${filtered.length})`;
      startBtn.disabled = filtered.length === 0;
    };

    backdrop.querySelectorAll('input').forEach((inp) =>
      inp.addEventListener('change', updateStartBtnCount)
    );

    backdrop.querySelector('#hb-dl-modal-cancel').addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#hb-dl-modal-start').addEventListener('click', async () => {
      const finalQueue = computeFilteredQueue();
      if (finalQueue.length === 0) return;

      // Acquire/verify OS directory handle right inside the trusted user click handler!
      let rootDirHandle = null;
      if (hasFileSystemAccessSupport()) {
        try {
          rootDirHandle = await ensureVerifiedRootDirectoryHandle();
        } catch (err) {
          setStatusMessage(
            'Base folder selection was cancelled. Select a base folder (e.g., Downloads) to create bundle subfolders.',
            'warn'
          );
          return;
        }
      }

      backdrop.remove();
      await executeDownloadQueue(finalQueue, rootDirHandle);
    });
  }

  async function executeDownloadQueue(queue, rootDirHandle) {
    if (state.isDownloading || queue.length === 0) return;
    state.isDownloading = true;
    updateExecuteButtonLabel();

    let completed = 0;
    let failed = 0;
    const revealedKeysBatch = [];
    const zipFallbackEntries = [];

    for (let i = 0; i < queue.length; i++) {
      const res = queue[i];
      const { bundleFolder, subFolder, cleanFileName, displayPath } = getOrganizedPathParts(res);
      const basePrefix = `[${i + 1}/${queue.length}] ${res.productTitle} -> ${bundleFolder}/${subFolder}/${cleanFileName}`;
      setStatusMessage(`${basePrefix}...`, 'info');

      try {
        if (res.kind === 'key') {
          const keyVal = await revealKeyResource(res);
          const keyRecord = {
            bundleId: state.bundleId,
            bundleName: state.bundleName,
            resourceId: res.id,
            productTitle: res.productTitle,
            serviceType: res.typeOrExt,
            keyValue: keyVal,
            expirationDate: res.expirationDate || 'None listed',
          };

          saveKeyToVault(keyRecord);
          revealedKeysBatch.push(keyRecord);

          const keyFileBody = [
            `Bundle: ${state.bundleName}`,
            `Product: ${res.productTitle}`,
            `Service: ${res.formatLabel}`,
            `Key / Redemption Code: ${keyVal}`,
            `Expiration Date: ${res.expirationDate || 'None listed'}`,
            `Extracted At: ${new Date().toISOString()}`,
          ].join('\n');

          if (rootDirHandle) {
            await writeToRealOsSubfolders(
              rootDirHandle,
              bundleFolder,
              subFolder,
              cleanFileName,
              keyFileBody
            );
          } else {
            zipFallbackEntries.push({
              relativePath: displayPath,
              dataUint8: new TextEncoder().encode(keyFileBody),
            });
          }

          markResourceDownloaded(state.bundleId, res.id, {
            path: displayPath,
            type: res.typeOrExt,
            keyValue: keyVal,
          });
          completed++;
        } else {
          const downloadUrl = await resolveResourceDownloadUrl(res);
          const fileBlob = await fetchUrlAsBlobViaGM(downloadUrl, (progressStr) => {
            setStatusMessage(`${basePrefix} — ${progressStr}`, 'info');
          });

          if (rootDirHandle) {
            await writeToRealOsSubfolders(
              rootDirHandle,
              bundleFolder,
              subFolder,
              cleanFileName,
              fileBlob
            );
          } else {
            const buf = await fileBlob.arrayBuffer();
            zipFallbackEntries.push({
              relativePath: displayPath,
              dataUint8: new Uint8Array(buf),
            });
          }

          markResourceDownloaded(state.bundleId, res.id, {
            path: displayPath,
            type: res.typeOrExt,
          });
          completed++;
        }
      } catch (err) {
        console.error(`[HB-DL] Error on ${res.productTitle}:`, err);
        failed++;
      }

      syncAllCheckboxesUI();
      await new Promise((r) => setTimeout(r, 350));
    }

    if (revealedKeysBatch.length > 0) {
      const summaryJson = JSON.stringify(revealedKeysBatch, null, 2);
      const bundleFolder = normalizeForPath(state.bundleName, 'Humble_Bundle');
      const summaryFileName = `${bundleFolder}_keys_summary.json`;
      if (rootDirHandle) {
        await writeToRealOsSubfolders(
          rootDirHandle,
          bundleFolder,
          'keys',
          summaryFileName,
          summaryJson
        ).catch(() => {});
      } else {
        zipFallbackEntries.push({
          relativePath: `${bundleFolder}/keys/${summaryFileName}`,
          dataUint8: new TextEncoder().encode(summaryJson),
        });
      }
    }

    if (!rootDirHandle && zipFallbackEntries.length > 0) {
      setStatusMessage('Building folder-structured ZIP archive...', 'info');
      const zipBlob = buildStructuredZipBlob(zipFallbackEntries);
      triggerSingleFileDownload(zipBlob, `${state.normalizedBundleName}.zip`);
    }

    state.isDownloading = false;
    updateExecuteButtonLabel();
    checkAndUpdatePageCompletionState();

    const targetDesc = rootDirHandle
      ? `${rootDirHandle.name}/${state.normalizedBundleName}/<type>/`
      : `${state.normalizedBundleName}.zip`;

    setStatusMessage(
      `Batch complete: ${completed} downloaded${failed > 0 ? `, ${failed} failed` : ''}. Created real subfolders under "${targetDesc}".`,
      failed > 0 ? 'warn' : 'success'
    );
  }

  /********************************************************************
   * 13. UI TOOLBAR & KEYS VAULT DRAWER
   ********************************************************************/
  function injectStyles() {
    safeAddStyle(`
      #hb-dl-root-host {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 2147483647 !important;
        background: #161922 !important;
        color: #f8fafc !important;
        border-bottom: 3px solid #cb272c !important;
        padding: 10px 18px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 13px !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.65) !important;
        box-sizing: border-box !important;
      }
      .hb-dl-top-row {
        display: flex !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 10px !important;
      }
      .hb-dl-brand {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
      }
      .hb-dl-bundle-title {
        font-weight: 700 !important;
        font-size: 14px !important;
        color: #ffffff !important;
      }
      .hb-dl-folder-preview {
        font-family: monospace !important;
        font-size: 11px !important;
        background: #262b38 !important;
        color: #7dd3fc !important;
        padding: 3px 7px !important;
        border-radius: 4px !important;
      }
      .hb-dl-page-badge {
        padding: 4px 10px !important;
        border-radius: 999px !important;
        font-weight: 700 !important;
        font-size: 11px !important;
      }
      .hb-dl-page-badge-complete {
        background: #166534 !important;
        color: #dcfce7 !important;
        border: 1px solid #22c55e !important;
      }
      .hb-dl-page-badge-partial {
        background: #334155 !important;
        color: #e2e8f0 !important;
      }
      .hb-dl-native-complete-badge {
        display: inline-block !important;
        margin-left: 12px !important;
        padding: 4px 10px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        background: #15803d !important;
        color: #ffffff !important;
        border-radius: 6px !important;
      }
      .hb-dl-link-complete-badge {
        display: inline-block !important;
        margin-left: 6px !important;
        padding: 2px 6px !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        background: #15803d !important;
        color: #ffffff !important;
        border-radius: 4px !important;
      }
      .hb-dl-controls {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        flex-wrap: wrap !important;
      }
      .hb-dl-split-group {
        position: relative !important;
        display: inline-flex !important;
        align-items: stretch !important;
      }
      .hb-dl-btn {
        cursor: pointer !important;
        border: 1px solid #475569 !important;
        background: #293040 !important;
        color: #f8fafc !important;
        padding: 7px 12px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border-radius: 5px !important;
        line-height: 1.2 !important;
      }
      .hb-dl-btn:hover:not(:disabled) {
        background: #3b4459 !important;
      }
      .hb-dl-btn:disabled {
        opacity: 0.5 !important;
        cursor: not-allowed !important;
      }
      .hb-dl-btn-primary {
        background: #cb272c !important;
        border-color: #ef4444 !important;
        color: #ffffff !important;
      }
      .hb-dl-btn-primary:hover:not(:disabled) {
        background: #dc2626 !important;
      }
      .hb-dl-split-main {
        border-top-right-radius: 0 !important;
        border-bottom-right-radius: 0 !important;
      }
      .hb-dl-split-toggle {
        border-top-left-radius: 0 !important;
        border-bottom-left-radius: 0 !important;
        border-left: 1px solid rgba(255, 255, 255, 0.3) !important;
      }
      .hb-dl-dropdown-menu {
        display: none;
        position: absolute !important;
        top: calc(100% + 6px) !important;
        right: 0 !important;
        width: 310px !important;
        max-height: 400px !important;
        overflow-y: auto !important;
        background: #1e2330 !important;
        border: 1px solid #64748b !important;
        border-radius: 6px !important;
        padding: 10px !important;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.75) !important;
        z-index: 2147483647 !important;
      }
      .hb-dl-dropdown-menu.open {
        display: block !important;
      }
      .hb-dl-dropdown-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 8px !important;
        padding-bottom: 6px !important;
        border-bottom: 1px solid #334155 !important;
        font-size: 11px !important;
        color: #cbd5e1 !important;
      }
      .hb-dl-dropdown-item {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 5px 6px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-size: 12px !important;
        color: #f1f5f9 !important;
      }
      .hb-dl-dropdown-item:hover {
        background: #2d3548 !important;
      }
      .hb-dl-status-line {
        margin-top: 6px !important;
        font-size: 12px !important;
        color: #cbd5e1 !important;
      }
      .hb-dl-status-warn { color: #fbbf24 !important; }
      .hb-dl-status-success { color: #4ade80 !important; }
      #hb-dl-drawer {
        display: none;
        margin-top: 10px !important;
        border-top: 1px solid #334155 !important;
        padding-top: 10px !important;
        max-height: 440px !important;
        overflow-y: auto !important;
      }
      #hb-dl-drawer.open {
        display: grid !important;
        grid-template-columns: 1.25fr 1fr !important;
        gap: 14px !important;
      }
      .hb-dl-box {
        background: #11141c !important;
        border: 1px solid #2e3646 !important;
        border-radius: 6px !important;
        padding: 10px !important;
      }
      .hb-dl-box h4 {
        margin: 0 0 8px 0 !important;
        font-size: 13px !important;
        color: #f8fafc !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
      }
      .hb-dl-table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 12px !important;
      }
      .hb-dl-table th, .hb-dl-table td {
        text-align: left !important;
        padding: 6px 8px !important;
        border-bottom: 1px solid #262b38 !important;
        color: #e2e8f0 !important;
      }
      .hb-dl-key-code {
        font-family: monospace !important;
        background: #232834 !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        color: #facc15 !important;
        user-select: all !important;
      }
      .hb-dl-inline-wrap {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        margin-right: 6px !important;
        padding: 2px 6px !important;
        background: #161922 !important;
        border: 1px solid #38bdf8 !important;
        border-radius: 4px !important;
        vertical-align: middle !important;
        z-index: 10 !important;
      }
      .hb-dl-inline-cb {
        cursor: pointer !important;
        width: 15px !important;
        height: 15px !important;
        margin: 0 !important;
        accent-color: #cb272c !important;
      }
      .hb-dl-inline-tag {
        font-size: 10px !important;
        font-weight: 700 !important;
        color: #38bdf8 !important;
      }
      .hb-dl-item-badge {
        font-size: 10px !important;
        font-weight: 700 !important;
        background: #166534 !important;
        color: #dcfce7 !important;
        padding: 1px 5px !important;
        border-radius: 3px !important;
      }
      .hb-dl-exp-tag {
        font-size: 10px !important;
        background: #7c2d12 !important;
        color: #ffedd5 !important;
        padding: 1px 5px !important;
        border-radius: 3px !important;
      }
      .hb-dl-modal-backdrop {
        position: fixed !important;
        inset: 0 !important;
        background: rgba(0, 0, 0, 0.75) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      }
      .hb-dl-modal {
        background: #1e222d !important;
        color: #f8fafc !important;
        border: 1px solid #64748b !important;
        border-radius: 8px !important;
        width: 580px !important;
        max-width: 92vw !important;
        padding: 18px !important;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.8) !important;
      }
      .hb-dl-modal-folder-box {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        background: #141720 !important;
        border: 1px solid #334155 !important;
        border-radius: 6px !important;
        padding: 10px 12px !important;
        margin: 10px 0 !important;
      }
      .hb-dl-modal-type-grid {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)) !important;
        gap: 8px !important;
        margin: 12px 0 !important;
        max-height: 240px !important;
        overflow-y: auto !important;
      }
      .hb-dl-modal-type-chip {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: #282e3d !important;
        padding: 6px 8px !important;
        border-radius: 5px !important;
        font-size: 12px !important;
        cursor: pointer !important;
      }
      .hb-dl-modal-actions {
        display: flex !important;
        justify-content: flex-end !important;
        gap: 8px !important;
        margin-top: 14px !important;
      }
    `);
  }

  function updateBaseFolderButtonUI() {
    const btn = document.getElementById('hb-dl-pick-root-dir-btn');
    if (!btn) return;
    if (!hasFileSystemAccessSupport()) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'inline-block';
    if (state.rootDirHandle) {
      btn.textContent = `📂 Base Folder: ${state.rootDirHandle.name}/`;
      btn.title = `Subfolders "${state.normalizedBundleName}/<type>/" will be created inside "${state.rootDirHandle.name}/". Click to change base folder.`;
    } else {
      btn.textContent = '📂 Set Base Download Folder';
      btn.title = 'Select your Downloads folder once so the script can create real bundle & type subfolders on disk.';
    }
  }

  function ensureMainToolbarMounted() {
    if (!document.documentElement) return;
    if (document.getElementById('hb-dl-root-host')) return;

    const bar = document.createElement('div');
    bar.id = 'hb-dl-root-host';
    bar.innerHTML = `
      <div class="hb-dl-top-row">
        <div class="hb-dl-brand">
          <span class="hb-dl-bundle-title" id="hb-dl-bundle-title-text">Humble Bundle Library Downloader</span>
          <span class="hb-dl-folder-preview" id="hb-dl-folder-preview-text">📁 Humble_Bundle/&lt;type&gt;/</span>
          <span class="hb-dl-page-badge hb-dl-page-badge-partial" id="hb-dl-page-complete-badge">0 / 0 Downloaded</span>
        </div>

        <div class="hb-dl-controls">
          <div class="hb-dl-split-group">
            <button type="button" id="hb-dl-execute-btn" class="hb-dl-btn hb-dl-btn-primary hb-dl-split-main">
              Download Selected Resources (0)
            </button>
            <button type="button" id="hb-dl-dropdown-toggle" class="hb-dl-btn hb-dl-btn-primary hb-dl-split-toggle">
              ▾ Filter Types / Extensions (0)
            </button>
            <div id="hb-dl-type-dropdown" class="hb-dl-dropdown-menu"></div>
          </div>

          <button type="button" id="hb-dl-pick-root-dir-btn" class="hb-dl-btn">📂 Set Base Download Folder</button>
          <button type="button" id="hb-dl-rescan-btn" class="hb-dl-btn">Rescan Page</button>
          <button type="button" id="hb-dl-clear-selection-btn" class="hb-dl-btn">Clear Selection</button>
          <button type="button" id="hb-dl-toggle-drawer-btn" class="hb-dl-btn">Resources &amp; Keys (0) ▾</button>
        </div>
      </div>

      <div id="hb-dl-status-msg" class="hb-dl-status-line">
        Ready (0 items selected by default). Check individual items, or click "▾ Filter Types / Extensions" to choose formats (e.g., EPUB, PDF, Steam Key).
      </div>

      <div id="hb-dl-drawer">
        <div class="hb-dl-box">
          <h4>
            <span>Discovered Bundle Resources (All Formats)</span>
            <span id="hb-dl-resource-count-label">0 items</span>
          </h4>
          <div id="hb-dl-resource-table-wrap"></div>
        </div>

        <div class="hb-dl-box">
          <h4>
            <span>Keys Section (Revealed &amp; Saved Keys)</span>
            <span>
              <button type="button" id="hb-dl-export-keys-json" class="hb-dl-btn" style="padding:3px 8px;font-size:11px;">Export JSON</button>
              <button type="button" id="hb-dl-export-keys-csv" class="hb-dl-btn" style="padding:3px 8px;font-size:11px;">Export CSV</button>
            </span>
          </h4>
          <div id="hb-dl-keys-table-wrap"></div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(bar);
    updateBaseFolderButtonUI();

    const dropdownToggle = document.getElementById('hb-dl-dropdown-toggle');
    const dropdownMenu = document.getElementById('hb-dl-type-dropdown');

    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      renderTypeDropdownMenu();
      dropdownMenu.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!dropdownMenu.contains(e.target) && e.target !== dropdownToggle) {
        dropdownMenu.classList.remove('open');
      }
    });

    document.getElementById('hb-dl-execute-btn').addEventListener('click', () => {
      promptPreDownloadFilterModal();
    });

    document.getElementById('hb-dl-pick-root-dir-btn').addEventListener('click', async () => {
      try {
        const handle = await pickNewRootDirectoryHandle();
        if (handle) {
          setStatusMessage(
            `Base download folder set to "${handle.name}/". Subfolders "${state.normalizedBundleName}/<type>/" will be created inside it.`,
            'success'
          );
        }
      } catch (_) {}
    });

    document.getElementById('hb-dl-rescan-btn').addEventListener('click', () => {
      scanPageResources();
      setStatusMessage(`Rescanned page: discovered ${state.resources.length} downloadable resources/keys.`, 'info');
    });

    document.getElementById('hb-dl-clear-selection-btn').addEventListener('click', () => {
      state.selectedResourceIds.clear();
      state.selectedTypesDropdown.clear();
      refreshToolbarAndPanel();
      syncAllCheckboxesUI();
      setStatusMessage('Selection cleared (0 items selected).', 'info');
    });

    document.getElementById('hb-dl-toggle-drawer-btn').addEventListener('click', () => {
      document.getElementById('hb-dl-drawer').classList.toggle('open');
      renderResourcesDrawerTable();
      renderKeysSection();
    });

    document.getElementById('hb-dl-export-keys-json').addEventListener('click', async () => {
      const vault = getSavedKeysVault();
      const jsonStr = JSON.stringify(vault, null, 2);
      if (state.rootDirHandle) {
        try {
          const dir = await ensureVerifiedRootDirectoryHandle();
          await writeToRealOsSubfolders(
            dir,
            state.normalizedBundleName || 'Humble_Library',
            'keys',
            'humble_keys_vault.json',
            jsonStr
          );
          setStatusMessage('Exported humble_keys_vault.json into keys subfolder.', 'success');
          return;
        } catch (_) {}
      }
      triggerSingleFileDownload(new Blob([jsonStr], { type: 'application/json' }), 'humble_keys_vault.json');
    });

    document.getElementById('hb-dl-export-keys-csv').addEventListener('click', async () => {
      const vault = getSavedKeysVault();
      const header = 'Bundle,Product,Service,Key,ExpirationDate,SavedAt\n';
      const rows = vault
        .map((k) =>
          [
            k.bundleName,
            k.productTitle,
            k.serviceType,
            k.keyValue,
            k.expirationDate || '',
            k.savedAt || '',
          ]
            .map((v) => `"${String(v || '').replace(/"/g, '""')}"`)
            .join(',')
        )
        .join('\n');
      const csvStr = header + rows;
      if (state.rootDirHandle) {
        try {
          const dir = await ensureVerifiedRootDirectoryHandle();
          await writeToRealOsSubfolders(
            dir,
            state.normalizedBundleName || 'Humble_Library',
            'keys',
            'humble_keys_vault.csv',
            csvStr
          );
          setStatusMessage('Exported humble_keys_vault.csv into keys subfolder.', 'success');
          return;
        } catch (_) {}
      }
      triggerSingleFileDownload(new Blob([csvStr], { type: 'text/csv' }), 'humble_keys_vault.csv');
    });
  }

  function updateExecuteButtonLabel() {
    const execBtn = document.getElementById('hb-dl-execute-btn');
    const toggleBtn = document.getElementById('hb-dl-dropdown-toggle');
    const drawerBtn = document.getElementById('hb-dl-toggle-drawer-btn');
    if (!execBtn || !toggleBtn) return;

    const effectiveCount = getEffectiveTargetResources().length;
    execBtn.textContent = state.isDownloading
      ? 'Downloading...'
      : `Download Selected Resources (${effectiveCount})`;
    execBtn.disabled = state.isDownloading;

    toggleBtn.textContent = `▾ Filter Types / Extensions (${state.selectedTypesDropdown.size})`;
    if (drawerBtn) {
      drawerBtn.textContent = `Resources & Keys (${state.resources.length}) ▾`;
    }
  }

  function refreshToolbarAndPanel() {
    ensureMainToolbarMounted();
    const titleEl = document.getElementById('hb-dl-bundle-title-text');
    const folderEl = document.getElementById('hb-dl-folder-preview-text');
    if (titleEl) titleEl.textContent = state.bundleName || 'Humble Bundle Library';
    if (folderEl) folderEl.textContent = `📁 ${state.normalizedBundleName}/<type>/`;

    updateBaseFolderButtonUI();
    renderTypeDropdownMenu();
    renderResourcesDrawerTable();
    renderKeysSection();
    updateExecuteButtonLabel();
  }

  function renderTypeDropdownMenu() {
    const menu = document.getElementById('hb-dl-type-dropdown');
    if (!menu) return;

    const countsByType = {};
    state.resources.forEach((r) => {
      countsByType[r.typeOrExt] = (countsByType[r.typeOrExt] || 0) + 1;
    });

    const discoveredTypes = Object.keys(countsByType).sort();
    const typesToDisplay =
      discoveredTypes.length > 0 && !state.showAllStandardTypes
        ? discoveredTypes
        : Array.from(new Set([...discoveredTypes, ...ALL_CATALOG_TYPES]));

    const itemsHtml = typesToDisplay
      .map((typeKey) => {
        const checked = state.selectedTypesDropdown.has(typeKey) ? 'checked' : '';
        const count = countsByType[typeKey] || 0;
        return `
          <label class="hb-dl-dropdown-item">
            <span>
              <input type="checkbox" class="hb-dl-type-dropdown-cb" value="${escapeHtml(typeKey)}" ${checked} />
              <strong>${escapeHtml(typeKey.toUpperCase())}</strong>
            </span>
            <span style="color:${count > 0 ? '#38bdf8' : '#64748b'};">${count} on page</span>
          </label>
        `;
      })
      .join('');

    menu.innerHTML = `
      <div class="hb-dl-dropdown-header">
        <span>Target Extensions &amp; Key Types</span>
        <span>
          <a href="#" id="hb-dl-toggle-all-catalog" style="color:#7dd3fc;text-decoration:none;margin-right:8px;">
            ${state.showAllStandardTypes ? 'Page Only' : 'Show All Types'}
          </a>
          <a href="#" id="hb-dl-dropdown-uncheck-all" style="color:#f87171;text-decoration:none;">Clear</a>
        </span>
      </div>
      ${itemsHtml}
    `;

    menu.querySelector('#hb-dl-toggle-all-catalog')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.showAllStandardTypes = !state.showAllStandardTypes;
      renderTypeDropdownMenu();
    });

    menu.querySelector('#hb-dl-dropdown-uncheck-all')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.selectedTypesDropdown.clear();
      renderTypeDropdownMenu();
      updateExecuteButtonLabel();
    });

    menu.querySelectorAll('.hb-dl-type-dropdown-cb').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        if (cb.checked) {
          state.selectedTypesDropdown.add(cb.value);
        } else {
          state.selectedTypesDropdown.delete(cb.value);
        }
        updateExecuteButtonLabel();
      });
    });
  }

  function renderResourcesDrawerTable() {
    const wrap = document.getElementById('hb-dl-resource-table-wrap');
    const countLabel = document.getElementById('hb-dl-resource-count-label');
    if (!wrap) return;
    if (countLabel) countLabel.textContent = `${state.resources.length} items`;

    if (state.resources.length === 0) {
      wrap.innerHTML = `<div style="color:#94a3b8;font-size:12px;">No resources detected yet. Wait for the bundle items to finish rendering or click "Rescan Page".</div>`;
      return;
    }

    const rowsHtml = state.resources
      .map((r) => {
        const isChecked = state.selectedResourceIds.has(r.id) ? 'checked' : '';
        const isDone = isResourceDownloaded(state.bundleId, r.id);
        const { displayPath } = getOrganizedPathParts(r);
        return `
          <tr>
            <td>
              <input type="checkbox" class="hb-dl-panel-row-cb" data-resource-id="${escapeHtml(r.id)}" ${isChecked} />
            </td>
            <td><strong>${escapeHtml(r.productTitle)}</strong></td>
            <td><span class="hb-dl-inline-tag">${escapeHtml(r.typeOrExt.toUpperCase())}</span></td>
            <td><code>${escapeHtml(displayPath)}</code></td>
            <td>
              ${
                isDone
                  ? '<span class="hb-dl-item-badge">✓ Downloaded</span>'
                  : '<span style="color:#94a3b8;">Pending</span>'
              }
              ${
                r.expirationDate
                  ? `<br/><span class="hb-dl-exp-tag">⏳ ${escapeHtml(r.expirationDate)}</span>`
                  : ''
              }
            </td>
          </tr>
        `;
      })
      .join('');

    wrap.innerHTML = `
      <table class="hb-dl-table">
        <thead>
          <tr>
            <th>Sel</th>
            <th>Product</th>
            <th>Type / Ext</th>
            <th>Target Subfolder Path</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    wrap.querySelectorAll('.hb-dl-panel-row-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const rid = cb.dataset.resourceId;
        if (cb.checked) {
          state.selectedResourceIds.add(rid);
        } else {
          state.selectedResourceIds.delete(rid);
        }
        syncAllCheckboxesUI();
      });
    });
  }

  function renderKeysSection() {
    const wrap = document.getElementById('hb-dl-keys-table-wrap');
    if (!wrap) return;

    const vault = getSavedKeysVault();
    if (vault.length === 0) {
      wrap.innerHTML = `<div style="color:#94a3b8;font-size:12px;">No keys revealed/saved yet. Select key items and click Download to auto-reveal and store them here.</div>`;
      return;
    }

    const rowsHtml = vault
      .slice()
      .reverse()
      .map(
        (k) => `
        <tr>
          <td>${escapeHtml(k.bundleName || k.bundleId)}</td>
          <td><strong>${escapeHtml(k.productTitle)}</strong></td>
          <td><span class="hb-dl-inline-tag">${escapeHtml((k.serviceType || '').toUpperCase())}</span></td>
          <td><span class="hb-dl-key-code">${escapeHtml(k.keyValue)}</span></td>
          <td>
            ${
              k.expirationDate && k.expirationDate !== 'None listed'
                ? `<span class="hb-dl-exp-tag">⏳ ${escapeHtml(k.expirationDate)}</span>`
                : '<span style="color:#64748b;">None</span>'
            }
          </td>
          <td>
            <button type="button" class="hb-dl-btn hb-dl-copy-key-btn" data-key-val="${escapeHtml(k.keyValue)}" style="padding:2px 6px;font-size:11px;">Copy</button>
          </td>
        </tr>
      `
      )
      .join('');

    wrap.innerHTML = `
      <table class="hb-dl-table">
        <thead>
          <tr>
            <th>Bundle</th>
            <th>Product</th>
            <th>Service</th>
            <th>Key / Code</th>
            <th>Expiration</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    wrap.querySelectorAll('.hb-dl-copy-key-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        safeSetClipboard(btn.dataset.keyVal);
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = 'Copy';
        }, 1400);
      });
    });
  }

  function setStatusMessage(msg, level = 'info') {
    const el = document.getElementById('hb-dl-status-msg');
    if (!el) return;
    el.className = `hb-dl-status-line ${
      level === 'warn' ? 'hb-dl-status-warn' : level === 'success' ? 'hb-dl-status-success' : ''
    }`;
    el.textContent = msg;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /********************************************************************
   * 14. HYDRATION-SAFE BOOTSTRAP & ROUTE WATCHER
   ********************************************************************/
  function handleRouteChangeCheck() {
    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      state.resourceById.clear();
      state.resources = [];
      state.selectedResourceIds.clear();
      state.selectedTypesDropdown.clear();
      document.querySelectorAll('.hb-dl-inline-wrap').forEach((el) => el.remove());
      setTimeout(scanPageResources, 500);
    }
  }

  function startHydrationSafeUI() {
    injectPageWorldBridge();
    injectStyles();
    ensureMainToolbarMounted();
    loadSavedRootDirectoryHandle();
    scanPageResources();

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      handleRouteChangeCheck();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        ensureMainToolbarMounted();
        scanPageResources();
      }, 650);
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    setInterval(() => {
      handleRouteChangeCheck();
      ensureMainToolbarMounted();
      if (state.resources.length === 0) {
        scanPageResources();
      }
    }, 2000);
  }

  if (document.readyState === 'complete') {
    setTimeout(startHydrationSafeUI, 600);
  } else {
    window.addEventListener('load', () => {
      setTimeout(startHydrationSafeUI, 600);
    });
  }
})();
