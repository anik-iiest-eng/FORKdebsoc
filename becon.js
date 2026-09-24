/* BECON page motion — vanilla, no dependencies.
   1. Builds the looping ticker bands + diagonal text (decorative)
   2. Speeds the tickers up while the page is scrolling
   3. Unmasks photos as they enter the viewport */
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- 1. Tickers ---- */
  function buildBand(band) {
    const unit = band.dataset.unit || "";
    band.textContent = "";
    const track = document.createElement("div");
    track.className = "ticker-track";
    const a = document.createElement("span");
    a.textContent = unit;
    track.append(a);
    band.append(track);
    let guard = 0;
    while (a.getBoundingClientRect().width < band.clientWidth && guard++ < 200) a.textContent += unit;
    const b = a.cloneNode(true);       // identical twin => translateX(-50%) loops seamlessly
    b.setAttribute("aria-hidden", "true");
    track.append(b);
    track.style.setProperty("--dur", `${band.dataset.speed || 60}s`);
    if ("reverse" in band.dataset) track.style.animationDirection = "reverse";
  }

  function buildDiagonal(box) {
    const line = `${box.dataset.word}   `.repeat(12);
    box.textContent = "";
    for (let i = 0; i < 9; i++) {
      const p = document.createElement("p");
      p.textContent = line;
      box.append(p);
    }
  }

  function buildTickers() {
    document.querySelectorAll(".ticker-band").forEach(buildBand);
    document.querySelectorAll(".ticker-diagonal").forEach((d) => { if (!d.children.length) buildDiagonal(d); });
  }

  const start = () => {
    buildTickers();
    let t;
    addEventListener("resize", () => { clearTimeout(t); t = setTimeout(buildTickers, 200); });
  };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);

  if (reduce) return;

  /* ---- 2. Scroll-velocity boost ---- */
  let lastY = scrollY, vel = 0, running = false;
  const tick = () => {
    vel *= 0.9;
    const rate = 1 + Math.min(Math.abs(vel) / 18, 7);
    document.querySelectorAll(".ticker-track").forEach((el) => {
      const anim = el.getAnimations()[0];
      if (anim) anim.playbackRate = rate;
    });
    if (Math.abs(vel) > 0.2) requestAnimationFrame(tick);
    else { running = false; document.querySelectorAll(".ticker-track").forEach((el) => { const a = el.getAnimations()[0]; if (a) a.playbackRate = 1; }); }
  };
  addEventListener("scroll", () => {
    vel += scrollY - lastY;
    lastY = scrollY;
    if (!running) { running = true; requestAnimationFrame(tick); }
  }, { passive: true });

  /* ---- 3. Photo unmask ---- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
})();