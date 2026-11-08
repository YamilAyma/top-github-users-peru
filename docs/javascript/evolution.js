"use strict";
(() => {
  document.documentElement.classList.add('history-js');
  const H=window.PeruHistory, $=id=>document.getElementById(id), fmt=new Intl.NumberFormat('es-PE');
  const labels={publicContributions:'Contribuciones públicas', total:'Contribuciones totales', followers:'Seguidores'};
  const colors=['#b63735','#176b77','#7152a3'];
  const params=new URLSearchParams(location.search);
  const files=new Map();
  let renderToken=0, exportState=null, catalog, summary, quality=null, snapshots=[], selected=[], profileKeys=[], pastLimit=25, requestId=0;
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
  const excludedDates=()=>new Set(quality?.excluded||[]);
  const usableSelected=()=>{const skip=excludedDates();return selected.filter(s=>!skip.has(s.date));};
  const weekdayName=new Intl.DateTimeFormat('es-PE',{weekday:'long',timeZone:'UTC'});
  function qualityMarks() {
    const flags=new Map((quality?.snapshots||[]).filter(r=>r.status==='incomplete'||r.status==='window-shift').map(r=>[r.date,r]));
    return selected.filter(s=>flags.has(s.date)).map(s=>{
      const r=flags.get(s.date);
      return r.status==='incomplete'
        ? {date:s.date,kind:'incomplete',short:`${H.dateLabel(s.date)}: ${fmt.format(r.profiles)} de ${fmt.format(r.expectedProfiles)} perfiles`,label:`${H.dateLabel(s.date)}: captura incompleta (${fmt.format(r.profiles)} de ${fmt.format(r.expectedProfiles)} perfiles), excluida de los totales`}
        : {date:s.date,kind:'shift',label:`${H.dateLabel(s.date)}: ajuste de ventana, muchos contadores bajan a la vez`};
    });
  }
  function renderQuality() {
    const marks=qualityMarks(), incomplete=marks.filter(m=>m.kind==='incomplete'), shifts=marks.filter(m=>m.kind==='shift');
    const parts=[];
    if (incomplete.length) parts.push(`${incomplete.length} ${incomplete.length===1?'captura incompleta excluida':'capturas incompletas excluidas'} de los totales (${incomplete.map(m=>m.short).join('; ')})`);
    if (shifts.length) {
      const days=new Set(shifts.map(m=>weekdayName.format(new Date(`${m.date}T12:00:00Z`))));
      parts.push(`${shifts.length} ${shifts.length===1?'ajuste':'ajustes'} de ventana${days.size===1?` en ${[...days][0]}`:''}: muchos contadores bajan a la vez y no reflejan actividad`);
    }
    $('e-quality').textContent=quality?`Calidad de datos: ${parts.length?parts.join('. ')+'.':'sin anomalías en las capturas seleccionadas.'}`:'';
  }
  function renderCommunity() {
    const tier=$('e-tier').value, dates=selected.map(s=>s.date);
    $('community-charts').replaceChildren();
    for (const [key,label,field] of [['profiles','Perfiles registrados',null],['publicContributions','Contador público agregado',1],['followers','Seguidores acumulados',3]]) {
      const skip=excludedDates();
      const values=selected.map(s=>{const rows=skip.has(s.date)?null:cityRows(s);return rows===null?null:field===null?rows.length:rows.reduce((n,r)=>n+r[field],0);});
      const card=H.metricCard(dates,values,label,{interval:tier,marks:qualityMarks()});
      $('community-charts').append(card);
    }
    const pool=usableSelected(), a=pool.length?cityRows(pool[0]):null, b=pool.length?cityRows(pool.at(-1)):null;
    if (a===null || b===null) { $('matched-summary').textContent='No hay cobertura local comparable en ambos extremos. Las ubicaciones actuales no se aplican al pasado.'; return; }
    const first=new Map(a.map(r=>[r[0].toLowerCase(),r])), last=new Map(b.map(r=>[r[0].toLowerCase(),r]));
    const common=[...first.keys()].filter(k=>last.has(k));
    const delta=common.reduce((n,k)=>n+value(last.get(k),$('e-metric').value)-value(first.get(k),$('e-metric').value),0);
    $('matched-summary').textContent=pool.length<2?'Hace falta otra captura para comparar cambios.':`${common.length} perfiles presentes en ambos extremos: ${signed(delta)} en ${labels[$('e-metric').value].toLowerCase()}. Entradas: ${[...last.keys()].filter(k=>!first.has(k)).length}; salidas: ${[...first.keys()].filter(k=>!last.has(k)).length}. Las variaciones no equivalen a actividad del período.`;
  }
  function statsGrid(key,values,valid,metric,color,positions) {
    const first=valid[0],last=valid.at(-1),delta=values[last]-values[first],days=H.day(selected[last].date)-H.day(selected[first].date);
    let jump={gain:-Infinity,at:first},high=first,low=first;
    valid.forEach((j,k)=>{
      if(k>0 && values[j]-values[valid[k-1]]>jump.gain) jump={gain:values[j]-values[valid[k-1]],at:j};
      if(values[j]>values[high]) high=j; if(values[j]<values[low]) low=j;
    });
    const pct=values[first]?`${signed(Math.round(delta/values[first]*1000)/10)} %`:'—';
    const ranked=valid.map(j=>positions[j].get(key)).filter(v=>v!==undefined), best=ranked.length?Math.min(...ranked):null;
    const stats=[
      ['Crecimiento','growth',`${signed(delta)} (${pct})`],
      ['Promedio por día','daily',days>0?signed((Math.round(delta/days*10)/10)||0):'—'],
      ['Mayor salto','jump',jump.gain>0?`${signed(jump.gain)} · ${H.dateLabel(selected[jump.at].date)}`:'Sin subidas'],
      ['Máximo','max',`${fmt.format(values[high])} · ${H.dateLabel(selected[high].date)}`],
      ['Mínimo','min',`${fmt.format(values[low])} · ${H.dateLabel(selected[low].date)}`],
      ['Puesto nacional','rank',ranked.length?`#${ranked[0]} → #${ranked.at(-1)} · mejor #${best}`:'Sin puesto']
    ];
    const dl=H.node('dl','comparison-stats');dl.style.borderColor=color;dl.setAttribute('aria-label',`Estadísticas de @${key} · ${labels[metric]}`);
    for(const [term,ic,text] of stats){const item=H.node('div');const dt=H.node('dt','',term);dt.prepend(H.icon(ic));item.append(dt,H.node('dd','',text));dl.append(item);}
    return dl;
  }
  function decorateControls() {
    const add=(el,name)=>el&&el.prepend(H.icon(name));
    H.decorate($('e-view').closest('label'),'view');
    for (const [id,name] of [['e-city','pin'],['e-tier','archive'],['e-days','clock'],['e-metric','bars'],['e-from','daily'],['e-to','daily']]) H.decorate($(id).closest('label'),name);
    for (const [id,name] of [['community-heading','users'],['weekly-heading','pulse'],['past-ranking-heading','clock']]) add($(id),name);
    add($('share-view'),'link'); add($('download-card'),'download'); add($('compare-form').querySelector('button'),'plus');
    add($('past-more'),'chevronDown'); add($('evolution-retry'),'refresh');
    H.searchField($('e-profile')); H.searchField($('past-search'));
    for (const id of ['export-profiles-series','export-profiles-analysis','export-profiles-json']) add($(id),'download');
    add($('to-stats'),'layers');
    $('export-profiles-series').addEventListener('click',()=>exportProfiles('series'));
    $('export-profiles-analysis').addEventListener('click',()=>exportProfiles('analysis'));
    $('export-profiles-json').addEventListener('click',()=>exportProfiles('json'));

  }
  function flashIcon(button) {
    const old=button.querySelector('.stat-icon'); if(!old) return;
    const check=H.icon('check'); old.replaceWith(check); setTimeout(()=>check.replaceWith(old),2000);
  }
  // ---- Per-profile insights (computed at build time by scripts/analytics.py) ----
  const insightCache=new Map();
  const loadInsights=metric=>{ if(!insightCache.has(metric)) insightCache.set(metric,json(`./data/analytics-users-${metric}.json`).catch(()=>null)); return insightCache.get(metric); };
  const confidenceText={alta:'Confianza alta',media:'Confianza media',baja:'Confianza baja',insuficiente:'Datos insuficientes'};
  const dec=new Intl.NumberFormat('es-PE',{maximumFractionDigits:1});
  const per=v=>`${v>0?'+':''}${dec.format(v)}`;
  function insightRow(icon,label,text) {
    const li=H.node('li');const head=H.node('strong','',label);head.prepend(H.icon(icon));
    li.append(head,H.node('span','',text));return li;
  }
  function buildInsights(key,metric,data,color) {
    const u=data?.users?.[key];
    const box=H.node('section','profile-insights');box.style.borderColor=color;
    box.setAttribute('aria-label',`Lecturas del análisis de @${key}`);
    if (!u) { box.append(H.node('p','history-notice','Aún no hay análisis para este perfil: necesita presencia en la última captura válida.'));return box; }
    const unit=metric==='followers'?'seguidores':metric==='total'?'contribuciones totales':'contribuciones públicas';
    const head=H.node('div','insights-head');
    const title=H.node('h4','',' Lecturas del análisis');title.prepend(H.icon('forecast'));
    const chip=H.node('span',`confidence-chip conf-${u.confidence}`,confidenceText[u.confidence]);
    chip.title=`${u.n} capturas en ${u.spanDays} días`;
    head.append(title,chip);box.append(head);
    const list=H.node('ul','insight-list');
    const pool=usableSelected(), last=pool.at(-1);
    // Pace
    if (u.perDay!==null) {
      let text=`${per(u.perDay)} por día en promedio`;
      if (u.recentPerDay!==null) {
        text+=` · últimos 7 días: ${per(u.recentPerDay)} por día`;
        if (u.perDay>0 && u.recentPerDay>0) text+=` (${dec.format(u.recentPerDay/u.perDay)}× su promedio)`;
      }
      list.append(insightRow('daily','Ritmo',text));
    }
    // Trend
    const trendText={alza:'Tendencia al alza',baja:'Tendencia a la baja',estable:'Sin tendencia distinguible del ruido','sin-datos':'Sin datos suficientes'}[u.trend];
    list.append(insightRow('growth','Tendencia',u.slope!==undefined?`${trendText} (${per(u.slope)} por día${u.r2!==null&&u.r2!==undefined?`, R² ${dec.format(u.r2)}`:''})`:trendText));
    // Position
    if (last) {
      const rows=last.users, mine=rows.find(r=>r[0].toLowerCase()===key);
      if (mine) {
        const rank=ranks(last).get(key), top=Math.max(1,Math.ceil(rank/rows.length*100));
        let text=`Puesto #${fmt.format(rank)} · entre el ${top} % superior de ${fmt.format(rows.length)} perfiles`;
        const city=$('e-city').value, cityList=city?cityRows(last):null;
        if (cityList && cityList.length) {
          const here=cityList.filter(r=>value(r,metric)>value(mine,metric)).length+1;
          text+=` · #${fmt.format(here)} de ${fmt.format(cityList.length)} en el ámbito elegido`;
        }
        list.append(insightRow('rank','Posición',text));
      }
    }
    // Projection
    if (u.projection) {
      const p=u.projection;
      let text=`≈ ${fmt.format(p.value)} ${unit} (rango ${fmt.format(p.low)}–${fmt.format(p.high)})`;
      text+=` · puesto probable #${fmt.format(p.rank)}${p.rankBest!==p.rankWorst?` (entre #${fmt.format(p.rankBest)} y #${fmt.format(p.rankWorst)})`:''}`;
      const row=insightRow('forecast','En 30 días',text);
      row.append(H.node('small','',u.jumpDriven?'Depende sobre todo de un único salto: tómala con mucha cautela.':'Supone que el ritmo actual se mantiene; es una referencia, no una predicción.'));
      list.append(row);
    } else list.append(insightRow('forecast','En 30 días','Todavía no hay suficientes capturas para proyectar.'));
    if (u.catchUp) list.append(insightRow('arrowUp','Alcance',`Alcanzaría a @${u.catchUp.login} (a ${fmt.format(u.catchUp.gap)}) en ~${fmt.format(u.catchUp.days)} días si ambos mantienen su ritmo.`));
    // Jumps
    for (const j of (u.jumps||[]).filter((j,index)=>index===0||(j.share||0)>=0.1)) list.append(insightRow('jump','Salto atípico',`${signed(j.delta)} el ${H.dateLabel(j.date)} (${dec.format(j.times)}× su ritmo habitual)${j.share?`: explica el ${Math.round(j.share*100)} % de su crecimiento`:''}.`));
    // Neighbours
    if (last) {
      const ordered=[...last.users].sort((a,b)=>value(b,metric)-value(a,metric)||a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
      const at=ordered.findIndex(r=>r[0].toLowerCase()===key);
      if (at>=0) {
        const mine=value(ordered[at],metric), near=[...ordered.slice(Math.max(0,at-2),at),...ordered.slice(at+1,at+3)];
        const li=insightRow('users','A su alrededor','');const holder=li.querySelector('span');
        near.forEach(r=>{const b=H.node('button','history-profile-button',`@${r[0]} ${signed(value(r,metric)-mine)}`);b.addEventListener('click',()=>addProfile(r[0].toLowerCase()));holder.append(b);});
        list.append(li);
      }
    }
    box.append(list);
    const note=H.node('p','insights-basis');note.prepend(H.icon('info'));
    const skipped=(quality?.excluded||[]).length;
    note.append(`Basado en ${data.basis.captures} capturas válidas (${H.dateLabel(data.basis.from)} – ${H.dateLabel(data.basis.through)})${skipped?`; excluye ${skipped} incompleta${skipped===1?'':'s'}`:''}. Los contadores son una ventana móvil, no actividad diaria.`);
    box.append(note);
    return box;
  }
  // ---- Data export (everything is generated in the browser from the data already loaded) ----
  const slug=text=>String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const stamp=()=>usableSelected().at(-1)?.date||new Date().toISOString().slice(0,10);
  const exportMeta=basis=>({generado:new Date().toISOString(),fuente:'GitHub Perú · Evolución',base:basis||null,
    notas:['Los contadores de GitHub son una ventana móvil de 12 meses: sus variaciones no equivalen a actividad diaria.','Las capturas incompletas se excluyen de los agregados y del análisis.','Las proyecciones suponen que el ritmo actual se mantiene y se acompañan de su nivel de confianza.']});
  const saveCSV=(name,rows)=>H.download(`${name}.csv`,'text/csv',H.toCSV(rows));
  const saveJSON=(name,payload)=>H.download(`${name}.json`,'application/json',JSON.stringify(payload,null,2)+'\n');
  function seriesRows() {
    const st=exportState,rows=[['fecha','perfil','metrica','valor','puesto_nacional']];
    st.dates.forEach((date,i)=>st.keys.forEach((key,k)=>{ if (st.values[k][i]!==null) rows.push([date,key,st.metric,st.values[k][i],st.ranks[k][i]]); }));
    return rows;
  }
  async function analysisRows() {
    const st=exportState,data=await loadInsights(st.metric),last=usableSelected().at(-1),rankNow=last?ranks(last):new Map();
    const rows=[['perfil','metrica','valor_actual','puesto_actual','capturas','dias','ritmo_por_dia','ritmo_ultimos_7_dias','tendencia','pendiente_por_dia','r2','confianza','proyeccion_30d','proyeccion_30d_bajo','proyeccion_30d_alto','puesto_probable_30d','puesto_mejor','puesto_peor','salto_fecha','salto_valor','salto_veces_su_ritmo','salto_parte_del_crecimiento','alcanza_a','distancia','dias_para_alcanzar','depende_de_un_salto']];
    for (const key of st.keys) {
      const u=data?.users?.[key],cur=last?(cityRows(last)||[]).find(r=>r[0].toLowerCase()===key):null;
      if (!u) { rows.push([key,st.metric,cur?value(cur,st.metric):null,rankNow.get(key)??null]);continue; }
      const p=u.projection||{},j=(u.jumps||[])[0]||{},c=u.catchUp||{};
      rows.push([key,st.metric,cur?value(cur,st.metric):null,rankNow.get(key)??null,u.n,u.spanDays,u.perDay,u.recentPerDay,u.trend,u.slope??null,u.r2??null,u.confidence,p.value??null,p.low??null,p.high??null,p.rank??null,p.rankBest??null,p.rankWorst??null,j.date??null,j.delta??null,j.times??null,j.share??null,c.login??null,c.gap??null,c.days??null,u.jumpDriven?'sí':'no']);
    }
    return rows;
  }
  async function exportProfiles(kind) {
    if (!exportState) return;
    const st=exportState,name=`github-peru-${kind==='series'?'serie':kind==='analysis'?'analisis':'perfiles'}-${st.metric}-${stamp()}`;
    if (kind==='series') saveCSV(name,seriesRows());
    else if (kind==='analysis') saveCSV(name,await analysisRows());
    else {
      const data=await loadInsights(st.metric);
      saveJSON(name,{...exportMeta(data?.basis),metrica:st.metric,perfiles:st.keys.map((key,k)=>({perfil:key,serie:st.dates.map((date,i)=>({fecha:date,valor:st.values[k][i],puesto:st.ranks[k][i]})).filter(r=>r.valor!==null),analisis:data?.users?.[key]||null}))});
    }
  }
  // The group and community analysis live on the Statistics page; keep the chosen scope, metric and profiles.
  function updateStatsLink() {
    const query=new URLSearchParams({metric:$('e-metric').value});
    if ($('e-city').value) query.set('city',$('e-city').value);
    if (profileKeys.length) query.set('users',profileKeys.join(','));
    $('to-stats').href=`./estadisticas/?${query}`;
    const name=$('e-city').selectedOptions[0]?.textContent.split(' · ')[0]||'Todo Perú';
    $('to-stats-label').textContent=$('e-city').value?`Estadísticas de ${name}`:'Estadísticas de toda la comunidad';
  }
  function renderProfiles() {
    renderToken++;
    $('compare-chips').replaceChildren(); $('profile-chart').replaceChildren(); $('profile-details').replaceChildren();
    $('download-card').disabled=true;exportState=null;for (const id of ['export-profiles-series','export-profiles-analysis','export-profiles-json']) $(id).disabled=true;
    if (!profileKeys.length) { $('profile-chart').append(H.node('p','history-notice','Busca tu usuario para descubrir su recorrido. Puedes comparar hasta tres perfiles.'));return; }
    const metric=$('e-metric').value, rankView=$('e-view').value==='rank';
    $('profile-chart').dataset.view=rankView?'rank':'value';
    $('comparison-heading').textContent=rankView?'Movimientos en el ranking.':`Evolución de ${labels[metric].toLowerCase()}.`;
    const maps=selected.map(s=>new Map((cityRows(s)||[]).map(r=>[r[0].toLowerCase(),r]))), positions=selected.map(ranks);
    const series=profileKeys.map(key=>maps.map((rows,i)=>rows.has(key)?rankView?positions[i].get(key):value(rows.get(key),metric):null));
    const all=series.flat().filter(v=>v!==null);
    profileKeys.forEach((key,i)=>{
      const chip=H.node('button','compare-chip',`@${key}`);chip.append(H.icon('close'));chip.style.borderColor=colors[i];chip.setAttribute('aria-label',`Quitar ${key} de la comparación`);
      chip.addEventListener('click',()=>{profileKeys=profileKeys.filter(k=>k!==key);render();});$('compare-chips').append(chip);
    });
    exportState={metric,keys:[...profileKeys],dates:selected.map(s=>s.date),
      values:profileKeys.map(key=>maps.map(m=>m.has(key)?value(m.get(key),metric):null)),
      ranks:profileKeys.map(key=>positions.map(p=>p.get(key)??null))};
    if (all.length) for (const id of ['export-profiles-series','export-profiles-analysis','export-profiles-json']) $(id).disabled=false;
    if (!all.length) { $('profile-chart').append(H.node('p','history-notice','No hay capturas de esos perfiles en el ámbito y las fechas seleccionados.'));return; }
    if (rankView) {
      const grid=H.node('div','rank-journeys');
      profileKeys.forEach((key,i)=>{
        const card=H.node('article','rank-journey');card.style.borderTopColor=colors[i];
        const link=H.node('a','rank-profile',`@${key}`);link.href=`https://github.com/${encodeURIComponent(key)}`;link.target='_blank';link.rel='noopener noreferrer';
        link.prepend(H.icon('user'));card.append(link,H.node('p','history-notice',`${labels[metric]} · puesto nacional`));
        card.append(H.rankMovement(selected.map(s=>s.date),series[i]));
        const valid=series[i].map((v,j)=>v===null?-1:j).filter(j=>j>=0);
        if(valid.length) {
          const first=valid[0],last=valid.at(-1);
          const ranksOf=valid.map(j=>series[i][j]),lo=Math.min(...ranksOf),hi=Math.max(...ranksOf),W=420,Ht=140;
          const rdates=selected.map(s=>s.date),rplot=H.node('div','comparison-plot card-plot');
          rplot.append(H.chart(rdates,series[i],{rank:true,width:W,height:Ht,interval:$('e-tier').value,domain:[lo,hi],window:{from:rdates[first],through:rdates[last]},label:`@${key}: puesto nacional`,color:colors[i]}));
          const span=rdates.slice(first,last+1);
          card.append(H.framePlot(rplot,{dates:span,domain:[lo,hi],format:v=>`#${fmt.format(v)}`,rank:true,width:W,height:Ht,maxTicks:3}));
          H.attachCursor(rplot,{dates:span,series:[series[i].slice(first,last+1)],colors:[colors[i]],names:[`@${key}`],domain:[lo,hi],format:v=>fmt.format(v),rank:true,width:W,height:Ht});
          if(valid.length>1){
            const bestAt=valid.find(j=>series[i][j]===lo),worstAt=valid.find(j=>series[i][j]===hi),moves=valid.filter((j,k)=>k>0&&series[i][j]!==series[i][valid[k-1]]).length;
            const dl=H.node('dl','comparison-stats');dl.style.borderColor=colors[i];
            for(const [t,ic,x] of [['Mejor puesto','rank',`#${lo} · ${H.dateLabel(selected[bestAt].date)}`],['Peor puesto','worst',`#${hi} · ${H.dateLabel(selected[worstAt].date)}`],['Cambios de puesto','moves',`${moves} en ${valid.length} capturas`]]){const it=H.node('div'),dt=H.node('dt','',t);dt.prepend(H.icon(ic));it.append(dt,H.node('dd','',x));dl.append(it);}
            card.append(dl);
          }
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
      const link=H.node('a','',`@${key}`);link.href=`https://github.com/${encodeURIComponent(key)}`;link.target='_blank';link.rel='noopener noreferrer';link.prepend(H.icon('user'));detail.append(link);
      if (!valid.length) detail.append(document.createTextNode(' · Sin datos en esta selección.'));
      else {
        const first=valid[0],last=valid.at(-1),delta=series[i][last]-series[i][first];
        detail.append(document.createTextNode(` · ${rankView?'Puesto nacional':'Contador'}: ${fmt.format(series[i][first])} → ${fmt.format(series[i][last])} · ${valid.length===1?'Primera captura':rankView?movement(-delta):signed(delta)} · ${H.dateLabel(selected[first].date)} – ${H.dateLabel(selected[last].date)}`));
      }
      $('profile-details').append(detail);
      if (valid.length>1) $('profile-details').append(statsGrid(key,series[i],valid,metric,colors[i],positions));
      if (!rankView) {
        const slot=H.node('div','insights-slot');slot.style.minHeight='64px';$('profile-details').append(slot);
        const token=renderToken;
        loadInsights(metric).then(data=>{ if (token!==renderToken || !slot.isConnected) return; slot.replaceWith(buildInsights(key,metric,data,colors[i])); });
      }
    });
    const dates=selected.map(s=>s.date), format=v=>fmt.format(v);
    H.attachCursor(plot,{dates,series,colors,names:profileKeys.map(k=>`@${k}`),ranks:profileKeys.map(k=>positions.map(m=>m.get(k)??null)),domain:[min,max],format,rank:rankView});
    $('profile-chart').append(H.node('p','chart-scale',`${rankView?'Puesto nacional · mejores posiciones arriba':labels[metric]} · escala compartida: ${fmt.format(min)} – ${fmt.format(max)}`),H.framePlot(plot,{dates,domain:[min,max],format:v=>fmt.format(v),rank:rankView}));
    $('download-card').disabled=false;
  }
  // Names, avatars and locations come from the ranking data; the table works without them and fills in when they arrive.
  let profileInfo=null, profileInfoPromise=null;
  function loadProfileInfo() {
    if (!profileInfoPromise) profileInfoPromise=json('./data/peru.json').then(data=>{
      profileInfo=new Map(data.users.map(u=>[u.login.toLowerCase(),u]));renderPast();
    }).catch(()=>{});
    return profileInfoPromise;
  }
  const cleanText=v=>!v||v==='undefined value'?'':String(v);
  function renderPast() {
    $('past-rows').replaceChildren();
    const pool=usableSelected();
    if (!pool.length) { $('past-more').hidden=true;return; }
    const last=pool.at(-1), rows=cityRows(last), beforeRows=cityRows(pool[0]);
    $('past-caption').textContent=`Captura del ${H.dateLabel(last.date)} · Ordenado por ${labels[$('e-metric').value].toLowerCase()}. Puestos nacionales; los empates comparten posición. ${$('e-tier').value==='daily'?'':'Última captura disponible del período; el período actual es provisional. '}`.trim();
    if (rows===null) { $('past-caption').textContent+=' Sin cobertura local en esta captura.';$('past-more').hidden=true;return; }
    loadProfileInfo();
    const metric=$('e-metric').value;
    document.querySelectorAll('#past-ranking-heading ~ *, .history-ranking th[data-metric]').forEach(th=>{ if (th.dataset?.metric) th.classList.toggle('active-metric',th.dataset.metric===metric); });
    const old=ranks(pool[0]), current=ranks(last), oldKeys=new Set((beforeRows || []).map(r=>r[0].toLowerCase()));
    const query=$('past-search').value.trim().replace(/^@/,'').toLowerCase();
    const ordered=[...rows].filter(r=>{const key=r[0].toLowerCase(),info=profileInfo?.get(key);return key.includes(query)||(info&&String(info.name||'').toLowerCase().includes(query));}).sort((a,b)=>current.get(a[0].toLowerCase())-current.get(b[0].toLowerCase()) || a[0].toLowerCase().localeCompare(b[0].toLowerCase(),'en'));
    const shown=ordered.slice(0,pastLimit);
    const maps=pool.map(s=>new Map((cityRows(s)||[]).map(r=>[r[0].toLowerCase(),r])));
    for (const row of shown) {
      const key=row[0].toLowerCase(), tr=H.node('tr'), rank=current.get(key), info=profileInfo?.get(key);
      const position=H.node('td');position.append(H.node('span',`position${rank<=3?' top':''}`,fmt.format(rank)));
      // Profile: avatar, name and handle (the handle adds the profile to the comparison).
      const profile=H.node('td','past-profile'), who=H.node('div','past-who');
      const fallback=H.node('span','avatar avatar-fallback',row[0].slice(0,2).toUpperCase());fallback.setAttribute('aria-hidden','true');
      if (info?.avatarUrl) {
        const img=H.node('img','avatar');img.src=info.avatarUrl;img.alt='';img.width=34;img.height=34;img.loading='lazy';img.referrerPolicy='no-referrer';
        img.addEventListener('error',()=>img.replaceWith(fallback),{once:true});who.append(img);
      } else who.append(fallback);
      const text=H.node('div','past-text');
      const name=cleanText(info?.name);
      if (name) text.append(H.node('span','past-name',name));
      const button=H.node('button','history-profile-button',`@${row[0]}`);button.title='Añadir a la comparación';button.addEventListener('click',()=>addProfile(key));
      text.append(button);who.append(text);profile.append(who);
      const place=H.node('td','past-place',cleanText(info?.location)||'—');
      tr.append(position,profile,place);
      for (const m of ['publicContributions','total','followers']) {
        const td=H.node('td','numeric'),v=fmt.format(value(row,m));
        if (m===metric) td.append(H.node('span','metric-pill',v)); else td.textContent=v;
        tr.append(td);
      }
      // Trend over the selected captures.
      const points=maps.map(map=>map.has(key)?value(map.get(key),metric):null);
      const trend=H.node('td','past-trend'), valid=points.filter(v=>v!==null);
      if (valid.length>1) {
        const delta=valid.at(-1)-valid[0];
        const spark=H.chart(pool.map(s=>s.date),points,{minSpan:Math.max(1,(valid[0]||0)*.1),color:delta>0?'#176b55':delta<0?'#b63735':'#737b87',label:`${labels[metric]} de ${row[0]}`});
        spark.querySelectorAll?.('title').forEach(t=>t.remove());
        trend.append(spark,H.node('small',`rank-change ${delta>0?'up':delta<0?'down':'stable'}`,delta?signed(delta):'Sin cambio'));
      } else trend.append(H.node('small','history-empty',valid.length?'Primera captura':'Sin capturas'));
      tr.append(trend);
      const moveCell=H.node('td','',pool.length<2?'Primera captura':beforeRows===null?'Sin cobertura inicial':oldKeys.has(key)?'':'No presente al inicio');
      if (pool.length>=2 && beforeRows!==null && oldKeys.has(key)) {
        const v=old.get(key)-current.get(key);
        moveCell.className=`rank-change-cell ${v>0?'up':v<0?'down':'stable'}`;
        moveCell.append(H.icon(v>0?'arrowUp':v<0?'arrowDown':'equal'),v===0?'Sin cambio':String(Math.abs(v)),H.node('small','past-from',`#${fmt.format(old.get(key))} → #${fmt.format(rank)}`));
      }
      tr.append(moveCell);
      $('past-rows').append(tr);
    }
    if (!ordered.length) $('past-caption').textContent+=' No hay perfiles con esa búsqueda.';
    $('past-more').hidden=ordered.length<=pastLimit;
    $('past-count')&&($('past-count').textContent=`Mostrando ${fmt.format(Math.min(pastLimit,ordered.length))} de ${fmt.format(ordered.length)} perfiles`);
  }
  function renderWeekly() {
    const w=summary.scopes[$('e-city').value || 'peru']?.weekly, wrap=$('weekly-summary');wrap.replaceChildren();
    if (!w) {wrap.append(H.node('p','','El resumen aparecerá con capturas comparables separadas entre 7 y 14 días.'));return;}
    wrap.append(H.node('p','',`${H.dateLabel(w.from)} – ${H.dateLabel(w.through)} · última comparación semanal disponible. ${w.matched} perfiles comparables; ${w.entered} entradas y ${w.left} salidas.`));
    wrap.append(H.node('p','',`Variación del contador público en perfiles comparables: ${signed(w.publicDeltaMatched)}. Seguidores: ${signed(w.followersDeltaMatched)}.`));
    if (!w.movers.length) wrap.append(H.node('p','','Sin ascensos de puesto nacional entre estas capturas.'));
    for (const mover of w.movers) {
      const b=H.node('button','history-profile-button',`@${mover.login}`);b.append(H.icon('arrowUp'),`${mover.change} puestos nacionales`);b.addEventListener('click',()=>addProfile(mover.login.toLowerCase()));wrap.append(b);
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
    renderQuality();
    $('e-coverage').textContent=`${selected.length} capturas seleccionadas · ${H.dateLabel(selected[0].date)} – ${H.dateLabel(selected.at(-1).date)}. ${selected.length===1?'Primera captura: todavía no hay una tendencia. ':''}${$('e-city').value?`${cityCount} con cobertura de ciudad. `:''}Los huecos se conservan. Hora de referencia: Perú.`;
    renderCommunity();updateStatsLink();renderProfiles();renderPast();renderWeekly();updateURL();
  }
  function addProfile(input) {
    const key=input.trim().replace(/^@/,'').toLowerCase();
    if (!/^[a-z0-9-]{1,39}$/.test(key)) { $('compare-status').textContent='Escribe un usuario de GitHub válido.';return; }
    if (profileKeys.includes(key)) { $('compare-status').textContent='Ese perfil ya está en la comparación.';return; }
    if (profileKeys.length>=3) { $('compare-status').textContent='Puedes comparar hasta tres perfiles. Quita uno para añadir otro.';return; }
    if (!snapshots.some(s=>s.users.some(r=>r[0].toLowerCase()===key))) { $('compare-status').textContent='No encontramos ese usuario en las capturas de este período.';return; }
    profileKeys.push(key);$('e-profile').value='';$('compare-status').textContent='';render();
  }
  // Arriving with profiles in the link (from the ranking, a hover card or Statistics) lands on their evolution, not at the top.
  function goToProfileSection() {
    const wants=profileKeys.length>0 || location.hash==='#tu-evolucion';
    const target=$('tu-evolucion');
    if (!wants || !target || $('evolution-app').hidden) return;
    const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(()=>{
      target.scrollIntoView({behavior:calm?'auto':'smooth',block:'start'});
      const heading=$('comparison-heading');heading.tabIndex=-1;heading.focus({preventScroll:true});
    });
  }
  async function start() {
    decorateControls();
    $('evolution-retry').hidden=true;
    try {
      [catalog,summary,quality]=await Promise.all([json('./history/index.json'),json('./data/evolution-summary.json'),json('./data/analytics-quality.json').catch(()=>null)]);
      if (!catalog.series || !summary.scopes) throw new Error('Invalid catalog');
      for (const [id,key] of [['e-city','city'],['e-tier','tier'],['e-days','days'],['e-metric','metric'],['e-view','view']]) selectKnown(id,key);
      profileKeys=[...new Set((params.get('users') || '').split(',').map(v=>v.toLowerCase()).filter(v=>/^[a-z0-9-]{1,39}$/.test(v)))].slice(0,3);
      await loadTier(true);
      goToProfileSection();
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
    try {await navigator.clipboard.writeText(location.href);$('share-status').textContent='Enlace copiado.';flashIcon($('share-view'));}
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
