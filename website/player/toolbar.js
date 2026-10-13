// Shared menu lifecycle: panel exits before the toolbar retracts.
// A single owner handles clicks in the launcher AND inside the game iframe.
export const MENU_EXIT_MS=210;
export function installToolbar(bar,settingsPanel,{getFrame,alwaysVisible=false}) {
  const edge=document.createElement('button');
  edge.id='toolbar-edge';
  edge.type='button';
  edge.setAttribute('aria-label','Show player controls');
  edge.setAttribute('aria-controls',bar.id);
  edge.setAttribute('aria-expanded','false');
  document.body.append(edge);
  let timer,closingTimer,finishClosing=null,pointerOver=false,suppressReveal=false;
  const reduced=()=>typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration=()=>reduced()?0:MENU_EXIT_MS;
  const entries=()=>[
    {name:'sandbox',node:settingsPanel,isOpen:()=>!settingsPanel.hidden,close:()=>{
      settingsPanel.hidden=true;
      bar.querySelector('#badge')?.setAttribute('aria-expanded','false');
    }},
    ...[...bar.querySelectorAll('details')].map(details=>({
      name:details.classList?.contains?.('game-display')?'display':'game',
      node:details.querySelector('.display-panel,.game-menu-panel') || details,
      isOpen:()=>details.open,
      close:()=>{details.open=false;}
    })),
    ...[...bar.children].filter(node=>node.shadowRoot).map(host=>({
      name:'controller',
      node:host.shadowRoot.querySelector('#panel'),
      isOpen:()=>!!host.shadowRoot.querySelector('#panel:not([hidden])'),
      close:()=>{}
    }))
  ].filter(entry=>entry.node);
  const hasOpen=()=>entries().some(entry=>entry.isOpen());
  function cancelPending(){
    clearTimeout(closingTimer);
    if(finishClosing){const finish=finishClosing;finishClosing=null;finish();}
  }
  function show() {
    clearTimeout(timer);
    cancelPending();
    bar.classList.add('is-visible');
    bar.inert=false;
    edge.setAttribute('aria-expanded','true');
  }
  function retract(force=false){
    if(!force && (alwaysVisible||hasOpen()||pointerOver||bar.matches(':focus-within')))return;
    if(alwaysVisible)return;
    bar.classList.remove('is-visible');
    bar.inert=true;
    edge.setAttribute('aria-expanded','false');
  }
  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(()=>retract(),650);
  }
  function releaseFocus(){
    const active=document.activeElement;
    active?.shadowRoot?.activeElement?.blur?.();
    if(bar.contains?.(active)||settingsPanel.contains?.(active))active?.blur?.();
    bar.querySelector('#badge')?.blur?.();
  }
  function closePanels({except=null,hideToolbar=false}={}) {
    clearTimeout(timer);
    cancelPending();
    const affected=entries().filter(entry=>entry.name!==except&&entry.isOpen());
    if(hideToolbar){
      suppressReveal=true;
      pointerOver=false;
      releaseFocus();
    }
    if(!affected.length){
      if(hideToolbar){
        document.dispatchEvent(new Event('playdeck:game-interaction'));
        retract(true);
      }else show();
      return;
    }
    // The open/hidden flags stay unchanged until the reverse animation finishes.
    for(const entry of affected)entry.node.classList?.add('playdeck-closing');
    const finish=()=>{
      for(const entry of affected){
        entry.node.classList?.remove('playdeck-closing');
        entry.close();
      }
      // The controller owns its internal visibility; notify once after all
      // visual exits have finished (including settings-only dismissals).
      if(hideToolbar || affected.some(entry=>entry.name==='controller'))
        document.dispatchEvent(new Event('playdeck:game-interaction'));
      if(hideToolbar)retract(true);
    };
    finishClosing=finish;
    closingTimer=setTimeout(()=>{
      if(finishClosing!==finish)return;
      finishClosing=null;
      finish();
    },duration());
  }
  // User clicks the game, blank page, or any area outside the menu chrome.
  function dismiss(){closePanels({hideToolbar:true});}
  function closeOthers(name){closePanels({except:name});}
  function track(event,doc=document){
    if(event.pointerType==='touch'||doc.pointerLockElement)return;
    let y=event.clientY;
    if(doc!==document){
      const rect=getFrame()?.getBoundingClientRect();
      if(!rect)return;
      y=rect.top+(y*rect.height)/(doc.defaultView.innerHeight||rect.height);
    }
    if(y<innerHeight-76)suppressReveal=false;
    if(y>=innerHeight-64 && !suppressReveal)show();
    else if(!pointerOver)schedule();
  }
  edge.addEventListener('pointerenter',()=>{if(!suppressReveal)show();});
  edge.addEventListener('pointerleave',schedule);
  edge.addEventListener('click',()=>{
    suppressReveal=false;
    show();
    bar.querySelector('#badge')?.focus?.();
  });
  bar.addEventListener('pointerenter',()=>{
    if(suppressReveal)return;
    pointerOver=true;
    show();
  });
  bar.addEventListener('pointerleave',()=>{pointerOver=false;schedule();});
  bar.addEventListener('focusin',()=>{suppressReveal=false;show();});
  bar.addEventListener('focusout',schedule);
  document.addEventListener('pointermove',event=>track(event),{passive:true});
  document.addEventListener('timebomb:menu-open',event=>{
    suppressReveal=false;
    closeOthers(event.detail);
  });
  document.addEventListener('playdeck:request-close',dismiss);
  bar.addEventListener('click',event=>{
    const summary=event.target.closest?.('.game-menu > summary,.game-display > summary');
    if(summary?.parentElement?.open){
      // Prevent <details> closing its content before the exit animation runs.
      event.preventDefault();
      dismiss();
    }
  },true);
  document.addEventListener('pointerdown',event=>{
    const path=event.composedPath?.()||[];
    if(path.includes(bar)||path.includes(settingsPanel)||event.target===edge)return;
    dismiss();
  },true);
  const watched=new WeakSet();
  function attach(doc){
    if(!doc||watched.has(doc))return;
    watched.add(doc);
    doc.addEventListener('pointermove',event=>track(event,doc),{passive:true});
    doc.addEventListener('pointerdown',dismiss,{passive:true,capture:true});
    doc.addEventListener('pointerlockchange',()=>{
      if(doc.pointerLockElement){
        pointerOver=false;
        dismiss();
      }
    },true);
  }
  bar.inert=true;
  if(alwaysVisible)show();
  return {show,attach,dismiss,closeOthers,toggleSettings(){
    if(settingsPanel.hidden){
      suppressReveal=false;
      document.dispatchEvent(new CustomEvent('timebomb:menu-open',{detail:'sandbox'}));
      settingsPanel.hidden=false;
      bar.querySelector('#badge')?.setAttribute('aria-expanded','true');
      show();
    }else dismiss();
  }};
}
