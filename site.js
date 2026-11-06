/* ══════════════════════════════════════════════════════════
   Qryptonics — shared site behaviour
   Navigation, scroll reveal, and quantum circuit figures.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Anti-framing. GitHub Pages cannot send X-Frame-Options, and a meta
     CSP ignores frame-ancestors, so the page hides itself when another
     site frames it (clickjacking). Reading window.top.location throws
     cross-origin, which is what marks a hostile frame. */
  if (window.top !== window.self) {
    var foreign = true;
    try { foreign = window.top.location.origin !== window.location.origin; } catch (e) {}
    if (foreign) document.documentElement.classList.add('is-framed');
  }

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

  /* Scroll reveal lives in motion.js. */

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

  /* ── tooltips ──────────────────────────────────────────
     One floating tooltip shared by every [data-tip] element, in
     the refined-reveal style of the component libraries but built
     to be accessible: it answers to focus as well as hover, wires
     aria-describedby so a screen reader announces it, and dismisses
     on Escape. Positioned through the CSSOM, so nothing inline is
     parsed and the strict style-src holds.
     ─────────────────────────────────────────────────────── */
  (function () {
    var triggers = [].slice.call(document.querySelectorAll('[data-tip]'));

    var tipReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tip = document.createElement('div');
    tip.className = 'tip';
    tip.id = 'tip-live';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);

    var current = null, hideTimer = null;

    function place(el) {
      var text = el.getAttribute('data-tip');
      if (!text) return;
      clearTimeout(hideTimer);
      tip.textContent = text;
      tip.hidden = false;
      el.setAttribute('aria-describedby', 'tip-live');
      current = el;

      var r = el.getBoundingClientRect();
      var tr = tip.getBoundingClientRect();
      var pad = 8;
      var left = r.left + r.width / 2 - tr.width / 2;
      left = Math.max(pad, Math.min(left, window.innerWidth - tr.width - pad));

      /* Prefer above; flip below when there is no room. */
      var above = r.top - tr.height - 10;
      var below = r.bottom + 10;
      var top = above > pad ? above : below;
      tip.classList.toggle('is-below', above <= pad);

      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(top + window.scrollY) + 'px';

      if (tipReduced || !tip.animate) { tip.style.opacity = '1'; return; }
      tip.animate(
        [{ opacity: 0, transform: 'translateY(' + (above > pad ? 4 : -4) + 'px)' },
         { opacity: 1, transform: 'translateY(0)' }],
        { duration: 160, easing: 'ease-out', fill: 'both' });
    }

    function hide() {
      if (current) current.removeAttribute('aria-describedby');
      current = null;
      hideTimer = setTimeout(function () { tip.hidden = true; }, 60);
    }

    triggers.forEach(function (el) {
      el.addEventListener('pointerenter', function () { place(el); });
      el.addEventListener('pointerleave', hide);
      el.addEventListener('focus', function () { place(el); });
      el.addEventListener('blur', hide);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && current) hide();
    });
    window.addEventListener('scroll', function () { if (current) hide(); }, { passive: true });

    /* Expose so scripts that build DOM later (the simulator) can
       register new triggers. */
    window.QTip = {
      bind: function (el) {
        el.addEventListener('pointerenter', function () { place(el); });
        el.addEventListener('pointerleave', hide);
        el.addEventListener('focus', function () { place(el); });
        el.addEventListener('blur', hide);
      }
    };
  })();

  /* ── footer year ─────────────────────────────────────── */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
