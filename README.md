# humble-fumble

A userscript that adds a download toolbar to your Humble Bundle library. It collects the files (EPUB, PDF, MOBI, audio, game installers) and service keys (Steam, GOG, Manning, Kobo, and others) on a bundle page, then saves them into `Bundle Name/type/file` folders.

Current version: 5.5.0. Primary target: [Violentmonkey](https://violentmonkey.github.io/). Chrome/Edge write straight into a folder you pick; Firefox and Safari get a `.zip` with the same folder layout. See [docs/compatibility.md](docs/compatibility.md) for what has and has not been tested.

## Install (Violentmonkey)

1. Install Violentmonkey for [Chrome/Edge](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) or [Firefox](https://addons.mozilla.org/firefox/addon/violentmonkey/). For Safari, use a Safari userscript manager (see the compatibility doc).
2. Open the raw script URL. The manager shows an install dialog:

   **https://raw.githubusercontent.com/vindir/humble-fumble/main/humble_fumble.user.js**

3. Click **Confirm installation**.
4. Open a page under `humblebundle.com/home/library`, `/downloads`, `/home/keys`, or `/home/purchases`. The toolbar appears pinned to the top of the page.

Chrome/Chromium: recent versions require the "Allow User Scripts" toggle (older versions: Developer mode) on the extension's details page before any userscript runs.

Manual install: Violentmonkey dashboard → **+** → **Install from URL**, paste the raw URL above. Or paste the contents of `humble_fumble.user.js` into a new script.

The script has no auto-update URL, so to update, reinstall from the raw URL.

## Use

1. Open a bundle's download page.
2. Tick the checkbox next to each item, or open **Filter Types** to select whole formats (for example every EPUB and PDF).
3. Click **Download Selected (N)**. A confirmation modal lists the formats and where they will go.
4. In Chrome/Edge, choose a base folder when asked (first time only; see below).
5. Items already downloaded are skipped by default. Tick the force option in the modal to re-download them.

Toolbar controls:

| Control | Purpose |
|---|---|
| Download Selected (N) | Open the confirmation modal and start the download |
| Filter Types (N) | Select every item of chosen formats; **Show All Types** lists formats not on this page |
| Set Base Folder | Pick or change the root folder (Chrome/Edge only; hidden elsewhere) |
| Rescan Page | Re-detect items |
| Clear | Uncheck everything |
| Resources & Keys (N) | Drawer listing discovered items with their target paths, and the saved keys |

The page is scanned on load, again about two seconds later, and after back/forward navigation. It does not watch for page changes, so click **Rescan Page** after expanding sections or navigating inside the site.

Downloads run one at a time with a randomized 1.2 to 2.2 second pause between items. Large selections take a while.

## Where files go

| Browser | Behavior |
|---|---|
| Chrome, Edge, Brave, other Chromium | You pick a base folder once, and the script writes `<Bundle>/<type>/<file>` directly into it, for example `humble/Some_Bundle/epub/Book_Title.epub`. |
| Firefox, Safari | No folder picker. The script collects everything into `<Bundle>.zip` with the same `<Bundle>/<type>/<file>` layout and downloads it when the batch finishes. |

**macOS (Chrome/Edge): create a subfolder first.** The browser will not let you pick `Downloads` or `Documents` as the base folder. Create a new folder (for example `~/Downloads/humble` or `~/Documents/humble`) in Finder, then choose that folder when the picker opens. Bundle folders are created inside it. The browser remembers the folder and may ask you to re-grant write permission in later sessions.

Zip mode details:

- Nothing reaches your disk until the batch ends, then the zip downloads. Closing the tab mid-batch loses the batch.
- Items are marked "downloaded" only after the zip is handed to the browser, so a failed batch can be retried.
- Everything in a part is held in memory. A part is capped at about 1 GiB; larger batches are split into `<Bundle>.zip`, `<Bundle>_part2.zip`, and so on. Your browser may ask to allow multiple downloads.

Service keys are written as small `.txt` files under `<Bundle>/<service>_key/` (or into the zip) and appear in the **Resources & Keys** drawer. In the drawer, **Copy** copies one key, and **Export JSON** / **Export CSV** save `humble_keys_vault.json` / `.csv`: into `<Bundle>/keys/` in the base folder if one is set, otherwise as a normal browser download. CSV cells that start with `=`, `+`, `-`, or `@` get a leading `'` so spreadsheets do not run them as formulas.

Download history is tracked per bundle, so the toolbar can show `N / M Downloaded`.

## Privacy and permissions

- Runs only on `humblebundle.com` pages under `/home/library`, `/downloads`, `/home/keys`, and `/home/purchases`.
- Header declares `@connect *`, so the script may request files from any host. Download URLs come from Humble's own page data (Humble, Akamai, S3, Google storage), but the wildcard is broader than that. Remove or narrow it if you prefer.
- Revealed keys are saved in the userscript manager's storage and mirrored to `localStorage` on `humblebundle.com`. Anyone with access to your browser profile, or a script running on that origin, can read them. Key `.txt` files, zips, and exported JSON/CSV files contain keys in plain text.
- To catch download links, the script wraps `window.open`, anchor `click()`, `window.fetch`, and the `navigation` `navigate` event on the page, and adds a capturing click listener. These only redirect a link into the script while it is resolving a download; otherwise they pass through. It does not inject `<script>` tags or patch `XMLHttpRequest`. If a Humble page behaves oddly, disable the script first to check.
- No data is sent to any server other than Humble's own download hosts.

## Troubleshooting

| Symptom | Try |
|---|---|
| No toolbar | Confirm the script is enabled and the URL matches one of the paths above; reload. |
| Items missing or wrong | Click **Rescan Page**. Humble changes its markup, so detection may need updates. |
| "Could not resolve URL" in the console | Click the item's own download button once on the page, then **Rescan Page** and retry. |
| Picker rejects the folder (macOS) | You chose `Downloads` or `Documents` itself. Make a subfolder inside it and pick that. |
| Nothing saved after picking a folder | Re-pick the base folder; the browser may have revoked write permission. |
| Status says "N failed" | Open the browser console and look for `[HB-DL] Failed item:` lines. |
| Zip never appears (Firefox/Safari) | Allow downloads for `humblebundle.com` when the browser asks, and check that downloads are not blocked. |
| Large downloads fail | Files are fetched into memory as blobs before writing; very large files need enough RAM. |

## Development

The zip writer is covered by a test that builds an archive with the script's own code and checks it with Python's `zipfile` and `unzip`:

```bash
node test/zip.test.js
```

## Disclaimer

Not affiliated with or endorsed by Humble Bundle. Intended for downloading content you own, from your own account, for personal use. You are responsible for following Humble Bundle's terms of service.

## License

[MIT](LICENSE)
