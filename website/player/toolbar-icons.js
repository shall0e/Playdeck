// Official Lucide package, bundled at build time for offline use.
import {createElement, Menu, Monitor, Settings, ArrowLeft, RotateCw, Maximize, X, Cast, Trash, Play, MousePointer2, RotateCcw, Gamepad2} from 'lucide';
const paths={menu:Menu,monitor:Monitor,settings:Settings,'arrow-left':ArrowLeft,'rotate-cw':RotateCw,maximize:Maximize,x:X,cast:Cast,trash:Trash,play:Play,'mouse-pointer-2':MousePointer2,'rotate-ccw':RotateCcw,'gamepad-2':Gamepad2};
const controls=[['#badge','settings'],['.game-menu > summary','menu'],['.game-display > summary','monitor'],
 ['[data-action="return"]','arrow-left'],['[data-action="reload"]','rotate-cw'],['[data-action="fullscreen"]','maximize'],['[data-action="exit"]','x'],['[data-action="cast"]','cast'],
 ['#clear-game','trash'],['#clear','trash'],['#retry','rotate-cw'],['#continue','play'],
 ['#playdeck-launch button[type="submit"]','play'],['#mouse-relock','mouse-pointer-2'],
 ['#tv-connect','cast'],['#tv-stop','x'],['#tv-cast button[value="close"]','x']];
export function iconMarkup(name){
 const node=paths[name];if(!node)throw new Error('Unknown player icon');
 const attrs={class:'lucide lucide-icon lucide-'+name,'data-playdeck-icon':name,width:'16',height:'16','aria-hidden':'true'};
 if(typeof document!=='undefined' && document.createElementNS)return createElement([node[0],{...node[1],...attrs},node[2]]).outerHTML;
 const children=node[2].map(([tag,attributes])=>'<'+tag+' '+Object.entries(attributes).map(([key,value])=>key+'="'+value+'"').join(' ')+'/>').join('');
 return '<svg xmlns="http://www.w3.org/2000/svg" class="'+attrs.class+'" data-playdeck-icon="'+name+'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+children+'</svg>';
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
