// Scroll-reveal: fade sections in as they enter the viewport.
// IntersectionObserver only, no scroll listeners. Honors reduced-motion.
(function () {
  var els = document.querySelectorAll('.reveal');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

  els.forEach(function (el) { io.observe(el); });
})();

// Top bar: a shadow appears only once the page is scrolled (it floats above
// content). At the very top the bar is flush with the canvas.
(function () {
  var nav = document.querySelector('.nav');
  if (!nav) return;
  var onScroll = function () {
    nav.classList.toggle('scrolled', window.scrollY > 4);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// On phones/tablets the Windows .exe is useless, so point every "Download for
// Windows" button at the GitHub releases page instead of the direct download.
(function () {
  var isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS|BlackBerry/i
    .test(navigator.userAgent || '');
  if (!isMobile) return;
  var rel = 'https://github.com/Nickkk66/media-toolbox/releases/latest';
  document.querySelectorAll('a.dl').forEach(function (a) {
    a.setAttribute('href', rel);
  });
})();

// Adapt the download buttons to the visitor's OS: swap the logo (Windows / Apple
// / Linux), the label, and the link to the matching release asset. Defaults to
// Windows when the OS can't be told apart.
(function () {
  var ua = (navigator.userAgent || '');
  var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  var s = (plat + ' ' + ua).toLowerCase();
  var os = 'win';
  if (/android/.test(s)) os = 'win';                                  // mobile: keep the .exe link behavior
  else if (/mac|iphone|ipad|ipod/.test(s)) os = 'mac';
  else if (/linux|x11|ubuntu|fedora|debian/.test(s)) os = 'linux';

  var REL = 'https://github.com/Nickkk66/media-toolbox/releases/latest/download/';
  var MAP = {
    win:   { icon: '#i-win',   label: 'Download for Windows', file: 'media-toolbox-Setup.exe' },
    mac:   { icon: '#i-apple', label: 'Download for Mac',     file: 'media-toolbox-mac.dmg' },
    linux: { icon: '#i-linux', label: 'Download for Linux',   file: 'media-toolbox-linux.AppImage' },
  };
  var cfg = MAP[os] || MAP.win;
  var XLINK = 'http://www.w3.org/1999/xlink';

  document.querySelectorAll('a.dl').forEach(function (a) {
    a.setAttribute('href', REL + cfg.file);
    var use = a.querySelector('.dl-ic use');
    if (use) {
      use.setAttribute('href', cfg.icon);
      try { use.setAttributeNS(XLINK, 'href', cfg.icon); } catch (e) { /* */ }
    }
    var lbl = a.querySelector('.dl-label');
    if (lbl) lbl.textContent = cfg.label;
  });
})();

// Hero video: click the poster (the logo) to play, like pressing a native
// button. While it plays, sample the video's average colour every frame and
// glow the area around it in that colour ("ambilight"), fading back to canvas.
(function () {
  var shot = document.getElementById('heroShot');
  var video = document.getElementById('heroVideo');
  var amb = document.getElementById('ambient');
  if (!shot || !video || !amb) return;

  var canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 9;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var raf = null;

  function sample() {
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var r = 0, g = 0, b = 0, n = d.length / 4;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      // a soft radial wash of the sampled colour, fading to nothing at the edge
      amb.style.background = 'radial-gradient(closest-side, rgba(' + r + ',' + g + ',' + b + ',0.95), rgba(' + r + ',' + g + ',' + b + ',0))';
    } catch (e) { /* cross-origin or not ready; ignore */ }
    raf = window.requestAnimationFrame(sample);
  }

  function play() {
    if (shot.classList.contains('playing')) return;
    shot.classList.add('playing');
    // Played from a real click (user gesture), so sound is allowed.
    video.muted = false;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
    if (!raf) sample();
  }
  function stopSampling() {
    if (raf) { window.cancelAnimationFrame(raf); raf = null; }
  }

  shot.addEventListener('click', function () {
    if (shot.classList.contains('playing')) {
      // toggle pause/replay on subsequent clicks
      if (video.paused) { video.play(); if (!raf) sample(); }
      else { video.pause(); stopSampling(); }
    } else { play(); }
  });
  video.addEventListener('ended', function () {
    stopSampling();
    shot.classList.remove('playing'); // show the play hint again to replay
    amb.style.background = 'transparent';
  });
})();

// Brand (top-left logo / name): clicking it scrolls all the way to the very top
// of the page, above the hero — not just to the hero anchor.
(function () {
  var brand = document.querySelector('.brand');
  if (!brand) return;
  brand.addEventListener('click', function (e) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// Convert tile: HOLD DOWN to fire. Adds .firing on pointerdown, which runs the
// two-arrow "pull back, aim, shoot in arcs, fall off-screen" animation. It
// auto-resets when the animation ends (so it can be fired again) and keeps
// running even if the cursor leaves mid-flight (it's an animation, not a hover).
(function () {
  var conv = document.querySelector('.f-convert');
  if (!conv) return;
  conv.addEventListener('pointerdown', function () {
    if (conv.classList.contains('firing')) return;   // ignore until it resets
    conv.classList.add('firing');
  });
  conv.addEventListener('animationend', function (e) {
    if (e.animationName === 'shootTop' || e.animationName === 'shootBot') {
      conv.classList.remove('firing');               // reset → ready to fire again
    }
  });
})();

// "Blazing fast / native app": the purple loop draws itself the FIRST time the
// visitor scrolls down after a fresh page load — once only, then never again
// this load. (Reloading the page arms it again.)
(function () {
  var loop = document.querySelector('.ncircle');
  if (!loop) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { loop.classList.add('draw'); return; }  // show it instantly, no scroll dance

  var startY = window.scrollY || window.pageYOffset || 0;
  var armed = true;
  function onScroll() {
    var y = window.scrollY || window.pageYOffset || 0;
    if (armed && y > startY + 8) {      // first real downward scroll
      armed = false;
      loop.classList.add('draw');
      window.removeEventListener('scroll', onScroll);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// Releases dropdown: on first hover of "Releases", pull the published releases
// from the GitHub API and list each version with direct per-OS download links,
// so the visitor downloads any build in place instead of being sent to GitHub.
(function () {
  var rel = document.getElementById('rel');
  var menu = document.getElementById('relMenu');
  if (!rel || !menu) return;
  var REPO = 'Nickkk66/media-toolbox';
  var loaded = false;

  // one preferred installer per OS, in display order, if present in the release
  function pickAssets(assets) {
    var order = [['Windows', 'setup.exe'], ['macOS', 'mac.dmg'], ['Linux', 'linux.appimage']];
    var out = [];
    order.forEach(function (o) {
      for (var i = 0; i < assets.length; i++) {
        if (assets[i].name.toLowerCase().indexOf(o[1]) > -1) {
          out.push({ label: o[0], url: assets[i].browser_download_url });
          break;
        }
      }
    });
    return out;
  }

  function render(releases) {
    if (!releases || !releases.length) { menu.innerHTML = '<div class="rel-empty">No releases yet.</div>'; return; }
    var html = '';
    releases.slice(0, 6).forEach(function (r) {
      var ver = r.name || r.tag_name || 'release';
      var picks = pickAssets(r.assets || []);
      var links = picks.map(function (p) { return '<a href="' + p.url + '">' + p.label + '</a>'; }).join('');
      if (!links) links = '<a href="' + r.html_url + '">GitHub</a>';
      html += '<div class="rel-row"><span class="rel-ver">' + ver + '</span><span class="rel-os">' + links + '</span></div>';
    });
    menu.innerHTML = html;
  }

  function load() {
    if (loaded) return; loaded = true;
    fetch('https://api.github.com/repos/' + REPO + '/releases?per_page=8', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) { render(d.filter(function (x) { return !x.draft && /^v/i.test(x.tag_name || ''); })); })
      .catch(function () {
        menu.innerHTML = '<div class="rel-empty"><a href="https://github.com/' + REPO + '/releases">Open releases on GitHub &rarr;</a></div>';
      });
  }
  rel.addEventListener('pointerenter', load);
  rel.addEventListener('focusin', load);
})();
