import assert from 'node:assert/strict';
import vm from 'node:vm';
import {controllerRuntime,controllerDefaults} from '../website/player/controller.js';
const events=[],listeners={},parent={},origin='https://playdeck-1z1.pages.dev';
let scheduled,focused=true,pad={buttons:[{value:0},{value:0}],axes:[0,0,0,0]};
class InputEvent {constructor(type,options){this.type=type;Object.assign(this,options);this.movementX=0;this.movementY=0;this.keyCode=0;this.which=0;}}
const element={isConnected:true,tagName:'CANVAS',matches:()=>false,dispatchEvent:event=>events.push(event),getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})};
const document={body:element,hidden:false,activeElement:element,hasFocus:()=>focused,addEventListener:()=>{},querySelector:()=>element};
const window={addEventListener:(type,fn)=>{listeners[type]=fn;},KeyboardEvent:InputEvent,MouseEvent:InputEvent,PointerEvent:InputEvent};
element.ownerDocument={defaultView:window};
vm.runInNewContext('('+controllerRuntime.toString()+')();',{window,parent,location:{origin},document,navigator:{getGamepads:()=>pad?[pad]:[]},performance:{now:()=>0},requestAnimationFrame:fn=>{scheduled=fn;}});
const config={enabled:true,pad:'auto',deadzone:.18,sensitivity:700,look:{enabled:true,x:2,y:3},bindings:{'button:0':{kind:'key',code:'KeyW'},'button:1':{kind:'key',code:'KeyW'}}};
const message=data=>listeners.message({source:parent,origin,data});
message({type:'timebomb:controller',config});
pad.buttons[0].value=1;scheduled(16);assert.equal(events.at(-1).type,'keydown');assert.equal(events.at(-1).code,'KeyW');
assert.equal(events.at(-1).keyCode,87,'legacy key codes must survive constructors that ignore them');
pad.buttons[1].value=1;pad.buttons[0].value=0;scheduled(32);assert.equal(events.length,1,'shared mapping must stay held');
pad.axes[2]=1;scheduled(48);assert.equal(events.at(-1).type,'mousemove');assert.ok(events.at(-1).movementX>0);
message({type:'playdeck:state',paused:true});assert.equal(events.at(-1).type,'keyup');
const count=events.length;scheduled(64);assert.equal(events.length,count,'paused game gets no input');
message({type:'playdeck:state',paused:false});scheduled(80);assert.ok(events.some(event=>event.type==='keydown'));
pad=null;scheduled(96);assert.equal(events.at(-1).type,'keyup','disconnect releases input');
pad={buttons:[{value:1},{value:0}],axes:[0,0,0,0]};focused=false;const before=events.length;scheduled(112);assert.equal(events.length,before,'unfocused game gets no input');
focused=true;message({type:'timebomb:controller',config:{...config,enabled:false}});scheduled(128);assert.equal(events.length,before,'native mode gets no mapped input');
console.log('PASS: shared bindings, aim movement, pause/resume, disconnect, focus and native mode');


// The shell sees a pad even when the child Gamepad API would return nothing.
window.__timebombController = false;
const childDocument={...document,hasFocus:()=>false};
let directConfig={...config,enabled:true},directPaused=false;
pad={buttons:[{value:1},{value:0}],axes:[0,0,0,0]};
focused=true;
const context={window,parent,location:{origin},document,navigator:{getGamepads:()=>[pad]},performance:{now:()=>0},requestAnimationFrame:fn=>{scheduled=fn;},getFrame:()=>({contentDocument:childDocument}),readConfig:()=>directConfig,isPaused:()=>directPaused};
vm.runInNewContext('('+controllerRuntime.toString()+')({getFrame,readConfig,isPaused});',context);
const startDirect=events.length;scheduled(144);
assert.equal(events.length,startDirect+1,'shell-detected pad must dispatch into child document');
assert.equal(events.at(-1).type,'keydown');
directPaused=true;scheduled(160);assert.equal(events.at(-1).type,'keyup');
directPaused=false;directConfig={...config,enabled:false};const closed=events.length;scheduled(176);assert.equal(events.length,closed,'settings-open/disabled state stops the direct bridge');
console.log('PASS: direct frame dispatch uses shell gamepad detection and pause state');

directConfig={...config,enabled:true,separateAim:true,sensitivity:600,sensitivityY:1800};
pad.axes=[0,0,1,1];scheduled(192);
assert.equal(events.at(-1).type,'mousemove');
assert.equal(events.at(-1).movementY/events.at(-1).movementX,3,'split aim must use the separate Y sensitivity');
directConfig.separateAim=false;scheduled(208);
assert.equal(events.at(-1).movementY,events.at(-1).movementX,'linked aim must use the same sensitivity on both axes');
console.log('PASS: separate and linked aim sensitivity');

directConfig={...controllerDefaults(),enabled:true};
pad.axes=[0,0,1,0];scheduled(224);
assert.ok(events.at(-1).movementX>0);
assert.equal(events.at(-1).movementY,0,'horizontal stick input must not move vertical aim');
pad.axes=[0,0,0,1];scheduled(240);
assert.equal(events.at(-1).movementX,0,'vertical stick input must not move horizontal aim');
assert.ok(events.at(-1).movementY>0);
console.log('PASS: default aim axes move independently');

const fullSpeed=events.at(-1).movementY;
pad.buttons[6]={value:1};scheduled(256);
assert.equal(events.at(-1).movementY,fullSpeed*.5,'left trigger must reduce aim sensitivity by the configured percentage');
directConfig.aimSlowdown=0;scheduled(272);
assert.equal(events.at(-1).movementY,fullSpeed,'zero reduction disables trigger slowdown');
console.log('PASS: left trigger aim reduction');

// Clickteam and other older browser runtimes distinguish single clicks via detail.
directConfig={...controllerDefaults(),enabled:true,bindings:{'button:7':{kind:'mouse',button:0}}};
pad.axes=[0,0,0,0];pad.buttons[7]={value:1};scheduled(288);
const legacyClick=events.findLast(event=>event.type==='mousedown');
assert.equal(legacyClick.detail,1,'mapped mouse presses must report a single click');
assert.equal(legacyClick.which,1,'mapped left click must include the legacy mouse button');
console.log('PASS: legacy mouse click compatibility');

pad.buttons[7].value=0;
directConfig.look.cursor=true;
pad.axes=[0,0,1,0];scheduled(304);
const firstCursorX=events.at(-1).clientX;
scheduled(320);const nextCursorX=events.at(-1).clientX;
assert.ok(nextCursorX>firstCursorX,'cursor movement must accumulate instead of resetting to center');
pad.axes=[0,0,0,0];pad.buttons[7].value=1;scheduled(336);
assert.equal(events.findLast(event=>event.type==='mousedown').clientX,nextCursorX,'mapped clicks must use the moved cursor');
console.log('PASS: accumulated cursor movement and click position');

