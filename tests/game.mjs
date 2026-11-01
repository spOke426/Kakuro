import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
for (const file of ['puzzles.js', 'engine.js']) vm.runInContext(readFileSync(new URL(`../public/assets/${file}`, import.meta.url), 'utf8'), context);
const engine = context.KakuroEngine;
const sizes = { easy: [6, 15], medium: [8, 27], hard: [10, 47] };
let total = 0;
for (const [difficulty, [size, cells]] of Object.entries(sizes)) {
  for (let index = 0; index < 6; index++) for (const flags of ['00', '01', '10', '11']) {
    const variant = `${difficulty}-${index}-${flags}`;
    const puzzle = engine.fromVariant(variant);
    assert.equal(puzzle.size, size);
    assert.equal(Object.keys(puzzle.cells).length, size * size);
    assert.equal(Object.keys(puzzle.solution).length, cells);
    const membership = Object.fromEntries(Object.keys(puzzle.solution).map(k => [k, 0]));
    for (const run of puzzle.runs) {
      const digits = run.cells.map(key => puzzle.solution[key]);
      assert.ok(digits.length >= 2 && digits.length <= 9);
      assert.ok(digits.every(n => Number.isInteger(n) && n >= 1 && n <= 9));
      assert.equal(new Set(digits).size, digits.length);
      assert.equal(digits.reduce((sum, n) => sum + n, 0), run.target);
      assert.equal(puzzle.cells[run.clue][run.direction], run.target);
      const [row, col] = run.clue.split('-').map(Number);
      run.cells.forEach((key, i) => {
        const expected = run.direction === 'across' ? `${row}-${col + i + 1}` : `${row + i + 1}-${col}`;
        assert.equal(key, expected); membership[key]++;
      });
    }
    assert.ok(Object.values(membership).every(n => n === 2));
    assert.equal(engine.check(puzzle, puzzle.solution).complete, true);
    assert.equal(engine.check(puzzle, {}).complete, false);
    const editable = Object.keys(puzzle.solution).filter(k => !puzzle.givens[k]);
    const key = editable[0], values = { ...puzzle.givens, [key]: puzzle.solution[key] % 9 + 1 };
    assert.deepEqual([...engine.check(puzzle, values).incorrect], [key]);
    const firstHint = engine.hint(puzzle, values, key);
    assert.equal(firstHint.key, key);
    assert.equal(firstHint.value, puzzle.solution[key]);
    values[key] = firstHint.value;
    for (let i = 0; i < 2; i++) {
      const hint = engine.hint(puzzle, values); values[hint.key] = hint.value;
    }
    assert.throws(() => engine.hint(puzzle, values), /All 3 hints used/);
    const saved = { version: 2, bankVersion: engine.bankVersion, variant, hintsUsed: puzzle.hintsUsed, hinted: puzzle.hinted };
    const restored = engine.restore(saved);
    assert.equal(restored.hintsUsed, 3);
    assert.throws(() => engine.hint(restored, {}), /All 3 hints used/);
    for (const invalid of [null, [], { [key]: 10 }, { [key]: '5' }, { [key]: 1.5 }, { '99-99': 1 }]) {
      assert.throws(() => engine.check(puzzle, invalid));
    }
    const given = Object.keys(puzzle.givens)[0];
    assert.equal(engine.validateValues(puzzle, { [given]: 9 })[given], puzzle.givens[given]);
    assert.notEqual(engine.create(difficulty, variant).variant, variant);
    total++;
  }
}
for (const bad of ['impossible', '__proto__', 'toString']) assert.throws(() => engine.create(bad));
for (const bad of ['easy-999-00', 'easy-01-00', 'easy-0-22', '__proto__', null]) assert.throws(() => engine.fromVariant(bad));
for (const bad of [null, {}, { version: 1 }, { version: 2, bankVersion: 'outdated' }, { version: 2, bankVersion: engine.bankVersion, variant: 'easy-0-00', hintsUsed: -1 }]) assert.throws(() => engine.restore(bad));
console.log(`PASS: all ${total} variants; clues, adjacency, no-repeat rules, checking, hints, restoration, and invalid inputs.`);
