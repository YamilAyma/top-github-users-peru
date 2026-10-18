"use strict";
(() => {
  const section=document.getElementById('history-preview');
  if (!section) return;
  const H=window.PeruHistory, fmt=new Intl.NumberFormat('es-PE');
  const select=document.getElementById('preview-days');
  let summary;
  const metricNames={profiles:'Perfiles registrados', publicContributions:'Contador público agregado'};
  function render() {
    const city=document.body.dataset.city || '', scope=summary.scopes[city || 'peru'];
    const all=scope?.series.daily || [];
    const end=summary.window?.through;
    const points=all.filter(p=>!end || H.day(end)-H.day(p.date)<Number(select.value));
    const wrap=document.getElementById('preview-charts');
    wrap.replaceChildren();
    for (const metric of ['profiles','publicContributions']) {
      const card=H.node('article','history-card');
      card.append(H.node('h3','',metricNames[metric]));
      const valid=points.filter(p=>p[metric]!==null);
      card.append(H.node('strong','history-value',valid.length?fmt.format(valid.at(-1)[metric]):'Sin cobertura histórica'));
      if (valid.length) {
        card.append(H.chart(points.map(p=>p.date), points.map(p=>p[metric]), {width:420,height:80,label:metricNames[metric]}));
        card.append(H.node('p','',valid.length===1 ? `Primera captura: ${H.dateLabel(valid[0].date)}. Aún no hay una tendencia.` : `${valid.length} capturas · ${H.dateLabel(valid[0].date)} – ${H.dateLabel(valid.at(-1).date)}`));
      } else card.append(H.node('p','','Las capturas locales comienzan cuando se registra la ciudad; no se reconstruyen con ubicaciones actuales.'));
      wrap.append(card);
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
  if ('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}}, {rootMargin:'160px'});
    observer.observe(section);
  } else load();
})();
