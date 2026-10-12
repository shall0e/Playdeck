import {appendFileSync} from 'node:fs';
const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,PLAYER_PROJECT:name='playdeck-1z1'}=process.env;
if(!token || !account)throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for this repository.');
if(!/^[a-z0-9][a-z0-9-]*$/.test(name))throw new Error('Invalid Pages project name');
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects`;
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
let response=await fetch(endpoint+'/'+name,{headers});let data=await response.json();
if(response.status===404){
  response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({name,production_branch:'main'})});data=await response.json();
}
if(!response.ok || !data.success)throw new Error('Pages project setup failed: '+JSON.stringify(data.errors?.map(e=>({code:e.code,message:e.message})) || []));
const project=data.result;
if(!project.production_branch || /[\r\n]/.test(project.production_branch))throw new Error('Invalid production branch');
appendFileSync(process.env.GITHUB_ENV,`PAGES_PROJECT=${name}\nPAGES_PRODUCTION_BRANCH=${project.production_branch}\n`);
console.log('Playdeck Pages project: '+project.subdomain);
