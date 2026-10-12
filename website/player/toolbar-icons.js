// Native Playdeck icons, independent of cached toolbar-label updates.
const paths={
 menu:'<path d="M4 5h16M4 12h16M4 19h16"/>',
 monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
 settings:"<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"></path><circle cx=\"12\" cy=\"12\" r=\"3\"></circle>",
 'arrow-left':'<path d="m12 19-7-7 7-7m-7 7h14"/>',
 'rotate-cw':'<path d="M21 7v5h-5"/><path d="M20 12a8 8 0 1 0-2 6M21 12l-3-6"/>',
 maximize:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
 x:'<path d="m6 6 12 12M6 18 18 6"/>',
 cast:'<path d="M2 16a6 6 0 0 1 6 6M2 12a10 10 0 0 1 10 10M2 8V4h20v16h-6"/><path d="M2 20h.01"/>'
};
const controls=[['#badge','settings'],['.game-menu > summary','menu'],['.game-display > summary','monitor'],
 ['[data-action="return"]','arrow-left'],['[data-action="reload"]','rotate-cw'],['[data-action="fullscreen"]','maximize'],['[data-action="exit"]','x'],['[data-action="cast"]','cast']];
export function iconMarkup(name){
 if(!paths[name])throw new Error('Unknown player icon');
 return '<svg xmlns="http://www.w3.org/2000/svg" class="lucide-icon lucide-'+name+'" data-playdeck-icon="'+name+'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
}
export function installToolbarIcons(root){
 const update=()=>{
  for(const [selector,name] of controls){
   const control=root.querySelector(selector);if(!control)continue;
   if(control.querySelector('svg[data-playdeck-icon="'+name+'"]'))continue;
   control.querySelectorAll('svg.lucide-icon').forEach(icon=>icon.remove());
   control.insertAdjacentHTML('afterbegin',iconMarkup(name));
   control.classList.add('playdeck-icon-control');
  }
 };
 update();
 const observer=new MutationObserver(update);observer.observe(root,{childList:true,subtree:true});
 return ()=>observer.disconnect();
}
if(typeof document!=='undefined'){
 const style=document.createElement('style');
 style.textContent='.playdeck-icon-control{display:flex!important;align-items:center!important;gap:7px!important}.playdeck-icon-control>.lucide-icon{display:block!important;visibility:visible!important;opacity:1!important;width:16px!important;height:16px!important;flex:0 0 16px!important;fill:none!important;stroke:currentColor!important;stroke-width:2!important}';
 document.head.append(style);
 const attach=()=>{const bar=document.getElementById('game-menu-bar');if(!bar)return false;installToolbarIcons(bar);return true;};
 if(!attach()){
  const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});
  observer.observe(document.documentElement,{subtree:true,childList:true});
 }
}
