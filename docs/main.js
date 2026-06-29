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
