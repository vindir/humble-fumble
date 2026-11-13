// Checks the script's own key patterns accept real key shapes and reject ordinary text.
// Run: node test/keys.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'humble_fumble.user.js'), 'utf8');
const m = src.match(/const KEY_TOKEN_RX = [\s\S]*?const isKeyToken = [^\n]*/);
assert(m, 'key patterns not found');
const { KEY_TOKEN_RX, KEY_IN_TEXT_RX } = new Function(m[0] + '\nreturn { KEY_TOKEN_RX, KEY_IN_TEXT_RX };')();

const keys = ['AAAAA-BBBBB-CCCCC', 'P3BBB-IAHEM-WJA2W', '74679RGEX2A69RGEX2A6', '7kQmZ2xPaB9nWc4T'];
for (const k of keys) {
  assert(KEY_TOKEN_RX.test(k), 'token should match: ' + k);
  assert.strictEqual((('Key: ' + k + ' (copy)').match(KEY_IN_TEXT_RX) || [])[1], k, 'text should find: ' + k);
}
const notKeys = ['Reveal', 'Download', 'blackcloak_vol1_ebook', 'GovernanceReliabilityApplication', 'alllowercase1234567890', 'EPUB', '225.7 MB', 'AI in Production: Governance, Reliability, and Application by Manning'];
for (const t of notKeys) assert(!KEY_TOKEN_RX.test(t) && !KEY_IN_TEXT_RX.test(t), 'must not match: ' + t);
console.log('keys test: PASS (' + keys.length + ' keys matched, ' + notKeys.length + ' non-keys rejected)');
