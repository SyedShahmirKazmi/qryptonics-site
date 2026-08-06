/* ══════════════════════════════════════════════════════════
   Qryptonics — motion layer
   Spring physics without a framework. A damped harmonic
   oscillator is sampled and emitted as a CSS linear() easing,
   which gives genuine spring feel on the compositor thread with
   no runtime animation loop and no dependencies.

   Restraint is deliberate: one orchestrated moment per view,
   displacement kept small enough to read as feedback rather than
   movement, and everything disabled under reduced-motion.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── spring → linear() easing ──────────────────────────
     Solves x'' + (d/m)x' + (k/m)x = 0 numerically, samples the
     displacement curve, and formats it as linear(...). Cached,
     since we only need a handful of springs.
     ─────────────────────────────────────────────────────── */
  /* Null prototype: cache keys are numeric and never user-supplied, but a
     plain object literal is one refactor away from prototype pollution. */
  var springCache = Object.create(null);

  /* The spring gives the curve SHAPE; duration is chosen separately at
     the call site. linear() is normalised over 0..1, so the two are
     independent — which is what lets us keep spring character while
     still landing inside the 150-400ms the interaction guidelines ask
     for. The imperceptible settling tail is truncated. */
  function spring(stiffness, damping, mass) {
    var key = stiffness + ':' + damping + ':' + mass;
    if (springCache[key]) return springCache[key];

    var x = 1, v = 0, dt = 1 / 240, t = 0, samples = [], MAX = 6;
    while (t < MAX) {
      v += ((-stiffness * x - damping * v) / mass) * dt;
      x += v * dt;
      t += dt;
      samples.push(1 - x);
    }

    /* Cut where the curve last leaves a 0.4% band around its target. */
    var settled = samples.length - 1;
    for (var i = samples.length - 1; i >= 0; i--) {
      if (Math.abs(1 - samples[i]) > 0.004) { settled = i + 1; break; }
    }
    samples = samples.slice(0, Math.max(settled, 8));

    var out = [], step = Math.max(1, Math.floor(samples.length / 40));
    for (var j = 0; j < samples.length; j += step) out.push(+samples[j].toFixed(4));
    out.push(1);

    var result = { easing: 'linear(' + out.join(',') + ')', peak: Math.max.apply(null, out) };
    springCache[key] = result;
    return result;
  }

  /* Two curves, two purposes. Reveal is near-critically damped so
     content does not wobble; feedback overshoots slightly so a press
     feels physical. Durations follow the interaction guidelines. */
  var SOFT = { easing: spring(180, 26, 1).easing, duration: 380 };
  var SNAP = { easing: spring(420, 24, 1).easing, duration: 190 };

  function animate(el, frames, opts) {
    if (!el.animate) return null;
    return el.animate(frames, {
      duration: opts.duration,
      easing: opts.easing,
      delay: opts.delay || 0,
      fill: 'both'
    });
  }

  /* ── orchestrated reveal ───────────────────────────────
     Replaces the plain fade. Children of a marked group stagger;
     everything else reveals on its own. Falls back to visible.
     ─────────────────────────────────────────────────────── */
  var items = [].slice.call(document.querySelectorAll('.rv'));

  function showNow(el) { el.classList.add('is-in'); }

  function play(el) {
    var kids = el.hasAttribute('data-stagger')
      ? [].slice.call(el.children)
      : [el];

    el.classList.add('is-in');
    if (kids.length > 1) el.style.opacity = '1';

    kids.forEach(function (kid, i) {
      if (kids.length > 1) {
        kid.style.opacity = '0';
        kid.style.willChange = 'transform, opacity';
      }
      var anim = animate(kid,
        [{ opacity: 0, transform: 'translate3d(0,14px,0)' },
         { opacity: 1, transform: 'translate3d(0,0,0)' }],
        { duration: SOFT.duration, easing: SOFT.easing, delay: i * 45 });
      if (anim) anim.finished.then(function () { kid.style.willChange = ''; }, function () {});
      else showNow(kid);
    });
  }

  function initReveal() {
    if (reduced.matches || !('IntersectionObserver' in window) || !window.innerHeight) {
      items.forEach(showNow);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        play(e.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

    items.forEach(function (el) { io.observe(el); });

    /* If nothing has appeared after two seconds the observer is not
       doing its job. Content beats choreography. */
    setTimeout(function () {
      if (!document.querySelector('.rv.is-in')) items.forEach(showNow);
    }, 2000);
  }

  /* ── hero entrance ─────────────────────────────────────
     The one orchestrated moment on the page. Sequenced rather
     than simultaneous, so the eye is led down the column.
     ─────────────────────────────────────────────────────── */
  function initHero() {
    var hero = document.querySelector('.hero__inner, .phead__inner');
    if (!hero || reduced.matches) return;

    var seq = [].filter.call(hero.children, function (n) { return n.nodeType === 1; });
    seq.forEach(function (node, i) {
      node.style.opacity = '0';
      node.style.willChange = 'transform, opacity';
      var anim = animate(node,
        [{ opacity: 0, transform: 'translate3d(0,18px,0)' },
         { opacity: 1, transform: 'translate3d(0,0,0)' }],
        { duration: SOFT.duration, easing: SOFT.easing, delay: 60 + i * 70 });
      if (anim) {
        anim.finished.then(function () {
          node.style.opacity = ''; node.style.willChange = '';
        }, function () { node.style.opacity = ''; });
      } else {
        node.style.opacity = '';
      }
    });
  }

  /* ── pointer feedback ──────────────────────────────────
     Transform and opacity only, so it stays off the main thread.
     Displacement is capped at 3px: feedback, not movement.
     ─────────────────────────────────────────────────────── */
  function initHover() {
    if (reduced.matches || window.matchMedia('(hover: none)').matches) return;

    var targets = [].slice.call(document.querySelectorAll(
      '.cell, .track, .collab, .step, .sim-kpi, .post'));

    targets.forEach(function (el) {
      var current = null;
      function to(y, shadow) {
        if (current) current.cancel();
        current = animate(el,
          [{ transform: 'translate3d(0,' + y + 'px,0)' }],
          { duration: SNAP.duration, easing: SNAP.easing });
        el.style.boxShadow = shadow;
      }
      el.addEventListener('pointerenter', function () {
        to(-3, '0 10px 30px -18px rgba(0,0,0,.7)');
      });
      el.addEventListener('pointerleave', function () { to(0, ''); });
    });

    /* Buttons get a press, which is the interaction people
       actually notice the absence of. */
    [].slice.call(document.querySelectorAll('.btn, .sim-tool, .sim-mode, .figure__play'))
      .forEach(function (b) {
        b.addEventListener('pointerdown', function () {
          animate(b, [{ transform: 'scale(0.97)' }], { duration: 90, easing: 'ease-out' });
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
          b.addEventListener(ev, function () {
            animate(b, [{ transform: 'scale(1)' }], { duration: SNAP.duration, easing: SNAP.easing });
          });
        });
      });
  }

  /* ── nav condense ──────────────────────────────────────
     A single class toggle at a threshold, not a per-frame
     recalculation. The transition lives in CSS.
     ─────────────────────────────────────────────────────── */
  function initNav() {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var ticking = false;
    function update() {
      nav.classList.toggle('is-scrolled', window.scrollY > 24);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* ── anchor scrolling that respects reduced motion ────── */
  function initAnchors() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({
        behavior: reduced.matches ? 'auto' : 'smooth',
        block: 'start'
      });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      history.replaceState(null, '', '#' + id);
    });
  }

  /* ── figure parallax ───────────────────────────────────
     Page-head illustrations tilt gently toward the pointer, so
     they read as an object in the page rather than a print.
     Transform-only, hover devices only, off under reduced motion.
     ─────────────────────────────────────────────────────── */
  function initFigParallax() {
    if (reduced.matches || window.matchMedia('(hover: none)').matches) return;
    var fig = document.querySelector('.phead__fig');
    if (!fig) return;
    var head = fig.closest('.phead__inner') || fig.parentElement;
    var raf = null, tx = 0, ty = 0;

    head.addEventListener('pointermove', function (e) {
      var r = head.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5);
      ty = ((e.clientY - r.top) / r.height - 0.5);
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        fig.style.transform = 'translate3d(' + (tx * 10).toFixed(1) + 'px,' +
          (ty * 8).toFixed(1) + 'px,0) rotate(' + (tx * 1.6).toFixed(2) + 'deg)';
      });
    });
    head.addEventListener('pointerleave', function () {
      tx = 0; ty = 0;
      var anim = animate(fig, [{ transform: 'translate3d(0,0,0) rotate(0deg)' }],
        { duration: SNAP.duration, easing: SNAP.easing });
      if (anim) anim.finished.then(function () { fig.style.transform = ''; }, function () {});
      else fig.style.transform = '';
    });
  }

  initReveal();
  initHero();
  initHover();
  initNav();
  initAnchors();
  initFigParallax();

  /* Expose the spring generator for the simulator and any future
     component that wants the same feel. */
  window.QMotion = { spring: spring, SOFT: SOFT, SNAP: SNAP, animate: animate };
})();
