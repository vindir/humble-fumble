# Userscript manager compatibility

Status below comes from reading which `GM_*` APIs the script calls (`humble_fumble.user.js`, v5.0.0). It has not been run in Tampermonkey or Greasemonkey. Only the Violentmonkey column reflects the author's intended target.

## APIs the script uses

| API | Where | Fallback when missing |
|---|---|---|
| `GM_xmlhttpRequest` | Fetches file bytes as a blob (`fetchUrlAsBlobViaGM`) | Plain `fetch()` (subject to CORS) |
| `GM_getValue` / `GM_setValue` | Download history, key vault | `localStorage` |
| `GM_setClipboard` | Copy key button | `navigator.clipboard.writeText` |
| `unsafeWindow` | Reaches page `showDirectoryPicker` / `indexedDB` | `window` |

Granted in the header but never called: `GM_download`, `GM_deleteValue`, `GM_listValues`, `GM_addStyle`. Styles are injected with a `<style>` element, so those grants are harmless.

`@inject-into auto` is Violentmonkey-specific; other managers ignore it.

## Summary

| Manager | Works as-is | Notes |
|---|---|---|
| Violentmonkey | Yes (target) | Chrome needs "Allow User Scripts" enabled |
| Tampermonkey | Expected yes, untested | No changes needed |
| Greasemonkey 4+ | No, downloads likely fail | Needs a small patch (below) |

## Tampermonkey

Every API listed above exists in Tampermonkey under the same name, so the script should run unmodified.

- Install the same way: open the raw URL and click **Install**.
- Chrome: enable the "Allow User Scripts" toggle (older Chrome: Developer mode) for Tampermonkey.
- Tampermonkey may show a cross-origin request prompt the first time a file is fetched. `@connect *` in the header means you can choose **Always allow**.
- Storage is the manager's own GM storage, so history and keys are separate from Violentmonkey's. Nothing migrates between managers.

## Greasemonkey 4+ (Firefox)

Greasemonkey 4 removed the synchronous `GM_*` functions and only provides the promise-based `GM.*` API (for example `GM.xmlHttpRequest`). Effect on this script:

| Feature | Result |
|---|---|
| Download history and key vault | Work, through the `localStorage` fallback. Data lives in `humblebundle.com` site storage, so clearing site data erases it. |
| Copy key | Works through `navigator.clipboard`. |
| Page styling | Works. |
| Folder picker | Not available in Firefox; the `.zip` fallback is used. |
| **File download** | `GM_xmlhttpRequest` is undefined, so the script falls back to `fetch()`. Requests to Humble's download hosts are cross-origin, so CORS is likely to block them. |

To support Greasemonkey, two edits to `humble_fumble.user.js` are needed. They are not applied in this repo.

1. Add to the header:

   ```js
   // @grant        GM.xmlHttpRequest
   ```

2. In `fetchUrlAsBlobViaGM`, pick whichever function exists:

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

This patch is unverified: it has not been tested in Greasemonkey, and it is not confirmed that `GM.xmlHttpRequest` honors `responseType: 'blob'` and `onprogress` there. If you need Greasemonkey support, Violentmonkey or Tampermonkey on Firefox is the lower-risk route.

## Any manager, by browser

| Browser | Folder output |
|---|---|
| Chrome, Edge, Brave, other Chromium | Direct write to a chosen base folder |
| Firefox | `.zip` with the same folder layout |
| Safari | `.zip` fallback expected; Safari userscript managers are not covered here |

## Reporting results

If you run it in Tampermonkey or Greasemonkey, please open an issue with the manager, its version, the browser, and what happened, so this table can be corrected.
