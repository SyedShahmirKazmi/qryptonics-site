/* ══════════════════════════════════════════════════════════
   Qryptonics — hero lattice, third dimension

   A 3D point lattice under basis reduction: a skewed basis
   relaxing toward its reduced form, the operation whose hardness
   ML-KEM rests on. Lattice cryptography lives in high dimension,
   so depth is more honest than the flat version was.

   The scene is an interactive layer, not a video: it rotates
   slowly on its own and tilts toward the pointer. Plain canvas,
   no dependencies, paused off-screen, static under reduced
   motion.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var canvas = document.getElementById('lattice');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover)').matches;

  var COLD = 'rgba(111, 168, 214, ';
  var COPPER = 'rgba(200, 135, 74, ';

  var w = 0, h = 0, cx = 0, cy = 0;
  var running = true, t0 = null;

  /* Basis triples: each cycle interpolates a long, skewed basis
     toward a short, near-orthogonal one. */
  var CYCLES = [
    { from: [[1.00, 0.14, 0.12], [0.84, 0.44, -0.10], [0.66, 0.24, 0.78]],
      to:   [[1.00, 0.14, 0.12], [-0.16, 0.30, 0.06], [-0.04, -0.14, 0.84]] },
    { from: [[0.92, -0.28, 0.08], [1.10, 0.16, 0.22], [0.52, 0.60, 0.72]],
      to:   [[0.92, -0.28, 0.08], [0.18, 0.46, -0.08], [-0.10, 0.10, 0.88]] },
    { from: [[1.04, 0.20, -0.10], [0.72, 0.58, 0.16], [0.80, 0.10, 0.70]],
      to:   [[1.04, 0.20, -0.10], [-0.30, 0.36, 0.10], [0.06, -0.10, 0.82]] }
  ];
  var CYCLE_MS = 11000, HOLD_MS = 2600;
  var SPAN = 3;                       // lattice points per axis: (2*SPAN+1)^3
  var FOCAL = 3.4;                    // perspective strength

  /* Pointer tilt: target set by the pointer, eased every frame so
     the scene follows rather than jumps. */
  var tiltX = 0, tiltY = 0, targetX = 0, targetY = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    w = Math.max(r.width, 1); h = Math.max(r.height, 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (w < 1000) { cx = w * 0.78; cy = h * 0.78; }
    else { cx = w * 0.70; cy = h * 0.50; }
  }

  function easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function lerpV(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }

  /* Rotate about Y (yaw) then X (pitch), project with perspective.
     Returns screen x, y and a depth factor used for size and alpha. */
  function project(x, y, z, yaw, pitch, scale) {
    var cyw = Math.cos(yaw), syw = Math.sin(yaw);
    var x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    var d = FOCAL / (FOCAL + z2);
    return { x: cx + x1 * scale * d, y: cy + y2 * scale * d, d: d, z: z2 };
  }

  function draw(b1, b2, b3, yaw, pitch, scale) {
    ctx.clearRect(0, 0, w, h);

    /* Shift so the cell sits at the visual centre of the cloud. */
    var off = [-(b1[0] + b2[0] + b3[0]) / 2, -(b1[1] + b2[1] + b3[1]) / 2, -(b1[2] + b2[2] + b3[2]) / 2];
    var maxR = SPAN * 1.15;

    /* Point cloud, depth-sorted cheaply by drawing back first:
       collect, sort by z descending (far first). */
    var pts = [];
    for (var i = -SPAN; i <= SPAN; i++) {
      for (var j = -SPAN; j <= SPAN; j++) {
        for (var k = -SPAN; k <= SPAN; k++) {
          var x = i * b1[0] + j * b2[0] + k * b3[0] + off[0];
          var y = i * b1[1] + j * b2[1] + k * b3[1] + off[1];
          var z = i * b1[2] + j * b2[2] + k * b3[2] + off[2];
          var r2 = x * x + y * y + z * z;
          if (r2 > maxR * maxR) continue;
          var p = project(x, y, z, yaw, pitch, scale);
          if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
          p.r2 = r2;
          pts.push(p);
        }
      }
    }
    pts.sort(function (a, b2s) { return b2s.z - a.z; });

    for (var n = 0; n < pts.length; n++) {
      var p2 = pts[n];
      var fade = 1 - Math.sqrt(p2.r2) / maxR;
      var depth = Math.max(0, Math.min(1, (p2.d - 0.62) * 1.9));
      var alpha = (0.05 + fade * fade * 0.55) * (0.35 + 0.65 * depth);
      var rad = (0.9 + fade * 1.6) * (0.55 + 0.85 * p2.d);
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = COLD + alpha.toFixed(3) + ')';
      ctx.fill();
    }

    /* Fundamental cell: the parallelepiped spanned by the basis. */
    var C = [[0, 0, 0], b1, b2, b3,
             [b1[0] + b2[0], b1[1] + b2[1], b1[2] + b2[2]],
             [b1[0] + b3[0], b1[1] + b3[1], b1[2] + b3[2]],
             [b2[0] + b3[0], b2[1] + b3[1], b2[2] + b3[2]],
             [b1[0] + b2[0] + b3[0], b1[1] + b2[1] + b3[1], b1[2] + b2[2] + b3[2]]];
    var P = C.map(function (c) {
      return project(c[0] + off[0], c[1] + off[1], c[2] + off[2], yaw, pitch, scale);
    });
    var EDGES = [[0,1],[0,2],[0,3],[1,4],[1,5],[2,4],[2,6],[3,5],[3,6],[4,7],[5,7],[6,7]];

    ctx.strokeStyle = COPPER + '0.38)';
    ctx.lineWidth = 1.1;
    EDGES.forEach(function (e) {
      ctx.beginPath();
      ctx.moveTo(P[e[0]].x, P[e[0]].y);
      ctx.lineTo(P[e[1]].x, P[e[1]].y);
      ctx.stroke();
    });

    /* Basis vectors from the origin corner, the focal object. */
    ctx.save();
    ctx.shadowColor = COPPER + '0.55)';
    ctx.shadowBlur = 12;
    [1, 2, 3].forEach(function (ci) {
      ctx.beginPath();
      ctx.moveTo(P[0].x, P[0].y);
      ctx.lineTo(P[ci].x, P[ci].y);
      ctx.strokeStyle = COPPER + '0.92)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(P[ci].x, P[ci].y, 3.6 * P[ci].d, 0, Math.PI * 2);
      ctx.fillStyle = COPPER + '1)';
      ctx.fill();
    });
    ctx.restore();

    ctx.beginPath();
    ctx.arc(P[0].x, P[0].y, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(237, 240, 247, 0.9)';
    ctx.fill();
  }

  function frame(ts) {
    if (!running) return;
    if (t0 === null) t0 = ts;

    var scale = Math.max(Math.min(w, h) * 0.16, 90);
    var total = CYCLE_MS + HOLD_MS;
    var elapsed = ts - t0;
    var index = Math.floor(elapsed / total) % CYCLES.length;
    var local = Math.min((elapsed % total) / CYCLE_MS, 1);
    var c = CYCLES[index];
    var k = easeInOut(local);

    /* Ease the tilt toward the pointer target. */
    tiltX += (targetX - tiltX) * 0.06;
    tiltY += (targetY - tiltY) * 0.06;

    var yaw = elapsed * 0.00006 + tiltX;
    var pitch = -0.24 + tiltY;

    draw(lerpV(c.from[0], c.to[0], k),
         lerpV(c.from[1], c.to[1], k),
         lerpV(c.from[2], c.to[2], k),
         yaw, pitch, scale);
    requestAnimationFrame(frame);
  }

  function renderStatic() {
    var scale = Math.max(Math.min(w, h) * 0.16, 90);
    var c = CYCLES[0];
    draw(c.to[0], c.to[1], c.to[2], 0.5, -0.24, scale);
  }

  /* Pointer parallax on the hero itself, hover devices only. */
  if (canHover && !reduced) {
    var hero = canvas.closest('.hero') || canvas.parentElement;
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      targetX = ((e.clientX - r.left) / r.width - 0.5) * 0.35;
      targetY = ((e.clientY - r.top) / r.height - 0.5) * 0.28;
    });
    hero.addEventListener('pointerleave', function () { targetX = 0; targetY = 0; });
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      if (reduced) renderStatic();
    }, 150);
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          if (!running && !reduced) { running = true; t0 = null; requestAnimationFrame(frame); }
        } else running = false;
      });
    }, { threshold: 0 }).observe(canvas);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) running = false;
    else if (!reduced) { running = true; t0 = null; requestAnimationFrame(frame); }
  });

  resize();
  if (reduced) { renderStatic(); return; }
  requestAnimationFrame(frame);
})();
