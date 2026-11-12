# Mock-page harness

Manual browser checks for `humble_fumble.user.js` that do not need a Humble account. The script is loaded straight from the repo root, so edits are picked up on reload.

```bash
node test/mock/server.js        # http://localhost:8778/
```

| Page | Checks |
|---|---|
| `/zip-concurrency.html` | 8 files, no folder picker (zip mode). Peak simultaneous downloads and the zip handoff. |
| `/zip-keys.html` | One file and one key row. Zip contents, Copy / Export JSON / Export CSV in the drawer. |
| `/zip-keys-reveal.html` | Four key rows: key appears after 1.5 s in an input, as text, as the button's own text, or never. Expect 3 saved and 1 failed, no placeholder keys. |
| `/zip-keys-revealed.html` | Keys already revealed (hyphenated text, input value, and an unhyphenated code inside a button). All three must be detected once each and the type filter must list only `steam_key`. |
| `/empty.html` | No items. The type filter must say none were detected instead of listing every format. |
| `/grid-rows.html` | 42 rows in a layout like Humble's current library page. Expect 42 distinct items. |
| `/grid-late-titles.html` | Same rows, but titles appear 10 s after load and one row is re-rendered at 14 s. Expect 42 placeholder items at first, then 42 correctly named ones with no stale checkboxes. |
| `/hydration.html` | Server-rendered React 18 that hydrates 2.5 s after load. Needs internet for the React CDN. Open the console: there must be no `Minified React error #418` / `#423`. |
| `/hydration-baseline.html` | Same page without the script, to confirm any error comes from the script. |

The pages record the zip download name in `window.__dl` instead of saving it.

## Concurrency check

Open `/zip-concurrency.html`, then in the console select every item, start a download, and read the server's peak:

```js
document.querySelectorAll('.hb-dl-inline-wrap input').forEach((c) => { if (!c.checked) c.click(); });
document.getElementById('hb-dl-execute-btn').click();
// optionally set document.getElementById('hb-dl-concurrency-input').value = '2'
document.getElementById('hb-dl-modal-start').click();
// after the status line says Finished:
(await (await fetch('/stat')).json()).max   // expect the chosen value (default 5)
```

Call `/reset-stat` between runs; the peak is cumulative.

## Hydration check

Open `/hydration.html` with the console visible. The toolbar should appear after about 3.5 s, `window.__errs` should be empty, and the inline checkbox next to "Book One" should still be there.
