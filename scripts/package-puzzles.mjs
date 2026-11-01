import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// A classic script lets the game run on Pages or by opening index.html directly.
const puzzles = JSON.parse(await readFile(new URL('../data/puzzles.json', import.meta.url), 'utf8'));
const json = JSON.stringify(puzzles);
const version = createHash('sha256').update(json).digest('hex').slice(0, 16);
const output = `// Generated from data/puzzles.json by scripts/package-puzzles.mjs.\n` +
  `globalThis.KakuroPuzzleBank = Object.freeze(${JSON.stringify({ version, puzzles })});\n`;
const target = new URL('../public/assets/puzzles.js', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error('Puzzle bundle is out of date. Run node scripts/package-puzzles.mjs.');
  console.log('PASS: browser puzzle bundle matches the verified source bank.');
} else {
  await writeFile(target, output);
  console.log(`Packaged ${Object.values(puzzles).flat().length} puzzles for static hosting.`);
}
