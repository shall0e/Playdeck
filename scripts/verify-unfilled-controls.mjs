import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fixtureServer} from './browser-fixture.mjs';
const fixture=fixtureServer(), origin=await fixture.start();
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1200,height:800}});
  await page.goto(origin+'/player/?url=https%3A%2F%2Ffixture.example%2Fone%2Findex.html&toolbar=visible&displayOptions=true');
  await page.locator('#badge').waitFor({state:'visible'});
  const check=async locator=>{
    for(const el of await locator.all()) {
      if(!await el.isVisible()) continue;
      const style=await el.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,image:s.backgroundImage,outline:s.outlineWidth,shadow:s.boxShadow};});
      assert.equal(style.background,'rgba(0, 0, 0, 0)');
      assert.equal(style.image,'none');
      assert.equal(style.outline,'0px',await el.evaluate(el=>el.outerHTML));
      assert.equal(style.shadow,'none');
    }
  };
  for(const theme of ['glass','transparent']) {
    await page.locator('#badge').click();
    await page.locator('select[name=appearance]').selectOption(theme);
    await page.waitForTimeout(300);
    if(await page.locator('body > #panel').isHidden()) await page.locator('#badge').click();
    await check(page.locator('#game-menu-bar :is(button,summary),body > #panel :is(button,summary,select,input:not([type=checkbox]):not([type=range]))'));
    const action=page.locator('#badge');
    await action.hover(); await check(action);
    await action.focus(); await check(action);
    await page.locator('#badge').click();
    await page.locator('.game-menu > summary').click();
    await check(page.locator('.game-menu-panel button'));
    await page.locator('.game-menu > summary').click();
    await page.locator('.game-display > summary').click();
    await check(page.locator('.display-panel :is(button,summary,select)'));
    await page.locator('.game-display > summary').click();
    await page.locator('#toggle').click();
    await check(page.locator('#toggle'));
    const filled=await page.locator('#toggle').evaluate(el=>Array.from(el.getRootNode().querySelectorAll('#panel :is(button,summary,select,input:not([type=checkbox]):not([type=range]))')).filter(el=>el.getClientRects().length && getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)').map(el=>el.outerHTML));
    assert.deepEqual(filled,[]);
    await page.locator('#toggle').click();
  }
  await page.screenshot({path:'playdeck-unfilled-controls.png'});
  console.log('Unfilled menu controls verified in Glass and Transparent with normal clicks.');
} finally {await browser.close();await fixture.close();}




