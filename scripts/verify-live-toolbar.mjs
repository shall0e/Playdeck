import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const origin=process.env.PLAYDECK_URL;
if(!origin)throw new Error('Missing Playdeck deployment URL');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:800}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const url=new URL('/player/',origin);url.searchParams.set('url','https://example.com/');url.searchParams.set('displayOptions','true');url.searchParams.set('toolbar','visible');
 await page.goto(url.href,{waitUntil:'domcontentloaded'});
 for(const name of ['menu','monitor','settings']){
  const icon=page.locator('#game-menu-bar svg[data-playdeck-icon="'+name+'"]');
  try{await icon.waitFor({state:'visible',timeout:15000});}catch(error){
   const probes=await Promise.all(['/player/','/player/boot.js','/player/toolbar-icons.js'].map(async path=>{const response=await page.request.get(new URL(path,origin).href);const body=await response.text();return {path,status:response.status(),type:response.headers()['content-type'],start:body.slice(0,160),icons:body.includes('toolbarIconPaths') || body.includes('data-playdeck-icon')};}));
   console.error(JSON.stringify({errors,url:page.url(),toolbarCount:await page.locator('#game-menu-bar').count(),body:(await page.locator('body').innerText()).slice(0,4000),head:(await page.locator('head').innerHTML()).slice(-3500),probes}));
   await page.screenshot({path:'playdeck-toolbar.png'});throw error;
  }
  const box=await icon.boundingBox();assert(box?.width>0 && box?.height>0,'Missing visible '+name+' icon');
 }
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('#game-menu-bar svg[data-playdeck-icon="settings"]').waitFor({state:'visible'});
 assert.equal(await page.locator('#game-menu-bar svg[data-playdeck-icon]').count(),8);
 await page.screenshot({path:'playdeck-toolbar.png'});
 console.log(JSON.stringify({url:page.url(),visibleIcons:8,reloadPassed:true,pageErrors:errors}));
}finally{await browser.close();}
