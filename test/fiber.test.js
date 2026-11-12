// Runs the script's own inspectReactFiber on a row shaped like Humble's entitlement.signedUrls
// (cbz, pdf and .torrent URLs side by side) and checks each format gets its own URL.
// Run: node test/fiber.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'humble_fumble.user.js'), 'utf8');
const grab = (re, name) => { const m = src.match(re); assert(m, name + ' not found'); return m[0]; };
const code = [
  grab(/const FILE_EXTENSIONS = \[[\s\S]*?\];/, 'FILE_EXTENSIONS'),
  grab(/function isNonDownloadUrl[\s\S]*?\n  }\n/, 'isNonDownloadUrl'),
  grab(/function detectStrictExtension[\s\S]*?\n  }\n/, 'detectStrictExtension'),
  grab(/function inspectReactFiber[\s\S]*?\n  }\n/, 'inspectReactFiber'),
].join('\n');
const inspect = new Function(
  'document', 'location', 'Node', 'Window', 'isBulkHeaderOrSummaryRow', 'isKeyToken',
  code + '\nreturn inspectReactFiber;'
)({ body: {} }, { origin: 'https://www.humblebundle.com' }, class {}, class {}, () => false, () => false);

const h = 'https://cdn.humble.com/humblebundle/';
const entitlement = {
  subproductMachineName: 'blackcloak_vol1',
  signedUrls: { blackcloak_vol1: { blackcloak_vol1_ebook: {
    'blackcloak_vol1.cbz': h + 'blackcloak_vol1.cbz?t=st=1~exp=2~hmac=aa',
    'blackcloak_vol1.pdf': h + 'blackcloak_vol1.pdf?t=st=1~exp=2~hmac=bb',
    'blackcloak_vol1.cbz.torrent': h + 'torrents/blackcloak_vol1.cbz.torrent?t=st=1~exp=2~hmac=cc',
    'blackcloak_vol1.pdf.torrent': h + 'torrents/blackcloak_vol1.pdf.torrent?t=st=1~exp=2~hmac=dd',
  } } },
};
const el = { __reactProps$x: { entitlement }, parentElement: null };
const m = inspect(el);
assert.strictEqual(m.urlsByExt.pdf, h + 'blackcloak_vol1.pdf?t=st=1~exp=2~hmac=bb', 'pdf url');
assert.strictEqual(m.urlsByExt.cbz, h + 'blackcloak_vol1.cbz?t=st=1~exp=2~hmac=aa', 'cbz url');
assert.ok(!m.urlsByExt.torrent, 'torrent must not be registered');
console.log('fiber test: PASS (pdf and cbz each resolve to their own URL, torrents ignored)');
