const fs=require('fs'),path=require('path');
const SRC=process.argv[2];
const files=[]; // {file, top, test}
function modsIn(text){ // returns [{name,test,pathAttr}]
  const out=[]; const lines=text.split('\n');
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/);
    if(!m) continue;
    let test=false, pathAttr=null;
    for(let j=i-1;j>=0&&j>=i-4;j--){ const l=lines[j].trim(); if(!l.startsWith('#[')&&!l.startsWith('//'))break;
      if(/cfg\((?:all\()?test/.test(l)) test=true; const p=l.match(/#\[path\s*=\s*"([^"]+)"/); if(p) pathAttr=p[1]; }
    out.push({name:m[1],test,pathAttr});
  }
  return out;
}
function walk(file, dir, top, test){
  const text=fs.readFileSync(file,'utf8'); files.push({file,top,test,text});
  for(const m of modsIn(text)){
    let f; if(m.pathAttr) f=path.join(path.dirname(file),m.pathAttr);
    else { const a=path.join(dir,m.name+'.rs'), b=path.join(dir,m.name,'mod.rs'); f=fs.existsSync(a)?a:b; }
    const sub = path.join(dir,m.name);
    walk(f, sub, top??m.name, test||m.test);
  }
}
const lib=path.join(SRC,'lib.rs'); const libText=fs.readFileSync(lib,'utf8');
const tops={}; for(const m of modsIn(libText)) tops[m.name]=m.test;
for(const m of modsIn(libText)){ const a=path.join(SRC,m.name+'.rs'), b=path.join(SRC,m.name,'mod.rs'); walk(fs.existsSync(a)?a:b, path.join(SRC,m.name), m.name, m.test); }
// strip inline #[cfg(test)] mod x { ... } blocks -> count them as test
function split(text){ let prod='',test=''; const re=/#\[cfg\(test\)\]\s*(?:pub\s+)?mod\s+\w+\s*\{/g; let last=0,m;
  while((m=re.exec(text))){ prod+=text.slice(last,m.index); let d=1,i=re.lastIndex; while(i<text.length&&d>0){ if(text[i]=='{')d++; else if(text[i]=='}')d--; i++; } test+=text.slice(m.index,i); last=i; re.lastIndex=i; }
  prod+=text.slice(last); return [prod,test]; }
function refs(text){ const s=new Set(); text=text.replace(/\/\/.*$/gm,'');
  for(const m of text.matchAll(/crate::(\w+)/g)) s.add(m[1]);
  for(const m of text.matchAll(/crate::\{([^;]*?)\}\s*;/gs)){ // grouped
    let depth=0,cur='',parts=[]; for(const c of m[1]){ if(c=='{')depth++; if(c=='}')depth--; if(c==','&&depth==0){parts.push(cur);cur='';} else cur+=c;} parts.push(cur);
    for(const p of parts){ const w=p.trim().match(/^(\w+)/); if(w) s.add(w[1]); } }
  return s; }
const edges={prod:{},test:{}}; const lines={};
for(const f of files){ let [p,t]=f.test?['',f.text]:split(f.text);
  const n=f.text.split('\n').length; lines[f.top]=lines[f.top]||{prod:0,test:0}; 
  lines[f.top].test+=t.split('\n').length-(t?0:1); lines[f.top].prod+=f.test?0:p.split('\n').length;
  for(const [kind,txt] of [['prod',p],['test',t]]) for(const r of refs(txt)){ if(!(r in tops)||r==f.top) continue; (edges[kind][f.top]??={})[r]=((edges[kind][f.top]??={})[r]||0)+1; } }
fs.writeFileSync('graph.json',JSON.stringify({tops,edges,lines},null,1));
console.log('files',files.length,'tops',Object.keys(tops).length, 'prod lines',Object.values(lines).reduce((a,b)=>a+b.prod,0),'test lines',Object.values(lines).reduce((a,b)=>a+b.test,0));
