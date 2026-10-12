import {parse,tokenizer} from './vendor/acorn.js';

function tree(source) {
  const options={ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true,allowHashBang:true};
  try{return parse(source,{...options,sourceType:'module'});}catch{try{return parse(source,{...options,sourceType:'script'});}catch{return null;}}
}

function walk(node,visit,parent=null) {
  if(!node || typeof node!=='object')return;
  if(typeof node.type==='string')visit(node,parent);
  for(const [key,value] of Object.entries(node)) {
    if(['start','end','loc'].includes(key))continue;
    if(Array.isArray(value))for(const child of value)walk(child,visit,node);
    else if(value && typeof value==='object')walk(value,visit,node);
  }
}

export function rewriteJavaScript(source,{mapURL=value=>value,identity=false,mobile=false}={}) {
  if(source.length>1024*1024)return rewriteLargeImports(source,mapURL);
  const ast=tree(source);
  if(!ast)return source; // Unknown syntax must remain byte-for-byte intact.
  const edits=[],fields=new Set(['href','origin','hostname','host','protocol','pathname','search','hash']);
  const quote=(value,node)=>source[node.start]==="'"?"'"+value.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'":JSON.stringify(value);
  let shadowedLocation=false;
  walk(ast,node=>{if(node.type==='VariableDeclarator' && node.id.type==='Identifier' && node.id.name==='location')shadowedLocation=true;if(/Function/.test(node.type) && node.params?.some(p=>p.type==='Identifier' && p.name==='location'))shadowedLocation=true;});
  const locationObject=node=>node?.type==='Identifier' ? !shadowedLocation && node.name==='location' : node?.type==='MemberExpression' && !node.computed && node.property.name==='location' && node.object.type==='Identifier' && ['window','self','globalThis','document'].includes(node.object.name);
  walk(ast,(node,parent)=>{
    if(mobile && node.type==='IfStatement' && node.consequent.type==='ReturnStatement' && node.consequent.argument?.type==='ObjectExpression'){
      const gate=node.consequent.argument.properties.some(property=>property.key?.name==='kind' && property.value?.value==='mobile'),condition=source.slice(node.test.start,node.test.end);
      if(gate && /navigator\s*\.\s*userAgent/.test(condition) && /Android|iPhone|iPad|Mobile/.test(condition))edits.push({start:node.test.start,end:node.test.end,text:'globalThis.__playdeckContext?.compatibility?.desktop===false && ('+condition+')'});
    }
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) && node.source) {
      const mapped=mapURL(node.source.value);
      if(mapped!==node.source.value)edits.push({start:node.source.start,end:node.source.end,text:quote(mapped,node.source)});
    }
    if(node.type==='ImportExpression') {
      if(node.source.type==='Literal' && typeof node.source.value==='string') {
        const mapped=mapURL(node.source.value);if(mapped!==node.source.value)edits.push({start:node.source.start,end:node.source.end,text:quote(mapped,node.source)});
      } else edits.push({start:node.source.start,end:node.source.start,text:'globalThis.__playdeckMap('},{start:node.source.end,end:node.source.end,text:')'});
    }
    if(!identity || node.type!=='MemberExpression' || node.computed || !fields.has(node.property.name) || !locationObject(node.object))return;
    const written=parent && ((parent.type==='AssignmentExpression' && parent.left===node) || parent.type==='UpdateExpression' || (parent.type==='UnaryExpression' && parent.operator==='delete'));
    if(!written)edits.push({start:node.start,end:node.end,text:'globalThis.__playdeckSourceLocation.'+node.property.name});
  });
  // Outer replacements suppress child edits. Insertions at expression boundaries stay valid.
  const selected=edits.sort((a,b)=>a.start-b.start || b.end-a.end).filter((edit,index,list)=>!list.slice(0,index).some(previous=>previous.end>previous.start && previous.start<=edit.start && previous.end>=edit.end));
  for(const edit of selected.sort((a,b)=>b.start-a.start || b.end-a.end))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  return source;
}

export function executableScript(type) {
  return !type || /^(?:module|(?:text|application)\/(?:java|ecma)script(?:\s*;.*)?)$/i.test(type.trim());
}

export function rewriteMobilePolicy(source) {
  return rewriteJavaScript(source,{mobile:true});
}

// Large generated engines are tokenized with bounded lookbehind instead of
// allocating an AST for millions of literals. URL hooks handle ordinary requests.
function rewriteLargeImports(source,mapURL){
  const edits=[],groups=[],imports=[];let previous=null,beforePrevious=null;
  const quote=(value,token)=>source[token.start]==="'"?"'"+value.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'":JSON.stringify(value);
  const finish=(entry,end)=>{if(!entry.first)return;if(entry.count===1 && entry.first.type.label==='string'){const mapped=mapURL(entry.first.value);if(mapped!==entry.first.value)edits.push({start:entry.first.start,end:entry.first.end,text:quote(mapped,entry.first)});}else edits.push({start:entry.first.start,end:entry.first.start,text:'globalThis.__playdeckMap('},{start:end,end,text:')'});};
  try{const tokens=tokenizer(source,{ecmaVersion:'latest',sourceType:'module',allowHashBang:true});while(true){const token=tokens.getToken(),label=token.type.label;if(label==='eof')break;
    for(const entry of imports)if(!entry.done){if(groups.length===entry.depth && (label===',' || label===')')){finish(entry,token.start);entry.done=true;}else{entry.first ||= token;entry.count++;}}
    if(label==='string' && (previous?.type.label==='import' || previous?.value==='from')){const mapped=mapURL(token.value);if(mapped!==token.value)edits.push({start:token.start,end:token.end,text:quote(mapped,token)});}
    if(['(','[','{','${'].includes(label)){groups.push(label);if(label==='(' && previous?.type.label==='import' && !['.','?.'].includes(beforePrevious?.type.label))imports.push({depth:groups.length,first:null,count:0,done:false});}
    else if([')',']','}'].includes(label)){groups.pop();while(imports.length && imports.at(-1).depth>groups.length)imports.pop();}
    beforePrevious=previous;previous=token;
  }}catch{return source;}
  for(const edit of edits.sort((a,b)=>b.start-a.start || b.end-a.end))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);return source;
}

export function restoreLegacyIdentity(source){
  const ast=tree(source);if(!ast)return source;const edits=[];
  walk(ast,node=>{if(node.type==='MemberExpression' && !node.computed && node.object.type==='Identifier' && node.object.name==='globalThis' && node.property.name==='__playdeckSourceLocation')edits.push({start:node.start,end:node.end});});
  for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+'globalThis.location'+source.slice(edit.end);return source;
}
