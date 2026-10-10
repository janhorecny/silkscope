// Serves files from one directory. No caching: it is a local dev tool and edits should show on reload.

import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

export function staticHandler(root) {
  root = path.resolve(root);
  return (req, res, pathname) => {
    let p;
    try { p = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
    if (p === '/') p = '/index.html';
    const file = path.join(root, path.normalize(p));
    // root + sep, so a sibling like "public-old" can't pass the prefix test
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  };
}
