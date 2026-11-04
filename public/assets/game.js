(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const engine = globalThis.KakuroEngine;
  if (!engine) {
    $('status').textContent = 'The puzzle files did not load. Please reload this page.';
    $('status').classList.add('error');
    return;
  }
  const board = $('board');
  const buttons = new Map();
  // Separate saves for different GitHub project sites on the same origin.
  const storageKey = `kakuro:v2:${new URL('.', location.href).pathname}`;
  let puzzle, restored = null;
  try {
    restored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    puzzle = engine.restore(restored);
  } catch {
    restored = null;
    puzzle = engine.create('easy');
  }
  let values = {}, notes = {}, history = [], selected = null, errors = new Set();
  let notesMode = false, paused = false, complete = false, started = false;
  let elapsed = 0, lastTick = performance.now(), confirming = null;
  const validDigit = n => Number.isInteger(n) && n >= 1 && n <= 9;
  const isEntry = key => puzzle.cells[key]?.type === 'entry';
  const fixed = key => Boolean(puzzle.givens[key]);
  const formatTime = seconds => {
    const n = Math.floor(seconds);
    return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
  };
  const hasDialog = () => Boolean(document.querySelector('dialog[open]'));
  const message = (text, type = '') => { $('status').textContent = text; $('status').className = `status-message ${type}`; };
  const feedback = globalThis.KakuroFeedback.create({
    soundButton: $('sound-button'), celebrationHost: $('win-dialog'),
    musicHost: $('music-player-host'), musicStatus: $('music-status'), musicButton: $('music-play-button'),
    settingsKey: `kakuro:settings:${new URL('.', location.href).pathname}`,
    isActive: () => started && !paused && !complete && !document.hidden && !hasDialog(),
  });

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        version: 2, bankVersion: engine.bankVersion, variant: puzzle.variant,
        hintsUsed: puzzle.hintsUsed, hinted: puzzle.hinted,
        values, notes, selected, elapsed, started, notesMode,
      }));
    } catch {
      document.querySelector('.save-note').textContent = 'Saving unavailable in this browser';
    }
  }

  function load(saved = null) {
    feedback.reset();
    values = {...puzzle.givens}; notes = {}; selected = null; elapsed = 0;
    history = []; errors = new Set(); paused = false; complete = false; started = false;
    notesMode = false;
    try {
      if (saved) {
        for (const [key, digit] of Object.entries(saved.values || {})) if (isEntry(key) && validDigit(digit)) values[key] = digit;
        Object.assign(values, puzzle.givens);
        for (const [key, digits] of Object.entries(saved.notes || {})) {
          if (isEntry(key) && !fixed(key) && Array.isArray(digits)) notes[key] = [...new Set(digits.filter(validDigit))];
        }
        elapsed = Number.isFinite(saved.elapsed) && saved.elapsed >= 0 ? Math.min(saved.elapsed, 31536000) : 0;
        selected = isEntry(saved.selected) ? saved.selected : null;
        started = Boolean(saved.started); notesMode = Boolean(saved.notesMode);
        // Recheck the answers against the bundled puzzle after restoring progress.
      }
    } catch { /* A damaged save is replaced with a fresh board. */ }
    if (!selected) selected = Object.keys(puzzle.cells).find(key => isEntry(key) && !fixed(key));
    lastTick = performance.now();
    $('level-badge').textContent = puzzle.difficulty.toUpperCase();
    $('level-badge').className = `level-badge ${puzzle.difficulty}`;
    $('board-size').textContent = `${puzzle.size} × ${puzzle.size} grid`;
    document.querySelector(`input[name="difficulty"][value="${puzzle.difficulty}"]`).checked = true;
    buildBoard(); render(); save();
    if (Object.keys(values).length === buttons.size) check(false, false);
  }

  function buildBoard() {
    board.replaceChildren(); buttons.clear();
    const area = document.querySelector('.board-area');
    area.classList.toggle('large-board', puzzle.difficulty === 'insane');
    area.scrollLeft = 0;
    board.style.setProperty('--size', puzzle.size);
    board.className = `board ${puzzle.difficulty}`;
    board.setAttribute('aria-label', `${puzzle.difficulty} Kakuro, ${puzzle.size} by ${puzzle.size} grid`);
    for (const [key, cell] of Object.entries(puzzle.cells)) {
      const node = document.createElement(cell.type === 'entry' ? 'button' : 'div');
      node.className = `cell ${cell.type}`;
      if (cell.type === 'entry') {
        node.type = 'button'; node.dataset.key = key;
        const value = document.createElement('span'); value.className = 'value';
        const candidates = document.createElement('span'); candidates.className = 'cell-notes'; candidates.setAttribute('aria-hidden', 'true');
        for (let n = 1; n <= 9; n++) candidates.appendChild(document.createElement('span'));
        node.append(value, candidates);
        node.addEventListener('click', () => {
          if (paused) return;
          selected = key; started = true; render(); save();
          feedback.interact();
          if (fixed(key)) message('This starter number is fixed. Select an empty square to play.');
          else message(notesMode ? 'Pencil mode is on. Add or remove possible numbers.' : 'Use the number pad or type a digit from 1 to 9.');
        });
        buttons.set(key, node);
      } else if (cell.across || cell.down) {
        node.classList.add('clue'); node.dataset.clue = key;
        const labels = [];
        for (const direction of ['across', 'down']) if (cell[direction]) {
          const number = document.createElement('span');
          number.className = `clue-number ${direction}`; number.textContent = cell[direction]; node.appendChild(number);
          labels.push(`${direction} ${cell[direction]}`);
        }
        node.setAttribute('aria-label', labels.join(', '));
      } else node.setAttribute('aria-hidden', 'true');
      board.appendChild(node);
    }
  }

  function render() {
    const runs = puzzle.runs.filter(run => run.cells.includes(selected));
    const related = new Set(runs.flatMap(run => run.cells));
    for (const [key, node] of buttons) {
      node.classList.toggle('selected', selected === key);
      node.classList.toggle('related', related.has(key));
      node.classList.toggle('is-given', fixed(key));
      node.classList.toggle('is-error', errors.has(key));
      node.classList.toggle('is-hinted', Boolean(puzzle.hinted[key]) && !fixed(key));
      node.tabIndex = selected === key ? 0 : -1;
      node.querySelector('.value').textContent = values[key] || '';
      const candidates = node.querySelector('.cell-notes');
      candidates.hidden = Boolean(values[key]);
      [...candidates.children].forEach((n, i) => n.textContent = notes[key]?.includes(i + 1) ? i + 1 : '');
      const cell = puzzle.cells[key];
      const clues = puzzle.runs.filter(r => r.cells.includes(key)).map(r => `${r.direction} ${r.target}`).join(', ');
      node.setAttribute('aria-label', `Row ${cell.row + 1}, column ${cell.col + 1}, ${values[key] || 'empty'}${fixed(key) ? ', fixed starter' : ''}${errors.has(key) ? ', incorrect' : ''}${notes[key]?.length && !values[key] ? `, notes ${notes[key].join(' ')}` : ''}; ${clues}`);
      node.setAttribute('aria-pressed', String(selected === key));
    }
    board.querySelectorAll('[data-clue]').forEach(n => n.classList.toggle('related-clue', runs.some(r => r.clue === n.dataset.clue)));
    const filled = Object.keys(values).length;
    $('progress-label').textContent = `${filled} / ${buttons.size}`;
    $('progress-fill').style.width = `${filled / buttons.size * 100}%`;
    $('board-caption').textContent = complete ? 'Every number in its place. Nicely done.' : notesMode ? 'Pencil mode · jot down possibilities' : `${buttons.size - filled} squares to discover`;
    $('notes-button').setAttribute('aria-pressed', String(notesMode));
    $('hint-count').textContent = `${Math.max(0, 3 - puzzle.hintsUsed)} left`;
    $('timer').textContent = formatTime(elapsed);
    $('pause-overlay').hidden = !paused;
    board.inert = paused;
    board.classList.toggle('completed', complete);
    for (const id of ['notes-button', 'erase-button', 'check-button', 'hint-button', 'undo-button']) $(id).disabled = paused || complete;
    $('undo-button').disabled ||= history.length === 0;
    $('hint-button').disabled ||= puzzle.hintsUsed >= 3;
    $('pause-button').disabled = complete;
    $('pause-button').setAttribute('aria-label', paused ? 'Resume puzzle' : 'Pause puzzle');
    $('pause-button').title = paused ? 'Resume puzzle' : 'Pause puzzle';
    document.querySelectorAll('[data-digit]').forEach(b => b.disabled = paused || complete);
    updateBoardSizing();
    renderRuns(runs);
    feedback.sync();
  }

  function updateBoardSizing() {
    const area = document.querySelector('.board-area');
    $('board-scroll-tip').hidden = puzzle.difficulty !== 'insane' || area.scrollWidth <= area.clientWidth;
  }

  function revealSelected() {
    if (puzzle.difficulty !== 'insane') return;
    const area = document.querySelector('.board-area'), cell = buttons.get(selected);
    if (!cell) return;
    const viewport = area.getBoundingClientRect(), bounds = cell.getBoundingClientRect();
    if (bounds.left < viewport.left) area.scrollLeft += bounds.left - viewport.left - 8;
    else if (bounds.right > viewport.right) area.scrollLeft += bounds.right - viewport.right + 8;
  }

  function renderRuns(runs) {
    const panel = $('run-details'); panel.replaceChildren();
    for (const run of runs) {
      const line = document.createElement('div'); line.className = 'run-line';
      const direction = document.createElement('span'); direction.className = 'run-direction'; direction.textContent = run.direction === 'across' ? '→ Across' : '↓ Down';
      const target = document.createElement('span'); target.className = 'run-target'; target.textContent = run.target;
      const sum = run.cells.reduce((n, key) => n + (values[key] || 0), 0);
      const count = run.cells.filter(key => values[key]).length;
      const progress = document.createElement('span'); progress.className = 'run-sum'; progress.textContent = `${sum} of ${run.target} · ${count}/${run.cells.length} cells`;
      const distinct = new Set(run.cells.map(key => values[key])).size === run.cells.length;
      progress.classList.toggle('satisfied', sum === run.target && count === run.cells.length && distinct);
      line.append(direction, target, progress); panel.appendChild(line);
    }
  }

  function snapshot() {
    history.push({values: {...values}, notes: structuredClone(notes)});
    if (history.length > 100) history.shift();
  }

  function enter(digit) {
    if (paused || complete || hasDialog()) return;
    if (!selected) return message('Select a white square first.');
    if (fixed(selected)) return message('This starter number is fixed. Try another square.');
    snapshot(); started = true; errors.delete(selected);
    if (digit) feedback.digitEntered(); else feedback.interact();
    if (notesMode && digit) {
      delete values[selected];
      const set = new Set(notes[selected] || []);
      if (set.has(digit)) set.delete(digit); else set.add(digit);
      notes[selected] = [...set].sort();
      message('Pencil notes are possibilities. Toggle Notes off to enter your answer.');
    } else {
      if (digit) values[selected] = digit; else delete values[selected];
      delete notes[selected];
      message(digit ? 'One square at a time. You’ve got this.' : 'A fresh square. A fresh possibility.');
    }
    render(); save();
    if (Object.keys(values).length === buttons.size) check(false);
  }

  function check(explicit = true, celebrate = true) {
    if (paused || complete) return;
    const result = engine.check(puzzle, values);
    errors = new Set(result.incorrect);
    if (result.complete) {
      complete = true;
      message('Solved! A little focus goes a long way.', 'success');
      render(); save(); showWin(celebrate);
    } else {
      if (errors.size) message(`${errors.size} ${errors.size === 1 ? 'entry needs' : 'entries need'} another look. Highlighted in pink.`, 'error');
      else if (explicit) message(`Looking good! ${result.total - result.filled} squares left to discover.`, 'success');
      render();
    }
  }

  function hint() {
    if (paused || complete) return;
    let result;
    try { result = engine.hint(puzzle, values, selected); }
    catch (error) { message(error.message, 'error'); return; }
    snapshot(); values[result.key] = result.value; delete notes[result.key]; errors.delete(result.key);
    puzzle.hintsUsed = result.hintsUsed; puzzle.hinted[result.key] = result.value;
    selected = result.key; started = true;
    feedback.digitEntered();
    message(`A little nudge: this square is ${result.value}. ${3 - puzzle.hintsUsed} hints remaining.`);
    render(); save();
    revealSelected();
    if (Object.keys(values).length === buttons.size) check(false);
  }

  function confirmAction(title, copy, action) {
    confirming = action; $('confirm-title').textContent = title; $('confirm-copy').textContent = copy;
    $('confirm-dialog').showModal();
    feedback.sync();
  }

  function newPuzzle() {
    const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
    puzzle = engine.create(difficulty, puzzle.variant);
    load(); message('A fresh puzzle. Find a small sum and start there.');
  }

  function startNew() {
    const changed = Object.keys(values).some(key => !fixed(key)) || Object.values(notes).some(n => n.length);
    if (changed && !complete) confirmAction('Ready for a fresh puzzle?', 'Your current answers and pencil notes will be replaced with a new puzzle.', newPuzzle);
    else newPuzzle();
  }

  function restart() {
    confirmAction('Try this one again?', 'Clear your answers, notes, and timer. Used hints stay used.', () => {
      feedback.reset();
      values = {...puzzle.givens}; notes = {}; history = []; errors.clear(); elapsed = 0;
      complete = false; paused = false; started = false;
      render(); save(); message('A fresh look at a familiar puzzle.');
    });
  }

  function undo() {
    if (!history.length || paused || complete) return;
    const previous = history.pop(); values = previous.values; notes = previous.notes; errors.clear();
    render(); save(); message('Last move undone.');
  }

  function toggleNotes() {
    if (paused || complete) return;
    notesMode = !notesMode; render(); save();
    message(notesMode ? 'Pencil mode is on. Add possible numbers to a square.' : 'Pencil mode is off. Enter your answers.');
  }

  function togglePause() {
    if (complete) return;
    paused = !paused; lastTick = performance.now(); render(); save();
    if (paused && puzzle.difficulty === 'insane') document.querySelector('.board-area').scrollLeft = 0;
    if (paused) $('resume-button').focus(); else buttons.get(selected)?.focus();
  }

  function move(dr, dc) {
    if (!selected || paused) return;
    const [r, c] = selected.split('-').map(Number);
    for (let row = r + dr, col = c + dc; row >= 0 && col >= 0 && row < puzzle.size && col < puzzle.size; row += dr, col += dc) {
      const key = `${row}-${col}`;
      if (isEntry(key)) { selected = key; render(); buttons.get(key).focus(); revealSelected(); save(); return; }
    }
  }

  function showWin(celebrate) {
    const stats = $('win-stats'); stats.replaceChildren();
    for (const [label, value] of [['Difficulty', puzzle.difficulty[0].toUpperCase() + puzzle.difficulty.slice(1)], ['Your time', formatTime(elapsed)], ['Hints used', `${puzzle.hintsUsed} / 3`]]) {
      const item = document.createElement('div'); item.className = 'win-stat';
      const number = document.createElement('strong'); number.textContent = value;
      const caption = document.createElement('span'); caption.textContent = label;
      item.append(number, caption); stats.appendChild(item);
    }
    $('win-dialog').showModal();
    if (celebrate) feedback.celebrate();
  }

  const showHelp = () => { $('help-dialog').showModal(); feedback.sync(); };
  $('help-button').addEventListener('click', showHelp);
  $('example-button').addEventListener('click', showHelp);
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => feedback.sync()));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('[data-digit]').forEach(b => b.addEventListener('click', () => enter(Number(b.dataset.digit))));
  $('notes-button').addEventListener('click', toggleNotes);
  $('erase-button').addEventListener('click', () => enter(0));
  $('undo-button').addEventListener('click', undo);
  $('hint-button').addEventListener('click', hint);
  $('check-button').addEventListener('click', () => check(true));
  $('new-game-button').addEventListener('click', startNew);
  $('restart-button').addEventListener('click', restart);
  $('pause-button').addEventListener('click', togglePause);
  $('resume-button').addEventListener('click', togglePause);
  $('confirm-cancel').addEventListener('click', () => { confirming = null; $('confirm-dialog').close(); });
  $('confirm-dialog').addEventListener('cancel', () => confirming = null);
  $('confirm-yes').addEventListener('click', () => { const action = confirming; confirming = null; $('confirm-dialog').close(); action?.(); });
  $('win-next').addEventListener('click', () => { $('win-dialog').close(); newPuzzle(); });
  document.addEventListener('keydown', event => {
    if (hasDialog() || event.target.matches('input,textarea,select') || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
    if (event.ctrlKey || event.metaKey) return;
    if (/^[1-9]$/.test(event.key)) { event.preventDefault(); enter(Number(event.key)); }
    else if (['Backspace', 'Delete', '0'].includes(event.key)) { event.preventDefault(); enter(0); }
    else if (event.key.toLowerCase() === 'n') { event.preventDefault(); toggleNotes(); }
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const moves = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]};
      move(...moves[event.key]);
    }
  });
  let lastSave = 0;
  setInterval(() => {
    const now = performance.now(), delta = (now - lastTick) / 1000; lastTick = now;
    if (started && !paused && !complete && !document.hidden && !hasDialog()) elapsed += Math.min(delta, 2);
    $('timer').textContent = formatTime(elapsed);
    if (now - lastSave > 5000) { save(); lastSave = now; }
  }, 500);
  document.addEventListener('visibilitychange', () => {
    lastTick = performance.now(); save(); feedback.sync();
    if (document.hidden) feedback.clearCelebration();
  });
  window.addEventListener('pagehide', () => { save(); feedback.reset(); });
  window.addEventListener('resize', updateBoardSizing);
  load(restored);
  revealSelected();
})();
