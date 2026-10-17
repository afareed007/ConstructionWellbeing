// Run with Node 20+; exercises the actual dashboard logic without controlling a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    dataset:{},className:'',value:'',hidden:false,innerHTML:'',textContent:'',
    addEventListener(){},classList:{toggle(){}},
    attributes:{},paused:true,currentTime:0,duration:5,readyState:4,
    pause(){this.paused=true;},async play(){this.paused=false;},load(){},
    getAttribute(name){return this.attributes[name] ?? null;},
    setAttribute(name,value){this.attributes[name]=value;},
    removeAttribute(name){delete this.attributes[name];},
  });
  return elements.get(id);
}
const context = vm.createContext({
  document:{getElementById:element,querySelectorAll:()=>[]},
  fetch:()=>new Promise(()=>{}),setInterval(){},setTimeout(){},clearTimeout(){},
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../warehouse/static/app.js'),'utf8'),context);
vm.runInContext(`
  state={tracks:[{id:'t',recording_id:'r',task:'walking'}],
    clips:[{id:'c',track_key:'t',track_id:1,recording_id:'r',offset:5,duration:5,started_at:5,
            task:'walking',window_coverage:1,demo:true,media_path:'c.mp4',context_path:'scene.mp4'}],
    analyses:[],busy:true};
  selectedTrack='t'; selectedClip='c'; renderEvidence(); state.busy=false; renderEvidence();
`,context);
assert.equal(element('identity-save').disabled,false,'Identity confirmation must unlock when processing finishes');
assert.equal(element('review-save').disabled,false,'Human review must unlock when processing finishes');
vm.runInContext(`
  state.clips.push({...state.clips[0],id:'ref',started_at:0});
  state.analyses=[{clip_id:'c',status:'stale',reference_id:'ref',reference_candidates:[{clip_id:'ref'}]}];
  renderedKey='';renderEvidence();
`,context);
assert.equal(element('reference-video').hidden,true,'Invalidated identity mappings must not keep showing the old match');
assert.equal(element('matches-section').hidden,true,'Invalidated candidates must stay hidden until recomputed');
vm.runInContext(`
  state={recordings:[],tracks:[{id:'old',recording_id:'r1'},{id:'new',recording_id:'r2'}],
         clips:[],analyses:[],busy:false,jobs:[{id:'job2',status:'completed',stage:'Ready',
         progress:100,events:[],result:{recording_id:'r2'}}]};
  selectedTrack='old'; completedJob='job1'; renderPipeline();
`,context);
assert.equal(vm.runInContext('selectedTrack',context),'new', 'Completed recording must open its own track, not the previously selected recording');
vm.runInContext(`
  state.tracks.push({id:'second',recording_id:'r2'});
  state.jobs=[{id:'job3',status:'completed',stage:'Ready',progress:100,events:[],
               result:{recording_id:'r2',track_key:'second'}}];
  selectedTrack='second'; renderPipeline();
`,context);
assert.equal(vm.runInContext('selectedTrack',context),'second','Recomparison must preserve the selected person when multiple tracks share a recording');
console.log('Dashboard regressions: controls unlock, new recording opens, reanalysis selects correct person — passed');

async function checkPairedPlayback() {
  const earlier=element('reference-video'),current=element('current-video');
  earlier.hidden=false; element('pair-scrub').value=0;
  await vm.runInContext('playPair()',context);
  assert.equal(earlier.paused,false);
  assert.equal(current.paused,false);
  vm.runInContext('seekPair(3)',context);
  assert.equal(earlier.currentTime,3);
  assert.equal(current.currentTime,3);
  earlier.duration=2.5;
  vm.runInContext('seekPair(20)',context);
  assert.equal(earlier.currentTime,2.5,'Shared seeking must stop at the shorter clip');
  assert.equal(current.currentTime,2.5);
  vm.runInContext('pausePair()',context);
  assert.equal(earlier.paused,true);
  assert.equal(current.paused,true);
  current.play=async()=>{throw new Error('Playback unavailable');};
  await assert.rejects(vm.runInContext('playPair()',context));
  assert.equal(earlier.paused,true,'A failed video must not leave the other playing');
  assert.equal(current.paused,true);
  console.log('Paired playback: shared play, pause, seek, duration clamp and failure handling passed');
}
checkPairedPlayback().catch(error=>{console.error(error);process.exitCode=1;});
