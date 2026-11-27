const g=require('./graph.json');
const set=new Set(process.argv[2].split(',')); const inG=t=>set.has(t);
const G=[...set]; const sum=k=>G.reduce((a,t)=>a+(g.lines[t]?.[k]||0),0);
console.log('modules',G.length,'prod',sum('prod'),'test',sum('test'));
const out={},inn={};
for(const [from,to] of Object.entries(g.edges.prod)) for(const t of Object.keys(to)){
  if(inG(from)&&!inG(t)) (out[t]??=new Set()).add(from);
  if(!inG(from)&&inG(t)) (inn[from]??=new Set()).add(t);}
console.log('needs',Object.keys(out).length,':',Object.keys(out).sort().join(' '));
console.log('needed by',Object.keys(inn).length,':',Object.entries(inn).sort().map(([k,v])=>k+'->'+[...v].join('+')).join('  '));
