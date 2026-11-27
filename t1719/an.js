const g=require('./graph.json');
const tops=Object.keys(g.tops);
const groups={
 npc: t=>/^npc_/.test(t)||['lent','temperament'].includes(t),
 script: t=>/^script_/.test(t)||['scripts','default_scripts','conditions','queue','queue_tree','queues'].includes(t),
 worldgen: t=>['terrain_gen','land','regions','region_map','land_sites','starting_sites','player_start','node_gen','names','starting_city','trade_org','city_layout'].includes(t),
};
const which=process.argv[2]; const inG=groups[which];
const G=tops.filter(inG); const sum=(k)=>G.reduce((a,t)=>a+(g.lines[t]?.[k]||0),0);
console.log(which,'modules',G.length,'prod',sum('prod'),'test',sum('test'));
console.log('test-only in group:',G.filter(t=>g.tops[t]).join(' '));
for(const kind of ['prod','test']){
 const out={},inn={};
 for(const [from,to] of Object.entries(g.edges[kind])) for(const [t,n] of Object.entries(to)){
   if(inG(from)&&!inG(t)) (out[t]??=[]).push(from);
   if(!inG(from)&&inG(t)) (inn[from]??=[]).push(t);
 }
 console.log(`\n[${kind}] group needs ${Object.keys(out).length} outside modules:`, Object.entries(out).sort((a,b)=>b[1].length-a[1].length).map(([k,v])=>k+'('+v.length+')').join(' '));
 console.log(`[${kind}] ${Object.keys(inn).length} outside modules need the group:`); for(const [k,v] of Object.entries(inn).sort()) console.log('  '+k+(g.tops[k]?' [test-only]':'')+' -> '+[...new Set(v)].join(','));
}
