// Reveal controls near the bottom edge; keep panels and keyboard focus accessible.
export function installToolbar(bar,settingsPanel,{getFrame,alwaysVisible=false}) {
  const edge=document.createElement('button');edge.id='toolbar-edge';edge.type='button';
  edge.setAttribute('aria-label','Show player controls');edge.setAttribute('aria-controls',bar.id);edge.setAttribute('aria-expanded','false');
  document.body.append(edge);
  let timer,pointerOver=false;
  const open=()=>!settingsPanel.hidden || [...bar.querySelectorAll('details')].some(node=>node.open) || [...bar.children].some(node=>node.shadowRoot?.querySelector('#panel:not([hidden])'));
  function show(){clearTimeout(timer);bar.classList.add('is-visible');bar.inert=false;edge.setAttribute('aria-expanded','true');}
  function hide(){if(alwaysVisible || open() || pointerOver || bar.matches(':focus-within'))return;bar.classList.remove('is-visible');bar.inert=true;edge.setAttribute('aria-expanded','false');}
  function schedule(){clearTimeout(timer);timer=setTimeout(hide,650);}
  function track(event,doc=document) {
    if(event.pointerType==='touch')return;
    if(doc.pointerLockElement)return;
    let y=event.clientY;
    if(doc!==document){const rect=getFrame()?.getBoundingClientRect();if(!rect)return;y=rect.top+y*rect.height/(doc.defaultView.innerHeight || rect.height);}
    if(y>=innerHeight-64)show();else if(!pointerOver)schedule();
  }
  edge.addEventListener('pointerenter',show);edge.addEventListener('pointerleave',schedule);
  edge.addEventListener('click',()=>{show();bar.querySelector('#badge')?.focus();});
  bar.addEventListener('pointerenter',()=>{pointerOver=true;show();});bar.addEventListener('pointerleave',()=>{pointerOver=false;schedule();});
  bar.addEventListener('focusin',show);bar.addEventListener('focusout',schedule);
  document.addEventListener('pointermove',event=>track(event),{passive:true});
  document.addEventListener('timebomb:menu-open',show);
  document.addEventListener('pointerdown',event=>{if(event.composedPath().includes(bar) || event.composedPath().includes(settingsPanel) || event.target===edge)return;bar.querySelectorAll('details').forEach(node=>node.open=false);bar.querySelector('#badge')?.blur();schedule();},true);
  const watched=new WeakSet();
  function attach(doc){if(!doc || watched.has(doc))return;watched.add(doc);doc.addEventListener('pointermove',event=>track(event,doc),{passive:true});doc.addEventListener('pointerdown',schedule,{passive:true});doc.addEventListener('pointerlockchange',()=>{if(doc.pointerLockElement && !alwaysVisible){pointerOver=false;bar.classList.remove('is-visible');bar.inert=true;edge.setAttribute('aria-expanded','false');}},true);}
  bar.inert=true;if(alwaysVisible)show();
  return {show,attach};
}

