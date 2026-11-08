"use strict";
(() => {
  const H = window.PeruHistory, $ = (id) => document.getElementById(id), fmt = new Intl.NumberFormat('es-PE');
  const labels = {publicContributions: 'Contribuciones públicas', total: 'Contribuciones totales', followers: 'Seguidores'};
  const dec = new Intl.NumberFormat('es-PE', {maximumFractionDigits: 1});
  const signed = (v) => `${v > 0 ? '+' : ''}${fmt.format(v)}`;
  const per = (v) => `${v > 0 ? '+' : ''}${dec.format(v)}`;
  const params = new URLSearchParams(location.search);
  let groups = null, community = null, quality = null, profileKeys = [];
  async function json(url) { const response = await fetch(url); if (!response.ok) throw new Error(url); return response.json(); }
  // Links to the profile's evolution keep the chosen scope and metric.
  const profileHref = (login) => {
    const query = new URLSearchParams({users: login.toLowerCase(), metric: $('e-metric').value});
    if ($('e-city').value) query.set('city', $('e-city').value);
    return `./evolucion/?${query}`;
  };
  function profileLink(login) { const a = H.node('a', 'history-profile-button', `@${login}`); a.href = profileHref(login); return a; }

  // ---- Group analysis (computed at build time by scripts/analytics.py) ----
  const pct1=v=>`${dec.format(Math.round(v*1000)/10)} %`;
  const giniWord=g=>g<0.4?'bastante parejo':g<0.6?'moderadamente desigual':g<0.75?'desigual':'muy desigual';
  function groupRow(icon,label,text) {
    const li=H.node('li');const head=H.node('strong','',label);head.prepend(H.icon(icon));li.append(head,H.node('span','',text));return li;
  }
  function distribution(g,metric) {
    const wrap=H.node('div','group-hist');wrap.setAttribute('role','img');
    const {edges,counts}=g.histogram, top=Math.max(...counts);
    // Where the profiles named in the URL fall in the distribution.
    const column={publicContributions:1,followers:2,total:3}[metric], mine=new Map();
    for (const key of profileKeys) { const p=community?.community?.points?.find(q=>q[0].toLowerCase()===key); if (p) mine.set(key,p[column]); }
    const youIn=counts.map(()=>[]);
    mine.forEach((v,key)=>{let b=counts.length-1;for(let i=0;i<counts.length;i++){if(v<edges[i+1]||i===counts.length-1){b=i;break;}}youIn[b].push(key);});
    wrap.setAttribute('aria-label',`Distribución de ${labels[metric].toLowerCase()}: ${counts.map((c,i)=>`${fmt.format(edges[i])} a ${fmt.format(edges[i+1])}: ${c} perfiles`).join('; ')}`);
    counts.forEach((c,i)=>{
      const col=H.node('div','hist-col');
      const bar=H.node('div','hist-bar');bar.style.height=`${Math.max(c?4:0,c/top*100)}%`;
      if (youIn[i].length) { bar.classList.add('has-you'); bar.dataset.you=youIn[i].map(k=>`@${k}`).join(', '); }
      const label=H.node('span','hist-label');label.append(H.node('span','',fmt.format(edges[i])),H.node('span','hi',i===counts.length-1?'+':`–${fmt.format(edges[i+1]-1)}`));
      col.append(H.node('span','hist-count',fmt.format(c)),bar,label);
      wrap.append(col);
    });
    return wrap;
  }
  function renderGroup() {
    const panel=$('group-analysis'), body=$('group-body');
    const metric=$('e-metric').value, scope=$('e-city').value||'peru', data=groups?.metrics?.[metric];
    if (!data) { panel.hidden=true;return; }
    const g=data[scope], name=$('e-city').selectedOptions[0]?.textContent.split(' · ')[0]||'Todo Perú';
    panel.hidden=false;body.replaceChildren();
    $('group-heading').textContent=scope==='peru'?'Qué pasa en todo Perú.':`Qué pasa en ${name}.`;
    if (!g || !g.profiles) { body.append(H.node('p','history-notice','Este ámbito no tiene perfiles en la última captura válida.'));return; }
    const unit=labels[metric].toLowerCase();
    const list=H.node('ul','insight-list');
    if (g.small) list.append(groupRow('info','Grupo pequeño',`${fmt.format(g.profiles)} ${g.profiles===1?'perfil':'perfiles'} y ${fmt.format(g.total)} de ${unit} en total. Con menos de 10 perfiles no se calculan distribución ni concentración.`));
    else {
      list.append(groupRow('users','Tamaño',`${fmt.format(g.profiles)} perfiles · ${fmt.format(g.total)} de ${unit} · mediana ${fmt.format(g.median)} · P90 ${fmt.format(g.p90)} · P99 ${fmt.format(g.p99)}`));
      list.append(groupRow('layers','Concentración',`Los 10 mayores reúnen el ${pct1(g.top10Share)} del total${g.top1PctShare!==g.top10Share?` y el 1 % superior, el ${pct1(g.top1PctShare)}`:''}. Gini ${new Intl.NumberFormat('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(g.gini)}: ${giniWord(g.gini)}.`));
    }
    const gr=g.growth;
    if (gr.matched) {
      const dir=gr.delta>=0?'sube':'baja';
      let text=`De ${fmt.format(gr.matched)} perfiles comparables, el ${pct1(gr.growersShare)} aumentó su contador; la mediana es ${signed(gr.medianDelta)}. En conjunto ${dir} ${signed(gr.delta)}${gr.pct!==null?` (${per(gr.pct)} %)`:''} entre ${H.dateLabel(groups.basis.from)} y ${H.dateLabel(groups.basis.through)}.`;
      if (gr.top10Share!==null && gr.growers>=10) text+=` Los 10 que más suben aportan el ${pct1(gr.top10Share)} del aumento.`;
      list.append(groupRow('growth','Crecimiento',text));
    }
    const mix=g.trends||{}, total=(mix.alza||0)+(mix.estable||0)+(mix.baja||0);
    if (total) {
      const row=groupRow('forecast','Tendencias','');
      const bar=H.node('div','trend-mix');bar.setAttribute('role','img');
      bar.setAttribute('aria-label',`${mix.alza||0} al alza, ${mix.estable||0} estables, ${mix.baja||0} a la baja`);
      for (const [k,label] of [['alza','al alza'],['estable','estables'],['baja','a la baja']]) if (mix[k]) { const seg=H.node('span',`mix-${k}`,`${fmt.format(mix[k])} ${label}`);seg.style.flexGrow=mix[k];bar.append(seg); }
      row.querySelector('span').append(bar);list.append(row);
    }
    if (gr.newInGroup) list.append(groupRow('plus','Entradas',`${fmt.format(gr.newInGroup)} ${gr.newInGroup===1?'perfil no estaba':'perfiles no estaban'} en la primera captura válida y no cuentan como crecimiento.`));
    body.append(list);
    if (g.histogram) { const block=H.node('div','group-block');block.append(H.node('h3','','Distribución de perfiles'),distribution(g,metric),H.node('p','history-notice',profileKeys.length?'Resaltado: dónde caen los perfiles indicados en el enlace.':'Cada barra cuenta los perfiles dentro de ese rango; la escala es logarítmica.'));body.append(block); }
    if (gr.topGainers?.length||gr.emerging?.length) {
      const cols=H.node('div','group-lists');
      for (const [title,items,fmtItem] of [['Mayores avances',gr.topGainers,r=>signed(r.delta)],['Emergentes: base baja, ritmo alto',gr.emerging,r=>`${signed(r.delta)} (+${r.pct} %)`]]) {
        if (!items?.length) continue;
        const col=H.node('div','group-list');col.append(H.node('h3','',title));
        const ol=H.node('ol');
        for (const r of items) { const li=H.node('li'); li.append(profileLink(r.login),H.node('span','',fmtItem(r)));ol.append(li); }
        col.append(ol);cols.append(col);
      }
      body.append(cols);
    }
    // City comparison, normalised by group size.
    const rows=Object.entries(data).filter(([,v])=>v.profiles>=10&&!v.small);
    if (rows.length>1) {
      const options=new Map([...$('e-city').options].map(o=>[o.value||'peru',o.textContent.split(' · ')[0]]));
      const block=H.node('div','group-block');block.append(H.node('h3','','Comparación entre ámbitos'));
      const wrap=H.node('div','table-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Comparación entre ámbitos, desplazamiento horizontal');
      const table=H.node('table');const head=H.node('tr');
      ['Ámbito','Perfiles','Mediana','Top 10','Crecimiento','Crecieron'].forEach((h,i)=>head.append(Object.assign(H.node('th',i?'numeric':'',h),{scope:'col'})));
      const thead=H.node('thead');thead.append(head);table.append(thead);
      const tb=H.node('tbody');
      for (const [id,v] of rows.sort((a,b)=>b[1].profiles-a[1].profiles)) {
        const tr=H.node('tr',id===scope?'current':'');
        const nameCell=H.node('td');const btn=H.node('button','history-profile-button',options.get(id)||id);btn.addEventListener('click',()=>{$('e-city').value=id==='peru'?'':id;$('e-city').dispatchEvent(new Event('change',{bubbles:true}));});nameCell.append(btn);
        tr.append(nameCell,H.node('td','numeric',fmt.format(v.profiles)),H.node('td','numeric',fmt.format(v.median)),H.node('td','numeric',pct1(v.top10Share)),H.node('td','numeric',v.growth?.pct!=null?`${per(v.growth.pct)} %`:'—'),H.node('td','numeric',v.growth?.growersShare!=null?pct1(v.growth.growersShare):'—'));
        tb.append(tr);
      }
      table.append(tb);wrap.append(table);block.append(wrap);
      const skipped=Object.values(data).filter(v=>v.profiles&&v.profiles<10).length;
      if (skipped) block.append(H.node('p','history-notice',`${skipped} ${skipped===1?'ámbito con':'ámbitos con'} menos de 10 perfiles no se comparan.`));
      body.append(block);
    }
    const note=H.node('p','insights-basis');note.prepend(H.icon('info'));
    note.append(`Grupo: perfiles que hoy declaran este ámbito, seguidos en su propio historial (las ubicaciones actuales no se aplican al pasado). Base: ${groups.basis.captures} capturas válidas. Los contadores son una ventana móvil, no actividad diaria.`);
    body.append(note);
  }
  // ---- Community view (computed at build time by scripts/analytics.py) ----
  const cityLabel=id=>[...$('e-city').options].find(o=>o.value===id)?.textContent.split(' · ')[0]||id;
  const corrWord=r=>{const a=Math.abs(r);return a<0.2?'casi no se relacionan':a<0.4?'se relacionan débilmente':a<0.6?'se relacionan de forma moderada':'se relacionan con fuerza';};
  function tile(icon,label,value,sub) {
    const el=H.node('div','kpi-tile');const head=H.node('span','kpi-label',label);head.prepend(H.icon(icon));
    el.append(head,H.node('strong','kpi-value',value),H.node('small','',sub));return el;
  }
  function rotationChart(rotation) {
    const wrap=H.node('div','rotation-chart');wrap.setAttribute('role','img');
    const top=Math.max(1,...rotation.map(r=>Math.max(r.entered,r.left)));
    wrap.setAttribute('aria-label',`Entradas y salidas diarias: ${rotation.map(r=>`${H.dateLabel(r.date)} +${r.entered} −${r.left}`).join('; ')}`);
    for (const r of rotation) {
      const col=H.node('div','rot-col');
      const up=H.node('span','rot-up'),down=H.node('span','rot-down');
      up.style.height=`${r.entered/top*100}%`;down.style.height=`${r.left/top*100}%`;
      col.append(up,down);wrap.append(col);
    }
    return wrap;
  }
  function scatter(data) {
    const NS='http://www.w3.org/2000/svg',W=900,Ht=420,L=58,B=36,T=12,R=14;
    const pts=data.points, log=v=>Math.log1p(v);
    const maxX=Math.max(...pts.map(p=>p[1])), maxY=Math.max(...pts.map(p=>p[2])), minY=Math.min(...pts.map(p=>p[2]));
    const lx=log(maxX)||1, ly0=log(minY), ly1=log(maxY)||1;
    const X=v=>L+log(v)/lx*(W-L-R), Y=v=>T+(1-(log(v)-ly0)/(ly1-ly0||1))*(Ht-T-B);
    const wrap=H.node('div','scatter-wrap');
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${Ht}`);svg.setAttribute('class','scatter');svg.setAttribute('role','img');
    svg.setAttribute('aria-label',`Contribuciones públicas contra seguidores de ${fmt.format(pts.length)} perfiles, en escala logarítmica. Correlación de rangos ${data.scatter.spearman===null?'no disponible':dec.format(data.scatter.spearman)}.`);
    const mk=(tag,attrs)=>{const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);return el;};
    const xticks=[0,10,100,1000,10000].filter(v=>v<=maxX*1.05), yticks=[10,30,100,300,1000,3000,10000].filter(v=>v>=minY*0.9&&v<=maxY*1.1);
    for (const v of yticks) { svg.append(mk('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),class:'sc-grid'})); const t=mk('text',{x:L-8,y:Y(v)+4,class:'sc-tick','text-anchor':'end'});t.textContent=fmt.format(v);svg.append(t); }
    for (const v of xticks) { svg.append(mk('line',{x1:X(v),x2:X(v),y1:T,y2:Ht-B,class:'sc-grid'})); const t=mk('text',{x:X(v),y:Ht-B+18,class:'sc-tick','text-anchor':'middle'});t.textContent=fmt.format(v);svg.append(t); }
    const ax=mk('text',{x:(L+W-R)/2,y:Ht-4,class:'sc-axis','text-anchor':'middle'});ax.textContent='Contribuciones públicas (escala logarítmica)';svg.append(ax);
    const ay=mk('text',{x:14,y:(T+Ht-B)/2,class:'sc-axis','text-anchor':'middle',transform:`rotate(-90 14 ${(T+Ht-B)/2})`});ay.textContent='Seguidores';svg.append(ay);
    const act=new Set(data.scatter.moreActivity.map(o=>o.login)), aud=new Set(data.scatter.moreAudience.map(o=>o.login));
    const rows=[...pts].sort((a,b)=>(act.has(a[0])||aud.has(a[0])?1:0)-(act.has(b[0])||aud.has(b[0])?1:0));
    for (const [login,pub,fol] of rows) {
      const c=mk('circle',{cx:X(pub).toFixed(1),cy:Y(fol).toFixed(1),r:act.has(login)||aud.has(login)?4.2:2.6,class:`sc-dot${act.has(login)?' activity':aud.has(login)?' audience':''}`});
      c.dataset.login=login;svg.append(c);
    }
    const mine=[];
    profileKeys.forEach((key,i)=>{ const p=pts.find(q=>q[0].toLowerCase()===key); if (!p) return;
      svg.append(mk('circle',{cx:X(p[1]),cy:Y(p[2]),r:8,class:'sc-ring'}));
      const right=X(p[1])>W*0.75, t=mk('text',{x:X(p[1])+(right?-11:11),y:Y(p[2])-10-i*15,class:'sc-me','text-anchor':right?'end':'start'});
      t.textContent=`@${p[0]}`;svg.append(t);mine.push(p); });
    const tip=H.node('div','scatter-tip');tip.hidden=true;
    svg.addEventListener('pointermove',e=>{
      const r=svg.getBoundingClientRect(),sx=W/r.width,x=(e.clientX-r.left)*sx,y=(e.clientY-r.top)*sx;
      let best=null,d=Infinity;for (const p of pts){const dx=X(p[1])-x,dy=Y(p[2])-y,dd=dx*dx+dy*dy;if(dd<d){d=dd;best=p;}}
      if (!best||d>26*26){tip.hidden=true;return;}
      tip.replaceChildren(H.node('strong','',`@${best[0]}`),H.node('span','',`${fmt.format(best[1])} contribuciones públicas`),H.node('span','',`${fmt.format(best[2])} seguidores`));
      tip.hidden=false;const px=X(best[1])/W*100;tip.style.left=`${px}%`;tip.style.top=`${Y(best[2])/Ht*100}%`;tip.classList.toggle('flip',px>65);svg.style.cursor='pointer';svg.dataset.hover=best[0];
    });
    svg.addEventListener('pointerleave',()=>{tip.hidden=true;delete svg.dataset.hover;});
    svg.addEventListener('click',()=>{ if (svg.dataset.hover) location.href=profileHref(svg.dataset.hover); });
    wrap.append(svg,tip);return wrap;
  }
  function renderCommunityView() {
    const panel=$('community-view'),body=$('community-view-body'),c=community?.community;
    if (!c||!c.health) { panel.hidden=true;return; }
    panel.hidden=false;body.replaceChildren();
    const h=c.health,w=h.weekly;
    const tiles=H.node('div','kpi-grid');
    tiles.append(tile('users','Perfiles registrados',fmt.format(h.profiles),`mediana ${fmt.format(h.medianPublic)} contribuciones · ${fmt.format(h.medianFollowers)} seguidores`));
    if (w) {
      tiles.append(tile('growth','Con aumento reciente',pct1(w.activeShare),`subieron su contador entre ${H.dateLabel(w.from)} y ${H.dateLabel(w.through)}`));
      tiles.append(tile('swap','Rotación semanal',`+${fmt.format(w.entered)} / −${fmt.format(w.left)}`,`entradas y salidas (${pct1((w.entered+w.left)/2/h.profiles)} de la comunidad)`));
      tiles.append(tile('pulse','Variación semanal',signed(w.publicDelta),`contribuciones públicas · ${signed(w.followersDelta)} seguidores`));
    } else tiles.append(tile('info','Comparación semanal','Pendiente','hace falta una captura de al menos 7 días antes'));
    body.append(tiles);
    if (h.rotation.length>1) { const block=H.node('div','group-block');block.append(H.node('h3','','Entradas y salidas por día'),rotationChart(h.rotation.slice(-30)),H.node('p','history-notice','Barras hacia arriba: perfiles que aparecen; hacia abajo: perfiles que dejan de aparecer en la muestra.'));body.append(block); }
    if (c.scatter&&c.points.length) {
      const sc=c.scatter,block=H.node('div','group-block');
      block.append(H.node('h3','','Actividad frente a audiencia'));
      block.append(H.node('p','history-notice',sc.spearman===null?'No se puede calcular la correlación entre actividad y audiencia con estos datos. Pasa el cursor para ver un perfil y haz clic para abrir su evolución.':`Contribuciones públicas y seguidores ${corrWord(sc.spearman)} en esta muestra (correlación de rangos ${new Intl.NumberFormat('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(sc.spearman)}). Pasa el cursor para ver un perfil y haz clic para abrir su evolución.`));
      block.append(scatter(c));
      const legend=H.node('p','scatter-legend');legend.append(H.node('span','dot audience','Mucha más audiencia que actividad'),H.node('span','dot activity','Mucha más actividad que audiencia'));block.append(legend);
      const cols=H.node('div','group-lists');
      for (const [title,items,count] of [['Más audiencia que actividad',sc.moreAudience,sc.audienceCount],['Más actividad que audiencia',sc.moreActivity,sc.activityCount]]) {
        const col=H.node('div','group-list');col.append(H.node('h3','',`${title} (${fmt.format(count)})`));const ol=H.node('ol');
        for (const r of items) { const li=H.node('li');li.append(profileLink(r.login),H.node('span','',`${fmt.format(r.public)} contrib. · ${fmt.format(r.followers)} seg.`));ol.append(li); }
        col.append(ol);cols.append(col);
      }
      block.append(cols);body.append(block);
    }
    const geo=c.geo;
    if (geo?.cities.length) {
      const block=H.node('div','group-block');block.append(H.node('h3','','Concentración geográfica'));
      const lead=geo.cities[0];
      block.append(H.node('p','history-notice',`${cityLabel(lead.id)} reúne el ${pct1(lead.share)} de los perfiles y el ${pct1(lead.publicShare)} de las contribuciones públicas. ${fmt.format(geo.unassigned)} perfiles (${pct1(geo.unassigned/geo.profiles)}) no declaran una ciudad reconocida.`));
      const bars=H.node('div','geo-bars');
      for (const r of geo.cities.slice(0,8)) {
        const row=H.node('div','geo-row');
        const track=H.node('div','geo-track');const a=H.node('span','geo-profiles');a.style.width=`${r.share/lead.share*100}%`;const b=H.node('span','geo-public');b.style.width=`${Math.min(100,r.publicShare/lead.share*100)}%`;track.append(a,b);
        row.append(H.node('span','geo-name',cityLabel(r.id)),track,H.node('span','geo-values',`${pct1(r.share)} perfiles · ${pct1(r.publicShare)} contrib.`));bars.append(row);
      }
      block.append(bars,H.node('p','history-notice','Un perfil puede declarar varias ciudades, por lo que los porcentajes pueden sumar más del 100 %.'));
      body.append(block);
    }
    const seas=c.seasonality;
    if (seas) { const note=H.node('p','insights-basis');note.prepend(H.icon('info'));note.append(seas.available?'Hay historial suficiente para estudiar estacionalidad; aún no se calcula.':`Estacionalidad: se mostrará con al menos ${seas.neededWeeks} semanas de historial (hoy ${seas.weeks}).`);body.append(note); }
  }

  // ---- Data export (everything is generated in the browser from the data already loaded) ----
  const slug=text=>String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const stamp=()=>groups?.basis?.through||new Date().toISOString().slice(0,10);
  const exportMeta=()=>({generado:new Date().toISOString(),fuente:'GitHub Perú · Evolución',base:groups?.basis||null,
    notas:['Los contadores de GitHub son una ventana móvil de 12 meses: sus variaciones no equivalen a actividad diaria.','Las capturas incompletas se excluyen de los agregados y del análisis.','Las proyecciones suponen que el ritmo actual se mantiene y se acompañan de su nivel de confianza.']});
  const saveCSV=(name,rows)=>H.download(`${name}.csv`,'text/csv',H.toCSV(rows));
  const saveJSON=(name,payload)=>H.download(`${name}.json`,'application/json',JSON.stringify(payload,null,2)+'\n');
  function exportGroup(format) {
    const metric=$('e-metric').value,scope=$('e-city').value||'peru',data=groups?.metrics?.[metric];if (!data) return;
    const name=`github-peru-grupo-${slug(scope)}-${metric}-${stamp()}`;
    if (format==='json') { saveJSON(name,{...exportMeta(),metrica:metric,ambito:scope,grupo:data[scope]||null,todosLosAmbitos:data});return; }
    const rows=[['ambito','nombre','perfiles','grupo_pequeno','total','media','mediana','p90','p99','maximo','gini','parte_top10','parte_top1_por_ciento','perfiles_comparables','perfiles_nuevos','variacion','variacion_pct','perfiles_que_crecieron','parte_que_crecio','mediana_variacion','parte_del_aumento_top10','al_alza','estables','a_la_baja','ritmo_mediano_por_dia']];
    for (const [id,v] of Object.entries(data).sort((a,b)=>b[1].profiles-a[1].profiles)) {
      const gr=v.growth||{},t=v.trends||{};
      rows.push([id,cityLabel(id==='peru'?'':id)||'Todo Perú',v.profiles,v.small?'sí':'no',v.total??null,v.mean??null,v.median??null,v.p90??null,v.p99??null,v.max??null,v.gini??null,v.top10Share??null,v.top1PctShare??null,gr.matched??null,gr.newInGroup??null,gr.delta??null,gr.pct??null,gr.growers??null,gr.growersShare??null,gr.medianDelta??null,gr.top10Share??null,t.alza??0,t.estable??0,t.baja??0,v.medianPerDay??null]);
    }
    saveCSV(name,rows);
  }
  function exportCommunity(format) {
    const c=community?.community;if (!c) return;
    const name=`github-peru-comunidad-${stamp()}`;
    if (format==='json') { saveJSON(name,{...exportMeta(),comunidad:{salud:c.health,actividadFrenteAAudiencia:c.scatter,geografia:c.geo,estacionalidad:c.seasonality,perfiles:c.points.map(([perfil,contribuciones_publicas,seguidores,contribuciones_totales])=>({perfil,contribuciones_publicas,seguidores,contribuciones_totales}))}});return; }
    saveCSV(name,[['perfil','contribuciones_publicas','seguidores','contribuciones_totales'],...c.points]);
  }

  function qualityText() {
    const records = quality?.snapshots || [];
    const incomplete = records.filter((r) => r.status === 'incomplete'), shifts = records.filter((r) => r.status === 'window-shift');
    const parts = [];
    if (incomplete.length) parts.push(`${incomplete.length} ${incomplete.length === 1 ? 'captura incompleta excluida' : 'capturas incompletas excluidas'} (${incomplete.map((r) => `${H.dateLabel(r.date)}: ${fmt.format(r.profiles)} de ${fmt.format(r.expectedProfiles)} perfiles`).join('; ')})`);
    if (shifts.length) parts.push(`${shifts.length} ${shifts.length === 1 ? 'ajuste' : 'ajustes'} de ventana: muchos contadores bajan a la vez y no reflejan actividad`);
    return quality ? `Calidad de datos: ${parts.length ? parts.join('. ') + '.' : 'sin anomalías en las capturas analizadas.'}` : '';
  }
  function updateLinks() {
    const query = new URLSearchParams({metric: $('e-metric').value});
    if ($('e-city').value) query.set('city', $('e-city').value);
    if (profileKeys.length) query.set('users', profileKeys.join(','));
    $('to-evolution').href = `./evolucion/?${query}`;
    window.history.replaceState(null, '', `${location.pathname}?${query}`);
  }
  function render() {
    $('stats-coverage').textContent = groups.basis ? `Base: ${groups.basis.captures} capturas válidas, del ${H.dateLabel(groups.basis.from)} al ${H.dateLabel(groups.basis.through)}.` : '';
    $('stats-quality').textContent = qualityText();
    renderGroup(); renderCommunityView(); updateLinks();
  }
  function known(id, key) { const wanted = params.get(key); if (wanted && [...$(id).options].some((o) => o.value === wanted)) $(id).value = wanted; }
  function decorateControls() {
    for (const [id, name] of [['e-city', 'pin'], ['e-metric', 'bars']]) H.decorate($(id).closest('label'), name);
    $('to-evolution').prepend(H.icon('view'));
    for (const id of ['export-group-csv', 'export-group-json', 'export-community-csv', 'export-community-json']) $(id).prepend(H.icon('download'));
    $('export-group-csv').addEventListener('click', () => exportGroup('csv'));
    $('export-group-json').addEventListener('click', () => exportGroup('json'));
    $('export-community-csv').addEventListener('click', () => exportCommunity('csv'));
    $('export-community-json').addEventListener('click', () => exportCommunity('json'));
  }
  async function start() {
    decorateControls();
    $('stats-retry').hidden = true;
    try {
      [groups, community, quality] = await Promise.all([json('./data/analytics-groups.json'), json('./data/analytics-community.json'), json('./data/analytics-quality.json').catch(() => null)]);
      if (!groups?.metrics || !community?.community) throw new Error('Invalid analytics');
      known('e-city', 'city'); known('e-metric', 'metric');
      profileKeys = [...new Set((params.get('users') || '').split(',').map((v) => v.toLowerCase()).filter((v) => /^[a-z0-9-]{1,39}$/.test(v)))].slice(0, 3);
      $('stats-status').textContent = ''; $('stats-app').hidden = false;
      render();
    } catch {
      $('stats-status').textContent = 'No pudimos cargar las estadísticas. Puedes reintentar o consultar el ranking actual.';
      $('stats-retry').hidden = false;
    }
  }
  $('e-city').addEventListener('change', render);
  $('e-metric').addEventListener('change', render);
  $('stats-retry').addEventListener('click', start);
  start();
})();
