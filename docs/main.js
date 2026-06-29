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
