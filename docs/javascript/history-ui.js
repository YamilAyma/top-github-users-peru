"use strict";
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const day = value => Date.parse(`${value}T12:00:00Z`) / 86400000;
  const dateLabel = value => new Intl.DateTimeFormat('es-PE', {day:'2-digit', month:'short', year:'numeric', timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
  function node(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function svgNode(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
  }
  function chart(dates, values, {rank=false, width=120, height=36, window:range, daily=true, interval='daily', domain, minSpan=0, label='Evolución', color='#b63735'}={}) {
    const valid = values.map((v,i) => v !== null && Number.isFinite(v) ? i : -1).filter(i=>i>=0);
    if (!valid.length) return node('span', 'history-empty', 'Sin capturas');
    const svg = svgNode('svg', {viewBox:`0 0 ${width} ${height}`, role:'img', 'aria-label':label, class:'history-chart', preserveAspectRatio:'none'});
    const title = svgNode('title', {});
    const first = valid[0], last = valid.at(-1);
    title.textContent = `${label}. ${dateLabel(dates[first])}: ${values[first]}; ${dateLabel(dates[last])}: ${values[last]}. ${valid.length} capturas. Los huecos no se interpolan.`;
    svg.append(title);
    svg.setAttribute('aria-label', title.textContent);
    let low = domain?.[0] ?? Math.min(...valid.map(i=>values[i])), high = domain?.[1] ?? Math.max(...valid.map(i=>values[i]));
    if (!domain && high-low < minSpan) {
      const middle=(low+high)/2;
      low=rank ? Math.max(1,middle-minSpan/2) : middle-minSpan/2;
      high=low+minSpan;
    }
    const start = day(range?.from || dates[0]), end = day(range?.through || dates.at(-1));
    const x = i => start===end ? width/2 : 5 + (day(dates[i]) - start) / Math.max(1, end-start) * (width-10);
    const y = i => low===high ? height/2 : 5 + (rank ? values[i]-low : high-values[i]) / (high-low) * (height-10);
    let path = '', prev = -2;
    for (const i of valid) {
      const periodStep = prev>=0 && (interval==='monthly' ? (Number(dates[i].slice(0,4))*12+Number(dates[i].slice(5,7)))-(Number(dates[prev].slice(0,4))*12+Number(dates[prev].slice(5,7))) : interval==='yearly' ? Number(dates[i].slice(0,4))-Number(dates[prev].slice(0,4)) : day(dates[i])-day(dates[prev]));
      const contiguous = i===prev+1 && periodStep===1;
      path += `${contiguous?'L':'M'}${x(i).toFixed(1)},${y(i).toFixed(1)} `;
      prev=i;
    }
    svg.append(svgNode('path', {d:path, fill:'none', stroke:color, 'stroke-width':2, 'stroke-linejoin':'round', 'stroke-linecap':'round', 'vector-effect':'non-scaling-stroke'}));
    // Dots keep isolated observations visible, including a single starting capture.
    for (const i of valid) {
      const dot=svgNode('circle', {cx:x(i).toFixed(1), cy:y(i).toFixed(1), r: valid.length===1 ? 3 : 1.7, fill:color});
      const tooltip=svgNode('title',{});tooltip.textContent=`${dateLabel(dates[i])}: ${values[i]}`;dot.append(tooltip);svg.append(dot);
    }
    return svg;
  }
  function rankMovement(dates, ranks, {compact=false}={}) {
    const indices=ranks.map((v,i)=>v!==null && Number.isFinite(v)?i:-1).filter(i=>i>=0);
    const wrap=node('div',compact?'rank-movement compact':'rank-movement');
    if(!indices.length) {wrap.append(node('span','history-empty','Sin capturas'));return wrap;}
    const first=indices[0], last=indices.at(-1), change=ranks[first]-ranks[last];
    const badge=node('span',`movement-badge ${change>0?'up':change<0?'down':'stable'}`,indices.length===1?'Primera captura':change>0?`↑ ${change} ${change===1?'puesto':'puestos'}`:change<0?`↓ ${-change} ${change===-1?'puesto':'puestos'}`:'= Sin cambio');
    const journey=node('div','rank-endpoints');
    journey.append(node('span','rank-token',`#${ranks[first]}`));
    if(indices.length>1) {journey.append(node('span','rank-arrow','→'),node('span','rank-token current',`#${ranks[last]}`));}
    wrap.append(journey,badge);
    wrap.title=`Puesto nacional: ${dateLabel(dates[first])} – ${dateLabel(dates[last])}. ${indices.length} capturas disponibles.`;
    wrap.setAttribute('aria-label',`Puesto nacional: ${ranks[first]}${indices.length>1?` a ${ranks[last]}`:''}. ${badge.textContent}. ${dateLabel(dates[first])} – ${dateLabel(dates[last])}`);
    return wrap;
  }
  function metricCard(dates, values, label, {interval='daily'}={}) {
    const fmt=new Intl.NumberFormat('es-PE');
    const valid=values.map((v,i)=>v!==null && Number.isFinite(v)?i:-1).filter(i=>i>=0);
    const card=node('article','history-card');card.append(node('h3','',label));
    card.append(node('strong','history-value',valid.length?fmt.format(values[valid.at(-1)]):'Sin cobertura histórica'));
    if (!valid.length) {
      card.append(node('p','history-empty','Las capturas locales comienzan cuando se registra la ciudad; no se reconstruyen con ubicaciones actuales.'));
      return card;
    }
    const first=valid[0], last=valid.at(-1), delta=values[last]-values[first];
    const signed=n=>`${n>0?'+':''}${fmt.format(n)}`;
    const percent=values[first] ? ` (${new Intl.NumberFormat('es-PE',{maximumFractionDigits:2,signDisplay:'exceptZero'}).format(delta/values[first]*100)} %)` : '';
    const text=valid.length===1?'Primera captura · todavía sin comparación':delta===0?`Sin cambios en ${valid.length} capturas`:`${signed(delta)}${percent} desde ${dateLabel(dates[first])}`;
    card.append(node('p',`counter-change ${delta>0?'up':delta<0?'down':'stable'}`,text));
    const changes=values.map(v=>v===null?null:v-values[first]);
    const plot=node('div','delta-plot');
    const ticks=node('div','delta-axis');
    const actual=valid.map(i=>changes[i]);
    const low=Math.min(0,...actual), high=Math.max(0,...actual);
    ticks.append(node('span','',signed(high)),node('span','',low===high?'':signed(low)));
    plot.append(ticks,chart(dates,changes,{width:420,height:80,interval,domain:[low,high],window:{from:dates[first],through:dates[last]},color:delta===0?'#737b87':'#b63735',label:`Variación de ${label.toLowerCase()} respecto a ${dateLabel(dates[first])}`}));
    card.append(plot);
    const ends=node('div','chart-endpoints');ends.append(node('span','',dateLabel(dates[first])),node('span','',first===last?'':dateLabel(dates[last])));card.append(ends);
    card.append(node('p','history-card-caption',valid.length===1?'Hace falta otra captura para trazar una evolución.':'La línea muestra la variación del contador desde la primera captura, no actividad diaria.'));
    return card;
  }
  const KEY = 'github-peru:favorites:v1';
  let available = true, saved = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(raw)) saved = new Set(raw.filter(v=>typeof v==='string' && /^[a-z0-9-]+$/i.test(v)).map(v=>v.toLowerCase()));
  } catch { available=false; }
  function toggle(login) {
    const key=login.toLowerCase(), next=new Set(saved);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem(KEY, JSON.stringify([...next])); available=true; }
    catch { available=false; return false; }
    saved=next;
    window.dispatchEvent(new Event('favorites-changed'));
    return true;
  }
  window.PeruHistory = {chart, metricCard, rankMovement, node, day, dateLabel, favorites: {has: login=>saved.has(login.toLowerCase()), toggle, available:()=>available}};
})();
