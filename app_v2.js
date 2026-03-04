
// Geo Trainer V2 — gameplay (compat build v2.0.4, cleaned)
(function(){
  const MODES = ['flag-to-country','capital-to-country','country-to-capital','flag-to-capital'];
  const LB_PREFIX = 'gt.v2.lb.';
  const INIT_FLAG = 'gt.v2.init';
  console.log('[GT] app_v2 compat v2.0.4 loaded');
  try{
    if(!localStorage.getItem(INIT_FLAG)){
      const keys = Object.keys(localStorage);
      for(const k of keys){
        if(k.startsWith('geo.lb.') ||
           k.startsWith('lb.') ||
           k.startsWith('gt.lb.') ||
           k.startsWith('geo.v1.')){
          localStorage.removeItem(k);
        }
      }
      localStorage.setItem(INIT_FLAG, '1');
    }
  }catch(_){ }

  // DOM
  const modeButtons = Array.prototype.slice.call(document.querySelectorAll('.modes button'));
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
  const hudCorrect = document.getElementById('hudCorrect');
  const hudStreak = document.getElementById('hudStreak');
  const hudReveals = document.getElementById('hudReveals');
  const hudMistakes = document.getElementById('hudMistakes');
  const penaltyChipEl = document.getElementById('penaltyChip');

  // State
  var DATA = Array.isArray(window.DATA) ? window.DATA : [];
  var MODE = 'flag-to-country';
  var QUEUE = [];
  var qIndex=0, correct=0, streak=0, bestStreak=0, reveals=0; var revealed=[];
  var startTs=0, tickHandle=null, finished=false; var qShownTs=0;
  var penaltyMs=0; var wrongLog=[]; var runId=null;
  var USED_BY_CLUSTER = {};

  // Helpers
  function toKey(s){ return (s==null? '' : String(s)).trim().toLowerCase().replace(/\s+/g,' '); }
  function asSet(arr){ var s=new Set(); (arr||[]).forEach(function(a){ s.add(toKey(a)); }); return s; }
  function shuffle(a){ var x=a.slice(); for(var i=x.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=x[i]; x[i]=x[j]; x[j]=t; } return x; }
  function fmtMS(ms){ var t=Math.floor(ms/1000); var m=String(Math.floor(t/60)).padStart(2,'0'); var s=String(t%60).padStart(2,'0'); var d=Math.floor((ms%1000)/100); return m+':'+s+'.'+d; }
  function updateRibbonPills(){
    var total = QUEUE.length || 0;
    var current = Math.min(qIndex + (finished ? 0 : 1), Math.max(total, 1));
    var remaining = Math.max(total - (finished ? qIndex : (qIndex + 1)), 0);
    if (hudProgress) hudProgress.textContent = current+'/'+total+' ('+remaining+' left)';
    if (hudCorrect) hudCorrect.textContent = 'Correct: '+correct;
    if (hudStreak) hudStreak.textContent = 'Streak: '+streak+' ('+bestStreak+')';
    if (hudReveals) hudReveals.textContent = 'Reveals: '+reveals;
    if (hudMistakes) hudMistakes.textContent = 'Mistakes ('+wrongLog.length+')';
  }
  function lbKey(mode){ return LB_PREFIX+mode; }
  function loadLB(mode){ try{ return JSON.parse(localStorage.getItem(lbKey(mode))) || []; }catch(e){ return []; } }
  function saveLB(mode,list){ localStorage.setItem(lbKey(mode), JSON.stringify(list)); }
  function addLB(mode, ms, stats){ var item={ ms:ms, when: Date.now(), stats: stats||{} }; var list=loadLB(mode).concat(item).sort(function(a,b){return a.ms-b.ms;}).slice(0,10); saveLB(mode,list); renderLB(mode,item.when); }
  function renderLB(mode, latestWhen){ if(!leaderboardBody) return; var list=loadLB(mode); leaderboardBody.innerHTML=''; list.forEach(function(it,idx){ var tr=document.createElement('tr'); if(latestWhen && it.when===latestWhen) tr.classList.add('latest'); var timeStr = fmtMS(it.ms) + ((it.stats && it.stats.reveals>0)? '*':''); var cells=[ idx+1, timeStr, new Date(it.when).toISOString().slice(0,10), (it.stats&&it.stats.reveals)||0, (it.stats&&it.stats.bestStreak)||0 ]; cells.forEach(function(v){ var td=document.createElement('td'); td.textContent=String(v); tr.appendChild(td); }); leaderboardBody.appendChild(tr); }); }
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
  function answerSetForRow(row, expect){ return expect==='country'? asSet([row.country].concat(row.countryAlt||[])) : asSet([row.capital].concat(row.capitalAlt||[])); }
  function makeQueue(mode, rows){ var q=[]; rows.forEach(function(row){ var countrySet=answerSetForRow(row,'country'); var capitalSet=answerSetForRow(row,'capital'); if(mode==='flag-to-country'){ if(row.flag) q.push({type:mode, flag:row.flag, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, expect:'country', countrySet:countrySet, capitalSet:capitalSet, label:row.country}); } else if(mode==='flag-to-capital'){ if(row.flag) q.push({type:mode, flag:row.flag, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, expect:'capital', countrySet:countrySet, capitalSet:capitalSet, label:row.capital}); } else if(mode==='capital-to-country'){ q.push({type:mode, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, prompt:row.capital, expect:'country', countrySet:countrySet, capitalSet:capitalSet, label:row.country}); } else if(mode==='country-to-capital'){ q.push({type:mode, flagDupGroup:row.flagDupGroup, capDupGroup:row.capDupGroup, prompt:row.country, expect:'capital', countrySet:countrySet, capitalSet:capitalSet, label:row.capital}); } }); return shuffle(q); }
  function buildUnionValidExcludingUsed(q){ var original = (q.expect==='country'? q.countrySet : q.capitalSet); var key = clusterKey(q); if(!key) return { valid: original, rows: [], used:new Set(), key:null, clusterLabel:null }; var rows=[], clusterLabel=null; if(key.indexOf('flagdup::')===0){ var g=key.slice('flagdup::'.length); rows = DATA.filter(function(r){ return toKey(r.flagDupGroup||'')===g; }); clusterLabel=q.flagDupGroup; } else if(key.indexOf('flag::')===0){ var p=key.slice('flag::'.length); rows = DATA.filter(function(r){ return r.flag===p; }); clusterLabel=''; } else if(key.indexOf('capdup::')===0){ var g2=key.slice('capdup::'.length); rows = DATA.filter(function(r){ return toKey(r.capDupGroup||'')===g2; }); clusterLabel=q.capDupGroup; } else if(key.indexOf('cap::')===0){ var cap=key.slice('cap::'.length); rows = DATA.filter(function(r){ return toKey(r.capital)===cap; }); clusterLabel=q.prompt; } var used = USED_BY_CLUSTER[key] || new Set(); var union = new Set(); rows.forEach(function(r){ var ek=entityKeyForRow(r,q.expect); var aset=answerSetForRow(r,q.expect); if(!used.has(ek)){ aset.forEach(function(v){ union.add(v); }); } }); return { valid: (union.size? union : original), rows:rows, used:used, key:key, clusterLabel:clusterLabel };
  }
  function consumeEntityForCluster(q, info, chosenNorm){ if(!info || !info.key) return; var ek=null; for(var i=0;i<info.rows.length;i++){ var r=info.rows[i]; var aset=answerSetForRow(r,q.expect); if(aset.has(chosenNorm)){ ek=entityKeyForRow(r,q.expect); break; } } if(!ek) ek = toKey(q.label); if(!USED_BY_CLUSTER[info.key]) USED_BY_CLUSTER[info.key]=new Set(); USED_BY_CLUSTER[info.key].add(ek); }

  // UI helpers
  function resetCounters(total){ qIndex=0; correct=0; streak=0; reveals=0; bestStreak=0; revealed=[]; finished=false; for(var k in USED_BY_CLUSTER) delete USED_BY_CLUSTER[k]; if(qTotalEl) qTotalEl.textContent=total; updateCounters(); if(revealedBody) revealedBody.innerHTML=''; if(feedback){ feedback.textContent=''; feedback.className='feedback'; } updateRibbonPills(); }
  function updateCounters(){ if(qIndexEl) qIndexEl.textContent=Math.min(qIndex+1, QUEUE.length); if(remainingEl) remainingEl.textContent=Math.max(QUEUE.length - qIndex - (finished?0:1), 0); if(correctEl) correctEl.textContent=correct; if(streakEl) streakEl.textContent=streak; if(bestStreakEl) bestStreakEl.textContent=bestStreak; if(revealsEl) revealsEl.textContent=reveals; updateRibbonPills(); }
  function startTimer(){ startTs=performance.now(); clearInterval(tickHandle); tickHandle=setInterval(function(){ if(timerEl) timerEl.textContent=fmtMS(performance.now()-startTs + penaltyMs); }, 100); }
  function stopTimer(){ clearInterval(tickHandle); tickHandle=null; }
  function renderQuestion(){ var q=QUEUE[qIndex]; if(!q) return; qShownTs=performance.now(); var info = buildUnionValidExcludingUsed(q); if(dupBadge){ if(info && info.rows && info.rows.length>1){ dupBadge.classList.remove('hidden'); dupBadge.textContent = "multiple answers available, don't reuse the same one"; } else { dupBadge.classList.add('hidden'); } } if(q.type==='flag-to-country' || q.type==='flag-to-capital'){ if(flagWrap) flagWrap.classList.remove('hidden'); if(flagImg) flagImg.src=q.flag; if(promptEl) promptEl.textContent = (q.type==='flag-to-country')? 'Which country is this flag?' : "What is the capital of this flag's country?"; } else { if(flagWrap) flagWrap.classList.add('hidden'); if(promptEl){ if(q.type==='capital-to-country') promptEl.innerHTML = 'Capital: <strong>'+q.prompt+'</strong> — which country?'; else promptEl.innerHTML = 'Country: <strong>'+q.prompt+'</strong> — what is the capital?'; } }
    if(input){ input.value=''; input.disabled=false; }
    if(revealBtn) revealBtn.disabled=false;
    if(input) input.focus();
    updateCounters();
  }
  function pushRevealedEntry(q, guessText, displayAnswer){ if(!revealedBody) return; var row = document.createElement('tr'); var tdQ=document.createElement('td'); if(q.type==='flag-to-country' || q.type==='flag-to-capital'){ var img=document.createElement('img'); img.src=q.flag; img.alt=''; img.setAttribute('role','presentation'); img.setAttribute('aria-hidden','true'); tdQ.appendChild(img); } else { tdQ.textContent=q.prompt||''; } var tdA=document.createElement('td'); tdA.textContent=displayAnswer||''; var tdG=document.createElement('td'); tdG.textContent=guessText||''; row.appendChild(tdQ); row.appendChild(tdA); row.appendChild(tdG); revealedBody.prepend(row); }
  function revealCurrent(){ var q=QUEUE[qIndex]; if(!q) return; var corr=q.expect==='country'? Array.from(q.countrySet)[0] : Array.from(q.capitalSet)[0]; var disp=q.label||corr; reveals++; penaltyMs += 5000; var info=buildUnionValidExcludingUsed(q); consumeEntityForCluster(q, info, toKey(q.label)); pushRevealedEntry(q, input.value, disp); if(revealsEl) revealsEl.textContent=reveals; if(penaltyChipEl){ penaltyChipEl.classList.add('show'); setTimeout(function(){ penaltyChipEl.classList.remove('show'); }, 1000); } if(feedback){ feedback.textContent='Revealed (+5s penalty).'; feedback.className='feedback bad'; } updateRibbonPills(); nextQuestion(); }
  function nextQuestion(){ if(finished) return; qIndex++; if(qIndex>=QUEUE.length){ finished=true; stopTimer(); var elapsed=performance.now()-startTs + penaltyMs; addLB(MODE, elapsed, {reveals:reveals, bestStreak:bestStreak}); saveMistakes(MODE); if(feedback){ feedback.textContent='Done — '+fmtMS(elapsed)+'.'; feedback.className='feedback ok'; } if(input) input.disabled=true; if(revealBtn) revealBtn.disabled=true; updateRibbonPills(); return; } renderQuestion(); }
  function submitAnswer(val){ var q=QUEUE[qIndex]; if(!q) return; var info = buildUnionValidExcludingUsed(q); var set = info.valid; var norm = toKey(val); var entity=null; if(info && info.rows && info.rows.length){ for(var i=0;i<info.rows.length;i++){ var r=info.rows[i]; var ek=entityKeyForRow(r,q.expect); var aset=answerSetForRow(r,q.expect); if(aset.has(norm)){ entity=ek; break; } } if(entity && info.used && info.used.has(entity)){ if(feedback){ feedback.textContent='Already used that answer for this set — try its twin.'; feedback.className='feedback bad'; } streak=0; updateCounters(); return; } }
    if(set.has(norm)){
      correct++; streak++; bestStreak=Math.max(bestStreak, streak);
      if(feedback){ feedback.textContent='Correct.'; feedback.className='feedback ok'; }
      consumeEntityForCluster(q, info, norm); updateRibbonPills(); nextQuestion();
    } else {
      wrongLog.push({ type:q.type, prompt:q.prompt||null, flag:q.flag||null, expect:q.expect, correct:q.label||'', guess:val||'', when: Date.now() });
      saveMistakesDraft(MODE);
      if(hudMistakes) hudMistakes.textContent = 'Mistakes ('+wrongLog.length+')';
      if(feedback){ feedback.textContent='Not quite.'; feedback.className='feedback bad'; }
      streak=0; updateCounters();
    }
  }
  function saveMistakes(mode){ try{ var payload = { mode:mode, when: Date.now(), runId: runId, items: wrongLog }; localStorage.setItem('gt.v2.mistakes.latest', JSON.stringify(payload)); localStorage.setItem('gt.v2.mistakes.'+mode+'.latest', JSON.stringify(payload)); }catch(_){ } }
  function saveMistakesDraft(mode){ try{ var payload = { mode:mode, when: Date.now(), runId: runId, items: wrongLog }; localStorage.setItem('gt.v2.mistakes.draft', JSON.stringify(payload)); localStorage.setItem('gt.v2.mistakes.'+mode+'.draft', JSON.stringify(payload)); }catch(_){ } }

  // Events
  if(form) form.addEventListener('submit', function(e){ e.preventDefault(); if(!finished) submitAnswer(input.value); });
  if(revealBtn) revealBtn.addEventListener('click', function(){ if(!finished) revealCurrent(); });
  if(newGameBtn) newGameBtn.addEventListener('click', function(){ startGame(MODE); });
  modeButtons.forEach(function(btn){ btn.addEventListener('click', function(){ modeButtons.forEach(function(b){ b.classList.remove('active'); }); btn.classList.add('active'); MODE=btn.getAttribute('data-mode'); startGame(MODE); }); });
  if(clearLbBtn) clearLbBtn.addEventListener('click', function(){ localStorage.removeItem(lbKey(MODE)); renderLB(MODE); });
  document.addEventListener('keydown', function(e){ var k=e.key?e.key.toLowerCase():''; if(k==='r' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); if(!finished) revealCurrent(); }});

  function startGame(mode){
    QUEUE=makeQueue(mode, DATA);
    penaltyMs=0; wrongLog=[]; runId=Date.now();
    try{ localStorage.removeItem('gt.v2.mistakes.draft'); }catch(_){ }
    if(hudMistakes) hudMistakes.textContent='Mistakes (0)';
    resetCounters(QUEUE.length); renderLB(mode); renderQuestion(); startTimer();
  }

  var m = new URLSearchParams(location.search).get('mode'); if(m && MODES.indexOf(m)>=0) MODE=m; var btn = document.querySelector('.modes button[data-mode="'+MODE+'"]'); if(btn){ btn.classList.add('active'); }
  startGame(MODE);
})();
