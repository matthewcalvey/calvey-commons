'use strict';
(() => {
  const chapters=JSON.parse(document.getElementById('book-data').textContent);
  const key='nature-architecture-v1';
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch(_){}
  saved.positions ||= {};let active=null,queue=false,queueTimer=null,lastSave=0,lastCue=null;
  const follow=document.getElementById('follow');follow.checked=!!saved.follow;
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify(saved))}catch(_){}};
  const rows=chapters.map((c,i)=>({c,i,el:document.getElementById(c.id),a:document.querySelector(`[data-player="${c.id}"] audio`),player:document.querySelector(`[data-player="${c.id}"]`)}));
  const status=(r,msg)=>r.player.querySelector('.player-status').textContent=msg;
  function remember(r){if(Number.isFinite(r.a.currentTime)){saved.positions[r.c.id]=r.a.currentTime;saved.last=r.c.id;persist();progress(r)}}
  function progress(r){const t=saved.positions[r.c.id]||0;r.el.querySelector('.progress-state').textContent=t>r.c.duration-3?'Finished':t>1?`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')} saved`:'Unplayed'}
  function open(r,read=false){if(matchMedia('(max-width:700px)').matches)rows.forEach(x=>{if(x!==r)x.el.open=false});r.el.open=true;if(read)r.el.querySelector('.reading').open=true}
  function stopQueue(){queue=false;clearTimeout(queueTimer);rows.forEach(r=>{const b=r.player.querySelector('[data-action="all"]');b.textContent='Play from here';b.setAttribute('aria-pressed','false')})}
  async function play(r,t){open(r,follow.checked);if(active&&active!==r){active.a.pause();remember(active)}active=r;if(t!==undefined){if(r.a.readyState<1){r.a.load();await new Promise(resolve=>{r.a.addEventListener('loadedmetadata',resolve,{once:true});r.a.addEventListener('error',resolve,{once:true})})}r.a.currentTime=Math.max(0,Math.min(t,r.c.duration))}try{await r.a.play()}catch(_){status(r,'Tap play to continue')}}
  function media(r){if(!('mediaSession'in navigator))return;navigator.mediaSession.metadata=new MediaMetadata({title:r.c.title,artist:'af_bella',album:'Nature + Architecture'});const handlers={play:()=>play(r),pause:()=>r.a.pause(),seekbackward:d=>r.a.currentTime=Math.max(0,r.a.currentTime-(d.seekOffset||15)),seekforward:d=>r.a.currentTime=Math.min(r.c.duration,r.a.currentTime+(d.seekOffset||30)),seekto:d=>r.a.currentTime=d.seekTime,previoustrack:()=>jump(r,-1),nexttrack:()=>jump(r,1)};for(const [k,v]of Object.entries(handlers)){try{navigator.mediaSession.setActionHandler(k,v)}catch(_){}}}
  function jump(r,delta){const n=rows[r.i+delta];if(n){remember(r);play(n,0)}}
  rows.forEach(r=>{
    const {a,el,player,c}=r;progress(r);a.playbackRate=saved.speed||1;player.querySelector('select').value=a.playbackRate.toFixed(1);
    player.querySelector('[data-action="prev"]').disabled=r.i===0;player.querySelector('[data-action="next"]').disabled=r.i===rows.length-1;
    a.addEventListener('loadedmetadata',()=>{const t=saved.positions[c.id]||0;if(t>0&&t<c.duration-3&&a.currentTime===0)a.currentTime=t});
    a.addEventListener('play',()=>{clearTimeout(queueTimer);rows.forEach(x=>{if(x!==r&&!x.a.paused)x.a.pause()});active=r;saved.last=c.id;persist();open(r,follow.checked);status(r,queue?'Playing in sequence':'Playing');media(r)});
    a.addEventListener('pause',()=>{remember(r);if(!a.ended)status(r,'Paused');if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused'});
    a.addEventListener('error',()=>status(r,'Audio could not load. Try the MP3 download.'));
    a.addEventListener('timeupdate',()=>{
      if(Date.now()-lastSave>1500){remember(r);lastSave=Date.now()}
      const cue=c.cues.find(q=>a.currentTime>=q.start&&a.currentTime<q.end);const node=cue&&document.getElementById(cue.kind==='heading'?cue.section:cue.id);
      if(node!==lastCue){lastCue?.classList.remove('active-cue');lastCue=node;node?.classList.add('active-cue');if(follow.checked&&!a.paused&&node){el.querySelector('.reading').open=true;const bounds=node.getBoundingClientRect();if(bounds.top<player.getBoundingClientRect().bottom||bounds.top>innerHeight*.8)node.scrollIntoView({block:'center',behavior:'auto'})}}
      if('mediaSession'in navigator&&a.duration&&a.currentTime<=a.duration){try{navigator.mediaSession.setPositionState({duration:a.duration,position:a.currentTime,playbackRate:a.playbackRate});navigator.mediaSession.playbackState=a.paused?'paused':'playing'}catch(_){}}
    });
    a.addEventListener('ended',()=>{remember(r);status(r,'Finished');if(queue&&r.i<rows.length-1){status(r,'Next chapter in 2 seconds');queueTimer=setTimeout(()=>play(rows[r.i+1],0),2000)}else if(queue)stopQueue()});
    player.querySelector('select').addEventListener('change',event=>{saved.speed=Number(event.target.value);rows.forEach(x=>{x.a.playbackRate=saved.speed;x.player.querySelector('select').value=saved.speed.toFixed(1)});persist()});
    player.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(!b)return;switch(b.dataset.action){case'back':a.currentTime=Math.max(0,a.currentTime-15);break;case'forward':a.currentTime=Math.min(c.duration,a.currentTime+30);break;case'prev':jump(r,-1);break;case'next':jump(r,1);break;case'all':if(queue){stopQueue();status(r,'Sequence stopped')}else{queue=true;b.textContent='Stop sequence';b.setAttribute('aria-pressed','true');play(r)}break}});
    el.querySelectorAll('[data-seek-section]').forEach(b=>b.addEventListener('click',()=>{const cue=c.cues.find(q=>q.section===b.dataset.seekSection&&q.kind==='heading');if(cue)play(r,cue.start)}));
    el.addEventListener('toggle',()=>{if(el.open&&matchMedia('(max-width:700px)').matches&&!document.body.dataset.expanding)rows.forEach(x=>{if(x!==r)x.el.open=false})});
  });
  follow.addEventListener('change',()=>{saved.follow=follow.checked;persist();if(active&&follow.checked)open(active,true)});
  document.getElementById('expand-all').addEventListener('click',()=>{document.body.dataset.expanding='true';rows.forEach(r=>r.el.open=true);setTimeout(()=>delete document.body.dataset.expanding,100)});
  document.getElementById('collapse-all').addEventListener('click',()=>rows.forEach(r=>r.el.open=false));
  const resume=document.getElementById('resume-book');if(saved.last)resume.textContent='Resume listening';resume.addEventListener('click',()=>{const r=rows.find(x=>x.c.id===saved.last)||rows[0];play(r,saved.positions[r.c.id]||0);r.el.scrollIntoView({block:'start'})});
  function navigateHash(){let id;try{id=decodeURIComponent(location.hash.slice(1))}catch(_){return}if(!id)return;const node=document.getElementById(id);if(!node)return;const r=rows.find(x=>x.el===node||x.el.contains(node));if(r){open(r,node!==r.el);setTimeout(()=>node.scrollIntoView({block:'start'}),30)}}
  window.addEventListener('hashchange',navigateHash);navigateHash();
  window.addEventListener('pagehide',()=>{if(active)remember(active)});
})();
