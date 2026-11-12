# Userscript manager and browser compatibility

Status below is for `humble_fumble.user.js` v5.10.1. Read the "How this was tested" section before relying on any row marked untested.

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
- Hydration (v5.5.1): a server-rendered React 18 mock page that hydrates 2.5 seconds after load. v5.5.0 reproduced `Minified React error #418` and `#423` there and lost its inline checkboxes. v5.5.1 added the toolbar at about 3.6 seconds with no React errors, and the checkbox survived; a baseline page with no userscript had no errors. Two further loads matched. The mock is React 18 production; Humble's real app (a different React build, hydrating the whole document) was not available to test, so the fix is unconfirmed on the live site.
- Concurrency (v5.7.0): a local server counted simultaneous requests while 8 mock files downloaded in zip mode. The peak was 5 and all 8 were saved. The saved setting was written to storage, and a run set to 3 peaked at 3.
- `node test/fiber.test.js`: the script's own `inspectReactFiber` run on a row shaped like Humble's `signedUrls` (cbz, pdf and torrent entries); fails on the 5.8.0 logic.
- `node test/zip.test.js`: the generated zip passes Python `zipfile` CRC checks and `unzip -t`. The test fails if the CRC fields are broken.

Not done: running in real Firefox, real Safari, Tampermonkey, Greasemonkey, or against the live Humble site. Everything in those rows comes from reading which APIs the script calls.

## Version history relevant to compatibility

- 5.0.0 had the `.zip` fallback and the key export/copy buttons.
- 5.4.0 removed both. Without a folder picker it fetched files and discarded them while still marking them downloaded, so Firefox and Safari saved nothing.
- 5.5.0 restored the zip fallback (and marks downloaded only after the zip is delivered) and restored Copy / Export JSON / Export CSV.
- 5.5.1 waits for React hydration before adding any DOM (fixes React error #418) and adds `@updateURL` / `@downloadURL` / `@homepageURL` / `@supportURL`.
- 5.6.0 collapses the toolbar into a clickable banner; no API changes.
- 5.6.1 places the toolbar in the page flow above the site content instead of overlaying it.
- 5.7.0 downloads 5 files at a time (setting in the confirmation modal); no API changes.
- 5.7.1 waits up to 10 s for a revealed key and fails the item instead of writing a `REVEALED_ON_PAGE` placeholder.
- 5.7.2 detects keys that are already revealed (no Reveal button) and no longer fills the type filter with the whole catalog when a page has no detected items.
- 5.7.3 recognises plain unhyphenated key codes (12-40 uppercase letters and digits, as in Humble's current key buttons), and stops the row finder from counting the script's own checkbox, which produced a duplicate key on rescan.
- 5.8.0 gives rows with the same derived name separate items (they were merged, so some files were never queued), rescans when the page changes, checks the size of each file written to a folder, and rejects empty or failed downloads and request timeouts.
- 5.8.1 fixes PDF (and any second format) rows downloading the wrong file. A row's page data lists every format's signed URL; only the first (usually the CBZ) was recorded, so each other format's button was given that CBZ link. Each format now gets its own URL and `.torrent` links are ignored. Covered by `node test/fiber.test.js`.
- 5.9.0 lets you press the download button with nothing selected and choose the formats in the confirmation modal; the button is renamed Download Selections. No API changes.
- 5.9.1 retries a failed file download twice (2 s, then 4 s apart) before counting it as failed, and the final status line names the failed items with the error. Added after a bundle where 5 files failed on the first run and all succeeded on retry; the error text was not captured. The user had several large uploads running at the same time, so timeouts from a saturated connection are the likely cause (not confirmed). Lower Simultaneous downloads on a busy connection.
- 5.10.0 adds a third retry after 30 s (retries are now 2 s, 4 s, 30 s, so up to 4 attempts per file) and replaces the per-file progress line with one summary line (`Downloading 12/42 · 5 active · 318 MB saved`) redrawn at most every 250 ms. Per-file percentages are no longer shown. No API changes.
- 5.10.1 keeps a running download tied to the bundle it started on. Humble navigates between bundles without a page reload, and the single toolbar used to re-read the bundle from the URL (Rescan Page, opening the download dialog) while a run was in flight. The status line now names the bundle (`Downloading "<bundle>" 12/42`, `Finished "<bundle>": ...`), rescans wait until the run ends, and starting a second run during one is refused. Reproduced only on the mock page; the original report was not captured.

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
