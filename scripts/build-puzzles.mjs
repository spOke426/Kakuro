// Development-only puzzle builder. Every stored board is checked for uniqueness.
import fs from 'node:fs';
const ALL = 511;
const bits = m => { const a=[]; for(let d=1;d<=9;d++) if(m & (1 << (d-1))) a.push(d); return a; };
const pop = m => bits(m).length;
const sum = m => bits(m).reduce((a,b)=>a+b,0);
const combinations = new Map();
for(let m=1;m<=ALL;m++) { const key=`${pop(m)}:${sum(m)}`; if(!combinations.has(key)) combinations.set(key,[]); combinations.get(key).push(m); }
const shuffle = a => { for(let i=a.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
function structure(mask) {
  if (!mask.length || mask.some(row => row.length !== mask.length || !/^[#.]+$/.test(row)) || mask[0].includes('.') || mask.some(row => row[0] !== '#')) throw Error('Invalid square board mask or clue border.');
  const cells=[], runs=[], memberships=[];
  for(let r=0;r<mask.length;r++) for(let c=0;c<mask[0].length;c++) if(mask[r][c]==='.') cells.push([r,c]);
  const ids = new Map(cells.map(([r,c],i)=>[`${r},${c}`,i]));
  for(const [r,c] of cells) for(const [dr,dc] of [[0,1],[1,0]]) {
    if(ids.has(`${r-dr},${c-dc}`)) continue;
    const members=[]; let y=r,x=c;
    while(ids.has(`${y},${x}`)) {members.push(ids.get(`${y},${x}`));y+=dr;x+=dc;}
    if(members.length<2 || members.length>9) throw Error(`Invalid run ${r},${c}: ${members.length}`);
    const index=runs.length; runs.push({cells:members,direction:dr?'down':'across',row:r-dr,col:c-dc});
    for(const id of members) (memberships[id]??=[]).push(index);
  }
  return {cells,runs,memberships};
}
function randomFill(board) {
  const values=Array(board.cells.length).fill(0),used=Array(board.runs.length).fill(0);
  function search() {
    let chosen=-1, available=0, count=10;
    for(let i=0;i<values.length;i++) if(!values[i]) {
      const mask=ALL & ~board.memberships[i].reduce((a,r)=>a|used[r],0), n=pop(mask);
      if(!n)return false; if(n<count){chosen=i;available=mask;count=n;}
    }
    if(chosen<0)return true;
    for(const digit of shuffle(bits(available))) {
      const bit=1<<(digit-1); values[chosen]=digit;
      for(const r of board.memberships[chosen])used[r]|=bit;
      if(search())return true;
      for(const r of board.memberships[chosen])used[r]^=bit;
      values[chosen]=0;
    }
    return false;
  }
  search(); return values;
}
function solve(board, targets, limit=2, maxNodes=20000, givens={}) {
  let nodes=0,rootUnresolved=0; const solutions=[];
  const combos=board.runs.map((r,i)=>combinations.get(`${r.cells.length}:${targets[i]}`)??[]);
  function propagate(domains) {
    let changed=true;
    while(changed) {
      changed=false;
      for(let ri=0;ri<board.runs.length;ri++) {
        const ids=board.runs[ri].cells, supported=Array(ids.length).fill(0);
        for(const combo of combos[ri]) {
          const order=ids.map((id,i)=>({i,mask:domains[id]&combo})).sort((a,b)=>pop(a.mask)-pop(b.mask));
          if(order.some(o=>!o.mask))continue;
          // Matching proves a combination can be assigned to all cells.
          function matching(k,used,forcedIndex=-1,forcedBit=0) {
            if(k===order.length)return true;
            const o=order[k]; let options=o.mask & ~used;
            if(o.i===forcedIndex) options &= forcedBit;
            else options &= ~forcedBit;
            while(options){const bit=options & -options;options^=bit;if(matching(k+1,used|bit,forcedIndex,forcedBit))return true;}
            return false;
          }
          if(!matching(0,0))continue;
          for(const o of order) {
            let possible=o.mask & ~supported[o.i];
            while(possible){const bit=possible&-possible;possible^=bit;if(matching(0,0,o.i,bit))supported[o.i]|=bit;}
          }
        }
        for(let i=0;i<ids.length;i++) {
          const next=domains[ids[i]]&supported[i]; if(!next)return false;
          if(next!==domains[ids[i]]){domains[ids[i]]=next;changed=true;}
        }
      }
    }
    return true;
  }
  function search(domains) {
    if(++nodes>maxNodes || solutions.length>=limit)return;
    if(!propagate(domains))return;
    if(nodes===1)rootUnresolved=domains.filter(mask=>pop(mask)>1).length;
    let chosen=-1,count=10;
    for(let i=0;i<domains.length;i++){const n=pop(domains[i]);if(n>1&&n<count){chosen=i;count=n;}}
    if(chosen<0){solutions.push(domains.map(m=>bits(m)[0]));return;}
    for(const digit of bits(domains[chosen])){const next=domains.slice();next[chosen]=1<<(digit-1);search(next);if(solutions.length>=limit)return;}
  }
  search(Array.from({length:board.cells.length},(_,i)=>givens[i] ? 1<<(givens[i]-1) : ALL)); return {solutions,nodes,rootUnresolved,complete:nodes<=maxNodes};
}
const masks={
  easy:['######','#..###','#....#','##....','###...','###..#'],
  medium:['########','###..###','###...##','#......#','#..##..#','#......#','##....##','###..###'],
  hard:['##########','###...####','###....###','#...#....#','#...#....#','##..#..###','##..#....#','#....#...#','#....#...#','###..#####'],
  insane:['############','###....#####','###......###','#....#.....#','#....#.....#','##....#.....','##....#.....','#...#......#','#...#......#','###.....#..#','####....####','####..######']
};
const verify=process.argv.includes('--verify');
if(verify) {
  const bank=JSON.parse(fs.readFileSync(new URL('../data/puzzles.json',import.meta.url)));
  let total=0;
  for(const [difficulty,puzzles] of Object.entries(bank)) for(const puzzle of puzzles) {
    const board=structure(puzzle.mask),targets=board.runs.map(r=>r.cells.reduce((s,i)=>s+puzzle.solution[i],0));
    const result=solve(board,targets,2,20000,puzzle.givens??{});
    if(!result.complete||result.solutions.length!==1||JSON.stringify(result.solutions[0])!==JSON.stringify(puzzle.solution))throw Error(`Invalid ${difficulty} puzzle`);
    if(difficulty==='insane'&&(result.nodes<9||result.rootUnresolved<36||Object.keys(puzzle.givens).length>19))throw Error('Insane puzzle does not meet the complexity threshold.');
    if(process.argv.includes('--metrics')) console.log(`${difficulty}: ${board.cells.length} cells, ${Object.keys(puzzle.givens).length} starters, ${result.rootUnresolved} unresolved after propagation, ${result.nodes} search nodes`);
    total++;
  }
  console.log(`PASS: ${total} puzzles have exactly one solution; all runs use 2–9 distinct digits.`);
} else {
  const option=process.argv.indexOf('--difficulty');
  const selected=option<0?null:process.argv[option+1];
  if(option>=0&&!Object.hasOwn(masks,selected))throw Error('Choose a valid difficulty after --difficulty.');
  const bank=selected?JSON.parse(fs.readFileSync(new URL('../data/puzzles.json',import.meta.url))):{};
  for(const [difficulty,mask] of Object.entries(masks)) {
    if(selected&&selected!==difficulty)continue;
    bank[difficulty]=[]; const board=structure(mask); let attempts=0;
    while(bank[difficulty].length<6) {
      if(++attempts>500)throw Error(`Could not find enough ${difficulty} puzzles within 500 candidates.`);
      const solution=randomFill(board), targets=board.runs.map(r=>r.cells.reduce((s,i)=>s+solution[i],0)),givens={};
      let result=solve(board,targets,2,1500,givens);
      while(!result.complete||result.solutions.length!==1) {
        const ambiguous=shuffle(solution.map((_,i)=>i).filter(i=>!givens[i] && (result.solutions.length<2 || result.solutions[0][i]!==result.solutions[1][i])));
        const id=ambiguous[0] ?? solution.findIndex((_,i)=>!givens[i]);
        givens[id]=solution[id]; result=solve(board,targets,2,1500,givens);
      }
      for(const id of shuffle(Object.keys(givens))) {
        const value=givens[id]; delete givens[id]; const check=solve(board,targets,2,1500,givens);
        if(!check.complete||check.solutions.length!==1)givens[id]=value;
      }
      if(difficulty==='insane') {
        const rating=solve(board,targets,2,20000,givens);
        if(!rating.complete||rating.solutions.length!==1||rating.nodes<9||rating.rootUnresolved<36||Object.keys(givens).length>19) {
          if(attempts%5===0)console.log(`insane: searching (${attempts} candidates, ${bank[difficulty].length}/6 accepted)`);
          continue;
        }
      }
      bank[difficulty].push({mask,solution,givens});
      console.log(`${difficulty}: ${bank[difficulty].length}/6 (${Object.keys(givens).length} starter digits)`);
    }
  }
  fs.mkdirSync(new URL('../data/',import.meta.url),{recursive:true});
  fs.writeFileSync(new URL('../data/puzzles.json',import.meta.url),JSON.stringify(bank,null,2)+'\n');
}
