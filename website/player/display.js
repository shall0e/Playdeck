export const displayCSS="\n.game-display{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:4;font:15px system-ui,sans-serif;color:#e0e4dc;color-scheme:dark}\n.game-display summary{cursor:pointer;list-style:none;border:0;outline:0;padding:9px 13px;border-radius:10px;background:rgba(25,28,25,.58);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 4px 18px #0003;color:#e0e4dc;font-size:12px;transition:background .18s}\n.game-display summary:hover,.game-display summary:focus-visible{background:rgba(45,49,43,.72)}\n.game-display summary::-webkit-details-marker{display:none}\n.game-display .display-panel{position:absolute;bottom:46px;left:50%;transform:translateX(-50%);width:min(340px,calc(100vw - 24px));max-height:80vh;overflow:auto;border:0;border-radius:14px;padding:20px;background:rgba(25,28,25,.68);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 8px 30px #0004;scrollbar-width:thin;scrollbar-color:#ffffff30 transparent}\n.game-display header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}\n.game-display h2{font:700 15px system-ui,sans-serif;letter-spacing:normal;margin:0}\n.game-display label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0;font-size:13px}\n.game-display select,.game-display button{font:13px system-ui,sans-serif;color:inherit;border:0;border-radius:10px;background:rgba(110,120,106,.19);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:9px 14px}\n.game-display button{cursor:pointer}.game-display button:hover{background:rgba(140,150,136,.3)}\n.game-display select{max-width:160px}.game-display option{background:#191c19;color:#e0e4dc}\n.game-display p{margin:12px 0 0;color:#bdc3b9;font-size:13px;line-height:1.5}\n.game-display :focus-visible{outline:2px solid #bdc3b9;outline-offset:2px}\n";
export const displayMarkup='<summary aria-label="Game display settings"><svg class="lucide-icon lucide-monitor" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg><span>Display</span></summary><section class="display-panel" aria-label="Display settings"><header><h2>Game display</h2></header><label>Ratio<select aria-label="Game aspect ratio" data-display-ratio></select></label></section>';
export function displayConfig(value){
 if(value===null || value===false || value===undefined)return null;
 if(value!==true && (typeof value!=='object' || Array.isArray(value)))throw new Error('Invalid display configuration');
 const config=value===true?{}:value,supported=['auto','4:3','16:9','16:10','21:9','1:1'],ratios=config.ratios || supported;
 if(!Array.isArray(ratios) || !ratios.length || ratios.some(r=>!supported.includes(r)))throw new Error('Invalid display ratios');
 const ratio=config.ratio || config.defaultRatio || (ratios.includes('16:9')?'16:9':ratios[0]),mode='stretch';
 if(!ratios.includes(ratio) || !['fit','stretch','zoom'].includes(mode))throw new Error('Invalid display selection');
 return {ratios:[...new Set(ratios)],ratio,mode};
}

export function canvasDisplayBox(width,height,ratio='16:9'){
  if(ratio==='16:9' || ratio==='auto')return {width,height,left:0,top:0};
  const [x,y]=ratio.split(':').map(Number),aspect=x/y;
  if(!(aspect>0))return {width,height,left:0,top:0};
  const h=Math.min(height,width/aspect),w=h*aspect;
  return {width:w,height:h,left:(width-w)/2,top:(height-h)/2};
}

