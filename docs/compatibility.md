# Userscript manager and browser compatibility

Status below is for `humble_fumble.user.js` v5.5.0. Read the "How this was tested" section before relying on any row marked untested.

## Summary

| Manager + browser | Output | Status |
|---|---|---|
| Violentmonkey, Chrome/Edge | Folder | Target. Chrome needs "Allow User Scripts" enabled |
| Tampermonkey, Chrome/Edge | Folder | Expected to work, untested. No changes needed |
| Violentmonkey or Tampermonkey, Firefox | `.zip` | Expected to work, untested |
| Safari userscript managers | `.zip` | Expected to work, untested; see Safari notes |
| Greasemonkey 4+ (Firefox) | `.zip` | Not supported as-is: file fetching likely fails (patch below, untested) |

## How this was tested

Done, in a Chromium browser pane against a local mock page with one file link and one key row (not a real Humble page):

- No folder API (the page deleted `showDirectoryPicker` to imitate Firefox/Safari): both items detected, the folder button hidden, a valid `Test_Bundle.zip` produced with `Test_Bundle/pdf/book.pdf` and `Test_Bundle/steam_key/...txt`, and history marked only after delivery.
- Folder API (a stubbed in-memory directory handle): files written under `Bundle/type/`, no zip produced.
- Key vault: Copy, Export JSON, and Export CSV worked, including CSV quoting and the formula-prefix rule.
- `node test/zip.test.js`: the generated zip passes Python `zipfile` CRC checks and `unzip -t`. The test fails if the CRC fields are broken.

Not done: running in real Firefox, real Safari, Tampermonkey, Greasemonkey, or against the live Humble site. Everything in those rows comes from reading which APIs the script calls.

## Version history relevant to compatibility

- 5.0.0 had the `.zip` fallback and the key export/copy buttons.
- 5.4.0 removed both. Without a folder picker it fetched files and discarded them while still marking them downloaded, so Firefox and Safari saved nothing.
- 5.5.0 restored the zip fallback (and marks downloaded only after the zip is delivered) and restored Copy / Export JSON / Export CSV.

## APIs the script uses

| API | Where | Fallback when missing |
|---|---|---|
| `GM_xmlhttpRequest` | Fetches file bytes as a blob (`fetchBinaryBlobViaGM`) | Plain `fetch()` (subject to CORS) |
| `GM_getValue` / `GM_setValue` | Download history, key vault (`safeGet` / `safeSet`) | `localStorage` |
| `GM_setClipboard` | Copy key button (`safeSetClipboard`) | `navigator.clipboard.writeText` |
| `unsafeWindow` | Page hooks and `showDirectoryPicker` / `indexedDB` access | `window` |

Granted in the header but never called: `GM_download`, `GM_addStyle`. Styles are added with a `<style>` element, so these grants are harmless.

`@inject-into auto` is Violentmonkey-specific; other managers ignore it. `@run-at document-idle` is supported everywhere.

## Violentmonkey

Install from the raw URL in the README. On Chrome, enable "Allow User Scripts" (older Chrome: Developer mode) for the extension.

## Tampermonkey

Every API listed above exists in Tampermonkey under the same name, so the script should run unmodified in Chrome/Edge (folder output) and Firefox (zip output).

- Install the same way: open the raw URL and click **Install**.
- Chrome: enable "Allow User Scripts" (older Chrome: Developer mode) for Tampermonkey.
- Tampermonkey may show a cross-origin request prompt the first time a file is fetched. `@connect *` in the header means you can choose **Always allow**.
- Storage is the manager's own GM storage, so history and keys are separate from Violentmonkey's. Nothing migrates between managers. The script also mirrors them into `localStorage` on `humblebundle.com`, and `safeGet` prefers GM storage when present.

## Firefox

The script uses `window.open`, anchor `click()`, `fetch`, and `window.navigation` hooks installed on both `window` and `unsafeWindow`. `window.navigation` does not exist in Firefox, and the script skips it when absent. Whether the other hooks behave identically through Firefox's `unsafeWindow` wrapper is untested; if downloads fail to resolve, click the item's own download button once and retry, then report it.

Output is a zip (see the README for the part-size and memory limits).

## Safari

Needs a Safari userscript manager that provides `GM_xmlhttpRequest` (for example the Userscripts app or Tampermonkey for Safari). Without it the script uses `fetch()` and CORS is likely to block Humble's download hosts.

Output is a zip. The zip is triggered after the batch finishes, not directly from a click, so Safari may ask whether to allow downloads from `humblebundle.com`. Allow it.

## Greasemonkey 4+ (Firefox)

Greasemonkey 4 removed the synchronous `GM_*` functions and provides only the promise-based `GM.*` API. Effect:

| Feature | Result |
|---|---|
| Download history and key vault | Work, through the `localStorage` fallback. Data lives in `humblebundle.com` site storage, so clearing site data erases it. |
| Copy key | Works through `navigator.clipboard`. |
| Page styling | Works. |
| Output | Zip (Firefox has no folder picker). |
| **File download** | `GM_xmlhttpRequest` is undefined, so the script falls back to `fetch()`. Requests to Humble's download hosts are cross-origin, so CORS is likely to block them. |

A possible fix, not applied to the script and not tested:

1. Add to the header:

   ```js
   // @grant        GM.xmlHttpRequest
   ```

2. In `fetchBinaryBlobViaGM`, use whichever function exists:

   ```js
   const xhr = typeof GM_xmlhttpRequest === 'function'
     ? GM_xmlhttpRequest
     : (typeof GM !== 'undefined' && GM.xmlHttpRequest);
   if (xhr) {
     xhr({ /* same options object as today */ });
     return;
   }
   ```

   (replace the `typeof GM_xmlhttpRequest === 'function'` check and the call inside it.)

It is not confirmed that `GM.xmlHttpRequest` honors `responseType: 'blob'` and `onprogress` in Greasemonkey. Violentmonkey or Tampermonkey on Firefox is the lower-risk route.

## Reporting results

If you run it in Tampermonkey, Safari, Firefox, or another setup, please open an issue with the manager, its version, the browser, and what happened, so this table can be corrected.
