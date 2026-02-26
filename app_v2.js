
// Geo Trainer V2 — gameplay
// Notes: case-insensitive only; no extra aliasing beyond provided Alt columns.

(function(){
  const MODES = ['flag-to-country','capital-to-country','country-to-capital','flag-to-capital'];
  const LB_PREFIX = 'gt.v2.lb.';   // fresh namespace for V2
  const INIT_FLAG = 'gt.v2.init';   // one-time wipe flag

  // One-time: wipe any old leaderboards (V1 keys, older experiments)
  try{
    if(!localStorage.getItem(INIT_FLAG)){
      const keys = Object.keys(localStorage);
      for(const k of keys){
        if(k.startsWith('geo.lb.') || k.startsWith('lb.') || k.startsWith('gt.lb.') || k.startsWith('geo.v1.') ){
          localStorage.removeItem(k);
        }
      }
      localStorage.setItem(INIT_FLAG, '1');
    }
  }catch(e){}

  // DOM
  const modeButtons = [...document.querySelectorAll('.modes button')];
  const promptEl = document.getElementById('prompt');
  const dupBadge = document.getElementById('dupBadge');
  const flagWrap = document.getElementById('flagWrap');
  const flagImg = document.getElementById('flagImg');
  const form = document.getElementById('answerForm');
  const input = document.getElementById('answerInput');
  const feedback = document.getElementById('feedback');
  const revealBtn = document.getElementById('revealBtn');
  const newGameBtn = document.getElementById('newGame');
  const qIndexEl = document.getElementById('qIndex');
  const qTotalEl = document.getElementById('qTotal');
  const remainingEl = document.getElementById('remaining');
  const correctEl = document.getElementById('correct');
  const streakEl = document.getElementById('streak');
  const bestStreakEl = document.getElementById('bestStreak');
  const revealsEl = document.getElementById('reveals');
  const timerEl = document.getElementById('timer');
  const revealedBody = document.getElementById('revealedBody');
  const leaderboardBody = document.getElementById('leaderboardBody');
  const clearLbBtn = document.getElementById('clearLeaderboard');
  const hudProgress = document.getElementById('hudProgress');
const hudCorrect  = document.getElementById('hudCorrect');
const hudStreak   = document.getElementById('hudStreak');
const hudReveals  = document.getElementById('hudReveals');

  // State
  let DATA = window.DATA || [];
  let MODE = 'flag-to-country';
  let QUEUE = [];
  let qIndex=0, correct=0, streak=0, bestStreak=0, reveals=0; let revealed=[];
  let startTs=0, tickHandle=null, finished=false; let qShownTs=0;

  const USED_BY_CLUSTER = {}; // anti-reuse per duplicate group

  // Helpers
  function toKey(s){ return (s||'').toString().trim().toLowerCase().replace(/\s+/g,' '); }
  function asSet(arr){ const s=new Set(); for(const a of (arr||[])) s.add(toKey(a)); return s; }
  function shuffle(a){ const x=a.slice(); for(let i=x.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [x[i],x[j]]=[x[j],x[i]]; } return x; }
  function fmtMS(ms){ const t=Math.floor(ms/1000); const m=String(Math.floor(t/60)).padStart(2,'0'); const s=String(t%60).padStart(2,'0'); const d=Math.floor((ms%1000)/100); return `${m}:${s}.${d}`; }

  function lbKey(mode){ return LB_PREFIX+mode; }
  function loadLB(mode){ try{ return JSON.parse(localStorage.getItem(lbKey(mode)))||[]; }catch{return [];} }
  function saveLB(mode,list){ localStorage.setItem(lbKey(mode), JSON.stringify(list)); }
  function addLB(mode, ms, stats){ const item={ ms, when: Date.now(), stats}; const list=loadLB(mode).concat(item).sort((a,b)=>a.ms-b.ms).slice(0,10); saveLB(mode,list); renderLB(mode,item.when); }
  function renderLB(mode, latestWhen){ const list=loadLB(mode); if(leaderboardBody) leaderboardBody.innerHTML=''; list.forEach((it,idx)=>{ const tr=document.createElement('tr'); if(latestWhen && it.when===latestWhen) tr.classList.add('latest');
    const tds=[idx+1, fmtMS(it.ms), new Date(it.when).toISOString().slice(0,10), it.stats.reveals, it.stats.bestStreak||0].map(v=>{const td=document.createElement('td'); td.textContent=String(v); return td;});
    tds.forEach(td=>tr.appendChild(td)); leaderboardBody.appendChild(tr); }); }

  function clusterKey(q){
    if(q.type==='flag-to-country' || q.type==='flag-to-capital'){
      if(q.flagDupGroup) return 'flagdup::'+toKey(q.flagDupGroup);
      if(q.flag) return 'flag::'+q.flag;
    }
    if(q.type==='capital-to-country'){
      if(q.capDupGroup) return 'capdup::'+toKey(q.capDupGroup);
      if(q.prompt) return 'cap::'+toKey(q.prompt);
    }
    return null;
  }
  function entityKeyForRow(row, expect){ return expect==='country'? toKey(row.country) : toKey(row.capital); }
  function answerSetForRow(row, expect){ return expect==='country'? asSet([row.country, ...(row.countryAlt||[])]) : asSet([row.capital, ...(row.capitalAlt||[])]); }

  function makeQueue(mode, rows){
    const q=[];
    for(const row of rows){
      const countrySet=answerSetForRow(row,'country');
      const capitalSet=answerSetForRow(row,'capital');
      if(mode==='flag-to-country'){
        if(row.flag) q.push({type:mode, flag:row.flag, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, expect:'country', countrySet, capitalSet, label:row.country});
      } else if(mode==='flag-to-capital'){
        if(row.flag) q.push({type:mode, flag:row.flag, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, expect:'capital', countrySet, capitalSet, label:row.capital});
      } else if(mode==='capital-to-country'){
        q.push({type:mode, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, prompt:row.capital, expect:'country', countrySet, capitalSet, label:row.country});
      } else if(mode==='country-to-capital'){
        q.push({type:mode, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, prompt:row.country, expect:'capital', countrySet, capitalSet, label:row.capital});
      }
    }
    return shuffle(q);
  }

  function buildUnionValidExcludingUsed(q){
    const original = (q.expect==='country'? q.countrySet : q.capitalSet);
    const key = clusterKey(q);
    if(!key) return { valid: original, rows: [], used:new Set(), key:null, clusterLabel:null };
    let rows=[]; let clusterLabel=null;
    if(key.startsWith('flagdup::')){ const g=key.slice('flagdup::'.length); rows = DATA.filter(r=> toKey(r.flagDupGroup||'')===g); clusterLabel=q.flagDupGroup; }
    else if(key.startsWith('flag::')){ const p=key.slice('flag::'.length); rows = DATA.filter(r=> r.flag===p); clusterLabel=''; }
    else if(key.startsWith('capdup::')){ const g=key.slice('capdup::'.length); rows = DATA.filter(r=> toKey(r.capDupGroup||'')===g); clusterLabel=q.capDupGroup; }
    else if(key.startsWith('cap::')){ const cap=key.slice('cap::'.length); rows = DATA.filter(r=> toKey(r.capital)===cap); clusterLabel=q.prompt; }
    const used = USED_BY_CLUSTER[key] || new Set();
    const union = new Set();
    for(const r of rows){ const ek=entityKeyForRow(r,q.expect); const aset=answerSetForRow(r,q.expect); if(!used.has(ek)){ for(const v of aset) union.add(v); } }
    return { valid: (union.size? union : original), rows, used, key, clusterLabel };
  }
  function consumeEntityForCluster(q, info, chosenNorm){
    if(!info || !info.key) return;
    let ek=null; for(const r of info.rows){ const aset=answerSetForRow(r,q.expect); if(aset.has(chosenNorm)){ ek=entityKeyForRow(r,q.expect); break; } }
    if(!ek) ek = toKey(q.label);
    USED_BY_CLUSTER[info.key] = USED_BY_CLUSTER[info.key] || new Set();
    USED_BY_CLUSTER[info.key].add(ek);
  }
function updateRibbonPills(){
  const total = QUEUE.length || 0;
  // current question index is 1-based for display; cap at total if finished
  const current = Math.min(qIndex + (finished ? 0 : 1), Math.max(total, 1));
  const remaining = Math.max(total - (finished ? qIndex : (qIndex + 1)), 0);

  if (hudProgress) hudProgress.textContent = `${current}/${total} (${remaining} left)`;
  if (hudCorrect)  hudCorrect.textContent  = `Correct: ${correct}`;
  if (hudStreak)   hudStreak.textContent   = `Streak: ${streak} (${bestStreak})`;
  if (hudReveals)  hudReveals.textContent  = `Reveals: ${reveals}`;
}
  // UI helpers
  function resetCounters(total){ qIndex=0; correct=0; streak=0; reveals=0; bestStreak=0; revealed=[]; finished=false; for(const k in USED_BY_CLUSTER) delete USED_BY_CLUSTER[k]; qTotalEl.textContent=total; updateCounters(); revealedBody.innerHTML=''; feedback.textContent=''; feedback.className='feedback';  updateRibbonPills();   }
  function updateCounters(){ qIndexEl.textContent=Math.min(qIndex+1, QUEUE.length); remainingEl.textContent=Math.max(QUEUE.length - qIndex - (finished?0:1), 0); correctEl.textContent=correct; streakEl.textContent=streak; bestStreakEl.textContent=bestStreak; revealsEl.textContent=reveals;   updateRibbonPills();  }
  function startTimer(){ startTs=performance.now(); clearInterval(tickHandle); tickHandle=setInterval(()=>{ timerEl.textContent=fmtMS(performance.now()-startTs); }, 100); }
  function stopTimer(){ clearInterval(tickHandle); tickHandle=null; }

  function renderQuestion(){ const q=QUEUE[qIndex]; if(!q) return; qShownTs=performance.now();
    const info = buildUnionValidExcludingUsed(q);
    if(info && info.rows && info.rows.length>1){ dupBadge.classList.remove('hidden'); dupBadge.textContent = "multiple answers available, don't reuse the same one"; }
    else dupBadge.classList.add('hidden');

    if(q.type==='flag-to-country' || q.type==='flag-to-capital'){
      flagWrap.classList.remove('hidden'); flagImg.src=q.flag; flagImg.alt='Flag';
      promptEl.textContent = (q.type==='flag-to-country')? 'Which country is this flag?' : "What is the capital of this flag's country?";
    } else {
      flagWrap.classList.add('hidden');
      if(q.type==='capital-to-country') promptEl.innerHTML = `Capital: <strong>${q.prompt}</strong> — which country?`;
      else promptEl.innerHTML = `Country: <strong>${q.prompt}</strong> — what is the capital?`;
    }
    input.value=''; input.disabled=false; revealBtn.disabled=false; input.focus(); updateCounters();
  }

  function pushRevealedEntry(q, guessText, displayAnswer){
    const row = document.createElement('tr');
    const tdQ=document.createElement('td');
    if(q.type==='flag-to-country' || q.type==='flag-to-capital'){
      const img=document.createElement('img'); img.src=q.flag; img.alt='Flag'; tdQ.appendChild(img);
    } else tdQ.textContent=q.prompt||'';
    const tdA=document.createElement('td'); tdA.textContent=displayAnswer||'';
    const tdG=document.createElement('td'); tdG.textContent=guessText||'';
    row.appendChild(tdQ); row.appendChild(tdA); row.appendChild(tdG);
    revealedBody.prepend(row);
  }

  function revealCurrent(){ const q=QUEUE[qIndex]; if(!q) return; const corr=q.expect==='country'?[...q.countrySet][0]:[...q.capitalSet][0]; const disp=q.label||corr; reveals++; const info=buildUnionValidExcludingUsed(q); consumeEntityForCluster(q, info, toKey(q.label)); pushRevealedEntry(q, input.value, disp); revealsEl.textContent=reveals; nextQuestion(); }

  function nextQuestion(){ if(finished) return; qIndex++; if(qIndex>=QUEUE.length){ finished=true; stopTimer(); const elapsed=performance.now()-startTs; addLB(MODE, elapsed, {reveals, bestStreak}); feedback.textContent=`Done — ${fmtMS(elapsed)}.`; feedback.className='feedback ok'; input.disabled=true; revealBtn.disabled=true; return; } renderQuestion(); }

  function submitAnswer(val){ const q=QUEUE[qIndex]; if(!q) return; const info = buildUnionValidExcludingUsed(q); const set = info.valid; const norm = toKey(val);
    let entity=null; if(info && info.rows && info.rows.length){ for(const r of info.rows){ const ek=entityKeyForRow(r,q.expect); const aset=answerSetForRow(r,q.expect); if(aset.has(norm)){ entity=ek; break; } } if(entity && info.used && info.used.has(entity)){ feedback.textContent='Already used that answer for this set — try its twin.'; feedback.className='feedback bad'; streak=0; updateCounters(); return; } }
    if(set.has(norm)){
      correct++; streak++; bestStreak=Math.max(bestStreak, streak);
      feedback.textContent='Correct.'; feedback.className='feedback ok';
      consumeEntityForCluster(q, info, norm); nextQuestion();
    } else {
      feedback.textContent='Not quite.'; feedback.className='feedback bad'; streak=0; updateCounters();
    }
  }

  // Events
  form.addEventListener('submit', e=>{ e.preventDefault(); if(!finished) submitAnswer(input.value); });
  revealBtn.addEventListener('click', ()=>{ if(!finished) revealCurrent(); });
  newGameBtn.addEventListener('click', ()=> startGame(MODE));
  modeButtons.forEach(btn=> btn.addEventListener('click', ()=>{ modeButtons.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); MODE=btn.dataset.mode; startGame(MODE); }));
  clearLbBtn.addEventListener('click', ()=>{ localStorage.removeItem(lbKey(MODE)); renderLB(MODE); });
  document.addEventListener('keydown', e=>{ const k=e.key?e.key.toLowerCase():''; if(k==='r' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); if(!finished) revealCurrent(); }});

  function startGame(mode){ QUEUE=makeQueue(mode, DATA); resetCounters(QUEUE.length); renderLB(mode); renderQuestion(); startTimer(); }
  // Start with default or query param
  const m = new URLSearchParams(location.search).get('mode'); if(m && MODES.includes(m)) MODE=m;
  const btn = document.querySelector(`.modes button[data-mode="${MODE}"]`); if(btn){ btn.classList.add('active'); }
  startGame(MODE);
})();
.counts { display: none; }
