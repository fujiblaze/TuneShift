import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const library = fs.readFileSync('audio/realtime-bpm-processor.js','utf8');
for (const sampleRate of [44100,48000]) {
 let Processor;const events=[];
 vm.runInNewContext(library,{sampleRate,AudioWorkletProcessor:class{constructor(){this.port={addEventListener(){},start(){},postMessage:event=>events.push(event)};}},registerProcessor:(_name,type)=>Processor=type});
 const processor=new Processor({processorOptions:{continuousAnalysis:false,muteTimeInIndexes:Math.round(sampleRate*.2)}});
 for(let start=0;start<sampleRate*14;start+=128){
  const block=new Float32Array(128);
  for(let i=0;i<128;i++){const t=((start+i)/sampleRate)%.5;block[i]=t<.12?Math.sin(2*Math.PI*60*t)*Math.exp(-t*30):0;}
  processor.process([[block]],[],{});
  while(processor.analysisInProgress)await Promise.resolve();
 }
 const stable=events.find(event=>event.type==='bpmStable');
 assert.ok(stable,`No stable result at ${sampleRate}`);
 assert.ok(Math.abs(stable.data.bpm[0].tempo-120)<=1);
}
const listeners={};let messageListener;let created=0;const nodes=[];
class Node {connect(node){return node;} disconnect(){} }
class Context {constructor(){created++;this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:async()=>{}};} createMediaStreamSource(){return new Node();} resume(){return Promise.resolve();} close(){return Promise.resolve();}}
class Worklet extends Node {constructor(){super();this.port={postMessage(){},onmessage:null};nodes.push(this);}}
const media={src:'song-a',currentSrc:'song-a',currentTime:0,duration:180,readyState:4,paused:false,isConnected:true,playbackRate:1,defaultPlaybackRate:1,volume:1,
 addEventListener:(type,fn)=>listeners[type]=fn,getBoundingClientRect:()=>({width:100,height:100}),getAttribute:()=>null,captureStream:()=>({getAudioTracks:()=>[{}],getTracks:()=>[{stop(){}}]})};
const doc={querySelectorAll:()=>[media],documentElement:{},title:'A'};
const context={URL,console,location:{href:'https://example.com/watch',hostname:'example.com'},document:doc,AudioContext:Context,AudioWorkletNode:Worklet,BiquadFilterNode:Node,GainNode:Node,
 MutationObserver:class{observe(){}},setInterval:()=>0,clearInterval(){},requestAnimationFrame(){},chrome:{runtime:{getURL:path=>path,onMessage:{addListener:fn=>messageListener=fn}}}};
vm.runInNewContext(fs.readFileSync('content/content.js','utf8'),context);
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};await settle();
const controller=context.__tuneShiftController;
const send=message=>{let value;messageListener(message,{},result=>value=result);return value;};
const stable=(node,tempo)=>node.port.onmessage?.({data:{type:'bpmStable',data:{bpm:[{tempo,count:40,confidence:.8}]}}});
assert.equal(created,1);stable(nodes.at(-1),120);assert.equal(controller.state().bpm.value,120);
doc.title='A - playing';media.duration=181;listeners.loadedmetadata();controller.refresh();await settle();assert.equal(created,1);assert.equal(controller.state().bpm.status,'automatic');
send({type:'BEGIN_MANUAL_BPM'});assert.equal(controller.state().bpm.status,'tapping');send({type:'SET_MANUAL_BPM',bpm:128,source:'tap'});listeners.loadedmetadata();controller.refresh();assert.equal(controller.state().bpm.value,128);
media.currentSrc='song-b';controller.refresh();await settle();assert.equal(created,2);assert.equal(controller.state().bpm.status,'detecting');
const stale=nodes.at(-1).port.onmessage;await controller.apply({speed:1.25});listeners.ratechange();await settle();assert.equal(created,3);stale({data:{type:'bpmStable',data:{bpm:[{tempo:999,count:40}]}}});assert.equal(controller.state().bpm.status,'detecting');
stable(nodes.at(-1),150);assert.equal(controller.state().bpm.value,120);await controller.apply({speed:1.5});listeners.ratechange();assert.equal(created,3);
media.currentSrc='song-a';controller.refresh();await settle();assert.equal(controller.state().bpm.value,128);assert.equal(created,3);
media.currentSrc='song-c';controller.refresh();await settle();nodes.at(-1).port.onmessage({data:{type:'error'}});controller.refresh();listeners.loadedmetadata();await settle();assert.equal(created,4);assert.equal(controller.state().bpm.status,'failed');
console.log('BPM checks passed: real library 120 BPM at 44.1/48 kHz, metadata stability, manual override, track cache, speed normalization, stale callbacks and failure latching.');
// Reproduce delayed audio availability at the start of a video track.
function startupFixture() {
 const callbacks=new Map(),timers=new Map();let timerId=0,handler,ready=false,captures=0,contexts=0,stops=0;
 class AudioNode {connect(node){return node;}disconnect(){} }
 class AudioContext {constructor(){contexts++;this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:async()=>{}};}createMediaStreamSource(){return new AudioNode();}resume(){return Promise.resolve();}close(){return Promise.resolve();}}
 const worklets=[];
 class AudioWorklet extends AudioNode {constructor(){super();this.port={onmessage:null,postMessage(){}};worklets.push(this);}}
 const video={tagName:'VIDEO',src:'video-a',currentSrc:'video-a',currentTime:0,duration:180,readyState:1,paused:false,isConnected:true,playbackRate:1,defaultPlaybackRate:1,volume:1,
  addEventListener(type,fn){if(!callbacks.has(type))callbacks.set(type,new Set());callbacks.get(type).add(fn);},removeEventListener(type,fn){callbacks.get(type)?.delete(fn);},
  getBoundingClientRect:()=>({width:100,height:100}),getAttribute:()=>null,
  captureStream(){captures++;const track={readyState:'live',stop(){stops++;this.readyState='ended';}};return {getAudioTracks:()=>ready?[track]:[],getTracks:()=>ready?[track]:[]};}};
 const env={URL,console,location:{href:'https://music.youtube.com/watch?v=abcdefghijk',hostname:'music.youtube.com'},document:{querySelectorAll:()=>[video],title:'Video',documentElement:{}},
  AudioContext,AudioWorkletNode:AudioWorklet,BiquadFilterNode:AudioNode,GainNode:AudioNode,MutationObserver:class{observe(){}},requestAnimationFrame(){},
  setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),chrome:{runtime:{getURL:path=>path,onMessage:{addListener:fn=>handler=fn}}}};
 vm.runInNewContext(fs.readFileSync('content/content.js','utf8'),env);
 return {video,worklets,controller:env.__tuneShiftController,ready:value=>ready=value,contexts:()=>contexts,captures:()=>captures,stops:()=>stops,timers,
  tick:()=>[...timers.values()].forEach(fn=>fn()),emit:type=>[...(callbacks.get(type)||[])].forEach(fn=>fn()),send:message=>{let out;handler(message,{},result=>out=result);return out;}};
}
const delayed=startupFixture();await settle();assert.equal(delayed.controller.state().bpm.status,'detecting');assert.equal(delayed.captures(),0);
delayed.video.readyState=4;delayed.tick();delayed.tick();await settle();assert.equal(delayed.controller.state().bpm.status,'detecting');assert.equal(delayed.contexts(),0);
delayed.ready(true);delayed.emit('playing');await settle();assert.equal(delayed.contexts(),1);stable(delayed.worklets.at(-1),120);assert.equal(delayed.controller.state().bpm.value,120);delayed.emit('playing');delayed.emit('canplay');assert.equal(delayed.contexts(),1);
const manual=startupFixture();manual.tick();manual.send({type:'BEGIN_MANUAL_BPM'});manual.send({type:'SET_MANUAL_BPM',bpm:126,source:'tap'});manual.ready(true);manual.video.readyState=4;manual.tick();manual.emit('playing');await settle();assert.equal(manual.contexts(),0);assert.equal(manual.controller.state().bpm.value,126);
const timeout=startupFixture();for(let i=0;i<60;i++)timeout.tick();await settle();assert.equal(timeout.controller.state().bpm.status,'failed');assert.equal(timeout.controller.state().bpm.retryable,true);assert.equal(timeout.timers.size,1); // Only the existing page-navigation watcher remains.
timeout.ready(true);timeout.video.readyState=4;timeout.emit('playing');await settle();assert.equal(timeout.contexts(),1);assert.equal(timeout.controller.state().bpm.status,'detecting');
const changed=startupFixture();changed.video.currentSrc='video-b';changed.controller.refresh();await settle();changed.ready(true);changed.video.readyState=4;changed.tick();await settle();assert.equal(changed.contexts(),1);
console.log('Video startup checks passed: metadata-only state, delayed/empty capture, readiness recovery, bounded timeout, manual cancellation and track-switch cancellation.');
