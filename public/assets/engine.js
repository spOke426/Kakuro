(() => {
  'use strict';
  const bank = globalThis.KakuroPuzzleBank;
  if (!bank?.puzzles) throw new Error('The puzzle bank did not load. Reload the page.');
  const levels = Object.freeze({ easy: 6, medium: 8, hard: 10 });
  const validDigit = n => Number.isInteger(n) && n >= 1 && n <= 9;
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function fromVariant(variant) {
    const match = typeof variant === 'string' && /^(easy|medium|hard)-(\d+)-([01])([01])$/.exec(variant);
    if (!match) throw new Error('Unknown puzzle.');
    const [, difficulty, index, transposeFlag, complementFlag] = match;
    const source = bank.puzzles[difficulty][Number(index)];
    if (!source || String(Number(index)) !== index) throw new Error('Unknown puzzle.');
    const transpose = transposeFlag === '1', complement = complementFlag === '1';
    const size = levels[difficulty], solution = {}, givens = {}, cells = {}, runs = [];
    let offset = 0;
    source.mask.forEach((line, row) => {
      for (let col = 0; col < size; col++) {
        if (line[col] !== '.') continue;
        const key = transpose ? `${col}-${row}` : `${row}-${col}`;
        const digit = source.solution[offset];
        solution[key] = complement ? 10 - digit : digit;
        if (Object.hasOwn(source.givens, offset)) givens[key] = solution[key];
        offset++;
      }
    });
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const key = `${row}-${col}`;
        if (Object.hasOwn(solution, key)) {
          cells[key] = { type: 'entry', row, col };
          continue;
        }
        const cell = { type: 'block', row, col };
        for (const [direction, dr, dc] of [['across', 0, 1], ['down', 1, 0]]) {
          const members = [];
          let r = row + dr, c = col + dc;
          while (Object.hasOwn(solution, `${r}-${c}`)) {
            members.push(`${r}-${c}`); r += dr; c += dc;
          }
          if (members.length) {
            const target = members.reduce((sum, id) => sum + solution[id], 0);
            cell[direction] = target;
            runs.push({ direction, clue: key, cells: members, target });
          }
        }
        cells[key] = cell;
      }
    }
    return { variant, difficulty, size, cells, runs, givens, solution, hintsUsed: 0, hinted: {} };
  }

  function create(difficulty, previous = null) {
    if (!Object.hasOwn(levels, difficulty)) throw new Error('Choose Easy, Medium, or Hard.');
    const choices = bank.puzzles[difficulty].flatMap((_, index) =>
      ['00', '01', '10', '11'].map(flags => `${difficulty}-${index}-${flags}`)
    ).filter(variant => variant !== previous);
    return fromVariant(choices[Math.floor(Math.random() * choices.length)]);
  }

  function validateValues(puzzle, values) {
    if (!isRecord(values)) throw new Error('Invalid board values.');
    const clean = {};
    for (const [key, digit] of Object.entries(values)) {
      if (!Object.hasOwn(puzzle.solution, key) || !validDigit(digit)) {
        throw new Error('Entries must be digits from 1 to 9 on playable cells.');
      }
      clean[key] = digit;
    }
    return Object.assign(clean, puzzle.givens);
  }

  function check(puzzle, values) {
    const clean = validateValues(puzzle, values);
    const incorrect = Object.keys(clean).filter(key => clean[key] !== puzzle.solution[key]);
    const filled = Object.keys(clean).length, total = Object.keys(puzzle.solution).length;
    return { incorrect, filled, total, complete: filled === total && incorrect.length === 0 };
  }

  function hint(puzzle, values, selected = null) {
    const clean = validateValues(puzzle, values);
    if (puzzle.hintsUsed >= 3) throw new Error('All 3 hints used. You can still check your answers.');
    const available = Object.keys(puzzle.solution).filter(key => clean[key] !== puzzle.solution[key]);
    if (!available.length) throw new Error('Your puzzle is already complete!');
    const key = available.includes(selected) ? selected : available[0];
    puzzle.hintsUsed++;
    puzzle.hinted[key] = puzzle.solution[key];
    return { key, value: puzzle.solution[key], hintsUsed: puzzle.hintsUsed };
  }

  function restore(saved) {
    if (!isRecord(saved) || saved.version !== 2 || saved.bankVersion !== bank.version) {
      throw new Error('Saved puzzle is incompatible.');
    }
    const puzzle = fromVariant(saved.variant);
    if (!Number.isInteger(saved.hintsUsed) || saved.hintsUsed < 0 || saved.hintsUsed > 3) {
      throw new Error('Invalid saved hints.');
    }
    puzzle.hintsUsed = saved.hintsUsed;
    if (isRecord(saved.hinted)) {
      for (const [key, value] of Object.entries(saved.hinted)) {
        if (Object.hasOwn(puzzle.solution, key) && !Object.hasOwn(puzzle.givens, key) && puzzle.solution[key] === value) {
          puzzle.hinted[key] = value;
        }
      }
    }
    if (Object.keys(puzzle.hinted).length > puzzle.hintsUsed) throw new Error('Invalid saved hints.');
    return puzzle;
  }

  globalThis.KakuroEngine = Object.freeze({ levels, bankVersion: bank.version, create, fromVariant, validateValues, check, hint, restore });
})();
