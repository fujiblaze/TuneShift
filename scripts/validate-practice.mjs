import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('content/content.js','utf8');
function fixture(host='example.com', keys=null) {
 const listeners={}; let receive; let playCount=0; let contexts=0;
 const media={readyState:4,src:'song.mp3',currentSrc:'song.mp3',duration:120,currentTime:20,paused:true,isConnected:true,mediaKeys:keys,volume:1,playbackRate:1,defaultPlaybackRate:1,preservesPitch:true,
 getBoundingClientRect:()=>({width:0,height:0}),getAttribute:()=>null,addEventListener:(e,fn)=>listeners[e]=fn,play:()=>{playCount++;return Promise.resolve();},pause:()=>{},};
 const context={console,URL,location:{href:`https://${host}/song`,hostname:host},document:{querySelectorAll:()=>[media],title:'Song',documentElement:{}},MutationObserver:class{observe(){}},setInterval:()=>0,clearInterval:()=>{},requestAnimationFrame:()=>{},chrome:{runtime:{onMessage:{addListener:fn=>receive=fn}}},AudioContext:class{constructor(){contexts++;throw Error('Unexpected DSP');}}};
 vm.runInNewContext(source,context);
 return {media,listeners,controller:context.__tuneShiftController,contexts:()=>contexts,playCount:()=>playCount,request:msg=>new Promise(resolve=>receive(msg,{},resolve)),message:msg=>{let result;receive(msg,{},value=>result=value);return result;}};
}
for (const [host,keys] of [['open.spotify.com',null],['example.com',{}]]) {
 const f=fixture(host,keys); await f.controller.apply({transpose:3,bass:4,volume:150});assert.equal(f.contexts(),0);assert.equal(f.controller.state().drmProtected,true);
}
// Protected players repeatedly reset both native rate properties during playback.
for (const capture of [false, true]) {
 const rateFixture = fixture('open.spotify.com');
 rateFixture.message({type:'SET_TAB_EFFECTS',active:capture});
 await rateFixture.controller.apply({speed:1.35});
 let rate = rateFixture.media.playbackRate, writes = 0;
 Object.defineProperty(rateFixture.media,'playbackRate',{get:()=>rate,set:value=>{rate=value;writes++;}});
 for (let reset = 0; reset < 5; reset++) {
  rateFixture.media.defaultPlaybackRate = 1;
  rateFixture.media.playbackRate = 1;
  rateFixture.listeners.ratechange();
  assert.equal(rateFixture.media.playbackRate,1.35);
  assert.equal(rateFixture.media.defaultPlaybackRate,1.35);
  const settledWrites = writes;
  rateFixture.listeners.ratechange();
  assert.equal(writes,settledWrites,'own ratechange must not write again');
 }
 await rateFixture.request({type:'SET_ENABLED',enabled:false});
 assert.equal(rateFixture.media.playbackRate,1,'bypass restores original speed');
 rateFixture.media.playbackRate = 0.9;
 rateFixture.listeners.ratechange();
 assert.equal(rateFixture.media.playbackRate,0.9,'bypass permits player changes');
 await rateFixture.request({type:'SET_ENABLED',enabled:true});
 assert.equal(rateFixture.media.playbackRate,1.35);
 assert.equal(rateFixture.contexts(),0);
}
console.log('DRM speed checks passed: repeated player resets, capture on/off, settled events, bypass and re-enable.');
const f=fixture(); f.listeners.encrypted();await f.controller.apply({pitch:0.5});assert.equal(f.contexts(),0);assert.equal(f.controller.state().drmProtected,true);
await f.controller.apply({repeat:'track',loopA:null,loopB:null});f.media.currentTime=120;f.listeners.ended();assert.equal(f.media.currentTime,0);assert.equal(f.playCount(),1);
await f.controller.apply({repeat:'off'});f.media.currentTime=120;f.listeners.ended();assert.equal(f.playCount(),1);
assert.equal(f.message({type:'SET_LOOP_POINT',point:'B'}).ok,false);
f.media.currentTime=10;assert.equal(f.message({type:'SET_LOOP_POINT',point:'A'}).ok,true);
f.media.currentTime=5;assert.equal(f.message({type:'SET_LOOP_POINT',point:'B'}).ok,false);
f.media.currentTime=30;assert.equal(f.message({type:'SET_LOOP_POINT',point:'B'}).ok,true);
f.media.currentTime=31;f.listeners.timeupdate();assert.equal(f.media.currentTime,10);
await f.controller.apply({loopEnabled:false});f.media.currentTime=31;f.listeners.timeupdate();assert.equal(f.media.currentTime,31);
let backgroundContext={chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}},commands:{onCommand:{addListener(){}}}}};
vm.runInNewContext(fs.readFileSync('background.js','utf8'),backgroundContext);
const normalized=backgroundContext.sanitizeSettings({repeat:'track',loopEnabled:false,cues:[{name:'Verse',time:20},{name:'Invalid',time:-1}]});assert.equal(normalized.cues.length,1);assert.equal(normalized.repeat,'track');assert.equal(normalized.loopEnabled,false);
assert.equal(backgroundContext.makeBuiltInPresets().length,13);
console.log('Practice/DRM checks passed: protected-track DSP exclusion, encrypted event, repeat off/track, loop ordering/pause, cue sanitization and fourteen profiles.');

// Detached Spotify media can be created by either constructor or document API.
const microtasks=[];const adopted=[];
class Media { constructor(){this.isConnected=false;this.dataset={};} play(){return Promise.resolve();} }
class Doc {createElement(tag){return tag==='audio'||tag==='video'?new Media():{};} }
const page={HTMLMediaElement:Media,Document:Doc,document:{documentElement:{appendChild(m){m.isConnected=true;adopted.push(m);}}},queueMicrotask:fn=>microtasks.push(fn)};
page.window={Audio:Media};vm.runInNewContext(fs.readFileSync('content/spotify-bootstrap.js','utf8'),page);
new page.window.Audio();new Doc().createElement('audio');new Media().play();
for(const task of microtasks)task();assert.equal(adopted.length,3);
console.log('Spotify hook checks passed: Audio constructor, createElement and existing-player play.');
