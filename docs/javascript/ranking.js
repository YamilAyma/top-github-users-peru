"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const history = window.PeruHistory;
  const trendCache = new Map();
  let tableVisible = false;
  const format = new Intl.NumberFormat("es-PE");
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const clean = (value) =>
    !value || value === "undefined value" ? "" : String(value);
  const state = {
    users: [],
    cities: [],
    metric: document.body.dataset.initialMetric || "publicContributions",
    direction: -1,
    start: Number(document.body.dataset.start || 0),
    visible: Number(document.body.dataset.start || 0) + 25,
    batch: 25,
    loaded: false,
  };
  const labels = {
    publicContributions: "contribuciones públicas",
    total: "contribuciones totales",
    followers: "seguidores",
  };
  let filtered = [];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function profileURL(login) {
    return `https://github.com/${encodeURIComponent(login)}`;
  }
  function externalLink(href, className, text) {
    const link = element("a", className, text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }
  // Motion: subtle, transform/opacity only, and off under prefers-reduced-motion.
  const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROW_STAGGER = 28, ROW_DURATION = 380, ROW_COUNT = 12;
  const paintStart = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0;
  let firstRowsRender = true;
  const statSeen = new Set();
  function setStat(id, value) {
    const el = $(id);
    if (statSeen.has(id) || !motionOK()) { statSeen.add(id); el.textContent = format.format(value); return; }
    statSeen.add(id);
    const start = performance.now(), duration = 600;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format.format(Math.round(value * (0.85 + 0.15 * eased)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function row(user, rank) {
    const tr = element("tr");
    tr.dataset.login = user.login;
    tr.dataset.live = "";
    tr.classList.toggle("is-favorite", history.favorites.has(user.login));
    const position = element("td");
    position.append(
      element(
        "span",
        `position${rank <= 3 ? " top" : ""}`,
        format.format(rank),
      ),
    );
    const profile = element("td", "profile-cell");
    const link = externalLink(profileURL(user.login), "profile");
    const fallback = element(
      "span",
      "avatar avatar-fallback",
      user.login.slice(0, 2).toUpperCase(),
    );
    fallback.setAttribute("aria-hidden", "true");
    if (user.avatarUrl) {
      const avatar = element("img", "avatar");
      avatar.src = user.avatarUrl;
      avatar.alt = "";
      avatar.width = 34;
      avatar.height = 34;
      avatar.loading = "lazy";
      avatar.referrerPolicy = "no-referrer";
      avatar.addEventListener("error", () => avatar.replaceWith(fallback), {
        once: true,
      });
      link.append(avatar);
    } else link.append(fallback);
    const info = element("span", "profile-info");
    const name = element(
      "span",
      "profile-name",
      clean(user.name) || user.login,
    );
    name.title = name.textContent;
    info.append(name, element("span", "handle", `@${user.login}`));
    link.append(info);
    profile.append(link);
    const favorite = element('button', 'favorite-button');
    favorite.append(history.icon('star', {fill: history.favorites.has(user.login)}));
    favorite.type = 'button';
    favorite.dataset.favorite = user.login;
    favorite.setAttribute('aria-pressed', String(history.favorites.has(user.login)));
    favorite.setAttribute('aria-label', `Favorito: ${user.login}`);
    profile.append(favorite);
    if (document.body.dataset.city) {
      const local = [...state.users].filter(u=>u.cities.includes(document.body.dataset.city));
      const localRank = 1 + local.filter(u=>u[state.metric] > user[state.metric]).length;
      profile.append(element('small', 'local-rank', `Puesto local: ${format.format(localRank)}`));
    }
    const location = element(
      "td",
      "location",
      clean(user.location) || "Sin ubicación",
    );
    location.title = location.textContent;
    tr.append(position, profile, location);
    for (const metric of ["publicContributions", "total", "followers"]) {
      const td = element("td", "numeric");
      const value = format.format(user[metric]);
      if (metric === state.metric)
        td.append(element("span", "metric-pill", value));
      else td.textContent = value;
      tr.append(td);
    }
    tr.append(element('td', 'trend-cell'),element('td','movement-cell'));
    const last = element("td");
    const open = externalLink(profileURL(user.login), "profile-link");
    const icon = element("img", "external-icon");
    icon.src = "./assets/arrow-up-right.svg";
    icon.alt = "";
    open.append(icon);
    open.setAttribute("aria-label", `Ver perfil de ${user.login} en GitHub`);
    last.append(open);
    tr.append(last);
    return tr;
  }
  // FLIP: rows that persist across a re-render slide to their new position; new rows fade in.
  const FLIP_EASE = 'cubic-bezier(.22, .61, .36, 1)';
  const inViewport = (rect) => rect.bottom > -200 && rect.top < innerHeight + 200;
  function snapshotRows() {
    const tops = new Map();
    document.querySelectorAll('#rows tr[data-login]').forEach((tr) => {
      const rect = tr.getBoundingClientRect();
      if (inViewport(rect)) tops.set(tr.dataset.login, rect.top);
    });
    return tops;
  }
  function animateRows(before) {
    let entering = 0;
    document.querySelectorAll('#rows tr[data-login]').forEach((tr) => {
      const rect = tr.getBoundingClientRect();
      if (!inViewport(rect)) return;
      const previous = before.get(tr.dataset.login);
      const travel = previous === undefined ? null : previous - rect.top;
      if (travel !== null && Math.abs(travel) <= innerHeight * 0.9) {
        if (Math.abs(travel) > 1) tr.animate([{ transform: `translateY(${travel}px)` }, { transform: 'none' }], { duration: 340, easing: FLIP_EASE });
        return;
      }
      if (entering >= 10) return;
      tr.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: entering * 24, easing: FLIP_EASE, fill: 'backwards' });
      entering += 1;
    });
  }
  let rendered = 0;
  let observer;
  function render(reset = true) {
    if (!state.loaded) return;
    const ranked = [...state.users].sort(
      (a, b) =>
        b[state.metric] - a[state.metric] ||
        (a.login.toLowerCase() < b.login.toLowerCase() ? -1 : 1),
    );
    // Competition ranks: tied values share a national position, regardless of filters or sort direction.
    const ranks = new Map();
    let previous, rank;
    ranked.forEach((user, index) => {
      if (user[state.metric] !== previous) rank = index + 1;
      ranks.set(user.login, rank);
      previous = user[state.metric];
    });
    const query = normalize($("search").value.trim().replace(/^@/, ""));
    const city = document.body.dataset.city || $("city").value;
    filtered = ranked.filter(
      (user) =>
        (!query ||
          normalize(`${user.login} ${clean(user.name)}`).includes(query)) &&
        (!city || user.cities.includes(city)) &&
        (!$("only-favorites").checked || history.favorites.has(user.login)),
    );
    if (state.direction === 1)
      filtered.sort(
        (a, b) =>
          a[state.metric] - b[state.metric] ||
          (a.login.toLowerCase() < b.login.toLowerCase() ? -1 : 1),
      );
    const end = Math.min(state.visible, filtered.length);
    const fragment = document.createDocumentFragment();
    filtered
      .slice(reset ? state.start : rendered, end)
      .forEach((user) => fragment.append(row(user, ranks.get(user.login))));
    if (reset && firstRowsRender && motionOK()) {
      // The server-rendered rows already fade in via CSS; continue that animation on the live rows so the swap is invisible.
      const elapsed = performance.now() - paintStart;
      [...fragment.children].slice(0, ROW_COUNT).forEach((tr, i) => {
        const delay = i * ROW_STAGGER - elapsed;
        if (delay + ROW_DURATION <= 0) return;
        tr.classList.add("row-enter");
        tr.style.animationDelay = `${Math.round(delay)}ms`;
      });
    }
    const before = reset && !firstRowsRender && motionOK() ? snapshotRows() : null;
    if (reset) firstRowsRender = false;
    if (reset) $("rows").replaceChildren(fragment);
    else $("rows").append(fragment);
    if (before && before.size) animateRows(before);
    rendered = end;
    decorateTrends();
    $("status").textContent = filtered.length
      ? ""
      : "No encontramos perfiles con esos filtros. Prueba otro nombre o ciudad.";
    $("results").textContent = filtered.length
      ? `Mostrando ${format.format(state.start + 1)}–${format.format(end)} de ${format.format(filtered.length)} perfiles${end === filtered.length ? " · Llegaste al final" : ""}`
      : "0 perfiles";
    $("load-more").disabled = end >= filtered.length;
    $("load-more").hidden = end >= filtered.length;
    observer?.unobserve($("feed-sentinel"));
    if (end < filtered.length && $("auto-load").checked)
      observer?.observe($("feed-sentinel"));
    $("export").disabled = filtered.length === 0;
    $("static-pagination").hidden = Boolean(
      query || $("only-favorites").checked ||
        city !== (document.body.dataset.city || "") ||
        state.direction === 1 ||
        state.metric !== document.body.dataset.initialMetric,
    );
    $("metric-note").textContent =
      `Ordenado por ${labels[state.metric]} (${state.direction === -1 ? "de mayor a menor" : "de menor a mayor"}). Puesto nacional; los empates comparten posición.`;
    document.querySelectorAll("[data-metric]").forEach((button) => {
      const active = button.dataset.metric === state.metric;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      const active = th.dataset.sort === state.metric;
      th.setAttribute(
        "aria-sort",
        active ? (state.direction === -1 ? "descending" : "ascending") : "none",
      );
      th.querySelector("span").replaceChildren(
        history.icon(active ? (state.direction === -1 ? "arrowDown" : "arrowUp") : "sort"),
      );
    });
  }
  // Hover / focus card with the full chart for a row's trend sparkline.
  const canHover = matchMedia('(hover: hover) and (pointer: fine)');
  let trendPopover = null, trendOwner = null, showTimer = 0, hideTimer = 0;
  function ensurePopover() {
    if (trendPopover) return trendPopover;
    trendPopover = element('div', 'trend-popover');
    trendPopover.setAttribute('role', 'dialog');
    trendPopover.hidden = true;
    trendPopover.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    trendPopover.addEventListener('pointerleave', () => scheduleHide());
    document.body.append(trendPopover);
    return trendPopover;
  }
  function hideTrend() {
    clearTimeout(showTimer); clearTimeout(hideTimer);
    if (trendPopover) trendPopover.hidden = true;
    trendOwner = null;
  }
  function scheduleHide() { clearTimeout(showTimer); clearTimeout(hideTimer); hideTimer = setTimeout(hideTrend, 180); }
  function showTrend(anchor, info) {
    clearTimeout(hideTimer);
    if (trendOwner === anchor && trendPopover && !trendPopover.hidden) return;
    const pop = ensurePopover();
    trendOwner = anchor;
    pop.setAttribute('aria-label', `Evolución de ${info.login}`);
    const card = history.metricCard(info.dates, info.values, `@${info.login} · ${info.label}`, {interval: 'daily'});
    pop.replaceChildren(card);
    const foot = element('div', 'trend-popover-foot');
    if (info.positions && info.positions.some(v => v !== null)) foot.append(history.rankMovement(info.dates, info.positions, {compact: true}));
    const link = element('a', 'trend-popover-link', 'Explorar evolución');
    link.href = info.href; link.append(history.icon('arrowUp'));
    link.lastChild.style.transform = 'rotate(45deg)';
    foot.append(link);
    pop.append(foot);
    pop.hidden = false;
    const rect = anchor.getBoundingClientRect(), width = pop.offsetWidth, height = pop.offsetHeight, margin = 12;
    const left = Math.min(Math.max(margin, rect.right - width), innerWidth - width - margin);
    const below = rect.bottom + 8, above = rect.top - height - 8;
    const top = below + height <= innerHeight - margin ? below : above >= margin ? above : Math.max(margin, innerHeight - height - margin);
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  }
  function bindTrend(anchor, info) {
    anchor.addEventListener('pointerenter', () => {
      if (!canHover.matches) return;
      clearTimeout(hideTimer); clearTimeout(showTimer);
      showTimer = setTimeout(() => showTrend(anchor, info), 140);
    });
    anchor.addEventListener('pointerleave', () => { if (canHover.matches) scheduleHide(); });
    anchor.addEventListener('focus', () => showTrend(anchor, info));
    anchor.addEventListener('blur', () => scheduleHide());
  }
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTrend(); });
  window.addEventListener('scroll', hideTrend, {passive: true, capture: true});
  window.addEventListener('resize', hideTrend);
  const revealed = new Set();
  function decorateTrends() {
    const metric = state.metric;
    const data = trendCache.get(metric);
    if (!data || typeof data.then === 'function') {
      document.querySelectorAll('#rows .trend-cell').forEach(cell=>{
        if (!tableVisible) { cell.replaceChildren(element('span','history-empty','Historial de 90 días')); return; }
        const wait=element('span','trend-skeleton');wait.setAttribute('role','status');wait.setAttribute('aria-label','Cargando historial');
        cell.replaceChildren(wait);
      });
      if (tableVisible && !data) loadTrends(metric);
      return;
    }
    $('trend-period').textContent=`${labels[metric]} · ${data.dates.length} capturas`;
    $('trend-coverage').textContent=data.dates.length ? `${data.dates.length} capturas: ${history.dateLabel(data.dates[0])} – ${history.dateLabel(data.dates.at(-1))}. Se muestran las fechas registradas dentro de los últimos 90 días.${data.dates.length<90?' Aún no hay 90 días completos de historial.':''}` : 'Todavía no hay capturas históricas.';
    document.querySelectorAll('#rows tr').forEach(tr=>{
      const cell=tr.querySelector('.trend-cell');
      if (!cell) return;
      const key=tr.dataset.login.toLowerCase();
      const values=data.values[key];
      const positions=data.ranks[key];
      const movement=tr.querySelector('.movement-cell');
      movement.replaceChildren();
      const rankLink=element('a','rank-detail');
      rankLink.href=`./evolucion/?users=${encodeURIComponent(tr.dataset.login)}&metric=${metric}&view=rank${$('city').value?`&city=${encodeURIComponent($('city').value)}`:''}`;
      rankLink.setAttribute('aria-label',`Ver movimientos de puestos de ${tr.dataset.login}`);
      rankLink.append(history.rankMovement(data.dates,positions || [],{compact:true}));
      movement.append(rankLink);
      cell.replaceChildren();
      if (!values) { cell.append(element('span','history-empty','Sin capturas')); return; }
      const detail=element('a','trend-detail');
      detail.href=`./evolucion/?users=${encodeURIComponent(tr.dataset.login)}&metric=${metric}&view=value${$('city').value?`&city=${encodeURIComponent($('city').value)}`:''}`;
      detail.setAttribute('aria-label', `Explorar evolución de ${tr.dataset.login}`);
      const finite=values.filter(v=>v!==null);
      const change=finite.length>1 ? finite.at(-1)-finite[0] : 0;
      const spark=history.chart(data.dates, values, {minSpan:Math.max(1,(finite[0] || 0)*.1), color:change>0?'#176b55':change<0?'#b63735':'#737b87', label:`${labels[metric]} de ${tr.dataset.login}`});
      // The hover card replaces the browser's native tooltip; the svg keeps its aria-label.
      spark.querySelectorAll?.('title').forEach(t=>t.remove());
      if (!revealed.has(metric) && motionOK() && tr.rowIndex<=ROW_COUNT) {
        spark.classList.add('spark-reveal');
        spark.style.animationDelay=`${Math.max(0,tr.rowIndex-1)*ROW_STAGGER}ms`;
      }
      detail.append(spark);
      cell.append(detail);
      bindTrend(detail,{login:tr.dataset.login,label:labels[metric],dates:data.dates,values,positions,href:detail.href});
      const valid=values.map((value,i)=>value===null ? -1 : i).filter(i=>i>=0);
      if (valid.length < 2) {
        cell.append(element('small','history-empty', valid.length ? 'Primera captura' : 'Sin capturas'));
      } else {
        const first=valid[0], last=valid.at(-1), change=values[last]-values[first];
        const badge=element('small',`rank-change ${change>0?'up':change<0?'down':'stable'}`,`${change>0?'+':''}${change ? format.format(change) : 'Sin cambio'}`);
        badge.title=`Entre ${history.dateLabel(data.dates[first])} y ${history.dateLabel(data.dates[last])}; no mide actividad diaria.`;
        cell.append(badge);
      }
      if (valid.length && values[0]===null) cell.append(element('small','history-empty','Nuevo en el registro'));
    });
    revealed.add(metric);
  }
  async function loadTrends(metric) {
    const pending=fetch(`./data/trends-${metric}.json?schema=2`, {priority:'low'}).then(async response=>{
      if (!response.ok) throw new Error('History unavailable');
      const data=await response.json();
      if (data.version!==2 || data.metric!==metric || !Array.isArray(data.dates) || !data.values || !data.ranks) throw new Error('Invalid history');
      return data;
    });
    trendCache.set(metric,pending);
    try {
      trendCache.set(metric,await pending);
      if (metric===state.metric) decorateTrends();
    } catch {
      trendCache.delete(metric);
      if (metric===state.metric) document.querySelectorAll('#rows .trend-cell').forEach(cell=>{
        const retry=element('button','history-retry','Reintentar historial');
        retry.addEventListener('click',()=>loadTrends(metric));
        cell.replaceChildren(retry);
      });
    }
  }
  if ('IntersectionObserver' in window) {
    const lazy = new IntersectionObserver(entries=>{
      if (!entries.some(entry=>entry.isIntersecting)) return;
      tableVisible=true;
      decorateTrends();
      lazy.disconnect();
    }, {rootMargin:'200px'});
    lazy.observe(document.querySelector('.table-scroll'));
  } else tableVisible=true;
  $('rows').addEventListener('click', event=>{
    const button=event.target.closest('[data-favorite]');
    if (!button) return;
    if (!history.favorites.toggle(button.dataset.favorite)) $('favorites-status').textContent='El navegador no permite guardar favoritos. Revisa sus ajustes de almacenamiento.';
  });
  window.addEventListener('favorites-changed', ()=>render());
  const ONLY_FAVORITES_KEY = 'github-peru:only-favorites:v1';
  const onlyFavorites = $('only-favorites');
  try { onlyFavorites.checked = localStorage.getItem(ONLY_FAVORITES_KEY) === '1'; } catch { /* storage unavailable: start unchecked */ }
  onlyFavorites.addEventListener('change', ()=>{
    try { localStorage.setItem(ONLY_FAVORITES_KEY, onlyFavorites.checked ? '1' : '0'); } catch { /* the filter still works for this visit */ }
    state.start=0; state.visible=state.batch; render();
  });
  window.addEventListener('storage', (event)=>{
    if (event.key !== ONLY_FAVORITES_KEY) return;
    onlyFavorites.checked = event.newValue === '1';
    state.start=0; state.visible=state.batch; render();
  });
  async function load() {
    $("retry").hidden = true;
    $("status").textContent = "Cargando la comunidad…";
    try {
      const response = await fetch("./data/peru.json", { priority: "low" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.users) || !Array.isArray(data.cities))
        throw new Error("Formato de datos inválido");
      state.users = data.users.map((user) => ({
        ...user,
        total: user.publicContributions + user.privateContributions,
      }));
      state.loaded = true;
      document.documentElement.classList.add("ranking-ready");
      document.querySelectorAll("button[data-sort]").forEach((button) => {
        button.disabled = false;
      });
      if (data.updatedAt) {
        const parts = new Intl.DateTimeFormat("es-PE", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: "America/Lima",
        }).formatToParts(new Date(data.updatedAt));
        const part = (key) => parts.find((p) => p.type === key).value;
        $("updated").textContent =
          `Datos al ${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")} · hora de Perú`;
      } else $("updated").textContent = "Fuente: caché del repositorio";
      state.cities=data.cities;
      $('city').replaceChildren();
      const all=element('option','',`Todo Perú · ${format.format(state.users.length)} perfiles`);all.value='';$('city').append(all);
      data.cities.forEach(city=>{
        const count=state.users.filter(user=>user.cities.includes(city.id)).length;
        const option=element('option','',`${city.label} · ${format.format(count)} perfiles`);option.value=city.id;$('city').append(option);
      });
      const requested=new URLSearchParams(location.search).get('city');
      $('city').value=document.body.dataset.city || (data.cities.some(city=>city.id===requested) ? requested : '');
      if ($('city').value && !document.body.dataset.city) { state.start=0;state.visible=state.batch; }
      $('city').disabled=Boolean(document.body.dataset.city);
      if (document.body.dataset.city) $('city').title='Usa Ver todo Perú para cambiar libremente de ciudad.';
      updateScope();
      render();
    } catch (error) {
      $("status").textContent =
        "No pudimos cargar las funciones interactivas. Puedes consultar los perfiles y las páginas estáticas o reintentar.";

      $("retry").hidden = false;
    }
  }
  $("search").addEventListener("input", () => {
    state.start = 0;
    state.visible = state.batch;
    render();
  });
  function updateScope() {
    const city=document.body.dataset.city || $('city').value;
    const group=city ? state.users.filter(u=>u.cities.includes(city)) : state.users;
    setStat('stat-users',group.length);
    setStat('stat-contributions',group.reduce((n,u)=>n+u.publicContributions,0));
    setStat('stat-followers',group.reduce((n,u)=>n+u.followers,0));
    const label=state.cities.find(c=>c.id===city)?.label;
    $('stat-scope').textContent=label ? `Perfiles que mencionan ${label}` : 'Personas y organizaciones de Perú';
    const link=document.querySelector('#history-preview .text-link');
    if(link) link.href=`./evolucion/${city?`?city=${encodeURIComponent(city)}`:''}`;
    window.dispatchEvent(new CustomEvent('ranking-scope-changed',{detail:{city}}));
  }
  $('city').addEventListener('change',()=>{
    state.start=0;state.visible=state.batch;
    const url=new URL(location.href);
    if($('city').value) url.searchParams.set('city',$('city').value);else url.searchParams.delete('city');
    window.history.replaceState(null,'',url);
    updateScope();render();
  });
  document.querySelectorAll("[data-metric]").forEach((button) =>
    button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      state.direction = -1;
      state.start = 0;
      state.visible = state.batch;
      render();
    }),
  );
  document.querySelectorAll("button[data-sort]").forEach((button) =>
    button.addEventListener("click", () => {
      if (state.metric === button.dataset.sort) state.direction *= -1;
      else {
        state.metric = button.dataset.sort;
        state.direction = -1;
      }
      state.start = 0;
      state.visible = state.batch;
      render();
    }),
  );
  function loadMore() {
    if (!state.loaded || state.visible >= filtered.length) return;
    state.visible += state.batch;
    render(false);
  }
  (function decorateStatic() {
    const tabIcons = {publicContributions: "globe", total: "sigma", followers: "users"};
    document.querySelectorAll(".tab[data-metric]").forEach((tab) => tab.prepend(history.icon(tabIcons[tab.dataset.metric] || "bars")));
    $("export").prepend(history.icon("download"));
    $("load-more").prepend(history.icon("chevronDown"));
    $("retry").prepend(history.icon("refresh"));
    history.searchField($("search"));
    const fav = $("only-favorites").closest("label");
    if (fav) fav.append(history.icon("star", {fill: true}));
  })();
  $("load-more").addEventListener("click", loadMore);
  $("auto-load").addEventListener("change", () => {
    observer?.unobserve($("feed-sentinel"));
    if ($("auto-load").checked && rendered < filtered.length)
      observer?.observe($("feed-sentinel"));
  });
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          $("auto-load").checked
        )
          loadMore();
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
  } else {
    $("auto-load").checked = false;
    $("auto-load").disabled = true;
  }
  $("retry").addEventListener("click", load);
  $("export").addEventListener("click", () => {
    // Prevent spreadsheet formula execution in user-supplied profile fields.
    const cell = (value) =>
      '"' +
      String(
        typeof value === "string" && /^[=+@\-\t\r\n]/.test(value)
          ? "'" + value
          : value,
      ).replace(/"/g, '""') +
      '"';
    const csv = [
      ["Usuario", "Nombre", "Ubicación", "Públicas", "Totales", "Seguidores"],
      ...filtered.map((user) => [
        user.login,
        clean(user.name),
        clean(user.location),
        user.publicContributions,
        user.total,
        user.followers,
      ]),
    ]
      .map((values) => values.map(cell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = element("a");
    link.href = url;
    link.download = "github-peru.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  // The HTML ranking is already usable: let its hero paint before downloading
  // the full interactive dataset, which would compete for bandwidth on mobile.
  const hero = document.querySelector(".masthead-image img");
  const ready = hero?.decode
    ? hero.decode().catch(() => {})
    : Promise.resolve();
  let timer;
  Promise.race([
    ready,
    new Promise((resolve) => {
      timer = setTimeout(resolve, 1000);
    }),
  ]).then(() => {
    clearTimeout(timer);
    requestAnimationFrame(() => requestAnimationFrame(load));
  });
})();
