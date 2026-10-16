"use strict";
(() => {
  const flag = document.getElementById("peru-flag");
  const toggle = document.getElementById("flag-toggle");
  const footer = flag.closest("footer");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const width = 30,
    height = 14,
    duration = 4000;
  let paused = reduced.matches,
    visible = false,
    frame = 0;
  let elapsed = 0,
    previous = null,
    lastPaint = -Infinity;

  // One analytic clock drives a seamless four-second wave; no accumulated physics.
  function paint(time) {
    const phase = ((time % duration) / duration) * Math.PI * 2;
    const fragment = document.createDocumentFragment();
    for (let y = 0; y < height; y++) {
      fragment.append(document.createTextNode(y === 0 ? "+" : "|"));
      for (let stripe = 0; stripe < 3; stripe++) {
        const span = document.createElement("span");
        span.className = stripe === 1 ? "flag-white" : "flag-red";
        let text = "";
        for (let col = 0; col < width / 3; col++) {
          const x = (stripe * width) / 3 + col;
          const wave = 1.2 * (x / width) * Math.sin(x * 0.24 - phase);
          const localY = y - 2 - wave;
          const inside = localY >= 0 && localY < 8;
          const light = Math.sin(x * 0.24 - phase);
          text += inside ? (light > 0.3 ? "#" : light < -0.3 ? "+" : "=") : " ";
        }
        span.textContent = text;
        fragment.append(span);
      }
      fragment.append(document.createTextNode("\n"));
    }
    flag.replaceChildren(fragment);
  }
  function tick(now) {
    if (previous !== null) elapsed += now - previous;
    previous = now;
    if (now - lastPaint >= 80) {
      paint(elapsed);
      lastPaint = now;
    }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    previous = null;
    toggle.textContent = paused ? "Animar bandera" : "Pausar bandera";
    toggle.setAttribute("aria-pressed", String(paused));
    if (!paused && visible && !document.hidden)
      frame = requestAnimationFrame(tick);
  }
  toggle.addEventListener("click", () => {
    paused = !paused;
    sync();
  });
  reduced.addEventListener("change", () => {
    paused = reduced.matches;
    sync();
  });
  document.addEventListener("visibilitychange", sync);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      sync();
    }).observe(footer);
  } else visible = true;
  paint(0);
  sync();
})();
