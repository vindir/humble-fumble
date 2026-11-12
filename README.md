# humble-fumble

A userscript that adds a download toolbar to your Humble Bundle library. It collects the files (EPUB, PDF, MOBI, audio, game installers) and service keys (Steam, GOG, Manning, Kobo, and others) on a bundle page, then saves them into `Bundle Name/type/file` folders on disk.

Primary target: [Violentmonkey](https://violentmonkey.github.io/). See [docs/compatibility.md](docs/compatibility.md) for Tampermonkey and Greasemonkey.

## Install (Violentmonkey)

1. Install Violentmonkey for [Chrome/Edge](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag), [Firefox](https://addons.mozilla.org/firefox/addon/violentmonkey/), or another supported browser.
2. Open the raw script URL. Violentmonkey shows an install dialog:

   **https://raw.githubusercontent.com/vindir/humble-fumble/main/humble_fumble.user.js**

3. Click **Confirm installation**.
4. Open any bundle page under `humblebundle.com/home/library` or `humblebundle.com/downloads`. The toolbar appears at the top of the page.

Chrome/Chromium: recent versions require the "Allow User Scripts" toggle (older versions: Developer mode) on the extension's details page before any userscript runs.

Manual install: Violentmonkey dashboard → **+** → **Install from URL**, paste the raw URL above. Or paste the contents of `humble_fumble.user.js` into a new script.

## Use

1. Open a bundle's download page.
2. Tick the checkbox next to each item, or open **Filter Types / Extensions** to select whole formats (for example every EPUB and PDF).
3. Click the main download button. A confirmation modal lists the formats and the target folder structure.
4. Items already downloaded are skipped by default. Tick the force option in the modal to re-download them.

Toolbar controls:

| Control | Purpose |
|---|---|
| Download split button | Start the download; the arrow selects formats |
| Set Base Download Folder | Pick the root folder once (Chromium only) |
| Rescan Page | Re-detect items after the page changes |
| Clear Selection | Uncheck everything |
| Resources & Keys | Drawer listing items, download status, and the key vault |

The vault drawer can copy keys and export them as JSON or CSV.

## Where files go

| Browser | Behavior |
|---|---|
| Chrome, Edge, other Chromium | Uses the File System Access API. You pick a base folder once, and the script writes `<Bundle>/<type>/<file>` directly into it. |
| Firefox, Safari | No folder API. The script builds a `.zip` that keeps the same `<Bundle>/<type>/<file>` structure. |

Download history is tracked per bundle, so the toolbar can show `N / M Downloaded`.

## Privacy and permissions

- Runs on `*://*.humblebundle.com/*`.
- Header declares `@connect *`, so the script may request files from any host. Download URLs come from Humble's own page data (Humble, Akamai, S3, Google storage), but the wildcard is broader than that. Remove or narrow it if you prefer.
- Revealed keys are saved in the userscript manager's storage and mirrored to `localStorage` on `humblebundle.com`. Anyone with access to your browser profile, or a script running on that origin, can read them. Exported JSON/CSV files contain keys in plain text.
- The script patches page-level `fetch`, `XMLHttpRequest`, `window.open`, `Node.removeChild`, and `Node.insertBefore` on Humble pages. It does this to capture signed download URLs and to avoid React errors from the injected checkboxes. If a Humble page behaves oddly, disable the script first to check.
- No data is sent to any server other than Humble's own download hosts.

## Troubleshooting

| Symptom | Try |
|---|---|
| No toolbar | Confirm the script is enabled and you are on a `humblebundle.com` page; reload. |
| Items missing or wrong | Click **Rescan Page**. Humble changes its markup, so selectors may need updates. |
| "Could not resolve download URL" | Click the item's own download button once on the page, then **Rescan Page** and retry. |
| Nothing saved after picking a folder | Re-pick the base folder; the browser may have revoked write permission. |
| Large downloads fail | Files are fetched into memory as blobs before writing; very large files need enough RAM. |

## Disclaimer

Not affiliated with or endorsed by Humble Bundle. Intended for downloading content you own, from your own account, for personal use. You are responsible for following Humble Bundle's terms of service.

## License

[MIT](LICENSE)
