
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=s=>{s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
const COL={ok:"var(--ok)",warn:"var(--warn)",bad:"var(--bad)",base:"var(--base)"};
const RANK={base:0,ok:1,warn:2,bad:3};
const DET=!!(window.WSMode&&WSMode.mode==="detect");const TT=(a,fb)=>DET?WSMode.title(a):(a.report?.task_context||fb);const PR=a=>DET?WSMode.label(a):(a.report?.review_priority||"routine");
const kindOf=a=>{if(DET)return WSMode.kind(a);if(a.status==="no_reference"||!a.report)return"base";const p=a.report.review_priority||"";return /high|urgent|check/i.test(p)?"bad":/review|elevated|medium|attention/i.test(p)?"warn":"ok"};
const ZONES=[
  {id:"roof",name:"Roof deck",x:10,y:10,w:150,h:70},
  {id:"scaf",name:"Scaffold A",x:170,y:10,w:85,h:70},
  {id:"rest",name:"Rest area",x:265,y:10,w:85,h:70},
  {id:"walk",name:"Warehouse walkway",x:10,y:92,w:220,h:62},
  {id:"panel",name:"Panel room",x:240,y:92,w:110,h:62},
  {id:"load",name:"Loading bay",x:10,y:166,w:200,h:60},
  {id:"gate",name:"Main gate",x:220,y:166,w:130,h:60}];
function zoneFor(r){
  const s=((r.task||"")+" "+(r.filename||"")).toLowerCase();
  if(/seated|rest/.test(s))return"rest";
  if(/aerial|scaffold|rebar/.test(s))return"scaf";
  if(/crew|roof|squat|standing/.test(s))return"roof";
  if(/walking|gate/.test(s))return"gate";
  if(/walkway/.test(s))return"walk";
  if(/panel|intervention/.test(s))return"panel";
  if(/forklift|carrying|load/.test(s))return"load";
  return"walk";
}
const truth=r=>{const m=(r.filename||"").toLowerCase().match(/(?:^|[_\/])\d-(unsafe|safe)-/);return m?m[1]:null};
const nice=r=>{const f=(r.filename||"").replace(/\.mp4$/i,"");const m=f.match(/\d-(?:unsafe|safe)-([a-z-]+)/i);return m?m[1].replace(/-/g," "):f.replace(/^(construction-posture|factory-safe-unsafe-behaviours)_/,"").replace(/[_-]+/g," ").slice(0,40)};
let first=true,seenRec=new Set(),seenAn=new Set(),feeds=[],sel=null,camNo={};
function toast(cls,title,sub,ms){const t=document.createElement("div");t.className="toast k-"+(cls||"base");t.innerHTML=`<b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:""}`;$("toasts").prepend(t);while($("toasts").children.length>4)$("toasts").lastChild.remove();setTimeout(()=>t.remove(),ms||6000)}
function build(s){
  const recs=(s.recordings||[]).filter(r=>r.status==="ready").sort((a,b)=>(a.imported_at||0)-(b.imported_at||0));
  recs.forEach(r=>{if(!camNo[r.id])camNo[r.id]=Object.keys(camNo).length+1});
  const clips=s.clips||[],an=s.analyses||[];
  const clipById=Object.fromEntries(clips.map(c=>[c.id,c]));
  return recs.map(r=>{
    const rc=clips.filter(c=>c.recording_id===r.id).sort((a,b)=>a.offset-b.offset);
    const ra=an.filter(a=>a.recording_id===r.id).map(a=>({...a,kind:kindOf(a),clip:clipById[a.clip_id]})).sort((a,b)=>(b.created_at||0)-(a.created_at||0));
    const gt=truth(r);
    let worst=ra.reduce((k,a)=>RANK[a.kind]>RANK[k]?a.kind:k,"base");
    if(gt==="unsafe"&&RANK[worst]<RANK.bad)worst="bad";
    const hz=ra.filter(a=>a.kind==="warn"||a.kind==="bad").length+(gt==="unsafe"?1:0);
    const latest=ra.find(a=>a.report)||ra[0];
    return {r,cam:"CAM-"+String(camNo[r.id]).padStart(2,"0"),zone:zoneFor(r),gt,kind:worst,hz,
      people:new Set(rc.map(c=>c.track_id)).size,windows:rc.length,an:ra,thumb:rc[0]?.thumbnail_path,
      summary:latest?.report?.human_review_summary||latest?.report?.task_context||latest?.summary||"Processing…",name:nice(r)};
  });
}
function renderGrid(){
  const g=$("grid");
  if(!feeds.length){g.innerHTML='<div class="empty">Waiting for the first processed feed…</div>';return}
  if(g.querySelector(".empty"))g.innerHTML="";
  const order=[...feeds].sort((a,b)=>RANK[b.kind]-RANK[a.kind]||camNo[a.r.id]-camNo[b.r.id]);
  order.forEach((f,i)=>{
    let t=g.querySelector(`[data-id="${f.r.id}"]`);
    if(!t){
      t=document.createElement("button");t.className="tile"+(first?"":" new");t.dataset.id=f.r.id;
      const auto=i<9;
      t.innerHTML=`<video muted loop playsinline preload="metadata" ${auto?"autoplay":""} ${f.thumb?`poster="/media/${esc(f.thumb)}"`:""} src="/media/${esc(f.r.media_path)}"></video><div class="hud"><span class="live">● LIVE</span><span class="st"></span><span class="cam"></span><span class="task"></span></div><span class="hz" hidden></span><div class="tbody"><div class="trow"><span class="tname"></span><span class="gt"></span></div><div class="tsum"></div><div class="tfoot"><span class="tclip"></span><span class="tcat"></span></div></div>`;
      const v=t.querySelector("video");
      if(!auto){t.addEventListener("mouseenter",()=>v.play().catch(()=>{}));t.addEventListener("mouseleave",()=>v.pause())}
      t.onclick=()=>openFeed(f.r.id);
    }
    t.className="tile "+f.kind+(sel===f.r.id?" sel":"")+(t.classList.contains("new")?" new":"");
    t.querySelector(".cam").textContent=f.cam;
    t.querySelector(".task").textContent=f.r.task||"";
    const hz=t.querySelector(".hz");hz.hidden=!f.hz;hz.textContent="⚠ "+f.hz;
    t.querySelector(".tname").textContent=f.name;
    t.querySelector(".gt").innerHTML=f.gt?`<span class="chip ${f.gt}">${f.gt}</span>`:"";
    t.querySelector(".tsum").textContent=(window.WSMode&&WSMode.mode==="detect"&&/no eligible earlier reference|baseline/i.test(f.summary||""))?"Window checked · waiting for Cosmos description":f.summary;
    const DETM=!!(window.WSMode&&WSMode.mode==="detect");
    const ST={bad:"Hazard",warn:DETM?"Fatigue cue":"Check-in",ok:"OK",base:"Baseline"};
    const st=t.querySelector(".st");st.textContent=ST[f.kind]||"OK";st.className="st s-"+f.kind;
    t.querySelector(".tclip").textContent=(f.r.filename||"").replace(/\.mp4$/i,"").split(/[_\/]/).pop().slice(0,24);
    t.querySelector(".tcat").textContent=f.r.task||"";
    g.appendChild(t);
  });
  $("gridnote").textContent=`${feeds.length} feeds · hazards first`;
}
function renderMap(){
  const byZone={};feeds.forEach(f=>(byZone[f.zone]=byZone[f.zone]||[]).push(f));
  let h=`<rect class="m-bg" x="0" y="0" width="360" height="236" rx="6"/>`;
  ZONES.forEach(z=>{
    const hot=(byZone[z.id]||[]).some(f=>f.kind==="bad"||f.kind==="warn");
    h+=`<rect class="z${hot?" hot":""}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="4"/><text class="zt" x="${z.x+6}" y="${z.y+13}" font-size="9">${esc(z.name)}</text>`;
  });
  h+=`<text class="note" x="4" y="252" font-size="8.5">Schematic layout · camera positions are illustrative</text>`;
  ZONES.forEach(z=>{
    const list=byZone[z.id]||[],n=list.length,cols=Math.min(n,Math.max(1,Math.floor(z.w/26)));
    list.forEach((f,i)=>{
      const cx=z.x+16+((i%cols)+.5)*((z.w-24)/cols),cy=z.y+28+Math.floor(i/cols)*20;
      const c=COL[f.kind],isHz=f.kind==="bad"||f.kind==="warn";
      h+=`<g class="dot" data-id="${f.r.id}" tabindex="0" role="button" aria-label="${esc(f.cam)} ${esc(f.kind)}">`+
        (isHz?`<circle class="pulse s-${f.kind}" cx="${cx}" cy="${cy}" r="7" stroke-width="2"/>`:"")+
        `<circle class="dotc f-${f.kind}" cx="${cx}" cy="${cy}" r="${sel===f.r.id?7.5:6}"/>`+
        (isHz?`<text class="f-${f.kind}" x="${cx+8}" y="${cy-5}" font-size="10">⚠</text>`:"")+
        `<text class="ct" x="${cx}" y="${cy+15}" font-size="7.5" text-anchor="middle">${esc(f.cam.replace("CAM-",""))}</text></g>`;
    });
  });
  $("map").innerHTML=h;
  $("map").querySelectorAll(".dot").forEach(d=>{const go=()=>selectFeed(d.dataset.id);d.onclick=go;d.onkeydown=e=>{if(e.key==="Enter")go()}});
}
function renderAlerts(){
  const items=[];
  feeds.forEach(f=>{
    if(f.gt==="unsafe")items.push({f,kind:"bad",t:f.r.imported_at,title:`Unsafe behaviour · ${f.name}`,sub:"dataset label",text:f.summary});
    f.an.filter(a=>a.report).forEach(a=>items.push({f,kind:a.kind,t:a.created_at,title:TT(a,"Comparison"),sub:`${fmt(a.clip?.offset)} · ${PR(a)}`,text:a.report.human_review_summary||""}));
  });
  items.sort((a,b)=>(RANK[b.kind]>=2)-(RANK[a.kind]>=2)||(b.t||0)-(a.t||0));
  $("alerts").innerHTML=items.length?items.slice(0,40).map(x=>`<button class="al" data-id="${x.f.r.id}"><i class="k-${x.kind}"></i><span><b>${esc(x.title)}</b><small>${esc(x.f.cam)} · ${esc(x.sub)}</small><p>${esc(x.text)}</p></span></button>`).join(""):'<div class="empty">No findings yet.</div>';
  $("alerts").querySelectorAll(".al").forEach(b=>b.onclick=()=>openFeed(b.dataset.id));
}
function selectFeed(id){sel=id;renderGrid();renderMap();const t=$("grid").querySelector(`[data-id="${id}"]`);if(t)t.scrollIntoView({block:"nearest",behavior:"smooth"})}
function openFeed(id){
  const f=feeds.find(x=>x.r.id===id);if(!f)return;selectFeed(id);
  $("dv").src="/media/"+f.r.media_path;
  $("dinfo").innerHTML=`<h2>${esc(f.cam)} · ${esc(f.name)}</h2><div class="foot">${esc(f.r.task||"")} · ${esc(ZONES.find(z=>z.id===f.zone).name)} · ${f.people} people · ${f.windows} windows ${f.gt?`· <span class="chip ${f.gt}">${f.gt}</span>`:""}</div>`+
    (f.an.length?f.an.map(a=>`<div class="find k-${a.kind}"><b>${esc(TT(a,a.summary||"Baseline"))}</b><div class="foot">${fmt(a.clip?.offset)}–${fmt((a.clip?.offset||0)+(a.clip?.duration||0))} · Track ${esc(a.clip?.track_id)} · ${esc(DET?PR(a):(a.report?.review_priority||(a.kind==="base"?"baseline":"")))}${a.similarity&&!DET?` · sim ${a.similarity.toFixed(2)}`:""}</div>${a.report?.observable_changes?.length?`<ul>${a.report.observable_changes.map(c=>`<li>${esc(c)}</li>`).join("")}</ul>`:""}</div>`).join(""):'<p class="foot">No findings yet.</p>');
  if(!$("dlg").open)$("dlg").showModal();
}
$("dlgx").onclick=()=>{$("dlg").close();$("dv").pause()};
$("dlg").addEventListener("close",()=>$("dv").pause());
async function poll(){
  let s;try{s=await fetch("/api/state").then(r=>r.json())}catch{return}
  feeds=build(s);
  feeds.forEach(f=>{if(!seenRec.has(f.r.id)){seenRec.add(f.r.id);if(!first)toast(f.kind==="bad"?"bad":"base","● New feed online",`${f.cam} · ${f.name}`,5000)}
    f.an.forEach(a=>{if(seenAn.has(a.id))return;seenAn.add(a.id);if(!first&&a.report)toast(a.kind,(a.kind==="ok"?"◉ ":"⚠ ")+TT(a,"Cosmos finding"),`${f.cam} · ${PR(a)}`,6500)})});
  const job=(s.jobs||[]).find(j=>j.status!=="completed"&&j.status!=="failed");
  $("badge").className="badge"+(job?" on":"");$("badge").textContent=job?"● PROCESSING":"● LIVE";
  $("s-stage").textContent=job?`${job.label||"Recording"} · ${job.stage||job.status}`:"Idle · all feeds processed";
  $("s-prog").style.width=(job?job.progress||0:0)+"%";
  $("s-cams").textContent=feeds.length;
  $("s-people").textContent=feeds.reduce((n,f)=>n+f.people,0);
  $("s-win").textContent=feeds.reduce((n,f)=>n+f.windows,0);
  const hz=feeds.filter(f=>f.kind==="bad"||f.kind==="warn").length;$("s-hz").textContent=hz;$("s-hz").className=hz?"bad":"";
  renderGrid();renderMap();renderAlerts();first=false;
}
poll();setInterval(poll,2000);
