/* ══════════════════════════════════════════════════════════
   Qryptonics — shared site behaviour
   Navigation, scroll reveal, and quantum circuit figures.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var desktop = window.matchMedia('(min-width: 1021px)');

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── mobile menu ─────────────────────────────────────── */
  var toggle = document.querySelector('.nav__toggle');
  var menu = document.getElementById('nav-menu');

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      menu.classList.toggle('is-open', !open);
    });
  }

  /* ── Insights dropdown ───────────────────────────────── */
  var groups = [].slice.call(document.querySelectorAll('.nav__group'));

  groups.forEach(function (group) {
    var btn = group.querySelector('.nav__group-btn');
    if (!btn) return;

    function open(state) { btn.setAttribute('aria-expanded', String(state)); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      open(btn.getAttribute('aria-expanded') !== 'true');
    });

    /* Hover opens it on desktop only; on touch the click handler owns it. */
    group.addEventListener('mouseenter', function () { if (desktop.matches) open(true); });
    group.addEventListener('mouseleave', function () { if (desktop.matches) open(false); });
    group.addEventListener('focusout', function (e) {
      if (desktop.matches && !group.contains(e.relatedTarget)) open(false);
    });

    document.addEventListener('click', function (e) {
      if (!group.contains(e.target)) open(false);
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    groups.forEach(function (g) {
      var b = g.querySelector('.nav__group-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
    if (toggle && menu) {
      toggle.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
    }
  });

  /* ── scroll reveal ─────────────────────────────────────
     The effect is progressive enhancement, so every failure mode
     has to end with the content visible: no observer support, a
     zero-height viewport, or reduced-motion all reveal at once.
     A scroll fallback covers anything the observer misses.
     ─────────────────────────────────────────────────────── */
  var revealables = [].slice.call(document.querySelectorAll('.rv'));

  function revealAll() {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  }

  if (reduced || !('IntersectionObserver' in window) || !window.innerHeight) {
    revealAll();
  } else {
    var revealer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    revealables.forEach(function (el) { revealer.observe(el); });

    /* Fallback: reveal anything that has scrolled into view but was
       not caught, then stop listening once everything is shown. */
    var sweep = function () {
      var pending = 0;
      revealables.forEach(function (el) {
        if (el.classList.contains('is-in')) return;
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('is-in');
        else pending++;
      });
      if (!pending) window.removeEventListener('scroll', sweep);
    };
    window.addEventListener('scroll', sweep, { passive: true });

    /* Last resort: if nothing has appeared after two seconds, something
       is wrong with the observer. Show everything rather than nothing. */
    setTimeout(function () {
      if (!document.querySelector('.rv.is-in')) revealAll();
    }, 2000);
  }

  /* ── circuit figures ─────────────────────────────────── */
  [].slice.call(document.querySelectorAll('.figure')).forEach(function (fig) {
    var svg = fig.querySelector('.circuit');
    var cap = fig.querySelector('.figure__cap');
    var play = fig.querySelector('.figure__play');
    if (!svg || !cap) return;

    var gates = [].slice.call(svg.querySelectorAll('.gate'));
    var restingCaption = cap.innerHTML;
    var timers = [];
    var playing = false;

    function describe(gate) {
      cap.innerHTML = '<b>' + esc(gate.getAttribute('data-name')) + '</b> · ' +
        esc(gate.getAttribute('data-desc'));
    }

    function clearAll() {
      timers.forEach(clearTimeout);
      timers = [];
      gates.forEach(function (g) { g.classList.remove('is-lit'); });
    }

    gates.forEach(function (gate) {
      gate.setAttribute('tabindex', '0');
      gate.setAttribute('role', 'img');
      gate.setAttribute('aria-label', gate.getAttribute('data-name') + '. ' + gate.getAttribute('data-desc'));

      function show() { if (!playing) { gate.classList.add('is-lit'); describe(gate); } }
      function hide() { if (!playing) { gate.classList.remove('is-lit'); cap.innerHTML = restingCaption; } }

      gate.addEventListener('mouseenter', show);
      gate.addEventListener('mouseleave', hide);
      gate.addEventListener('focus', show);
      gate.addEventListener('blur', hide);
    });

    if (play) {
      play.addEventListener('click', function () {
        if (playing) return;
        clearAll();

        /* Group gates by column so simultaneous operations light together. */
        var steps = {};
        gates.forEach(function (g) {
          var s = g.getAttribute('data-step') || '0';
          (steps[s] = steps[s] || []).push(g);
        });
        var keys = Object.keys(steps).sort(function (a, b) { return a - b; });

        if (reduced) {
          gates.forEach(function (g) { g.classList.add('is-lit'); });
          cap.innerHTML = restingCaption;
          return;
        }

        playing = true;
        play.textContent = 'running';

        keys.forEach(function (key, i) {
          timers.push(setTimeout(function () {
            gates.forEach(function (g) { g.classList.remove('is-lit'); });
            steps[key].forEach(function (g) { g.classList.add('is-lit'); });
            describe(steps[key][0]);
          }, i * 620));
        });

        timers.push(setTimeout(function () {
          gates.forEach(function (g) { g.classList.remove('is-lit'); });
          cap.innerHTML = restingCaption;
          play.textContent = 'run circuit';
          playing = false;
        }, keys.length * 620 + 700));
      });
    }
  });

  /* ── Ising graph: click a node to flip its spin ──────── */
  [].slice.call(document.querySelectorAll('.graphfig')).forEach(function (svg) {
    var readout = document.getElementById(svg.getAttribute('data-readout'));
    var nodes = [].slice.call(svg.querySelectorAll('.node'));
    var edges = [].slice.call(svg.querySelectorAll('.edge'));

    function energy() {
      var total = 0;
      var frustrated = 0;
      edges.forEach(function (edge) {
        var a = svg.querySelector('.node[data-id="' + edge.getAttribute('data-a') + '"]');
        var b = svg.querySelector('.node[data-id="' + edge.getAttribute('data-b') + '"]');
        var w = parseFloat(edge.getAttribute('data-w'));
        var sa = a.classList.contains('is-up') ? 1 : -1;
        var sb = b.classList.contains('is-up') ? 1 : -1;
        var term = w * sa * sb;
        total += term;
        if (term > 0) { edge.classList.add('is-frust'); frustrated++; }
        else { edge.classList.remove('is-frust'); }
      });
      if (readout) {
        readout.innerHTML = '<b>Cost H = ' + total.toFixed(1) + '</b> · ' +
          frustrated + ' of ' + edges.length + ' couplings unsatisfied. ' +
          'Click any spin to flip it. The minimum is −4.0.';
      }
    }

    nodes.forEach(function (node) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', 'Spin ' + node.getAttribute('data-id') + ', click to flip');
      function flip() { node.classList.toggle('is-up'); energy(); }
      node.addEventListener('click', flip);
      node.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });
    });

    energy();
  });

  /* ── footer year ─────────────────────────────────────── */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
