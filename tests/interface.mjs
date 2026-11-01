// DOM-based integration checks. This does not replace real-browser visual QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from '../.qa/node_modules/jsdom/lib/api.js';
const base = 'https://example.github.io/Kakuro/';
const bank = JSON.parse(fs.readFileSync(new URL('../data/puzzles.json',import.meta.url)));
const html = fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => fs.readFileSync(new URL(`../public/${match[1]}`,import.meta.url),'utf8'));
assert.equal(scripts.length,3);
let dom, runtimeErrors = [], networkRequests = 0;
async function open(saved = {}, options = {}) {
  dom = new JSDOM(html,{url:options.url || base,runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window;
  w.structuredClone = structuredClone;
  w.addEventListener('error', event => runtimeErrors.push(event.message));
  w.HTMLDialogElement.prototype.showModal = function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close = function(){this.removeAttribute('open');};
  for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,value);
  if(options.blockStorage)w.Storage.prototype.setItem = () => {throw new Error('Storage unavailable');};
  w.fetch = () => {networkRequests++;throw new Error('The static game must not make API requests.');};
  w.XMLHttpRequest = function(){networkRequests++;throw new Error('The static game must not make API requests.');};
  for(const source of scripts)w.eval(source);
  await settle();
}
const $ = selector => dom.window.document.querySelector(selector);
const click = selector => { const node=$(selector); assert.ok(node,selector); node.click(); };
const press = key => dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true}));
async function settle() {
  await Promise.resolve();
  assert.deepEqual(runtimeErrors,[]);
  assert.equal(networkRequests,0);
}
function savedState() {
  const storage=dom.window.localStorage;
  return Object.fromEntries(Array.from({length:storage.length},(_,i)=>storage.key(i)).map(k=>[k,storage.getItem(k)]));
}
function activePuzzle() {
  const key=Object.keys(savedState()).find(k=>k.startsWith('kakuro:v2:'));
  return dom.window.KakuroEngine.restore(JSON.parse(dom.window.localStorage.getItem(key)));
}
function solutionFor(puzzle) {
  for(const item of bank[puzzle.difficulty])for(const transpose of [false,true])for(const complement of [false,true]) {
    const answer={},givens={};let i=0;
    item.mask.forEach((line,r)=>[...line].forEach((c,col)=>{
      if(c!=='.')return;
      const key=transpose?`${col}-${r}`:`${r}-${col}`;
      answer[key]=complement?10-item.solution[i]:item.solution[i];
      if(item.givens[i])givens[key]=answer[key];i++;
    }));
    if(Object.entries(puzzle.givens).every(([k,v])=>givens[k]===v)&&puzzle.runs.every(run=>run.cells.every(k=>answer[k])&&run.cells.reduce((s,k)=>s+answer[k],0)===run.target))return answer;
  }
  throw Error('No fixture solution matches puzzle.');
}
try {
  await open();
  let puzzle=activePuzzle(), solution=solutionFor(puzzle);
  assert.equal(dom.window.document.querySelectorAll('.cell.entry').length,15);
  const key=$('.cell.selected').dataset.key;
  click('#notes-button');press('3');press('7');
  assert.equal($(`[data-key="${key}"] .value`).textContent,'');
  assert.equal($(`[data-key="${key}"] .cell-notes`).textContent,'37');
  press('n');press('4');assert.equal($(`[data-key="${key}"] .value`).textContent,'4');
  press('Backspace');assert.equal($(`[data-key="${key}"] .value`).textContent,'');
  click('#undo-button');assert.equal($(`[data-key="${key}"] .value`).textContent,'4');
  const given=Object.keys(puzzle.givens)[0];click(`[data-key="${given}"]`);press('9');
  assert.equal($(`[data-key="${given}"] .value`).textContent,String(puzzle.givens[given]));
  click(`[data-key="${key}"]`);press(String(solution[key]%9+1));click('#check-button');await settle();
  assert.ok($(`[data-key="${key}"]`).classList.contains('is-error'));
  click('#hint-button');await settle();
  assert.equal($(`[data-key="${key}"] .value`).textContent,String(solution[key]));
  assert.equal($('#hint-count').textContent,'2 left');
  const state=savedState();dom.window.close();await open(state);
  assert.equal(activePuzzle().variant,puzzle.variant);
  assert.equal($(`[data-key="${key}"] .value`).textContent,String(solution[key]));
  assert.equal($('#hint-count').textContent,'2 left');
  click('#pause-button');assert.equal($('#pause-overlay').hidden,false);
  press('9');assert.equal($(`[data-key="${key}"] .value`).textContent,String(solution[key]));
  click('#resume-button');assert.equal($('#pause-overlay').hidden,true);
  // Arrow navigation also works when a keypad button retains keyboard focus.
  const origin=$('.cell.selected').dataset.key;
  const [originRow,originCol]=origin.split('-').map(Number);
  const next=Object.keys(puzzle.cells).find(k=>puzzle.cells[k].type==='entry'&&puzzle.cells[k].row===originRow&&puzzle.cells[k].col>originCol);
  if(next){$('[data-digit="1"]').focus();$('[data-digit="1"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal($('.cell.selected').dataset.key,next);click(`[data-key="${key}"]`);}
  click('#restart-button');assert.ok($('#confirm-dialog').open);click('#confirm-cancel');
  assert.equal($(`[data-key="${key}"] .value`).textContent,String(solution[key]));
  click('#restart-button');click('#confirm-yes');
  assert.equal($(`[data-key="${key}"] .value`).textContent,'');
  assert.equal($('#hint-count').textContent,'2 left');
  for(const [cell,digit] of Object.entries(solution))if(!puzzle.givens[cell]){click(`[data-key="${cell}"]`);press(String(digit));}
  await settle();assert.ok($('#win-dialog').open);assert.ok($('#board').classList.contains('completed'));
  click('#win-dialog [data-close]');
  click('input[value="medium"]');click('#new-game-button');await settle();
  assert.equal($('#level-badge').textContent,'MEDIUM');
  assert.equal(dom.window.document.querySelectorAll('.cell.entry').length,27);
  click('input[value="hard"]');click('#new-game-button');await settle();
  assert.equal($('#level-badge').textContent,'HARD');
  assert.equal(dom.window.document.querySelectorAll('.cell.entry').length,47);
  click('#help-button');assert.ok($('#help-dialog').open);click('#help-dialog [data-close]');

  // The hint budget survives both reloading and restarting without PHP sessions.
  click('#hint-button');click('#hint-button');click('#hint-button');
  assert.equal($('#hint-count').textContent,'0 left');assert.ok($('#hint-button').disabled);
  let saved=savedState();dom.window.close();await open(saved);
  assert.equal($('#level-badge').textContent,'HARD');
  assert.equal($('#hint-count').textContent,'0 left');
  click('#restart-button');click('#confirm-yes');
  assert.equal($('#hint-count').textContent,'0 left');
  const sameVariant=activePuzzle().variant;click('#new-game-button');
  assert.notEqual(activePuzzle().variant,sameVariant);assert.equal($('#hint-count').textContent,'3 left');

  // Restore notes, elapsed time, and selection; discard damaged individual entries.
  const activeKey=Object.keys(savedState()).find(k=>k.startsWith('kakuro:v2:'));
  assert.equal(activeKey,'kakuro:v2:/Kakuro/');
  const noteKey=$('.cell.selected').dataset.key;
  click('#notes-button');press('2');press('6');
  saved=savedState();
  const record=JSON.parse(saved[activeKey]);record.elapsed=83;record.values['999-999']=9;
  const lockedKey=Object.keys(activePuzzle().givens)[0];record.values[lockedKey]=10;
  saved[activeKey]=JSON.stringify(record);
  dom.window.close();await open(saved);
  assert.equal($('#timer').textContent,'01:23');
  assert.equal($('#notes-button').getAttribute('aria-pressed'),'true');
  assert.equal($('.cell.selected').dataset.key,noteKey);
  assert.equal($(`[data-key="${noteKey}"] .cell-notes`).textContent,'26');
  assert.equal($(`[data-key="${lockedKey}"] .value`).textContent,String(activePuzzle().givens[lockedKey]));

  // A corrupt/incompatible save must never stop a new game from loading.
  for(const bad of ['{broken', 'null', JSON.stringify({version:2,variant:'hard-99-00',bankVersion:record.bankVersion,hintsUsed:0}),JSON.stringify({...record,bankVersion:'obsolete'})]) {
    dom.window.close();await open({[activeKey]:bad});
    assert.equal($('#level-badge').textContent,'EASY');
    assert.equal(dom.window.document.querySelectorAll('.cell.entry').length,15);
  }

  // Project-site saves are isolated, and direct file access works without storage.
  dom.window.close();await open(saved,{url:'https://example.github.io/AnotherGame/'});
  assert.equal($('#level-badge').textContent,'EASY');
  assert.ok(Object.hasOwn(savedState(),'kakuro:v2:/AnotherGame/'));
  dom.window.close();await open({}, {blockStorage:true});
  press('5');assert.equal($('.cell.selected .value').textContent,'5');
  assert.match($('.save-note').textContent,/unavailable/);
  dom.window.close();await open({}, {url:'file:///test/Kakuro/public/index.html'});
  press('4');assert.equal($('.cell.selected .value').textContent,'4');
  click('#check-button');click('#hint-button');
  click('input[value="medium"]');click('#new-game-button');click('#confirm-yes');
  assert.equal($('#level-badge').textContent,'MEDIUM');
  await settle();
  console.log('PASS: all game controls, three difficulties, completion, persistent hints, saved notes/timer, damaged saves, path isolation, and local-file play; zero network requests.');
} finally {dom?.window.close();}
