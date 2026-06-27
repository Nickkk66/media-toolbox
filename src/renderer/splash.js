'use strict';

// Cursor-driven particle typography entry splash. Renders the app name as a
// cloud of particles that assemble on open, scatter away from the cursor, and
// spring back. Click (or wait) to dismiss. Adapted to vanilla canvas from the
// componentry.fun "cursor-driven particle typography" component.
(function () {
  const CFG = {
    text: 'media toolbox',
    sub: 'click to enter',
    fontSize: 120,
    particleDensity: 5,   // sample interval (px); lower = more particles
    particleSize: 1.8,
    dispersionStrength: 26,
    returnSpeed: 0.07,
    friction: 0.86,
  };

  function start() {
    const overlay = document.createElement('div');
    overlay.id = 'splash';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0f0e12;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:opacity .5s ease;';
    const canvas = document.createElement('canvas');
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const ctx = canvas.getContext('2d');
    const mouse = { x: -9999, y: -9999 };
    let particles = [];
    let raf = 0;
    let dismissed = false;

    function buildParticles() {
      W = overlay.clientWidth; H = overlay.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Render text to sample its pixels.
      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      const o = off.getContext('2d');
      let fs = CFG.fontSize;
      o.textAlign = 'center'; o.textBaseline = 'middle';
      // shrink font to fit width
      do {
        o.font = `300 ${fs}px Inter, "Segoe UI", system-ui, sans-serif`;
        if (o.measureText(CFG.text).width <= W * 0.86) break;
        fs -= 4;
      } while (fs > 28);
      o.fillStyle = '#fff';
      o.fillText(CFG.text, W / 2, H / 2);

      const data = o.getImageData(0, 0, W, H).data;
      const d = CFG.particleDensity;
      const next = [];
      for (let y = 0; y < H; y += d) {
        for (let x = 0; x < W; x += d) {
          const a = data[(y * W + x) * 4 + 3];
          if (a > 128) {
            next.push({
              hx: x, hy: y,
              x: Math.random() * W, y: Math.random() * H,
              vx: 0, vy: 0,
            });
          }
        }
      }
      particles = next;
    }

    function tick() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#f6f8f7';
      const rs = CFG.returnSpeed, fr = CFG.friction, ds = CFG.dispersionStrength;
      for (const p of particles) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 130 * 130) {
          const dist = Math.sqrt(dist2) || 1;
          const force = (ds * (1 - dist / 130));
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }
        p.vx += (p.hx - p.x) * rs;
        p.vy += (p.hy - p.y) * rs;
        p.vx *= fr; p.vy *= fr;
        p.x += p.vx; p.y += p.vy;
        ctx.fillRect(p.x, p.y, CFG.particleSize, CFG.particleSize);
      }
      // subtitle
      ctx.fillStyle = '#b2b2b2';
      ctx.font = '100 14px Inter, "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(CFG.sub, W / 2, H / 2 + (particles.length ? 90 : 0) + 40);
      raf = requestAnimationFrame(tick);
    }

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      overlay.style.opacity = '0';
      setTimeout(() => { cancelAnimationFrame(raf); overlay.remove(); }, 520);
    }

    overlay.addEventListener('mousemove', (e) => { const r = overlay.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
    overlay.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });
    overlay.addEventListener('click', dismiss);
    window.addEventListener('resize', buildParticles);

    buildParticles();
    tick();
    // Stays until the user clicks — no auto-dismiss.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
