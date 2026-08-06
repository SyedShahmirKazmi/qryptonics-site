/* ══════════════════════════════════════════════════════════
   Qryptonics — hero lattice
   Renders a 2D point lattice and animates Lagrange–Gauss basis
   reduction: a "bad" (long, near-parallel) basis relaxing toward
   the reduced basis. This is the operation that makes lattice
   cryptography hard, and the same lattice structure underlies
   Ising-form optimization. One motif, both practices.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var canvas = document.getElementById('lattice');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var COLD = 'rgba(111, 168, 214, ';
  var COPPER = 'rgba(200, 135, 74, ';

  var w = 0, h = 0, dpr = 1;
  var cx = 0, cy = 0;
  var running = true;
  var t0 = null;

  /* Basis pairs: each cycle interpolates from a skewed basis to its
     reduced form. Values are in unscaled lattice units. */
  var CYCLES = [
    { from: [[1.00, 0.14], [0.86, 0.42]], to: [[1.00, 0.14], [-0.14, 0.28]] },
    { from: [[0.92, -0.30], [1.12, 0.18]], to: [[0.92, -0.30], [0.20, 0.48]] },
    { from: [[1.06, 0.22], [0.74, 0.60]], to: [[1.06, 0.22], [-0.32, 0.38]] }
  ];
  var CYCLE_MS = 11000;
  var HOLD_MS = 2600;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    w = Math.max(r.width, 1);
    h = Math.max(r.height, 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* Anchor the lattice origin right of the text column. On narrow
       viewports the column takes the full width, so push the origin
       further out and let the veil carry legibility. */
    if (w < 1000) {
      /* Narrow: the text column takes the full width, so drop the basis
         into the empty region below the buttons rather than off-canvas. */
      cx = w * 0.78;
      cy = h * 0.80;
    } else {
      cx = w * 0.70;
      cy = h * 0.50;
    }
  }

  function easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function lerp(a, b, k) { return a + (b - a) * k; }

  function draw(b1, b2, scale) {
    ctx.clearRect(0, 0, w, h);

    var span = Math.ceil(Math.max(w, h) / scale) + 3;
    var maxR = Math.hypot(w, h) * 0.62;

    /* Lattice points */
    for (var i = -span; i <= span; i++) {
      for (var j = -span; j <= span; j++) {
        var x = (i * b1[0] + j * b2[0]) * scale;
        var y = (i * b1[1] + j * b2[1]) * scale;
        var d = Math.hypot(x, y);
        if (d > maxR) continue;

        var px = cx + x, py = cy + y;
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;

        var fade = 1 - d / maxR;
        var alpha = 0.09 + fade * fade * 0.66;
        var rad = 1.5 + fade * 2.4;

        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fillStyle = COLD + alpha.toFixed(3) + ')';
        ctx.fill();
      }
    }

    /* Fundamental parallelogram spanned by the current basis */
    var v1x = b1[0] * scale, v1y = b1[1] * scale;
    var v2x = b2[0] * scale, v2y = b2[1] * scale;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + v1x, cy + v1y);
    ctx.lineTo(cx + v1x + v2x, cy + v1y + v2y);
    ctx.lineTo(cx + v2x, cy + v2y);
    ctx.closePath();
    ctx.fillStyle = COPPER + '0.12)';
    ctx.fill();
    ctx.strokeStyle = COPPER + '0.40)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    /* Basis vectors — the focal point of the motif */
    ctx.save();
    ctx.shadowColor = COPPER + '0.55)';
    ctx.shadowBlur = 14;
    [[v1x, v1y], [v2x, v2y]].forEach(function (v) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + v[0], cy + v[1]);
      ctx.strokeStyle = COPPER + '0.92)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + v[0], cy + v[1], 4.2, 0, Math.PI * 2);
      ctx.fillStyle = COPPER + '1)';
      ctx.fill();
    });
    ctx.restore();

    /* Origin */
    ctx.beginPath();
    ctx.arc(cx, cy, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(233, 237, 247, 0.9)';
    ctx.fill();
  }

  function frame(ts) {
    if (!running) return;
    if (t0 === null) t0 = ts;

    var scale = Math.max(Math.min(w, h) * 0.088, 52);
    var total = CYCLE_MS + HOLD_MS;
    var elapsed = ts - t0;
    var index = Math.floor(elapsed / total) % CYCLES.length;
    var local = Math.min((elapsed % total) / CYCLE_MS, 1);

    var c = CYCLES[index];
    var k = easeInOut(local);

    var b1 = [lerp(c.from[0][0], c.to[0][0], k), lerp(c.from[0][1], c.to[0][1], k)];
    var b2 = [lerp(c.from[1][0], c.to[1][0], k), lerp(c.from[1][1], c.to[1][1], k)];

    draw(b1, b2, scale);
    requestAnimationFrame(frame);
  }

  function renderStatic() {
    var scale = Math.max(Math.min(w, h) * 0.088, 52);
    var c = CYCLES[0];
    draw(c.to[0], c.to[1], scale);
  }

  function start() {
    resize();
    if (reduced) { renderStatic(); return; }
    running = true;
    t0 = null;
    requestAnimationFrame(frame);
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      if (reduced) renderStatic();
    }, 150);
  });

  /* Stop painting when the hero is off-screen or the tab is hidden. */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          if (!running && !reduced) { running = true; t0 = null; requestAnimationFrame(frame); }
        } else {
          running = false;
        }
      });
    }, { threshold: 0 }).observe(canvas);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      running = false;
    } else if (!reduced) {
      running = true; t0 = null; requestAnimationFrame(frame);
    }
  });

  start();
})();
