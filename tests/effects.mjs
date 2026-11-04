// Timed integration tests for the real game scripts, without waiting in real time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from '../.qa/node_modules/jsdom/lib/api.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sources = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match =>
  readFileSync(new URL(`../public/${match[1]}`, import.meta.url), 'utf8')
);
const gameKey = 'kakuro:v2:/Kakuro/', settingsKey = 'kakuro:settings:/Kakuro/';

function open({ saved = {}, reducedMotion = false, noAPI = false, blockedAudio = false, readyDelay = 0, playbackDelay = 0, url = 'https://example.github.io/Kakuro/' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, errors = [], plays = [], players = [], timers = new Map();
  let now = 0, nextId = 0, hidden = false, blocked = blockedAudio;
  w.structuredClone = structuredClone;
  w.addEventListener('error', event => errors.push(event.message));
  w.fetch = () => { throw new Error('Tests use a mock YouTube player, never live media.'); };
  w.matchMedia = () => ({ matches: reducedMotion });
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  Object.defineProperty(w.performance, 'now', { value: () => now });
  Object.defineProperty(w.document, 'hidden', { get: () => hidden });
  w.setTimeout = (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, at: now + delay, interval: 0 }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.setInterval = (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay, interval: delay }); return id; };
  w.clearInterval = w.clearTimeout;

  class MockPlayer {
    constructor(frame, { events }) {
      this.frame = frame; this.events = events; this.playing = false; this.position = 0;
      players.push(this);
      w.setTimeout(() => events.onReady({ target: this }), readyDelay);
    }
    seekTo(position) { this.position = position; }
    unMute() { this.muted = false; }
    playVideo() {
      plays.push({ at: now, position: this.position, muted: this.muted });
      if (blocked) { this.events.onAutoplayBlocked({ target: this }); return; }
      w.setTimeout(() => this.emit(1), playbackDelay);
    }
    pauseVideo() { this.playing = false; this.events.onStateChange({ target: this, data: 2 }); }
    destroy() { this.destroyed = true; this.playing = false; this.frame.remove(); }
    emit(data) { this.playing = data === 1; this.events.onStateChange({ target: this, data }); }
    fail(code = 101) { this.events.onError({ target: this, data: code }); }
  }
  if (!noAPI) w.YT = { Player: MockPlayer };
  for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  for (const source of sources) w.eval(source);
  const $ = selector => w.document.querySelector(selector);
  return {
    $, w, plays, players, errors,
    get player() { return players.at(-1); },
    get reminders() { return plays.length; },
    allowPlayback() { blocked = false; },
    loadAPI() { w.YT = { Player: MockPlayer }; w.onYouTubeIframeAPIReady(); },
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
  assert.equal(game.players.length, 0); assert.equal(game.plays.length, 0);
  game.click('.cell.selected');
  assert.equal(game.players.length, 1);
  game.advance(9999); assert.equal(game.plays.length, 0);
  game.advance(1); assert.equal(game.reminders, 1);
  game.advance(20000); assert.equal(game.reminders, 1);
  game.press('4'); game.advance(9999); assert.equal(game.reminders, 1);
  game.advance(1); assert.equal(game.reminders, 2);
  game.press('5'); game.advance(9000); game.press('6');
  game.advance(9999); assert.equal(game.reminders, 2);
  game.advance(1); assert.equal(game.reminders, 3);
});

await test('the exact linked video plays for ten seconds and uses a visible, controllable embed', game => {
  game.press('4'); game.advance(10000);
  assert.equal(game.reminders, 1);
  const frame = game.$('#idle-music-player'), url = new URL(frame.src);
  assert.equal(url.origin + url.pathname, 'https://www.youtube.com/embed/SP0RCMtfm4o');
  assert.equal(url.searchParams.get('origin'), 'https://example.github.io');
  assert.equal(url.searchParams.get('autoplay'), '0');
  assert.equal(url.searchParams.get('enablejsapi'), '1');
  assert.match(frame.allow, /autoplay/); assert.equal(frame.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.ok(Number(frame.width) >= 200 && Number(frame.height) >= 200); assert.ok(!frame.hidden);
  assert.equal(game.$('.music-source').href, 'https://www.youtube.com/watch?v=SP0RCMtfm4o');
  assert.deepEqual(game.plays[0], { at: 10000, position: 0, muted: false });
  game.advance(9999); assert.ok(game.player.playing);
  game.advance(1); assert.ok(!game.player.playing);
  game.advance(10000); assert.equal(game.reminders, 1);
  game.press('5'); game.advance(10000); assert.ok(game.player.playing);
  game.press('6'); assert.ok(!game.player.playing);
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
  game.advance(20000); assert.equal(game.plays.length, 0);
  game.click('#resume-button'); game.advance(9999); assert.equal(game.plays.length, 0);
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
  assert.ok(!game.player.playing);
});

let mutedSave;
await test('mute immediately stops sound and persists separately from puzzle progress', game => {
  game.press('3'); game.advance(10000); assert.equal(game.reminders, 1);
  game.click('#sound-button');
  assert.equal(game.$('#sound-button').getAttribute('aria-pressed'), 'false');
  assert.ok(!game.player.playing);
  game.press('4'); game.advance(10000); assert.equal(game.reminders, 1);
  mutedSave = game.saved();
  assert.equal(JSON.parse(mutedSave[settingsKey]).soundEnabled, false);
  game.click('#sound-button'); game.advance(9999); assert.equal(game.reminders, 1);
  game.advance(1); assert.equal(game.reminders, 2);
});
await test('a restored muted game stays silent', game => {
  assert.equal(game.$('#sound-button').getAttribute('aria-pressed'), 'false');
  game.press('2'); game.advance(10000); assert.equal(game.plays.length, 0); assert.equal(game.players.length, 0);
}, { saved: mutedSave });

await test('restart and new puzzle remove any pending reminder', game => {
  game.press('2'); game.advance(9000); game.click('#restart-button'); game.click('#confirm-yes');
  game.advance(10000); assert.equal(game.plays.length, 0);
  game.press('4'); game.advance(9000); game.click('#new-game-button'); game.click('#confirm-yes');
  game.advance(10000); assert.equal(game.plays.length, 0);
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
  game.advance(15000); assert.equal(game.plays.length, 0);
});
await test('reopening a completed save does not replay confetti or sound', game => {
  assert.ok(game.$('#win-dialog').open); assert.equal(game.$('.confetti-layer'), null);
  game.advance(10000); assert.equal(game.plays.length, 0);
}, { saved: completedSave });
await test('closing results or starting another puzzle removes confetti immediately', game => {
  finish(game); assert.ok(game.$('.confetti-layer'));
  game.click('#win-dialog [data-close]'); assert.equal(game.$('.confetti-layer'), null);
  game.click('#restart-button'); game.click('#confirm-yes'); finish(game);
  game.click('#win-next'); assert.equal(game.$('.confetti-layer'), null);
  game.advance(10000); assert.equal(game.plays.length, 0);
});
await test('reduced-motion preference keeps the win screen without animation', game => {
  finish(game); assert.equal(game.$('.confetti-layer'), null);
}, { reducedMotion: true });
await test('an unavailable YouTube API does not break play or celebration', game => {
  game.press('4'); game.advance(20000);
  assert.equal(game.plays.length, 0); assert.match(game.$('#music-status').textContent, /could not load/);
  assert.equal(game.$('#music-play-button').hidden, false); finish(game);
  assert.ok(game.$('.confetti-layer'));
}, { noAPI: true });
await test('blocked autoplay offers a working play button without interrupting the puzzle', game => {
  game.press('4'); game.advance(10000); assert.ok(!game.player.playing);
  assert.match(game.$('#music-status').textContent, /needs a tap/);
  assert.equal(game.$('#music-play-button').hidden, false);
  assert.equal(game.$('.cell.selected .value').textContent, '4');
  game.allowPlayback(); game.click('#music-play-button'); game.advance(0);
  assert.ok(game.player.playing); assert.equal(game.$('#music-play-button').hidden, true);
  game.advance(10000); assert.ok(!game.player.playing);
}, { blockedAudio: true });

await test('the API loads only on interaction and a slow player honors the latest digit', game => {
  assert.equal(game.$('script[src="https://www.youtube.com/iframe_api"]'), null);
  game.press('4'); assert.ok(game.$('script[src="https://www.youtube.com/iframe_api"]'));
  game.advance(10000); assert.equal(game.reminders, 0);
  game.press('5'); game.loadAPI(); game.advance(0); assert.equal(game.reminders, 0);
  game.advance(9999); assert.equal(game.reminders, 0);
  game.advance(1); assert.equal(game.reminders, 1);
}, { noAPI: true });

await test('a late player starts only if the same idle stretch is still active', game => {
  game.press('4'); game.advance(10000); assert.equal(game.reminders, 0);
  game.advance(2000); assert.equal(game.reminders, 1); assert.ok(game.player.playing);
}, { readyDelay: 12000 });

await test('duplicate API callbacks create only one player', game => {
  game.press('4'); game.loadAPI(); game.loadAPI(); game.advance(0);
  assert.equal(game.players.length, 1);
  game.advance(10000); assert.equal(game.reminders, 1);
}, { noAPI: true });

await test('a script loading failure allows retry without breaking the puzzle', game => {
  game.press('4');
  game.$('script[src="https://www.youtube.com/iframe_api"]').dispatchEvent(new game.w.Event('error'));
  assert.match(game.$('#music-status').textContent, /could not load/);
  game.click('#music-play-button'); game.loadAPI(); game.advance(10000);
  assert.ok(game.player.playing); assert.equal(game.$('.cell.selected .value').textContent, '4');
}, { noAPI: true });

await test('entering a digit dismisses the autoplay prompt and starts a new countdown', game => {
  game.press('4'); game.advance(10000);
  assert.equal(game.$('#music-play-button').hidden, false);
  game.press('5'); assert.equal(game.$('#music-play-button').hidden, true);
  game.allowPlayback(); game.advance(9999); assert.ok(!game.player.playing);
  game.advance(1); assert.ok(game.player.playing);
}, { blockedAudio: true });

await test('muting before the player is ready prevents delayed playback', game => {
  game.press('4'); game.advance(10000); game.click('#sound-button');
  game.advance(3000); assert.equal(game.reminders, 0);
}, { readyDelay: 12000 });

await test('ten seconds of playback starts when the video actually plays, after buffering', game => {
  game.press('4'); game.advance(10000); assert.ok(!game.player.playing);
  game.advance(3000); assert.ok(game.player.playing);
  game.advance(9999); assert.ok(game.player.playing);
  game.advance(1); assert.ok(!game.player.playing);
}, { playbackDelay: 3000 });

await test('a digit cancels playback even if a delayed playing event arrives afterward', game => {
  game.press('4'); game.advance(10000); game.press('5');
  game.advance(3000); assert.ok(!game.player.playing);
}, { playbackDelay: 3000 });

await test('an embedding error offers retry and ignores events from the old player', game => {
  game.press('4'); game.advance(10000); const oldPlayer = game.player;
  oldPlayer.fail(101); assert.ok(oldPlayer.destroyed);
  assert.match(game.$('#music-status').textContent, /could not load/);
  game.click('#music-play-button'); game.advance(0);
  assert.equal(game.players.length, 2); oldPlayer.fail(153);
  assert.ok(!game.player.destroyed);
  game.advance(10000); assert.ok(game.player.playing);
  game.press('5'); assert.ok(!game.player.playing);
});

await test('manual play cannot sound while muted, paused, or before the idle deadline', game => {
  game.press('4'); game.advance(0); game.player.emit(1); assert.ok(!game.player.playing);
  game.advance(10000); assert.ok(game.player.playing);
  game.click('#sound-button'); game.player.emit(1); assert.ok(!game.player.playing);
  game.click('#sound-button'); game.click('#pause-button'); game.player.emit(1); assert.ok(!game.player.playing);
});

await test('the pagehide event cancels the soundtrack and all pending idle playback', game => {
  game.press('4'); game.advance(10000); assert.ok(game.player.playing);
  game.w.dispatchEvent(new game.w.Event('pagehide'));
  assert.ok(!game.player.playing); game.advance(20000); assert.equal(game.reminders, 1);
});

await test('completion stops active music and rejects subsequent playback', game => {
  game.press('4'); game.advance(10000); assert.ok(game.player.playing);
  finish(game); assert.ok(!game.player.playing);
  game.player.emit(1); assert.ok(!game.player.playing);
  game.advance(20000); assert.equal(game.reminders, 1);
});

await test('opening a local HTML file explains hosting while the puzzle still works', game => {
  assert.ok(game.$('#sound-button').disabled);
  assert.match(game.$('#music-status').textContent, /hosted game or local preview/);
  game.press('4'); game.advance(10000); assert.equal(game.players.length, 0);
  assert.equal(game.$('.cell.selected .value').textContent, '4');
}, { url: 'file:///C:/Kakuro/public/index.html' });
