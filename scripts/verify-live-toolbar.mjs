import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {iconMarkup} from '../website/player/toolbar-icons.js';
const origin=process.env.PLAYDECK_URL;
const expected=process.env.EXPECTED_REVISION;
if(!origin)throw new Error('Missing Playdeck deployment URL');
const browser=await chromium.launch({headless:true});
let page;
try{
 const context=await browser.newContext({viewport:{width:1200,height:800}});
 // Test the real player shell without downloading a full game.
 await context.route('**/player/games/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Player verification</body></html>'}));
 page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const url=new URL('/player/',origin);url.searchParams.set('url','https://example.com/');
 url.searchParams.set('displayOptions','true');url.searchParams.set('toolbar','visible');
 const controls=[['#badge','settings'],['.game-menu > summary','menu'],['.game-display > summary','monitor'],['#toggle','gamepad-2']];
 async function assertIcon(root,selector,name){
  const control=root.locator(selector),svg=control.locator('svg[data-playdeck-icon="'+name+'"]');
  await svg.waitFor({state:'attached',timeout:20000});
  assert.equal(await svg.count(),1,'Duplicate '+name);
  const actual=await svg.evaluate(el=>Array.from(el.children).map(child=>[child.tagName.toLowerCase(),Object.fromEntries(Array.from(child.attributes).filter(a=>a.name!=='key').map(a=>[a.name,a.value]))]));
  const official=iconMarkup(name);
  for(const [tag,attrs] of actual){
   assert(official.includes('<'+tag),'Unexpected icon geometry for '+name);
   for(const [key,value] of Object.entries(attrs))assert(official.includes(key+'="'+value+'"'),'Non-Lucide '+name+' attribute '+key);
  }
  const box=await svg.boundingBox();assert(box?.width>0 && box?.height>0,'Invisible '+name);
 }
 async function check(root){
  for(const [selector,name] of controls)await assertIcon(root,selector,name);
  // Status refreshes must preserve the SVG and mapping changes must preserve it too.
  await root.locator('#toggle').click();
  await root.locator('#enable').evaluate(input=>{input.checked=!input.checked;input.dispatchEvent(new Event('change',{bubbles:true}));});
  await new Promise(resolve=>setTimeout(resolve,1600));
  await assertIcon(root,'#toggle','gamepad-2');
  await root.locator('#toggle').click();
  await root.locator('#badge').click();
  await root.locator('#performance-control select').waitFor({state:'visible'});
  assert.equal(await root.locator('#performance-control select option').count(),4);
  await root.locator('#badge').click();
 }
 for(let attempt=0;attempt<6;attempt++){
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  const revision=await page.locator('meta[name="playdeck-build"]').getAttribute('content').catch(()=>null);
  if(!expected || revision===expected)break;
  if(attempt===5)throw Error('Production is serving '+revision+' instead of '+expected);
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 await check(page);
 await page.reload({waitUntil:'domcontentloaded'});await check(page);
 await page.screenshot({path:'playdeck-toolbar.png'});
 // Verify the actual launcher still embeds this deployment.
 await page.goto('https://timebomb.lol/',{waitUntil:'domcontentloaded'});
 const catalogResponse=await page.request.get('https://raw.githubusercontent.com/shall0e/Playdeck/refs/heads/main/games.json');
 const catalog=await catalogResponse.json();
 const games=Array.isArray(catalog)?catalog:catalog.games;
 const game=games.find(g=>g.id && !g.disabled && !g.noProxy && !g.nativeGamepad && !g.playerOptions?.nativeGamepad);
 assert(game,'No catalog entry suitable for controller verification');
 const gameButton=page.locator('button.game[data-play="'+game.id+'"]');
 await gameButton.waitFor({state:'visible',timeout:20000});await gameButton.click();
 const frame=page.frameLocator('#stage iframe');
 await frame.locator('#game-menu-bar').waitFor({state:'attached',timeout:30000});
 const source=await page.locator('#stage iframe').getAttribute('src');
 assert.equal(new URL(source).origin,new URL(origin).origin,'Timebomb embeds a different Playdeck deployment');
 await frame.locator('#toolbar-edge').click({force:true});
 await assertIcon(frame,'#toggle','gamepad-2');
 await frame.locator('#badge').click();
 await frame.locator('#performance-control select').waitFor({state:'visible'});
 await page.screenshot({path:'playdeck-timebomb.png'});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({origin,revision:expected,officialLucide:true,controllerStatusUpdates:true,reloadPassed:true,timebombEmbedded:true,performanceOptions:4}));
}catch(error){
 if(page){console.error(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText()).slice(0,3000)}));await page.screenshot({path:'playdeck-toolbar.png'}).catch(()=>{});}
 throw error;
}finally{await browser.close();}
