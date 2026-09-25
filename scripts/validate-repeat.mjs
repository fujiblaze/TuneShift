import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
function fixture({ detached = false, originalLoop = false } = {}) {
 const documentEvents = new Map(), events = new Map();
 let receive, advances = 0, plays = 0;
 const listen = (map, type, fn, capture) => map.set(type, [...(map.get(type) || []), {fn, capture: capture === true}]);
 const media = {readyState:4, src:'blob:song', currentSrc:'blob:song', duration:120, currentTime:20, paused:true, isConnected:true, loop:originalLoop,
 volume:1, playbackRate:1, defaultPlaybackRate:1, preservesPitch:true,
 getBoundingClientRect:()=>({width:100,height:100}),getAttribute:()=>null,
 addEventListener:(type,fn,capture)=>listen(events,type,fn,capture),play:()=>{plays++;return Promise.resolve();}};
 // The site's playlist handler exists before extension injection.
 listen(events,'ended',()=>{advances++;media.currentSrc='blob:next';},false);
 const env={console,URL,location:{href:'https://music.youtube.com/watch?v=abcdefghijk&list=PLtest',hostname:'music.youtube.com'},
 document:{querySelectorAll:()=>[media],title:'Song',documentElement:{},addEventListener:(type,fn,capture)=>listen(documentEvents,type,fn,capture)},
 MutationObserver:class{observe(){}},setInterval:()=>0,clearInterval(){},requestAnimationFrame(){},
 chrome:{runtime:{sendMessage:async()=>({ok:true}),onMessage:{addListener:fn=>receive=fn}}}};
 vm.runInNewContext(fs.readFileSync('content/content.js','utf8'),env);
 function dispatch(type) {
  const event={target:media,stopped:false,stopImmediatePropagation(){this.stopped=true;}};
  const ordered=[...(detached?[]:(documentEvents.get(type)||[]).filter(x=>x.capture)),...(events.get(type)||[]).filter(x=>x.capture),...(events.get(type)||[]).filter(x=>!x.capture)];
  for(const {fn} of ordered){if(event.stopped)break;fn(event);}
 }
 return {media,env,dispatch,controller:env.__tuneShiftController,advances:()=>advances,plays:()=>plays,
 finish(){media.currentTime=120;if(media.loop){media.currentTime=0;dispatch('timeupdate');}else dispatch('ended');},
 send:msg=>new Promise(resolve=>receive(msg,{},resolve))};
}
for(const detached of [false,true]) {
 for(const [mode,count] of [['once',1],['twice',2],['five',5]]) {
  const f=fixture({detached});await f.controller.apply({repeat:mode});
  for(let i=0;i<count;i++){f.finish();assert.equal(f.advances(),0);assert.equal(f.media.currentTime,0);}
  assert.equal(f.plays(),count);assert.equal(f.controller.state().settings.repeat,'off');
  f.finish();assert.equal(f.advances(),1,'playlist resumes after counted repeats');
 }
}
const track=fixture();await track.controller.apply({repeat:'track'});
assert.equal(track.media.loop,true);
for(let i=0;i<4;i++)track.finish();
assert.equal(track.advances(),0);assert.equal(track.media.currentTime,0);
track.media.loop=false;track.dispatch('timeupdate');assert.equal(track.media.loop,true,'repair player loop resets');
await track.send({type:'SET_ENABLED',enabled:false});assert.equal(track.media.loop,false);
await track.send({type:'SET_ENABLED',enabled:true});assert.equal(track.media.loop,true);
await track.controller.apply({repeat:'off'});assert.equal(track.media.loop,false);track.finish();assert.equal(track.advances(),1);
const native=fixture({originalLoop:true});await native.controller.apply({repeat:'track'});await native.controller.apply({repeat:'off'});assert.equal(native.media.loop,true,'restore original player loop');
const ab=fixture();await ab.controller.apply({repeat:'once',loopA:5,loopB:10});ab.finish();assert.equal(ab.media.currentTime,5);assert.equal(ab.advances(),0);assert.equal(ab.controller.state().settings.repeat,'once');
const changed=fixture();await changed.controller.apply({repeat:'once'});changed.env.location.href='https://music.youtube.com/watch?v=othertrack1';changed.finish();assert.equal(changed.plays(),0,'do not restart a newly selected song');
console.log('Repeat checks passed: YouTube Music URL fixture, pre-existing playlist listener, native loop, counted repeats, detached media, bypass, original loop restoration, A-B priority and navigation.');
