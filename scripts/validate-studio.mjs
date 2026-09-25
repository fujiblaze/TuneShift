import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=[]; let contentListener;
class Param { constructor(value=0){this.value=value;} cancelScheduledValues(){} setValueAtTime(v){this.value=v;} setTargetAtTime(v){this.value=v;} }
class AudioNode { constructor(context, options={}){this.options=options;this.edges=[];for(const key of ['gain','ratio','threshold','pan'])this[key]=new Param(options[key]??0);nodes.push(this);}connect(to,output=0,input=0){this.edges.push({to,output,input});return to;}disconnect(){this.edges=[];} }
class Filter extends AudioNode {} class Splitter extends AudioNode {} class Merger extends AudioNode {}
class Worklet extends AudioNode {constructor(context){super(context);this.parameters=new Map(['playbackRate','pitchSemitones','pitch'].map(k=>[k,new Param()]));this.port={postMessage(){}};} }
class Context {constructor(){this.currentTime=0;this.sampleRate=48000;this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};}createMediaElementSource(){return new AudioNode(this);}resume(){return Promise.resolve();} }
const media={readyState:4,src:'song.mp3',currentSrc:'song.mp3',duration:120,currentTime:20,paused:true,isConnected:true,volume:1,playbackRate:1,defaultPlaybackRate:1,preservesPitch:true,getBoundingClientRect:()=>({width:100,height:100}),getAttribute:()=>null,addEventListener(){}};
const env={console,URL,location:{href:'https://example.com/song',hostname:'example.com'},document:{querySelectorAll:()=>[media],documentElement:{},title:'Song'},MutationObserver:class{observe(){}},setInterval:()=>0,clearInterval(){},requestAnimationFrame(){},chrome:{runtime:{getURL:p=>p,onMessage:{addListener(fn){contentListener=fn;}}}},AudioContext:Context,AudioWorkletNode:Worklet,BiquadFilterNode:Filter,GainNode:AudioNode,DynamicsCompressorNode:AudioNode,StereoPannerNode:AudioNode,ChannelSplitterNode:Splitter,ChannelMergerNode:Merger};
vm.runInNewContext(fs.readFileSync('audio/effects-graph.js','utf8'),env);vm.runInNewContext(fs.readFileSync('content/content.js','utf8'),env);const controller=env.__tuneShiftController;
await controller.apply({subBass:4,warmth:-3,air:6,swapChannels:true});assert.equal(controller.state().audioActive,true);
for(const [frequency,gain] of [[60,4],[350,-3],[10000,6]])assert.equal(nodes.find(n=>n instanceof Filter&&n.options.frequency===frequency).gain.value,gain);
const splitter=nodes.find(n=>n instanceof Splitter),merger=nodes.find(n=>n instanceof Merger);assert.ok(splitter.edges.some(e=>e.to===merger&&e.output===0&&e.input===1));assert.ok(splitter.edges.some(e=>e.to===merger&&e.output===1&&e.input===0));const swapGate=merger.edges[0].to;assert.equal(swapGate.gain.value,1);
await controller.apply({swapChannels:false});assert.equal(swapGate.gain.value,0);
await controller.apply({subBass:0,warmth:0,air:0});assert.equal(controller.state().audioActive,false);
// Capture owns output gain; the page must neither process twice nor attenuate twice.
await controller.apply({volume:50, subBass:4});
assert.equal(media.volume,1);
await new Promise(resolve=>contentListener({type:'SET_TAB_EFFECTS',active:true},{},resolve));
assert.equal(controller.state().audioActive,false);
assert.equal(controller.state().tabEffectsActive,true);
assert.equal(media.volume,1);
await controller.apply({volume:150,pitch:0.5});
assert.equal(media.volume,1);
assert.equal(controller.state().audioActive,false);
await new Promise(resolve=>contentListener({type:'SET_TAB_EFFECTS',active:false},{},resolve));
assert.equal(controller.state().audioActive,true);
assert.equal(controller.state().tabEffectsActive,false);
const bg={chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}},commands:{onCommand:{addListener(){}}}}};vm.runInNewContext(fs.readFileSync('background.js','utf8'),bg);const saved=bg.sanitizeSettings({subBass:99,warmth:-99,air:4,swapChannels:true});assert.equal(saved.subBass,12);assert.equal(saved.warmth,-12);assert.equal(saved.air,4);assert.equal(saved.swapChannels,true);
console.log('Studio checks passed: three filter gains, reversed channel routing, toggle reset, neutral bypass and saved-setting bounds.');
