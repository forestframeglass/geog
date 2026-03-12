// Geography Trainer – Quiz runtime (app.js)
// Clean rebuild with global leaderboard support, name prompt, and Supabase Edge Functions integration.
// ------------------------------------------------------------
// IMPORTANT: Before deploying, set SUPABASE_PUB to your project's **Anon (legacy) JWT key**
// (Settings → API → Legacy API keys → Anon key). DO NOT use the service_role or the publishable key here.
// ------------------------------------------------------------

(function(){
  'use strict';

  // ====== CONFIG ======
  const SUPABASE_BASE = 'https://nwskrhnzusgnwsvnmbdp.supabase.co';
  const SUPABASE_PUB  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53c2tyaG56dXNnbndzdm5tYmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MDM0NDEsImV4cCI6MjA4ODI3OTQ0MX0.k29I_W8g22XT2InhJvGgeZanonkEuNIV-oVFBBEFvVQ';

  // If you want to disable global submit temporarily, flip this to false
  const ENABLE_GLOBAL = true;

  // ====== DOM HOOKS ======
  const modeButtons = Array.from(document.querySelectorAll('.modes button'));
  const promptEl    = document.getElementById('prompt');
  const dupBadge    = document.getElementById('dupBadge');
  const flagWrap    = document.getElementById('flagWrap');
  const flagImg     = document.getElementById('flagImg');
  const form        = document.getElementById('answerForm');
  const input       = document.getElementById('answerInput');
  const feedback    = document.getElementById('feedback');
  const revealBtn   = document.getElementById('revealBtn');
  const newGameBtn  = document.getElementById('newGame');
  const qIndexEl    = document.getElementById('qIndex');
  const qTotalEl    = document.getElementById('qTotal');
  const remainingEl = document.getElementById('remaining');
  const correctEl   = document.getElementById('correct');
  const streakEl    = document.getElementById('streak');
  const bestStreakEl= document.getElementById('bestStreak');
  const revealsEl   = document.getElementById('reveals');
  const timerEl     = document.getElementById('timer');
  const revealedBody= document.getElementById('revealedBody');
  const leaderboardBody = document.getElementById('leaderboardBody');
  const clearLbBtn  = document.getElementById('clearLeaderboard');
  const hudProgress = document.getElementById('hudProgress');
  const hudCorrect  = document.getElementById('hudCorrect');
  const hudStreak   = document.getElementById('hudStreak');
  const hudReveals  = document.getElementById('hudReveals');
  const hudMistakes = document.getElementById('hudMistakes');
  const penaltyChipEl = document.getElementById('penaltyChip');

  // ====== STATE ======
  const DATA = Array.isArray(window.DATA) ? window.DATA : [];
  const MODES = ['flag-to-country','capital-to-country','country-to-capital','flag-to-capital'];
  const LB_PREFIX = 'gt.v2.lb.';

  let MODE = 'flag-to-country';
  let QUEUE = [];
  let qIndex = 0, correct = 0, streak = 0, bestStreak = 0, reveals = 0;
  let revealed = [];
  let startTs = 0, tickHandle = null, finished = false;
  let penaltyMs = 0; let wrongLog = []; let runId = null;
  let START_TOKEN = null; // minted per run for global submit

  // ====== UTILS ======
  const toKey = s => (s==null? '': String(s)).trim().toLowerCase().replace(/\s+/g,' ');
  const asSet = arr => { const s=new Set(); (arr||[]).forEach(a=>s.add(toKey(a))); return s; };
  const shuffle = a => { const x=a.slice(); for(let i=x.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [x[i],x[j]]=[x[j],x[i]];} return x; };
  const fmtMS = (ms)=>{ const t=Math.floor(ms/1000); const m=String(Math.floor(t/60)).padStart(2,'0'); const s=String(t%60).padStart(2,'0'); const d=Math.floor((ms%1000)/100); return `${m}:${s}.${d}`; };

  function lbKey(mode){ return LB_PREFIX+mode; }
  function loadLB(mode){ try{ return JSON.parse(localStorage.getItem(lbKey(mode)))||[]; }catch{ return []; } }
  function saveLB(mode,list){ localStorage.setItem(lbKey(mode), JSON.stringify(list)); }
  function addLB(mode, ms, stats){ const item={ ms, when: Date.now(), stats:stats||{} }; const list=loadLB(mode).concat(item).sort((a,b)=>a.ms-b.ms).slice(0,10); saveLB(mode,list); renderLB(mode,item.when); }
  function renderLB(mode, latestWhen){ if(!leaderboardBody) return; const list=loadLB(mode); leaderboardBody.innerHTML=''; list.forEach((it,i)=>{ const tr=document.createElement('tr'); if(latestWhen && it.when===latestWhen) tr.classList.add('latest'); const timeStr = fmtMS(it.ms) + ((it.stats && it.stats.reveals>0)? '*':''); const cells=[ i+1, timeStr, new Date(it.when).toISOString().slice(0,10), (it.stats&&it.stats.reveals)||0, (it.stats&&it.stats.bestStreak)||0 ]; cells.forEach(v=>{ const td=document.createElement('td'); td.textContent=String(v); tr.appendChild(td); }); leaderboardBody.appendChild(tr); }); }

  function answerSetForRow(row, expect){ return expect==='country' ? asSet([row.country].concat(row.countryAlt||[])) : asSet([row.capital].concat(row.capitalAlt||[])); }
  function makeQueue(mode, rows){ const q=[]; rows.forEach(row=>{ const countrySet=answerSetForRow(row,'country'); const capitalSet=answerSetForRow(row,'capital'); if(mode==='flag-to-country'){ if(row.flag) q.push({type:mode, flag:row.flag, expect:'country', countrySet, capitalSet, label:row.country}); } else if(mode==='flag-to-capital'){ if(row.flag) q.push({type:mode, flag:row.flag, expect:'capital', countrySet, capitalSet, label:row.capital}); } else if(mode==='capital-to-country'){ q.push({type:mode, prompt:row.capital, expect:'country', countrySet, capitalSet, label:row.country}); } else if(mode==='country-to-capital'){ q.push({type:mode, prompt:row.country, expect:'capital', countrySet, capitalSet, label:row.capital}); } }); return shuffle(q); }

  function updateHUD(){ const total = QUEUE.length||0; const current = Math.min(qIndex + (finished?0:1), Math.max(total,1)); const remaining=Math.max(total - (finished? qIndex : (qIndex+1)),0); if(hudProgress) hudProgress.textContent = `${current}/${total} (${remaining} left)`; if(hudCorrect) hudCorrect.textContent = `Correct: ${correct}`; if(hudStreak) hudStreak.textContent = `Streak: ${streak} (${bestStreak})`; if(hudReveals) hudReveals.textContent = `Reveals: ${reveals}`; if(hudMistakes) hudMistakes.textContent = `Mistakes (${wrongLog.length})`; if(qIndexEl) qIndexEl.textContent = Math.min(qIndex+1, QUEUE.length); if(remainingEl) remainingEl.textContent = Math.max(QUEUE.length - qIndex - (finished?0:1), 0); if(correctEl) correctEl.textContent = correct; if(streakEl) streakEl.textContent = streak; if(bestStreakEl) bestStreakEl.textContent = bestStreak; if(revealsEl) revealsEl.textContent = reveals; }

  function startTimer(){ startTs=performance.now(); clearInterval(tickHandle); tickHandle=setInterval(()=>{ if(timerEl) timerEl.textContent = fmtMS(performance.now()-startTs + penaltyMs); }, 100); }
  function stopTimer(){ clearInterval(tickHandle); tickHandle=null; }

  function renderQuestion(){ const q=QUEUE[qIndex]; if(!q) return; if(dupBadge) dupBadge.classList.add('hidden'); if(q.type==='flag-to-country' || q.type==='flag-to-capital'){ if(flagWrap) flagWrap.classList.remove('hidden'); if(flagImg) flagImg.src=q.flag; if(promptEl) promptEl.textContent = (q.type==='flag-to-country')? 'Which country is this flag?' : "What is the capital of this flag's country?"; } else { if(flagWrap) flagWrap.classList.add('hidden'); if(promptEl){ if(q.type==='capital-to-country') promptEl.innerHTML = 'Capital: <strong>'+q.prompt+'</strong> — which country?'; else promptEl.innerHTML = 'Country: <strong>'+q.prompt+'</strong> — what is the capital?'; } }
    if(input){ input.value=''; input.disabled=false; input.focus(); }
    if(revealBtn) revealBtn.disabled=false; updateHUD(); }

  function pushRevealedEntry(q, guessText, displayAnswer){ if(!revealedBody) return; const row=document.createElement('tr'); const tdQ=document.createElement('td'); if(q.type==='flag-to-country' || q.type==='flag-to-capital'){ const img=document.createElement('img'); img.src=q.flag; img.alt=''; tdQ.appendChild(img); } else { tdQ.textContent=q.prompt||''; } const tdA=document.createElement('td'); tdA.textContent=displayAnswer||''; const tdG=document.createElement('td'); tdG.textContent=guessText||''; row.appendChild(tdQ); row.appendChild(tdA); row.appendChild(tdG); revealedBody.prepend(row); }

  function revealCurrent(){ const q=QUEUE[qIndex]; if(!q) return; const disp=q.label||''; reveals++; penaltyMs += 5000; pushRevealedEntry(q, input?input.value:'', disp); if(revealsEl) revealsEl.textContent=reveals; if(penaltyChipEl){ penaltyChipEl.classList.add('show'); setTimeout(()=> penaltyChipEl.classList.remove('show'), 1000); } if(feedback){ feedback.textContent='Revealed (+5s penalty).'; feedback.className='feedback bad'; } updateHUD(); nextQuestion(); }

  function submitAnswer(val){ const q=QUEUE[qIndex]; if(!q) return; const set = (q.expect==='country'? q.countrySet : q.capitalSet); const norm = toKey(val); if(set.has(norm)){ correct++; streak++; bestStreak = Math.max(bestStreak, streak); if(feedback){ feedback.textContent='Correct.'; feedback.className='feedback ok'; } updateHUD(); nextQuestion(); } else { wrongLog.push({ type:q.type, prompt:q.prompt||null, flag:q.flag||null, expect:q.expect, correct:q.label||'', guess:val||'', when:Date.now() }); if(hudMistakes) hudMistakes.textContent = `Mistakes (${wrongLog.length})`; if(feedback){ feedback.textContent='Not quite.'; feedback.className='feedback bad'; } streak=0; updateHUD(); } }

  // ====== NAME handling ======
  function getStoredPlayerName(){ return (localStorage.getItem('gt.v2.playerName')||'').trim(); }
  function setStoredPlayerName(name){ localStorage.setItem('gt.v2.playerName', (name||'').trim()); }
  function askPlayerName(){ let name = getStoredPlayerName(); if(!name){ name = (prompt('Enter your name for the global leaderboard:', '')||'').trim(); if(name) setStoredPlayerName(name); } return name; }

  // ====== SUPABASE calls ======
  async function getStartToken(mode){
    if(!ENABLE_GLOBAL) return null;
    if(!SUPABASE_PUB || SUPABASE_PUB.indexOf('.')<0){ console.warn('[GT] Missing/invalid ANON JWT for functions call'); return null; }
    const r = await fetch(`${SUPABASE_BASE}/functions/v1/token?mode=${encodeURIComponent(mode)}` ,{
      method:'GET',
      headers:{ 'Authorization': `Bearer ${SUPABASE_PUB}`, 'Content-Type':'application/json' },
      mode:'cors', credentials:'omit'
    });
    if(!r.ok){ console.warn('[GT] token fetch failed', r.status); return null; }
    const j = await r.json();
    return j && j.token || null;
  }

  function submitGlobalResult(name, mode, elapsedMs, stats){
    if(!ENABLE_GLOBAL) return;
    if(!name) return;
    if(!START_TOKEN){ console.warn('[GT] missing start token; skipping global submit'); return; }
    if(!navigator.onLine) return;
    fetch(`${SUPABASE_BASE}/functions/v1/submit`,{
      method:'POST',
      headers:{ 'Authorization': `Bearer ${SUPABASE_PUB}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ token: START_TOKEN, name, mode, ms: Math.floor(elapsedMs), stats })
    }).catch(()=>{});
  }

  // ====== GAME FLOW ======
  function resetCounters(total){ qIndex=0; correct=0; streak=0; reveals=0; bestStreak=0; revealed=[]; finished=false; if(qTotalEl) qTotalEl.textContent=total; if(revealedBody) revealedBody.innerHTML=''; if(feedback){ feedback.textContent=''; feedback.className='feedback'; } updateHUD(); }

  function nextQuestion(){ if(finished) return; qIndex++; if(qIndex>=QUEUE.length){ finished = true; stopTimer(); const elapsed = performance.now()-startTs + penaltyMs; addLB(MODE, elapsed, {reveals, bestStreak}); try{ const name=askPlayerName(); if(name) submitGlobalResult(name, MODE, elapsed, {reveals, bestStreak}); }catch(_){} if(feedback){ feedback.textContent='Done — '+fmtMS(elapsed)+'.'; feedback.className='feedback ok'; } if(input) input.disabled=true; if(revealBtn) revealBtn.disabled=true; updateHUD(); return; } renderQuestion(); }

  function startGame(mode){ MODE=mode; QUEUE = makeQueue(mode, DATA); penaltyMs=0; wrongLog=[]; runId=Date.now(); if(hudMistakes) hudMistakes.textContent='Mistakes (0)'; resetCounters(QUEUE.length); renderLB(MODE); renderQuestion(); startTimer(); START_TOKEN=null; getStartToken(mode).then(t=>{ START_TOKEN=t; }).catch(()=>{}); }

  // ====== EVENTS ======
  if(form) form.addEventListener('submit', (e)=>{ e.preventDefault(); if(!finished) submitAnswer(input.value); });
  if(revealBtn) revealBtn.addEventListener('click', ()=>{ if(!finished) revealCurrent(); });
  if(newGameBtn) newGameBtn.addEventListener('click', ()=> startGame(MODE));
  modeButtons.forEach(btn=> btn.addEventListener('click', ()=>{ modeButtons.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); const m=btn.getAttribute('data-mode'); if(MODES.includes(m)) startGame(m); }));
  if(clearLbBtn) clearLbBtn.addEventListener('click', ()=>{ localStorage.removeItem(lbKey(MODE)); renderLB(MODE); });

  // ====== INIT ======
  const urlMode = new URLSearchParams(location.search).get('mode');
  if(urlMode && MODES.includes(urlMode)) MODE=urlMode;
  const btn = document.querySelector(`.modes button[data-mode="${MODE}"]`); if(btn) btn.classList.add('active');
  console.log('[GT] app.js loaded');
  startGame(MODE);
})();
