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
  function row(user, rank) {
    const tr = element("tr");
    tr.dataset.login = user.login;
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
    const favorite = element('button', 'favorite-button', history.favorites.has(user.login) ? '★' : '☆');
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
    tr.append(element('td', 'trend-cell'));
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
    if (reset) $("rows").replaceChildren(fragment);
    else $("rows").append(fragment);
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
      query ||
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
      th.querySelector("span").textContent = active
        ? state.direction === -1
          ? "↓"
          : "↑"
        : "↕";
    });
  }
  function decorateTrends() {
    const metric = state.metric;
    const data = trendCache.get(metric);
    if (!data || typeof data.then === 'function') {
      document.querySelectorAll('#rows .trend-cell').forEach(cell=>cell.replaceChildren(element('span','history-empty', tableVisible ? 'Cargando historial…' : 'Historial de 90 días')));
      if (tableVisible && !data) loadTrends(metric);
      return;
    }
    document.querySelectorAll('#rows tr').forEach(tr=>{
      const cell=tr.querySelector('.trend-cell');
      if (!cell) return;
      const values=data.ranks[tr.dataset.login.toLowerCase()];
      cell.replaceChildren();
      if (!values) { cell.append(element('span','history-empty','Sin capturas')); return; }
      cell.append(history.chart(data.dates, values, {rank:true, window:data.window, label:`Puesto nacional de ${tr.dataset.login}: ${labels[metric]}`}));
      const valid=values.map((value,i)=>value===null ? -1 : i).filter(i=>i>=0);
      if (valid.length < 2) {
        cell.append(element('small','history-empty', valid.length ? 'Primera captura' : 'Sin capturas'));
      } else {
        const first=valid[0], last=valid.at(-1), change=values[first]-values[last];
        const badge=element('small',`rank-change ${change>0?'up':change<0?'down':'stable'}`,`${change>0?'↑':change<0?'↓':'—'} ${change ? Math.abs(change) : 'Sin cambio'}`);
        badge.title=`Entre ${history.dateLabel(data.dates[first])} y ${history.dateLabel(data.dates[last])}; no mide actividad diaria.`;
        cell.append(badge);
      }
      if (valid.length && values[0]===null) cell.append(element('small','history-empty','Nuevo en el registro'));
    });
  }
  async function loadTrends(metric) {
    const pending=fetch(`./data/trends-${metric}.json`, {priority:'low'}).then(async response=>{
      if (!response.ok) throw new Error('History unavailable');
      const data=await response.json();
      if (data.metric!==metric || !Array.isArray(data.dates) || !data.ranks) throw new Error('Invalid history');
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
  $('only-favorites').addEventListener('change', ()=>{ state.start=0; state.visible=state.batch; render(); });
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
      const summaryUsers = document.body.dataset.city
        ? state.users.filter((user) =>
            user.cities.includes(document.body.dataset.city),
          )
        : state.users;
      $("stat-users").textContent = format.format(summaryUsers.length);
      $("stat-contributions").textContent = format.format(
        summaryUsers.reduce((sum, user) => sum + user.publicContributions, 0),
      );
      $("stat-followers").textContent = format.format(
        summaryUsers.reduce((sum, user) => sum + user.followers, 0),
      );
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
      data.cities.forEach((city) => {
        const option = element("option", "", city.label);
        option.value = city.id;
        $("city").append(option);
      });
      if (document.body.dataset.city) {
        $("city").value = document.body.dataset.city;
        $("city").disabled = true;
        $("city").title =
          "Esta página muestra una selección de ciudad. Usa los enlaces para explorar otras vistas.";
      }
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
  $("city").addEventListener("change", () => {
    state.start = 0;
    state.visible = state.batch;
    render();
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
