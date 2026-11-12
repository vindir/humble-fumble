// Builds a zip with the script's own buildStructuredZipBlob and checks it with real unzip tools.
// Run: node test/zip.test.js   (needs node 18+ and python3; uses unzip if present)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');

const src = fs.readFileSync(path.join(__dirname, '..', 'humble_fumble.user.js'), 'utf8');
const m = src.match(/\/\/ ZIP-BEGIN[\s\S]*?\/\/ ZIP-END/);
assert(m, 'ZIP-BEGIN/ZIP-END markers not found in humble_fumble.user.js');
const buildStructuredZipBlob = new Function(m[0] + '\nreturn buildStructuredZipBlob;')();

const rnd = new Uint8Array(300000);
for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 31 + (i >> 8)) & 0xff;
const entries = [
  { relativePath: 'Some_Bundle/epub/Book_One.epub', dataUint8: rnd },
  { relativePath: 'Some_Bundle/steam_key/Game_steam_key.txt', dataUint8: new TextEncoder().encode('Key: AAAAA-BBBBB-CCCCC\n') },
  { relativePath: 'Some_Bundle/pdf/Café_日本.pdf', dataUint8: new Uint8Array(0) },
];

(async () => {
  const blob = buildStructuredZipBlob(entries);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hbzip-')), 'out.zip');
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));

  const py = `
import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, 'CRC mismatch'
print(json.dumps({n: len(z.read(n)) for n in z.namelist()}))
`;
  const sizes = JSON.parse(execFileSync('python3', ['-c', py, file]).toString());
  assert.deepStrictEqual(sizes, {
    'Some_Bundle/epub/Book_One.epub': 300000,
    'Some_Bundle/steam_key/Game_steam_key.txt': 23,
    'Some_Bundle/pdf/Café_日本.pdf': 0,
  });

  const u = spawnSync('unzip', ['-t', file]);
  if (u.error) console.log('unzip not found, skipped');
  else assert.strictEqual(u.status, 0, 'unzip -t failed:\n' + u.stdout + u.stderr);

  console.log('zip test: PASS (3 entries, CRC ok' + (u.error ? '' : ', unzip -t ok') + ')');
})().catch((e) => { console.error('zip test: FAIL\n', e); process.exit(1); });
