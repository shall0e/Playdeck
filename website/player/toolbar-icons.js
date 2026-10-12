// Lucide SVGs bundled locally for offline players. License: ./lucide-LICENSE.txt
const paths={
  "menu": "<path d=\"M4 5h16\" /> <path d=\"M4 12h16\" /> <path d=\"M4 19h16\" />",
  "monitor": "<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\" /> <line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\" /> <line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\" />",
  "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "arrow-left": "<path d=\"m12 19-7-7 7-7\" /> <path d=\"M19 12H5\" />",
  "rotate-cw": "<path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" />",
  "maximize": "<path d=\"M8 3H5a2 2 0 0 0-2 2v3\" /> <path d=\"M21 8V5a2 2 0 0 0-2-2h-3\" /> <path d=\"M3 16v3a2 2 0 0 0 2 2h3\" /> <path d=\"M16 21h3a2 2 0 0 0 2-2v-3\" />",
  "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
  "cast": "<path d=\"M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6\" /> <path d=\"M2 12a9 9 0 0 1 8 8\" /> <path d=\"M2 16a5 5 0 0 1 4 4\" /> <line x1=\"2\" x2=\"2.01\" y1=\"20\" y2=\"20\" />",
  "trash": "<path d=\"M10 11v6\" /> <path d=\"M14 11v6\" /> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" /> <path d=\"M3 6h18\" /> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />",
  "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />",
  "mouse-pointer-2": "<path d=\"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z\" />",
  "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /> <path d=\"M3 3v5h5\" />",
  "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "gauge": "<path d=\"m12 14 4-4\" /> <path d=\"M3.34 19a10 10 0 1 1 17.32 0\" />",
  "gamepad-2": "<line x1=\"6\" x2=\"10\" y1=\"11\" y2=\"11\" /> <line x1=\"8\" x2=\"8\" y1=\"9\" y2=\"13\" /> <line x1=\"15\" x2=\"15.01\" y1=\"12\" y2=\"12\" /> <line x1=\"18\" x2=\"18.01\" y1=\"10\" y2=\"10\" /> <path d=\"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z\" />"
};
const controls=[['#badge','settings'],['.game-menu > summary','menu'],['.game-display > summary','monitor'],
 ['[data-action="return"]','arrow-left'],['[data-action="reload"]','rotate-cw'],['[data-action="fullscreen"]','maximize'],['[data-action="exit"]','x'],['[data-action="cast"]','cast'],
 ['#clear-game','trash'],['#clear','trash'],['#retry','rotate-cw'],['#continue','play'],
 ['#playdeck-launch button[type="submit"]','play'],['#mouse-relock','mouse-pointer-2'],
 ['#tv-connect','cast'],['#tv-stop','x'],['#tv-cast button[value="close"]','x']];
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
 style.textContent='.playdeck-icon-control[hidden]{display:none!important}.playdeck-icon-control{display:flex!important;align-items:center!important;gap:7px!important}.playdeck-icon-control>.lucide-icon{display:block!important;visibility:visible!important;opacity:1!important;width:16px!important;height:16px!important;flex:0 0 16px!important;fill:none!important;stroke:currentColor!important;stroke-width:2!important}';
 document.head.append(style);
 const attach=()=>installToolbarIcons(document.body);
 if(document.body)attach();else document.addEventListener('DOMContentLoaded',attach,{once:true});
}
