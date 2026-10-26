import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hkBuilder = path.join(root, 'tools/build-hk-geodata.mjs');
const nycBuilder = path.join(root, 'tools/build-geodata.mjs');

test('geodata builds with default paths in a checkout containing spaces and non-ASCII characters', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'Hong Kong 香港 '));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.mkdirSync(path.join(dir, 'js'));
    for (const name of fs.readdirSync(path.join(root, 'tools'))) {
      if (name.endsWith('.mjs') || name.endsWith('.sh')) {
        fs.copyFileSync(path.join(root, 'tools', name), path.join(dir, 'tools', name));
      }
    }
    const useHk = fs.existsSync(hkBuilder) && fs.existsSync(path.join(root, 'tools/data-hk'));
    if (useHk) {
      fs.symlinkSync(path.join(root, 'tools/data-hk'), path.join(dir, 'tools/data-hk'), 'dir');
    } else {
      fs.symlinkSync(path.join(root, 'tools/data'), path.join(dir, 'tools/data'), 'dir');
    }
    const env = { ...process.env };
    if (useHk) env.GEO_DATA = path.join(dir, 'tools/data-hk');
    else delete env.GEO_DATA;
    const builder = useHk ? path.join(dir, 'tools/build-hk-geodata.mjs') : path.join(dir, 'tools/build-geodata.mjs');
    const result = spawnSync(process.execPath, ['--max-old-space-size=8192', builder], {
      encoding: 'utf8', env, timeout: 180000, cwd: dir
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const { GEO } = await import(pathToFileURL(path.join(dir, 'js/nyc-geodata.js')).href);
    assert.ok(GEO.roadGraph.links.length > 0 || (GEO.streets && GEO.streets.length > 0) || (GEO.avenues && GEO.avenues.length > 0));
    assert.ok(GEO.blocks.length > 0 || (GEO.landmarks && Object.keys(GEO.landmarks).length > 0));
    if (useHk) assert.equal(GEO.frame?.city, 'hongkong');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
