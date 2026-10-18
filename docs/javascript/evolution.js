"use strict";
(() => {
  document.documentElement.classList.add('history-js');
  const H=window.PeruHistory, $=id=>document.getElementById(id), fmt=new Intl.NumberFormat('es-PE');
  const labels={publicContributions:'Contribuciones públicas', total:'Contribuciones totales', followers:'Seguidores'};
  const colors=['#b63735','#176b77','#7152a3'];
  const params=new URLSearchParams(location.search);
  const files=new Map();
  let catalog, summary, snapshots=[], selected=[], profileKeys=[], pastLimit=25, requestId=0;
  const value=(row,metric)=>metric==='total'?row[1]+row[2]:metric==='followers'?row[3]:row[1];
  const signed=v=>`${v>0?'+':''}${fmt.format(v)}`;
  const movement=v=>v>0?`↑ ${v}`:v<0?`↓ ${-v}`:'— Sin cambio';
  function selectKnown(id,key) {
    const v=params.get(key);
    if (v && [...$(id).options].some(o=>o.value===v)) $(id).value=v;
  }
  function cityRows(s) {
    if (!$('e-city').value) return s.users;
    const indices=s.city_membership?.[$('e-city').value];
    return Array.isArray(indices)?indices.map(i=>s.users[i]):null;
  }
  function ranks(s) {
    const ordered=[...s.users].sort((a,b)=>value(b,$('e-metric').value)-value(a,$('e-metric').value) || a[0].toLowerCase().localeCompare(b[0].toLowerCase(),'en'));
    const result=new Map(); let previous, rank;
    ordered.forEach((row,i)=>{const v=value(row,$('e-metric').value);if(v!==previous)rank=i+1;result.set(row[0].toLowerCase(),rank);previous=v;});
    return result;
  }
  async function json(url) {
    const r=await fetch(url,{priority:'low'});
    if (!r.ok) throw new Error(`No se pudo cargar ${url}`);
    return r.json();
  }
  async function file(path) {
    if (!/^(daily\/\d{4}-\d{2}|(?:monthly|yearly)\/\d{4})\.json$/.test(path)) throw new Error('Ruta de captura no válida');
    if (!files.has(path)) files.set(path,json(`./history/${path}`).catch(error=>{files.delete(path);throw error;}));
    return files.get(path);
  }
  function windowSeries() {
    const all=summary.scopes[$('e-city').value || 'peru']?.series[$('e-tier').value] || [];
    if ($('e-tier').value!=='daily') return all;
    return all.filter(p=>H.day(catalog.daily_window.through)-H.day(p.date)<Number($('e-days').value));
  }
  function updateURL() {
    const url=new URL(location.href);
    url.search='';
    for (const [key,id] of [['city','e-city'],['tier','e-tier'],['days','e-days'],['metric','e-metric'],['view','e-view'],['from','e-from'],['to','e-to']]) {
      if ($(id).value) url.searchParams.set(key,$(id).value);
    }
    if (profileKeys.length) url.searchParams.set('users',profileKeys.join(','));
    history.replaceState(null,'',url);
  }
  function updateDates(restore=false) {
    const oldFrom=restore?params.get('from'):null;
    const oldTo=restore?params.get('to'):null;
    for (const [id,old,fallback] of [['e-from',oldFrom,0],['e-to',oldTo,snapshots.length-1]]) {
      $(id).replaceChildren();
      for (const s of snapshots) {
        const option=H.node('option','',H.dateLabel(s.date)); option.value=s.date; $(id).append(option);
      }
      $(id).value=snapshots.some(s=>s.date===old)?old:snapshots[fallback]?.date || '';
    }
  }
  async function loadTier(restore=false) {
    const id=++requestId;
    $('evolution-status').textContent='Cargando capturas del período…';
    $('evolution-retry').hidden=true;
    $('evolution-app').setAttribute('aria-busy','true');
    try {
      const tier=$('e-tier').value;
      const cutoff=H.day(catalog.daily_window.through)-Number($('e-days').value)+1;
      const entries=(catalog.series[tier] || []).filter(e=>tier!=='daily' || e.periods.some(p=>H.day(p.date)>=cutoff));
      const groups=await Promise.all(entries.map(e=>file(e.path)));
      if (id!==requestId) return;
      snapshots=groups.flatMap(g=>g.snapshots).filter(s=>tier!=='daily' || H.day(s.date)>=cutoff).sort((a,b)=>a.date.localeCompare(b.date));
      updateDates(restore);
      const logins=[...new Set(snapshots.flatMap(s=>s.users.map(r=>r[0].toLowerCase())))].sort();
      const options=document.createDocumentFragment();
      for (const login of logins) {const option=H.node('option');option.value=login;options.append(option);}
      $('profile-suggestions').replaceChildren(options);
      $('evolution-app').hidden=false;
      $('evolution-status').textContent='';
      $('evolution-app').removeAttribute('aria-busy');
      render();
    } catch(error) {
      if (id!==requestId) return;
      $('evolution-status').textContent='No pudimos cargar el histórico. El ranking actual sigue disponible. Reintenta para explorar estas capturas.';
      $('evolution-retry').hidden=false;
      $('evolution-app').hidden=true;
    }
  }
  function renderCommunity() {
    const tier=$('e-tier').value, dates=selected.map(s=>s.date);
    $('community-charts').replaceChildren();
    for (const [key,label,field] of [['profiles','Perfiles registrados',null],['publicContributions','Contador público agregado',1],['followers','Seguidores acumulados',3]]) {
      const values=selected.map(s=>{const rows=cityRows(s);return rows===null?null:field===null?rows.length:rows.reduce((n,r)=>n+r[field],0);});
      const card=H.metricCard(dates,values,label,{interval:tier});
      $('community-charts').append(card);
    }
    const a=cityRows(selected[0]), b=cityRows(selected.at(-1));
    if (a===null || b===null) { $('matched-summary').textContent='No hay cobertura local comparable en ambos extremos. Las ubicaciones actuales no se aplican al pasado.'; return; }
    const first=new Map(a.map(r=>[r[0].toLowerCase(),r])), last=new Map(b.map(r=>[r[0].toLowerCase(),r]));
    const common=[...first.keys()].filter(k=>last.has(k));
    const delta=common.reduce((n,k)=>n+value(last.get(k),$('e-metric').value)-value(first.get(k),$('e-metric').value),0);
    $('matched-summary').textContent=selected.length<2?'Hace falta otra captura para comparar cambios.':`${common.length} perfiles presentes en ambos extremos: ${signed(delta)} en ${labels[$('e-metric').value].toLowerCase()}. Entradas: ${[...last.keys()].filter(k=>!first.has(k)).length}; salidas: ${[...first.keys()].filter(k=>!last.has(k)).length}. Las variaciones no equivalen a actividad del período.`;
  }
  function renderProfiles() {
    $('compare-chips').replaceChildren(); $('profile-chart').replaceChildren(); $('profile-details').replaceChildren();
    $('download-card').disabled=true;
    if (!profileKeys.length) { $('profile-chart').append(H.node('p','history-notice','Busca tu usuario para descubrir su recorrido. Puedes comparar hasta tres perfiles.'));return; }
    const metric=$('e-metric').value, rankView=$('e-view').value==='rank';
    $('profile-chart').dataset.view=rankView?'rank':'value';
    $('comparison-heading').textContent=rankView?'Movimientos en el ranking.':`Evolución de ${labels[metric].toLowerCase()}.`;
    const maps=selected.map(s=>new Map((cityRows(s)||[]).map(r=>[r[0].toLowerCase(),r]))), positions=selected.map(ranks);
    const series=profileKeys.map(key=>maps.map((rows,i)=>rows.has(key)?rankView?positions[i].get(key):value(rows.get(key),metric):null));
    const all=series.flat().filter(v=>v!==null);
    profileKeys.forEach((key,i)=>{
      const chip=H.node('button','compare-chip',`@${key} ×`);chip.style.borderColor=colors[i];chip.setAttribute('aria-label',`Quitar ${key} de la comparación`);
      chip.addEventListener('click',()=>{profileKeys=profileKeys.filter(k=>k!==key);render();});$('compare-chips').append(chip);
    });
    if (!all.length) { $('profile-chart').append(H.node('p','history-notice','No hay capturas de esos perfiles en el ámbito y las fechas seleccionados.'));return; }
    if (rankView) {
      const grid=H.node('div','rank-journeys');
      profileKeys.forEach((key,i)=>{
        const card=H.node('article','rank-journey');card.style.borderTopColor=colors[i];
        const link=H.node('a','rank-profile',`@${key}`);link.href=`https://github.com/${encodeURIComponent(key)}`;link.target='_blank';link.rel='noopener noreferrer';
        card.append(link,H.node('p','history-notice',`${labels[metric]} · puesto nacional`));
        card.append(H.rankMovement(selected.map(s=>s.date),series[i]));
        const valid=series[i].map((v,j)=>v===null?-1:j).filter(j=>j>=0);
        if(valid.length) {
          const first=valid[0],last=valid.at(-1);
          card.append(H.node('p','rank-dates',`${H.dateLabel(selected[first].date)} → ${H.dateLabel(selected[last].date)} · ${valid.length} capturas`));
          const details=H.node('details','rank-events');details.append(H.node('summary','','Ver cambios registrados'));
          const list=H.node('ol','rank-event-list');
          valid.forEach((j,k)=>{
            if(k>0 && k<valid.length-1 && series[i][j]===series[i][valid[k-1]]) return;
            const item=H.node('li');
            const time=H.node('time','',H.dateLabel(selected[j].date));time.dateTime=selected[j].date;
            item.append(time,H.node('span','rank-token',`#${series[i][j]}`));list.append(item);
          });
          details.append(list);card.append(details);
        }
        grid.append(card);
      });
      $('profile-chart').append(H.node('p','history-notice','Compara el puesto inicial y final de cada perfil. Un número menor es una mejor posición. Las ausencias no se interpolan.'),grid);
      $('download-card').disabled=false;
      return;
    }
    const min=Math.min(...all), max=Math.max(...all), plot=H.node('div','comparison-plot');
    profileKeys.forEach((key,i)=>{
      const svg=H.chart(selected.map(s=>s.date),series[i],{rank:rankView,width:900,height:220,daily:$('e-tier').value==='daily',interval:$('e-tier').value,domain:[min,max],label:`@${key}: ${rankView?'puesto nacional':labels[metric]}`,color:colors[i]});
      if (svg.tagName.toLowerCase()==='svg') plot.append(svg);
      const valid=series[i].map((v,j)=>v===null?-1:j).filter(j=>j>=0);
      const detail=H.node('p','comparison-detail');
      detail.style.borderColor=colors[i];
      const link=H.node('a','',`@${key}`);link.href=`https://github.com/${encodeURIComponent(key)}`;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);
      if (!valid.length) detail.append(document.createTextNode(' · Sin datos en esta selección.'));
      else {
        const first=valid[0],last=valid.at(-1),delta=series[i][last]-series[i][first];
        detail.append(document.createTextNode(` · ${rankView?'Puesto nacional':'Contador'}: ${fmt.format(series[i][first])} → ${fmt.format(series[i][last])} · ${valid.length===1?'Primera captura':rankView?movement(-delta):signed(delta)} · ${H.dateLabel(selected[first].date)} – ${H.dateLabel(selected[last].date)}`));
      }
      $('profile-details').append(detail);
    });
    $('profile-chart').append(H.node('p','chart-scale',`${rankView?'Puesto nacional · mejores posiciones arriba':labels[metric]} · escala compartida: ${fmt.format(min)} – ${fmt.format(max)}`),plot);
    const ends=H.node('div','chart-endpoints');ends.append(H.node('span','',H.dateLabel(selected[0].date)),H.node('span','',H.dateLabel(selected.at(-1).date)));$('profile-chart').append(ends);
    $('download-card').disabled=false;
  }
  function renderPast() {
    $('past-rows').replaceChildren();
    if (!selected.length) { $('past-more').hidden=true;return; }
    const last=selected.at(-1), rows=cityRows(last), beforeRows=cityRows(selected[0]);
    $('past-caption').textContent=`Captura del ${H.dateLabel(last.date)} · ${labels[$('e-metric').value]}. Puestos nacionales; los empates comparten posición. ${$('e-tier').value==='daily'?'':'Última captura disponible del período; el período actual es provisional.'}`;
    if (rows===null) { $('past-caption').textContent+=' Sin cobertura local en esta captura.';$('past-more').hidden=true;return; }
    const old=ranks(selected[0]), current=ranks(last), oldKeys=new Set((beforeRows || []).map(r=>r[0].toLowerCase()));
    const query=$('past-search').value.trim().replace(/^@/,'').toLowerCase();
    const ordered=[...rows].filter(r=>r[0].toLowerCase().includes(query)).sort((a,b)=>current.get(a[0].toLowerCase())-current.get(b[0].toLowerCase()) || a[0].toLowerCase().localeCompare(b[0].toLowerCase(),'en'));
    for (const row of ordered.slice(0,pastLimit)) {
      const key=row[0].toLowerCase(), tr=H.node('tr');
      tr.append(H.node('td','',fmt.format(current.get(key))));
      const profile=H.node('td'), button=H.node('button','history-profile-button',`@${row[0]}`);
      button.addEventListener('click',()=>addProfile(key)); profile.append(button);tr.append(profile,H.node('td','numeric',fmt.format(value(row,$('e-metric').value))));
      tr.append(H.node('td','',selected.length<2?'Primera captura':beforeRows===null?'Sin cobertura inicial':oldKeys.has(key)?movement(old.get(key)-current.get(key)):'No presente al inicio'));
      $('past-rows').append(tr);
    }
    if (!ordered.length) $('past-caption').textContent+=' No hay perfiles con esa búsqueda.';
    $('past-more').hidden=ordered.length<=pastLimit;
  }
  function renderWeekly() {
    const w=summary.scopes[$('e-city').value || 'peru']?.weekly, wrap=$('weekly-summary');wrap.replaceChildren();
    if (!w) {wrap.append(H.node('p','','El resumen aparecerá con capturas comparables separadas entre 7 y 14 días.'));return;}
    wrap.append(H.node('p','',`${H.dateLabel(w.from)} – ${H.dateLabel(w.through)} · última comparación semanal disponible. ${w.matched} perfiles comparables; ${w.entered} entradas y ${w.left} salidas.`));
    wrap.append(H.node('p','',`Variación del contador público en perfiles comparables: ${signed(w.publicDeltaMatched)}. Seguidores: ${signed(w.followersDeltaMatched)}.`));
    if (!w.movers.length) wrap.append(H.node('p','','Sin ascensos de puesto nacional entre estas capturas.'));
    for (const mover of w.movers) {
      const b=H.node('button','history-profile-button',`@${mover.login} ↑ ${mover.change} puestos nacionales`);b.addEventListener('click',()=>addProfile(mover.login.toLowerCase()));wrap.append(b);
    }
  }
  function render() {
    $('e-days-label').hidden=$('e-tier').value!=='daily';
    let from=$('e-from').value, to=$('e-to').value;
    if (from>to) { [from,to]=[to,from];$('e-from').value=from;$('e-to').value=to; }
    selected=snapshots.filter(s=>s.date>=from && s.date<=to);
    if (!selected.length) {
      $('e-coverage').textContent='No hay capturas en esta ventana. Prueba un período más amplio o el archivo mensual.';
      for (const id of ['community-charts','profile-chart','profile-details','past-rows']) $(id).replaceChildren();
      $('matched-summary').textContent='';$('past-caption').textContent='Sin capturas.';$('past-more').hidden=true;$('download-card').disabled=true;
      renderWeekly();updateURL();return;
    }
    const cityCount=selected.filter(s=>cityRows(s)!==null).length;
    $('e-coverage').textContent=`${selected.length} capturas seleccionadas · ${H.dateLabel(selected[0].date)} – ${H.dateLabel(selected.at(-1).date)}. ${selected.length===1?'Primera captura: todavía no hay una tendencia. ':''}${$('e-city').value?`${cityCount} con cobertura de ciudad. `:''}Los huecos se conservan. Hora de referencia: Perú.`;
    renderCommunity();renderProfiles();renderPast();renderWeekly();updateURL();
  }
  function addProfile(input) {
    const key=input.trim().replace(/^@/,'').toLowerCase();
    if (!/^[a-z0-9-]{1,39}$/.test(key)) { $('compare-status').textContent='Escribe un usuario de GitHub válido.';return; }
    if (profileKeys.includes(key)) { $('compare-status').textContent='Ese perfil ya está en la comparación.';return; }
    if (profileKeys.length>=3) { $('compare-status').textContent='Puedes comparar hasta tres perfiles. Quita uno para añadir otro.';return; }
    if (!snapshots.some(s=>s.users.some(r=>r[0].toLowerCase()===key))) { $('compare-status').textContent='No encontramos ese usuario en las capturas de este período.';return; }
    profileKeys.push(key);$('e-profile').value='';$('compare-status').textContent='';render();
  }
  async function start() {
    $('evolution-retry').hidden=true;
    try {
      [catalog,summary]=await Promise.all([json('./history/index.json'),json('./data/evolution-summary.json')]);
      if (!catalog.series || !summary.scopes) throw new Error('Invalid catalog');
      for (const [id,key] of [['e-city','city'],['e-tier','tier'],['e-days','days'],['e-metric','metric'],['e-view','view']]) selectKnown(id,key);
      profileKeys=[...new Set((params.get('users') || '').split(',').map(v=>v.toLowerCase()).filter(v=>/^[a-z0-9-]{1,39}$/.test(v)))].slice(0,3);
      await loadTier(true);
    } catch {
      $('evolution-status').textContent='No pudimos cargar el índice de capturas. Puedes reintentar o consultar el ranking actual.';
      $('evolution-retry').hidden=false;
    }
  }
  $('evolution-retry').addEventListener('click',()=>catalog&&summary?loadTier():start());
  for (const id of ['e-tier','e-days']) $(id).addEventListener('change',()=>{pastLimit=25;loadTier();});
  for (const id of ['e-city','e-metric','e-view','e-from','e-to']) $(id).addEventListener('change',()=>{pastLimit=25;render();});
  $('past-search').addEventListener('input',()=>{pastLimit=25;renderPast();});
  $('past-more').addEventListener('click',()=>{pastLimit+=25;renderPast();});
  $('compare-form').addEventListener('submit',event=>{event.preventDefault();addProfile($('e-profile').value);});
  $('share-view').addEventListener('click',async()=>{
    updateURL();
    try {await navigator.clipboard.writeText(location.href);$('share-status').textContent='Enlace copiado.';}
    catch {$('share-url').value=location.href;$('share-url').hidden=false;$('share-url').select();$('share-status').textContent='Copia el enlace del campo seleccionado.';}
  });
  $('download-card').addEventListener('click',()=>{
    const key=profileKeys[0];if(!key || !selected.length)return;
    const rows=selected.map(s=>(cityRows(s)||[]).find(r=>r[0].toLowerCase()===key));
    const indices=rows.map((r,i)=>r?i:-1).filter(i=>i>=0);if(!indices.length)return;
    const first=indices[0],last=indices.at(-1),metric=$('e-metric').value;
    const rankView=$('e-view').value==='rank';
    const a=rankView?ranks(selected[first]).get(key):value(rows[first],metric), b=rankView?ranks(selected[last]).get(key):value(rows[last],metric);
    const xml=v=>String(v).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
    const lines=[`@${key}`,`${rankView?'Puesto nacional':'Valor registrado'}: ${a} → ${b}`,indices.length<2?'Primera captura':rankView?movement(a-b):signed(b-a),`${selected[first].date} — ${selected[last].date}`,labels[metric], 'Capturas del ranking; no mide actividad diaria.', 'yamilayma.github.io/top-github-users-peru/'];
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560" viewBox="0 0 1000 560"><rect width="1000" height="560" rx="24" fill="#fcfaf7"/><rect x="0" y="0" width="14" height="560" fill="#b63735"/><text x="60" y="65" font-family="sans-serif" font-size="22" fill="#b63735">GitHub Perú · Evolución</text>${lines.map((line,i)=>`<text x="60" y="${135+i*58}" font-family="sans-serif" font-size="${i===0?40:i===1?32:22}" fill="#24262b">${xml(line)}</text>`).join('')}</svg>`;
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'})), aTag=H.node('a');aTag.href=url;aTag.download=`github-peru-${key}.svg`;aTag.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('share-status').textContent=`Tarjeta descargada de @${key}, el primer perfil de la comparación.`;
  });
  start();
})();
