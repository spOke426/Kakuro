import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createPreviewServer } from '../scripts/serve.mjs';

for (const prefix of ['/', '/Kakuro/']) {
  const server = createPreviewServer(prefix);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  async function get(path, method = 'GET') {
    const response = await fetch(new URL(path, base), { method });
    const body = await response.text();
    return { status: response.status, body, type: response.headers.get('content-type') };
  }
  try {
    const page = await get('');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Find your flow'));
    assert.ok(!page.body.includes('<?php'));
    assert.ok(!page.body.includes('boot-data'));
    const assets = [...page.body.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(m => m[1]);
    assert.equal(assets.length, 6);
    for (const asset of assets) {
      assert.ok(!asset.startsWith('/'), `${asset} must be relative for GitHub project sites.`);
      const response = await get(asset);
      assert.equal(response.status, 200);
      assert.equal(response.body, await readFile(new URL(`../public/${asset}`, import.meta.url), 'utf8'));
      if (asset.endsWith('.js')) assert.match(response.type, /javascript/);
    }
    for (const path of ['api.php', 'index.php', 'app/Kakuro.php', '.tools/php/php.exe', '../data/puzzles.json', 'assets/missing.js']) {
      assert.equal((await get(path)).status, 404, `${path} should not be served.`);
    }
    assert.equal((await get('.nojekyll')).status, 200);
    assert.equal((await get('', 'POST')).status, 405);
    assert.equal((await get('index.html', 'HEAD')).body, '');
    assert.equal((await get('../publicity/index.html')).status, 404);
    console.log(`PASS: static page, all assets, MIME types, and no PHP/API at ${prefix}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
