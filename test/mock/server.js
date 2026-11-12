// Local mock of a Humble download page for manual browser checks. Run: node test/mock/server.js [port]
// Serves test/mock/pages/*, the repo's userscript at /humble_fumble.user.js, delayed fake files at /files/*,
// and /stat (peak simultaneous /files requests) and /reset-stat.
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 8778;
const root = path.join(__dirname, '..', '..');
const pages = path.join(__dirname, 'pages');
let cur = 0, max = 0;

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/stat') return res.end(JSON.stringify({ max }));
  if (url === '/reset-stat') { max = 0; return res.end('{}'); }
  if (url.startsWith('/files/')) {
    cur++; max = Math.max(max, cur);
    return setTimeout(() => { cur--; res.setHeader('content-type', 'application/pdf'); res.end(Buffer.alloc(50000, 1)); }, 1500);
  }
  const file = url === '/humble_fumble.user.js' ? path.join(root, url) : path.join(pages, path.basename(url === '/' ? '/zip-concurrency.html' : url));
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(buf);
  });
}).listen(port, () => console.log('mock server on http://localhost:' + port + '/'));
