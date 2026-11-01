// Timed integration tests for the real game scripts, without waiting in real time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from '../.qa/node_modules/jsdom/lib/api.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sources = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match =>
  readFileSync(new URL(`../public/${match[1]}`, import.meta.url), 'utf8')
);
const gameKey = 'kakuro:v2:/Kakuro/', settingsKey = 'kakuro:settings:/Kakuro/';

function open({ saved = {}, reducedMotion = false, noAudio = false, blockedAudio = false, initialAudioState = 'suspended' } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.github.io/Kakuro/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, errors = [], tones = [], timers = new Map();
  let now = 0, nextId = 0, hidden = false, contexts = 0, resumes = 0;
  w.structuredClone = structuredClone;
  w.addEventListener('error', event => errors.push(event.message));
  w.fetch = () => { throw new Error('Effects must work without network requests.'); };
  w.matchMedia = () => ({ matches: reducedMotion });
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  Object.defineProperty(w.performance, 'now', { value: () => now });
  Object.defineProperty(w.document, 'hidden', { get: () => hidden });
  w.setTimeout = (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, at: now + delay, interval: 0 }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.setInterval = (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay, interval: delay }); return id; };
  w.clearInterval = w.clearTimeout;

  if (!noAudio) w.AudioContext = class {
    constructor() { contexts++; this.state = initialAudioState; this.destination = {}; }
    get currentTime() { return now / 1000; }
    resume() { resumes++; if (blockedAudio) return Promise.reject(new Error('Audio blocked')); this.state = 'running'; return Promise.resolve(); }
    createGain() {
      const events = [];
      return { gain: {
        events,
        setValueAtTime(value, at) { events.push({ value, at }); },
        linearRampToValueAtTime(value, at) { events.push({ value, at }); },
        exponentialRampToValueAtTime(value, at) { events.push({ value, at }); },
      }, connect() {}, disconnect() {} };
    }
    createOscillator() {
      const tone = { createdAt: now, start: null, stop: null, frequency: null, sweep: null, type: null, envelope: [] };
      return {
        set type(type) { tone.type = type; },
        frequency: {
          setValueAtTime(frequency) { tone.frequency = frequency; },
          exponentialRampToValueAtTime(frequency, at) { tone.sweep = { frequency, at }; },
        },
        connect(gain) { tone.envelope = gain.gain.events; }, disconnect() {},
        start(at) { tone.start = at; tones.push(tone); },
        stop(at = now / 1000) { tone.stop = at; },
      };
    }
  };
  for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  for (const source of sources) w.eval(source);
  const $ = selector => w.document.querySelector(selector);
  return {
    $, w, tones, errors,
    get contexts() { return contexts; }, get resumes() { return resumes; },
    get reminders() { return new Set(tones.map(tone => tone.createdAt)).size; },
    click(selector) { const node = $(selector); assert.ok(node, selector); node.click(); },
    press(key) { w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true })); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(id);
        timer.callback();
      }
      now = end;
    },
    hide(value) { hidden = value; w.document.dispatchEvent(new w.Event('visibilitychange')); },
    saved() { return Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => w.localStorage.key(i)).map(key => [key, w.localStorage.getItem(key)])); },
    puzzle() { return w.KakuroEngine.restore(JSON.parse(w.localStorage.getItem(gameKey))); },
    close() { w.dispatchEvent(new w.Event('pagehide')); dom.window.close(); timers.clear(); },
  };
}

async function test(name, action, options) {
  const game = open(options);
  try { await action(game); assert.deepEqual(game.errors, []); console.log(`PASS: ${name}`); }
  finally { game.close(); }
}

await test('the music starts at ten seconds, once per idle stretch', game => {
  game.advance(10000);
  assert.equal(game.contexts, 0); assert.equal(game.tones.length, 0);
  game.click('.cell.selected');
  assert.equal(game.contexts, 1); assert.equal(game.resumes, 1);
  game.advance(9999); assert.equal(game.tones.length, 0);
  game.advance(1); assert.equal(game.reminders, 1);
  game.advance(20000); assert.equal(game.reminders, 1);
  game.press('4'); game.advance(9999); assert.equal(game.reminders, 1);
  game.advance(1); assert.equal(game.reminders, 2);
  game.press('5'); game.advance(9000); game.press('6');
  game.advance(9999); assert.equal(game.reminders, 2);
  game.advance(1); assert.equal(game.reminders, 3);
});

await test('the ten-second music has pitched melody, sustained chords, bass, and percussion', game => {
  game.press('4'); game.advance(10000);
  assert.equal(game.reminders, 1);
  const drums = game.tones.filter(tone => tone.type === 'sine' && tone.frequency < 120 && tone.sweep.frequency < tone.frequency);
  const melody = game.tones.filter(tone => tone.type === 'triangle' && tone.frequency > 200 && tone.frequency === tone.sweep.frequency);
  const chords = game.tones.filter(tone => tone.type === 'sine' && tone.frequency === tone.sweep.frequency && tone.stop - tone.start > 2);
  const bass = game.tones.filter(tone => tone.type === 'triangle' && tone.frequency < 120 && tone.frequency === tone.sweep.frequency);
  assert.ok(drums.length >= 8 && melody.length >= 16 && chords.length >= 6 && bass.length >= 8);
  assert.ok(new Set(melody.map(tone => Math.round(tone.frequency))).size >= 8);
  assert.ok(melody.at(-1).frequency > melody[0].frequency);
  const duration = Math.max(...game.tones.map(tone => tone.stop)) - Math.min(...game.tones.map(tone => tone.start));
  assert.ok(duration >= 9.9 && duration <= 10.1);
  assert.ok(game.tones.every(tone => tone.envelope[0].value === 0 && tone.envelope.at(-1).value <= 0.001));
  assert.ok(game.tones.every(tone => Math.max(...tone.envelope.map(event => event.value)) <= 0.15));
  // A fresh entry cancels every layer, including notes scheduled later in the cue.
  game.press('5'); assert.ok(game.tones.every(tone => tone.stop <= tone.start));
});

await test('notes and keypad digits reset inactivity; selection and erase do not', game => {
  game.click('.cell.selected'); game.advance(9000);
  game.click('.cell.selected'); game.advance(1000); assert.equal(game.reminders, 1);
  game.click('#notes-button'); game.press('2'); game.advance(9000);
  game.click('[data-digit="7"]'); game.advance(9999); assert.equal(game.reminders, 1);
  game.advance(1); assert.equal(game.reminders, 2);
  game.press('3'); game.advance(9000); game.press('Backspace'); game.advance(1000);
  assert.equal(game.reminders, 3);
});

await test('pausing, dialogs, and background tabs cancel music and restart the ten-second window', game => {
  game.press('4'); game.advance(9000); game.click('#pause-button');
  game.advance(20000); assert.equal(game.tones.length, 0);
  game.click('#resume-button'); game.advance(9999); assert.equal(game.tones.length, 0);
  game.advance(1); assert.equal(game.reminders, 1);
  game.press('5'); game.advance(9000); game.click('#help-button');
  game.advance(20000); assert.equal(game.reminders, 1);
  game.click('#help-dialog [data-close]'); game.advance(9999); assert.equal(game.reminders, 1);
  game.advance(1); assert.equal(game.reminders, 2);
  game.press('6'); game.advance(9000); game.hide(true);
  game.advance(20000); assert.equal(game.reminders, 2);
  game.hide(false); game.advance(9999); assert.equal(game.reminders, 2);
  game.advance(1); assert.equal(game.reminders, 3);
  game.click('#pause-button');
  assert.ok(game.tones.filter(tone => tone.createdAt === game.tones.at(-1).createdAt).every(tone => tone.stop <= tone.start));
});

let mutedSave;
await test('mute immediately stops sound and persists separately from puzzle progress', game => {
  game.press('3'); game.advance(10000); assert.equal(game.reminders, 1);
  game.click('#sound-button');
  assert.equal(game.$('#sound-button').getAttribute('aria-pressed'), 'false');
  assert.ok(game.tones.every(tone => tone.stop <= tone.start));
  game.press('4'); game.advance(10000); assert.equal(game.reminders, 1);
  mutedSave = game.saved();
  assert.equal(JSON.parse(mutedSave[settingsKey]).soundEnabled, false);
  game.click('#sound-button'); game.advance(9999); assert.equal(game.reminders, 1);
  game.advance(1); assert.equal(game.reminders, 2);
});
await test('a restored muted game stays silent', game => {
  assert.equal(game.$('#sound-button').getAttribute('aria-pressed'), 'false');
  game.press('2'); game.advance(10000); assert.equal(game.tones.length, 0);
}, { saved: mutedSave });

await test('restart and new puzzle remove any pending reminder', game => {
  game.press('2'); game.advance(9000); game.click('#restart-button'); game.click('#confirm-yes');
  game.advance(10000); assert.equal(game.tones.length, 0);
  game.press('4'); game.advance(9000); game.click('#new-game-button'); game.click('#confirm-yes');
  game.advance(10000); assert.equal(game.tones.length, 0);
  game.click('.cell.selected'); game.advance(10000); assert.equal(game.reminders, 1);
});

function finish(game) {
  const puzzle = game.puzzle();
  for (const [key, digit] of Object.entries(puzzle.solution)) {
    if (puzzle.givens[key]) continue;
    game.click(`[data-key="${key}"]`); game.press(String(digit));
  }
  assert.ok(game.$('#win-dialog').open);
}
let completedSave;
await test('solving launches confetti in the results dialog, cleans up, and stops reminders', game => {
  const puzzle = game.puzzle(), key = game.$('.cell.selected').dataset.key;
  game.press(String(puzzle.solution[key] % 9 + 1)); game.click('#check-button');
  assert.equal(game.$('.confetti-layer'), null);
  finish(game);
  const layer = game.$('#win-dialog .confetti-layer');
  assert.ok(layer); assert.equal(layer.getAttribute('aria-hidden'), 'true'); assert.equal(layer.children.length, 96);
  completedSave = game.saved();
  game.advance(4599); assert.ok(game.$('.confetti-layer'));
  game.advance(1); assert.equal(game.$('.confetti-layer'), null);
  game.advance(15000); assert.equal(game.tones.length, 0);
});
await test('reopening a completed save does not replay confetti or sound', game => {
  assert.ok(game.$('#win-dialog').open); assert.equal(game.$('.confetti-layer'), null);
  game.advance(10000); assert.equal(game.tones.length, 0);
}, { saved: completedSave });
await test('closing results or starting another puzzle removes confetti immediately', game => {
  finish(game); assert.ok(game.$('.confetti-layer'));
  game.click('#win-dialog [data-close]'); assert.equal(game.$('.confetti-layer'), null);
  game.click('#restart-button'); game.click('#confirm-yes'); finish(game);
  game.click('#win-next'); assert.equal(game.$('.confetti-layer'), null);
  game.advance(10000); assert.equal(game.tones.length, 0);
});
await test('reduced-motion preference keeps the win screen without animation', game => {
  finish(game); assert.equal(game.$('.confetti-layer'), null);
}, { reducedMotion: true });
await test('unavailable browser audio does not break play or celebration', game => {
  assert.ok(game.$('#sound-button').disabled);
  game.press('4'); game.advance(10000); finish(game);
  assert.ok(game.$('.confetti-layer'));
}, { noAudio: true });
await test('blocked audio resumes fail quietly without breaking the puzzle', game => {
  game.press('4'); game.advance(10000); assert.equal(game.tones.length, 0);
  assert.equal(game.$('.cell.selected .value').textContent, '4');
}, { blockedAudio: true });
await test('an interrupted audio context resumes on the next player interaction', game => {
  game.press('4'); game.advance(10000);
  assert.equal(game.resumes, 1); assert.equal(game.reminders, 1);
}, { initialAudioState: 'interrupted' });
