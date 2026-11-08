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
  const PAD = 5;
  const isoOfDay = d => new Date(Math.floor(d) * 86400000).toISOString().slice(0, 10);
  // Wraps a plot in a frame with value ticks, grid lines and date ticks (HTML, so text is never stretched).
  function framePlot(plot, {dates, domain, format=v=>String(v), rank=false, width=900, height=220, maxTicks=5, marks=[]}) {
    const [low, high] = domain, start = day(dates[0]), end = day(dates.at(-1));
    const frame = node('div', 'plot-frame'), yAxis = node('div', 'plot-yaxis'), xAxis = node('div', 'plot-xaxis');
    yAxis.style.height = plot.style.height = `${height}px`;
    yAxis.setAttribute('aria-hidden', 'true'); xAxis.setAttribute('aria-hidden', 'true');
    const fractions = low === high ? [0.5] : high - low <= 4 && Number.isInteger(low) && Number.isInteger(high) ? Array.from({length: high - low + 1}, (_, k) => k / (high - low)) : [0, 1/3, 2/3, 1];
    for (const f of fractions) {
      const top = low === high ? height / 2 : PAD + f * (height - 2 * PAD);
      const value = low === high ? low : rank ? low + f * (high - low) : high - f * (high - low);
      const tick = node('span', '', format(Math.round(value))); tick.style.top = `${top}px`; yAxis.append(tick);
      const line = node('i', 'plot-gridline'); line.style.top = `${top}px`; plot.append(line);
    }
    const count = start === end ? 1 : Math.min(maxTicks, dates.length);
    for (let k = 0; k < count; k++) {
      const f = count === 1 ? 0.5 : k / (count - 1);
      const label = node('span', k === 0 && count > 1 ? 'edge-start' : k === count - 1 && count > 1 ? 'edge-end' : '', dateLabel(isoOfDay(start + f * (end - start))));
      label.style.left = `${(PAD + f * (width - 2 * PAD)) / width * 100}%`; xAxis.append(label);
    }
    // Marks flag captures with a data-quality note (excluded or adjusted), drawn along the date axis.
    for (const mark of marks) {
      if (start === end) break;
      const f = (day(mark.date) - start) / (end - start);
      if (f < 0 || f > 1) continue;
      const el = node('i', `plot-mark ${mark.kind || ''} ${f < 0.3 ? 'edge-start' : f > 0.7 ? 'edge-end' : ''}`);
      el.style.left = `${(PAD + f * (width - 2 * PAD)) / width * 100}%`;
      el.setAttribute('role', 'img'); el.setAttribute('aria-label', mark.label); el.dataset.label = mark.label; el.tabIndex = 0;
      plot.append(el);
    }
    frame.append(yAxis, plot, node('span'), xAxis);
    return frame;
  }
  // Hover / touch / keyboard cursor: shows every series' value on the nearest capture.
  function attachCursor(plot, {dates, series, colors, names, ranks, domain, format=v=>String(v), rank=false, width=900, height=220, extra}) {
    const [low, high] = domain, start = day(dates[0]), end = day(dates.at(-1));
    const indices = dates.map((_, i) => i).filter(i => series.some(s => s[i] !== null && Number.isFinite(s[i])));
    if (!indices.length) return;
    const fracOf = i => start === end ? 0.5 : (PAD + (day(dates[i]) - start) / (end - start) * (width - 2 * PAD)) / width;
    const yOf = v => low === high ? height / 2 : PAD + (rank ? v - low : high - v) / (high - low) * (height - 2 * PAD);
    // The custom tooltip replaces the browser's native one; the svg keeps its aria-label.
    plot.querySelectorAll('svg title').forEach(t => t.remove());
    const cursor = node('i', 'plot-cursor'), tip = node('div', 'plot-tooltip'), live = node('span', 'sr-only');
    const dots = series.map((_, k) => { const d = node('i', 'plot-cursor-dot'); d.style.background = colors[k]; return d; });
    cursor.hidden = tip.hidden = true; dots.forEach(d => d.hidden = true);
    live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    plot.append(cursor, ...dots, tip, live);
    plot.tabIndex = 0; plot.setAttribute('role', 'group');
    plot.setAttribute('aria-label', 'Gráfica interactiva. Usa las flechas izquierda y derecha para recorrer las capturas.');
    let current = -1;
    const nf = new Intl.NumberFormat('es-PE', {signDisplay: 'exceptZero'});
    function show(i, announce) {
      current = i;
      const left = fracOf(i) * 100;
      cursor.style.left = `${left}%`; cursor.hidden = false;
      tip.replaceChildren(node('strong', '', dateLabel(dates[i])));
      const spoken = [dateLabel(dates[i])];
      series.forEach((values, k) => {
        const dot = dots[k], v = values[i];
        if (v === null || !Number.isFinite(v)) { dot.hidden = true; return; }
        dot.style.left = `${left}%`; dot.style.top = `${yOf(v)}px`; dot.hidden = false;
        let prev = -1; for (let j = i - 1; j >= 0; j--) if (values[j] !== null && Number.isFinite(values[j])) { prev = j; break; }
        const row = node('p', 'plot-tooltip-row'); row.style.borderColor = colors[k];
        const change = prev < 0 ? 'primera captura' : rank ? (values[prev] === v ? 'sin cambio' : `${values[prev] - v > 0 ? '↑' : '↓'} ${Math.abs(values[prev] - v)}`) : `${nf.format(v - values[prev])} vs. captura previa`;
        const place = extra ? extra(k, i) : !rank && ranks?.[k]?.[i] ? ` · puesto #${ranks[k][i]}` : '';
        row.append(node('span', '', names[k]), node('b', '', rank ? `#${format(v)}` : format(v)), node('small', '', change + place));
        tip.append(row); spoken.push(`${names[k]}: ${rank ? '#' : ''}${format(v)}, ${change}${place}`);
      });
      tip.hidden = false; tip.classList.toggle('flip', left > 60);
      tip.style.left = `${left}%`;
      if (announce) live.textContent = spoken.join('. ');
    }
    const hide = () => { current = -1; cursor.hidden = tip.hidden = true; dots.forEach(d => d.hidden = true); };
    plot.addEventListener('pointermove', e => {
      if (e.target.closest && e.target.closest('.plot-mark')) { hide(); return; }
      const r = plot.getBoundingClientRect(), f = ((e.clientX - r.left) / r.width * width - PAD) / (width - 2 * PAD);
      const target = start + f * (end - start);
      let best = indices[0]; for (const i of indices) if (Math.abs(day(dates[i]) - target) < Math.abs(day(dates[best]) - target)) best = i;
      if (best !== current) show(best, false);
    });
    plot.addEventListener('pointerleave', () => { if (document.activeElement !== plot) hide(); });
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', e => {
      const pos = indices.indexOf(current);
      let next = null;
      if (e.key === 'ArrowLeft') next = pos < 0 ? indices.at(-1) : indices[Math.max(0, pos - 1)];
      else if (e.key === 'ArrowRight') next = pos < 0 ? indices[0] : indices[Math.min(indices.length - 1, pos + 1)];
      else if (e.key === 'Home') next = indices[0]; else if (e.key === 'End') next = indices.at(-1);
      else if (e.key === 'Escape') { hide(); return; }
      if (next === null) return;
      e.preventDefault(); show(next, true);
    });
  }
  const ICONS = {
    growth: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    daily: 'M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM9 14h6',
    jump: 'M13 2L5 14h6l-1 8 8-12h-6z',
    max: 'M12 20V6M6 12l6-6 6 6M5 3h14',
    min: 'M12 4v14M6 12l6 6 6-6M5 21h14',
    rank: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3',
    worst: 'M12 4v14M6 12l6 6 6-6',
    moves: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
    link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    check: 'M5 12.5l4.5 4.5L19 7',
    download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    view: 'M3 17l5-5 4 4 8-9M4 4v16h16',
    arrowUp: 'M12 19V5M5 12l7-7 7 7',
    arrowDown: 'M12 5v14M5 12l7 7 7-7',
    equal: 'M5 9h14M5 15h14',
    pin: 'M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    bars: 'M5 20V10M12 20V4M19 20v-7',
    users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20a7 7 0 0114 0M16 4.3a3.5 3.5 0 010 6.4M18 14a7 7 0 013.5 6',
    pulse: 'M3 12h4l3-8 4 16 3-8h4',
    chevronDown: 'M6 9l6 6 6-6',
    refresh: 'M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4',
    heart: 'M12 20s-8-4.9-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 9c0 6.1-8 11-8 11z',
    globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18',
    sigma: 'M18 5H6l6 7-6 7h12',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    sort: 'M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4',
    pause: 'M8 5v14M16 5v14',
    play: 'M7 4l13 8-13 8z',
    swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
    map: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
    forecast: 'M3 17l5-5 4 3 3-4M17 9h4v4M15 11l6-3',
    info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.5-4.5'
  };
  function icon(name, {fill = false} = {}) {
    const svg = svgNode('svg', {viewBox: '0 0 24 24', width: 16, height: 16, fill: fill ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'stat-icon', 'aria-hidden': 'true', focusable: 'false'});
    svg.append(svgNode('path', {d: ICONS[name] || ICONS.growth}));
    return svg;
  }
  // Prepends an icon to a label / heading / button without disturbing its form control.
  function decorate(el, name) {
    if (!el) return;
    const first = el.firstChild;
    if (first && first.nodeType === 3 && el.querySelector('select,input')) {
      const text = node('span', 'label-text'); text.append(icon(name), first.textContent); first.replaceWith(text);
    } else el.prepend(icon(name));
  }
  // Wraps a text input so it can show a leading search icon.
  function searchField(input) {
    if (!input || input.parentElement.classList.contains('input-icon')) return;
    const wrap = node('span', 'input-icon'); input.replaceWith(wrap); wrap.append(icon('search'), input);
  }
  function rankMovement(dates, ranks, {compact=false}={}) {
    const indices=ranks.map((v,i)=>v!==null && Number.isFinite(v)?i:-1).filter(i=>i>=0);
    const wrap=node('div',compact?'rank-movement compact':'rank-movement');
    if(!indices.length) {wrap.append(node('span','history-empty','Sin capturas'));return wrap;}
    const first=indices[0], last=indices.at(-1), change=ranks[first]-ranks[last];
    const dir=change>0?'up':change<0?'down':'stable', amount=Math.abs(change);
    const badge=node('span',`movement-badge ${dir}`);
    if (indices.length===1) badge.append('Primera captura');
    else badge.append(icon(change>0?'arrowUp':change<0?'arrowDown':'equal'), change===0?'Sin cambio':`${amount} ${amount===1?'puesto':'puestos'}`);
    const journey=node('div','rank-endpoints');
    journey.append(node('span','rank-token',`#${ranks[first]}`));
    if(indices.length>1) {journey.append(node('span','rank-arrow','→'),node('span','rank-token current',`#${ranks[last]}`));}
    wrap.append(journey,badge);
    wrap.title=`Puesto nacional: ${dateLabel(dates[first])} – ${dateLabel(dates[last])}. ${indices.length} capturas disponibles.`;
    wrap.setAttribute('aria-label',`Puesto nacional: ${ranks[first]}${indices.length>1?` a ${ranks[last]}`:''}. ${badge.textContent}. ${dateLabel(dates[first])} – ${dateLabel(dates[last])}`);
    return wrap;
  }
  function metricCard(dates, values, label, {interval='daily', marks=[]}={}) {
    const fmt=new Intl.NumberFormat('es-PE');
    const valid=values.map((v,i)=>v!==null && Number.isFinite(v)?i:-1).filter(i=>i>=0);
    const card=node('article','history-card');
    const lower=label.toLowerCase(), bg=icon(lower.includes('seguidores')?'heart':lower.includes('perfiles')?'user':'pulse');
    bg.classList.add('card-bg-icon'); bg.setAttribute('width', 88); bg.setAttribute('height', 88); bg.setAttribute('stroke-width', 1.5);
    card.append(bg, node('h3','',label));
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
    const actual=valid.map(i=>changes[i]);
    const low=Math.min(0,...actual), high=Math.max(0,...actual);
    const W=420, Hh=120, color=delta===0?'#737b87':'#b63735';
    const plot=node('div','comparison-plot card-plot');
    plot.append(chart(dates,changes,{width:W,height:Hh,interval,domain:[low,high],window:{from:dates[first],through:dates[last]},color,label:`Variación de ${label.toLowerCase()} respecto a ${dateLabel(dates[first])}`}));
    const frameDates=dates.slice(first,last+1);
    card.append(framePlot(plot,{dates:frameDates,domain:[low,high],format:signed,width:W,height:Hh,maxTicks:3,marks}));
    attachCursor(plot,{dates:dates.slice(first,last+1),series:[changes.slice(first,last+1)],colors:[color],names:[label],domain:[low,high],format:signed,width:W,height:Hh,extra:(k,i)=>` · total ${fmt.format(values[first+i])}`});
    if (valid.length>1) {
      const days=day(dates[last])-day(dates[first]);
      let high=first,lo=first;valid.forEach(j=>{if(values[j]>values[high])high=j;if(values[j]<values[lo])lo=j;});
      const parts=[`Máx ${fmt.format(values[high])} · ${dateLabel(dates[high])}`,`Mín ${fmt.format(values[lo])} · ${dateLabel(dates[lo])}`];
      if (days>0) parts.push(`Promedio ${signed((Math.round(delta/days*10)/10)||0)} por día`);
      card.append(node('p','history-card-stats',parts.join(' · ')));
    }
    card.append(node('p','history-card-caption',valid.length===1?'Hace falta otra captura para trazar una evolución.':'La línea muestra la variación del contador desde la primera captura, no actividad diaria.'));
    return card;
  }
  // CSV: UTF-8 with BOM for Excel, quoted when needed, and text that a spreadsheet could run as a formula is neutralised.
  function toCSV(rows) {
    const cell = (value) => {
      if (value === null || value === undefined) return '';
      let text = typeof value === 'number' ? String(value) : String(value);
      if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  function download(filename, mime, text) {
    const url = URL.createObjectURL(new Blob([text], {type: `${mime};charset=utf-8`}));
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  function decorateNav() {
    document.querySelectorAll('.site-nav a:not(.repository)').forEach(a => {
      if (a.querySelector('.stat-icon')) return;
      const href = a.getAttribute('href') || '';
      a.prepend(icon(/evolucion\/?(\?.*)?$/.test(href) ? 'view' : /estadisticas\/?(\?.*)?$/.test(href) ? 'layers' : 'rank'));
    });
  }
  decorateNav();
  window.PeruHistory = {chart, icon, toCSV, download, decorate, searchField, framePlot, attachCursor, metricCard, rankMovement, node, day, dateLabel, favorites: {has: login=>saved.has(login.toLowerCase()), toggle, available:()=>available}};
})();
