import {appendFileSync} from 'node:fs';
const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,PLAYER_PROJECT:requested='playdeck',PLAYER_HOST:host}=process.env;
if(!token || !account)throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for this repository.');
if(!/^[a-z0-9][a-z0-9-]*$/.test(requested))throw new Error('Invalid Pages project name');
const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+'/pages/projects';
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
async function get(url){
 const response=await fetch(url,{headers});const data=await response.json();
 if(!response.ok || !data.success)throw new Error('Pages project lookup failed: '+JSON.stringify(data.errors?.map(e=>({code:e.code,message:e.message})) || []));
 return data;
}
let project;
if(host){
 // The assigned pages.dev domain is not necessarily the project's API name.
 // Resolve the existing live host instead of creating a similarly named site.
 if(!/^[a-z0-9-]+\.pages\.dev$/.test(host))throw new Error('Invalid Playdeck host');
 for(let page=1;!project;page++){
  const data=await get(endpoint+'?per_page=100&page='+page);
  project=data.result.find(value=>value.subdomain===host);
  if(page>=(data.result_info?.total_pages || 1))break;
 }
 if(!project)throw new Error('The live Playdeck host '+host+' was not found in the configured Cloudflare account.');
}else{
 let response=await fetch(endpoint+'/'+requested,{headers}),data=await response.json();
 if(response.status===404){response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({name:requested,production_branch:'main'})});data=await response.json();}
 if(!response.ok || !data.success)throw new Error('Pages project setup failed: '+JSON.stringify(data.errors?.map(e=>({code:e.code,message:e.message})) || []));
 project=data.result;
}
if(!project.production_branch || /[\r\n]/.test(project.production_branch))throw new Error('Invalid production branch');
appendFileSync(process.env.GITHUB_ENV,'PAGES_PROJECT='+project.name+'\nPAGES_PRODUCTION_BRANCH='+project.production_branch+'\nPAGES_URL=https://'+project.subdomain+'\n');
console.log('Playdeck live project: '+project.name+' -> https://'+project.subdomain);
