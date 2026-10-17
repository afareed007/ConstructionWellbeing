const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
const COL={baseline:"var(--base)",ok:"var(--ok)",warn:"var(--warn)",bad:"var(--bad)"};
let state=null,rec=null,events=[],fired=new Set(),live=false;
const v=$("v");

const kindOf=p=>/high|urgent|priority|check/i.test(p||"")?"bad":/elevated|medium|attention|review/i.test(p||"")?"warn":"ok";
function buildEvents(){
  const clips=state.clips.filter(c=>c.recording_id===rec.id);
  const byClip=Object.fromEntries(clips.map(c=>[c.id,c]));
  events=state.analyses.filter(a=>a.recording_id===rec.id&&byClip[a.clip_id]).map(a=>{
    const c=byClip[a.clip_id],r=a.report||{};
    const kind=a.status==="no_reference"?"baseline":(a.report?kindOf(r.review_priority):"baseline");
    return {id:a.id,start:c.offset,end:c.offset+c.duration,at:c.offset+c.duration,track:c.track_id,kind,
      title:kind==="baseline"?`Baseline captured · Track ${c.track_id}`:(r.task_context||a.summary||"Comparison complete"),
      priority:r.review_priority||(kind==="baseline"?"baseline":"routine"),
      changes:r.observable_changes||[],summary:r.human_review_summary||a.summary||"",sim:a.similarity};
  }).map(e=>{if(!(window.WSMode&&WSMode.mode==="detect"))return e;const a=state.analyses.find(x=>x.id===e.id);const k=WSMode.kind(a,rec.filename);return {...e,kind:k==="base"?"baseline":k,title:WSMode.title(a,rec.filename),priority:WSMode.label(a,rec.filename),sim:null,summary:a&&a.report?e.summary:"Window checked; no Cosmos description for this window yet."};}).sort((x,y)=>x.at-y.at);
}
async function load(){
  state=await fetch("/api/state").then(r=>r.json());
  const recs=state.recordings.filter(r=>r.status==="ready").slice().reverse();
  const keep=$("rec").value;
  $("rec").innerHTML=recs.map(r=>`<option value="${r.id}">${esc(r.task||"recording")} · ${esc(r.filename).slice(0,28)}</option>`).join("");
  if(keep&&recs.some(r=>r.id===keep))$("rec").value=keep;
  pickRec();
}
function pickRec(){
  rec=state.recordings.find(r=>r.id===$("rec").value);if(!rec)return;
  buildEvents();reset();
  v.src="/media/"+rec.media_path;$("cam").textContent=(rec.camera||"cam-1").replace("Uploaded camera","cam-1");
}
function setStat(k,val){const el=document.querySelector(`[data-k="${k}"]`);if(el.textContent!==String(val)){el.textContent=val;if(k!=="t"){el.classList.remove("bump");void el.offsetWidth;el.classList.add("bump");}}}
function reset(){
  fired=new Set();$("list").innerHTML='<div class="empty">Events appear here as the footage plays.</div>';
  $("tl").querySelectorAll(".mark").forEach(m=>m.remove());
  const D=rec.duration||10;$("ticks").innerHTML=[0,.25,.5,.75,1].map(f=>`<span>${fmt(f*D)}</span>`).join("");
  ["people","windows","routine","flags"].forEach(k=>setStat(k,0));setStat("t","0:00");$("ph").style.left="0%";
  $("nowtext").className="empty";$("nowtext").textContent=live?"Live. Watching for events…":"Press Go live to replay this camera.";
}
function toast(e){
  const t=document.createElement("div");t.className="toast";t.style.borderLeftColor=COL[e.kind];
  const icon=e.kind==="baseline"?"◎":e.kind==="ok"?"◉":"⚠";
  t.innerHTML=`<b>${icon} ${esc(e.title)}</b><small>${fmt(e.start)}–${fmt(e.end)} · Track ${e.track} · ${esc(e.priority)}${e.sim?` · similarity ${e.sim.toFixed(2)}`:""}</small>`;
  $("toasts").prepend(t);while($("toasts").children.length>4)$("toasts").lastChild.remove();
  setTimeout(()=>t.remove(),e.kind==="baseline"?3500:7000);
}
function show(e){
  $("nowtext").className="";
  $("nowtext").innerHTML=`<h2>${esc(e.title)}</h2><div class="meta">${fmt(e.start)}–${fmt(e.end)} · Track ${e.track} · priority ${esc(e.priority)}${e.sim?` · similarity ${e.sim.toFixed(2)}`:""}</div>`+
    (e.changes.length?`<ul class="obs">${e.changes.map(c=>`<li>${esc(c)}</li>`).join("")}</ul>`:"")+
    (e.summary?`<p class="caption"><b>Cosmos summary:</b> ${esc(e.summary)}</p>`:"");
}
function fire(e){
  fired.add(e.id);
  const D=rec.duration||10,m=document.createElement("div");m.className="mark";
  m.style.cssText=`left:${e.start/D*100}%;width:${Math.max(1,(e.end-e.start)/D*100)}%;background:${COL[e.kind]}`;
  m.title=`${fmt(e.start)} ${e.title}`;m.onclick=()=>show(e);$("tl").appendChild(m);
  const list=$("list");if(list.querySelector(".empty"))list.innerHTML="";
  const b=document.createElement("button");b.className="item";
  b.innerHTML=`<span class="sev k-${e.kind}"></span><span><h3>${esc(e.title)}<span class="pill c-${e.kind}">${esc(e.priority)}</span></h3><p>${esc(e.summary||e.changes[0]||"")}</p></span><span class="t">${fmt(e.start)}<br>Track ${e.track}</span>`;
  b.onclick=()=>{show(e);v.currentTime=e.start;};list.prepend(b);
  toast(e);if(e.kind!=="baseline"||!$("nowtext").querySelector("h2"))show(e);
  const done=events.filter(x=>fired.has(x.id));
  setStat("people",new Set(done.map(x=>x.track)).size);setStat("windows",done.length);
  setStat("routine",done.filter(x=>x.kind==="ok").length);setStat("flags",done.filter(x=>x.kind==="warn"||x.kind==="bad").length);
}
function tick(){
  const t=v.currentTime||0,D=rec.duration||10;
  $("clock").textContent=fmt(t);setStat("t",fmt(t));$("ph").style.left=Math.min(100,t/D*100)+"%";
  if(live)events.forEach(e=>{if(!fired.has(e.id)&&e.at<=t+.05)fire(e)});
}
function stop(){live=false;document.body.classList.remove("live-on");v.pause();$("live").textContent="● Go live";$("skip").disabled=true;}
async function goLive(){
  if(live){stop();return;}
  await load();live=true;document.body.classList.add("live-on");reset();
  v.currentTime=0;v.playbackRate=+$("speed").value;v.play().catch(()=>{});
  $("live").textContent="■ Stop";$("skip").disabled=false;
}
function skip(){const t=v.currentTime||0,n=events.find(e=>!fired.has(e.id)&&e.at>t);if(n)v.currentTime=Math.max(0,n.at-1.5);}
v.addEventListener("timeupdate",tick);
v.addEventListener("ended",()=>{tick();stop();$("live").textContent="↻ Replay";});
$("live").onclick=goLive;$("skip").onclick=skip;
$("speed").onchange=()=>v.playbackRate=+$("speed").value;
$("rec").onchange=()=>{stop();pickRec();};
load().catch(()=>{$("nowtext").textContent="Couldn't reach the WorkSight server. Check it's running, then reload.";});

if(window.WSMode&&WSMode.mode==="detect"){
  const L=document.querySelector(".panel .label");if(L)L.textContent="Camera timeline · red = hazard · amber = fatigue cue · green = clear · blue = not described";
  const sp=document.querySelectorAll(".stat span");if(sp[3])sp[3].textContent="clear";if(sp[4])sp[4].textContent="hazards + fatigue cues";
  const sub=document.querySelector(".sub");if(sub)sub.textContent="Detect mode: every window is checked for hazards and fatigue cues on its own. No comparison with earlier footage.";
}
