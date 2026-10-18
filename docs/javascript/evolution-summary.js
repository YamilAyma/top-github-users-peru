"use strict";
(() => {
  const section=document.getElementById('history-preview');
  if (!section) return;
  const H=window.PeruHistory, fmt=new Intl.NumberFormat('es-PE');
  const select=document.getElementById('preview-days');
  let summary;
  const metricNames={publicContributions:'Contribuciones públicas', followers:'Seguidores acumulados'};
  function render() {
    const city=document.body.dataset.city || document.getElementById('city')?.value || '', scope=summary.scopes[city || 'peru'];
    const all=scope?.series.daily || [];
    const end=summary.window?.through;
    const points=all.filter(p=>!end || H.day(end)-H.day(p.date)<Number(select.value));
    const wrap=document.getElementById('preview-charts');
    wrap.replaceChildren();
    const dates=points.map(p=>p.date);
    const valid=points.filter(p=>p.profiles!==null);
    const days=valid.length ? H.day(valid.at(-1).date)-H.day(valid[0].date)+1 : 0;
    const coverage=document.getElementById('preview-coverage');
    coverage.textContent=valid.length ? `${valid.length} ${valid.length===1?'captura disponible':'capturas disponibles'} · ${days} ${days===1?'día registrado':'días de período'} de una ventana máxima de ${select.value} días. ${valid.length<Number(select.value)?'El historial todavía no cubre toda la ventana seleccionada.':''}` : 'No hay capturas con cobertura local en esta ventana.';
    const population=document.getElementById('preview-population');
    population.textContent=valid.length ? `Perfiles registrados: ${fmt.format(valid.at(-1).profiles)}${valid.length>1 && valid.every(p=>p.profiles===valid[0].profiles)?` · sin cambios en la cantidad (${valid.length} capturas).`:valid.length>1?` · ${valid[0].profiles} → ${valid.at(-1).profiles} entre las fechas disponibles.`:' · primera captura.'}` : '';
    for (const metric of ['publicContributions','followers']) {
      wrap.append(H.metricCard(dates,points.map(p=>p[metric]),metricNames[metric]));
    }
    const weekly=document.getElementById('preview-movers');
    weekly.replaceChildren();
    if (scope?.weekly) {
      const w=scope.weekly;
      weekly.append(H.node('p','',`Pulso semanal · ${H.dateLabel(w.from)} – ${H.dateLabel(w.through)}. ${w.matched} perfiles comparables, ${w.entered} entradas y ${w.left} salidas.`));
      for (const mover of w.movers.slice(0,3)) {
        const a=H.node('a','mover-link',`@${mover.login} ↑ ${mover.change}`);
        a.href=`./evolucion/?users=${encodeURIComponent(mover.login)}${city?`&city=${encodeURIComponent(city)}`:''}`;
        weekly.append(a);
      }
      if (!w.movers.length) weekly.append(H.node('p','','Sin ascensos de puesto nacional entre las fechas comparadas.'));
    } else weekly.append(H.node('p','history-notice','El resumen semanal aparecerá cuando haya capturas comparables separadas por al menos 7 días.'));
  }
  async function load() {
    try {
      const response=await fetch('./data/evolution-summary.json',{priority:'low'});
      if (!response.ok) throw new Error('Unavailable');
      summary=await response.json();
      render();
      select.hidden=false;
      select.addEventListener('change',render);
    } catch { document.getElementById('preview-movers').textContent='El explorador conserva las capturas disponibles. Abre Evolución para consultar o reintentar su carga.'; }
  }
  window.addEventListener('ranking-scope-changed',()=>{if(summary)render();});
  if ('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}}, {rootMargin:'160px'});
    observer.observe(section);
  } else load();
})();
