'use strict';
const query=new URLSearchParams(location.search);
if(query.has('url'))location.replace('/player/'+location.search+location.hash);
else {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const choices=[...document.querySelectorAll('[data-preview]')],scenes=[...document.querySelectorAll('[data-scene]')],ambient=[...document.querySelectorAll('.ambient')];
  let selected=0,timer;
  function selectPreview(index){
    selected=index;
    choices.forEach((button,i)=>{button.classList.toggle('is-active',i===index);button.setAttribute('aria-pressed',String(i===index));});
    scenes.forEach((scene,i)=>{scene.classList.toggle('is-active',i===index);scene.setAttribute('aria-hidden',String(i!==index));});
    ambient.forEach((image,i)=>image.classList.toggle('is-active',i===index));
  }
  function cycle(){clearInterval(timer);if(!reduced.matches && !document.hidden)timer=setInterval(()=>selectPreview((selected+1)%choices.length),9000);}
  choices.forEach(button=>button.addEventListener('click',()=>{selectPreview(Number(button.dataset.preview));clearInterval(timer);}));
  const showcase=document.querySelector('.showcase');
  showcase.addEventListener('pointerenter',()=>clearInterval(timer));showcase.addEventListener('pointerleave',()=>{if(!showcase.contains(document.activeElement))cycle();});
  showcase.addEventListener('focusin',()=>clearInterval(timer));showcase.addEventListener('focusout',event=>{if(!showcase.contains(event.relatedTarget))cycle();});
  document.addEventListener('visibilitychange',cycle);reduced.addEventListener('change',cycle);cycle();
  if('IntersectionObserver' in window && !reduced.matches){
    document.documentElement.classList.add('js-motion');
    const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}});},{threshold:.08});
    document.querySelectorAll('.reveal').forEach(element=>observer.observe(element));
  }
  document.querySelector('#quick-launch').addEventListener('submit',event=>{
    event.preventDefault();const error=document.querySelector('#link-error');error.hidden=true;
    try{
      const game=new URL(document.querySelector('#game-url').value.trim());
      if(game.protocol!=='https:' || game.username || game.password || game.port || game.origin===location.origin || !game.hostname.includes('.'))throw new Error('Invalid game link');
      const player=new URL('/player/',location.origin);player.searchParams.set('url',game.href);location.assign(player.href);
    }catch{error.textContent='Enter a public HTTPS game link, such as https://example.com/game/.';error.hidden=false;document.querySelector('#game-url').focus();}
  });
}
