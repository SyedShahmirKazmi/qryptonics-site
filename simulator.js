/* ══════════════════════════════════════════════════════════
   Qryptonics — simulator workbench
   Palette drag-and-drop onto an infinite pannable sheet, three
   modes (circuit, network, distributed), live results.
   Pointer events throughout so touch works the same as mouse.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var svg = document.getElementById('sheet');
  if (!svg) return;

  var scene = document.getElementById('scene');
  var layerGrid = document.getElementById('layer-grid');
  var layerWires = document.getElementById('layer-wires');
  var layerItems = document.getElementById('layer-items');
  var frame = document.getElementById('frame');
  var results = document.getElementById('results');
  var inspector = document.getElementById('inspector');
  var hint = document.getElementById('hint');

  var COL_X = 150, COL_W = 74, WIRE_Y = 90, WIRE_H = 74;
  var uid = 0;

  var app = {
    mode: 'circuit',
    view: { x: 0, y: 0, k: 1 },
    circuit: { qubits: 4, ops: [] },
    net: { nodes: [], links: [] },
    params: { noise: 0, memoryT2: 0.01, srcFidelity: 0.98, swapQuality: 0.97, span: 200 },
    selected: null,
    connectFrom: null,
    linking: false
  };

  var TWO_Q = { CNOT: 1, CZ: 1, SWAP: 1 };
  var PARAMETRIC = { RX: 1, RY: 1, RZ: 1 };

  /* ── helpers ───────────────────────────────────────────── */
  /* Escape before any innerHTML interpolation. Nothing user-authored
     reaches these sinks today, but node labels and gate types are the
     kind of thing that becomes editable later, and a stored-XSS bug
     introduced that way is silent. */
  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(tag, attrs, parent) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmt(v, d) {
    if (!isFinite(v)) return '∞';
    if (v === 0) return '0';
    var a = Math.abs(v);
    if (a >= 1e6 || a < 1e-3) return v.toExponential(d === undefined ? 2 : d);
    return v.toFixed(d === undefined ? 2 : d);
  }
  function sci(v, unit) {
    if (!isFinite(v)) return '∞';
    var u = ['', 'k', 'M', 'G'], i = 0, x = v;
    while (x >= 1000 && i < 3) { x /= 1000; i++; }
    if (v < 1) return v.toExponential(2) + ' ' + unit;
    return x.toFixed(x < 10 ? 2 : 1) + ' ' + u[i] + unit;
  }

  /* Convert a client point into sheet coordinates. */
  function toSheet(clientX, clientY) {
    var r = svg.getBoundingClientRect();
    var vb = svg.viewBox.baseVal;
    var sx = vb.width / r.width, sy = vb.height / r.height;
    var vx = (clientX - r.left) * sx + vb.x;
    var vy = (clientY - r.top) * sy + vb.y;
    return { x: (vx - app.view.x) / app.view.k, y: (vy - app.view.y) / app.view.k };
  }

  function applyView() {
    scene.setAttribute('transform',
      'translate(' + app.view.x + ',' + app.view.y + ') scale(' + app.view.k + ')');
  }

  /* ── palette drag ──────────────────────────────────────── */
  var ghost = null, dragKind = null;

  function startPaletteDrag(e, kind) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    dragKind = kind;
    ghost = document.createElement('div');
    ghost.className = 'sim-ghost';
    ghost.textContent = kind.label;
    document.body.appendChild(ghost);
    moveGhost(e);
    window.addEventListener('pointermove', moveGhost);
    window.addEventListener('pointerup', dropGhost);
    frame.classList.add('is-dropping');
  }
  function moveGhost(e) {
    if (!ghost) return;
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
  }
  function dropGhost(e) {
    window.removeEventListener('pointermove', moveGhost);
    window.removeEventListener('pointerup', dropGhost);
    frame.classList.remove('is-dropping');
    if (ghost) { ghost.remove(); ghost = null; }
    var r = frame.getBoundingClientRect();
    var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (inside && dragKind) place(dragKind, toSheet(e.clientX, e.clientY));
    dragKind = null;
  }

  function place(kind, pt) {
    if (kind.family === 'gate') {
      if (app.mode !== 'circuit') { flash('Switch to Circuit mode to place gates.'); return; }
      var q = Math.round((pt.y - WIRE_Y) / WIRE_H);
      var col = Math.round((pt.x - COL_X) / COL_W);
      q = Math.max(0, Math.min(app.circuit.qubits - 1, q));
      col = Math.max(0, col);
      var op = { id: ++uid, type: kind.type, q: q, col: col };
      if (PARAMETRIC[kind.type]) op.theta = Math.PI / 2;
      if (TWO_Q[kind.type]) {
        op.control = q;
        op.q = (q + 1) % app.circuit.qubits;
        if (app.circuit.qubits < 2) { flash('Two-qubit gates need at least two wires.'); return; }
      }
      if (occupied(col, op.q) || (op.control !== undefined && occupied(col, op.control))) {
        col = nextFreeCol(col, op);
        op.col = col;
      }
      app.circuit.ops.push(op);
      app.selected = { type: 'op', id: op.id };
    } else {
      if (app.mode === 'circuit') { flash('Switch to Network or Distributed mode to place nodes.'); return; }
      app.net.nodes.push({
        id: ++uid, kind: kind.type, x: pt.x, y: pt.y,
        label: kind.short + (app.net.nodes.length + 1),
        qubits: kind.type === 'qpu' ? 2 : 1
      });
      app.selected = { type: 'node', id: uid };
    }
    render();
  }

  function occupied(col, q) {
    return app.circuit.ops.some(function (o) {
      return o.col === col && (o.q === q || o.control === q);
    });
  }
  function nextFreeCol(col, op) {
    var c = col;
    while (occupied(c, op.q) || (op.control !== undefined && occupied(c, op.control))) c++;
    return c;
  }

  function flash(msg) {
    hint.textContent = msg;
    hint.classList.add('is-warn');
    clearTimeout(flash._t);
    flash._t = setTimeout(function () {
      hint.classList.remove('is-warn');
      hint.textContent = defaultHint();
    }, 2600);
  }
  function defaultHint() {
    if (app.mode === 'circuit') return 'Drag gates onto the wires. Drag a placed gate to move it, click to select.';
    if (app.mode === 'network') return 'Drop nodes, then use Connect to link them. Drag nodes to reposition.';
    return 'Place QPU nodes and link them. Qubits are split across nodes automatically.';
  }

  /* ── canvas pan, zoom, item drag ───────────────────────── */
  var panning = null, movingItem = null;

  svg.addEventListener('pointerdown', function (e) {
    var target = e.target.closest('[data-item]');
    if (target) {
      var id = +target.getAttribute('data-item');
      var kind = target.getAttribute('data-family');
      if (app.linking && kind === 'node') { handleLinkClick(id); return; }
      app.selected = { type: kind === 'node' ? 'node' : 'op', id: id };
      movingItem = { id: id, family: kind, start: toSheet(e.clientX, e.clientY), moved: false };
      svg.setPointerCapture(e.pointerId);
      render();
      return;
    }
    if (app.linking) { app.connectFrom = null; setLinking(false); return; }
    app.selected = null;
    panning = { x: e.clientX, y: e.clientY, vx: app.view.x, vy: app.view.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('is-panning');
    render();
  });

  svg.addEventListener('pointermove', function (e) {
    if (movingItem) {
      var pt = toSheet(e.clientX, e.clientY);
      movingItem.moved = true;
      if (movingItem.family === 'node') {
        var n = findNode(movingItem.id);
        if (n) { n.x = pt.x; n.y = pt.y; render(); }
      } else {
        var op = findOp(movingItem.id);
        if (!op) return;
        var q = Math.max(0, Math.min(app.circuit.qubits - 1, Math.round((pt.y - WIRE_Y) / WIRE_H)));
        var col = Math.max(0, Math.round((pt.x - COL_X) / COL_W));
        if (TWO_Q[op.type]) {
          var span = op.q - op.control;
          op.control = q;
          op.q = Math.max(0, Math.min(app.circuit.qubits - 1, q + span));
          if (op.q === op.control) op.q = (op.control + 1) % app.circuit.qubits;
        } else {
          op.q = q;
        }
        op.col = col;
        render();
      }
      return;
    }
    if (panning) {
      var r = svg.getBoundingClientRect();
      var vb = svg.viewBox.baseVal;
      app.view.x = panning.vx + (e.clientX - panning.x) * (vb.width / r.width);
      app.view.y = panning.vy + (e.clientY - panning.y) * (vb.height / r.height);
      applyView();
    }
  });

  function endPointer(e) {
    if (movingItem) { movingItem = null; simulate(); }
    if (panning) { panning = null; svg.classList.remove('is-panning'); }
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  function zoomAt(cx, cy, factor) {
    var before = toSheet(cx, cy);
    app.view.k = Math.max(0.35, Math.min(2.6, app.view.k * factor));
    var after = toSheet(cx, cy);
    app.view.x += (after.x - before.x) * app.view.k;
    app.view.y += (after.y - before.y) * app.view.k;
    applyView();
  }

  /* ── linking ───────────────────────────────────────────── */
  function setLinking(on) {
    app.linking = on;
    document.getElementById('btn-link').setAttribute('aria-pressed', String(on));
    frame.classList.toggle('is-linking', on);
    if (!on) app.connectFrom = null;
    hint.textContent = on ? 'Click one node, then another, to lay fibre between them.' : defaultHint();
    render();
  }
  function handleLinkClick(id) {
    if (app.connectFrom === null) { app.connectFrom = id; render(); return; }
    if (app.connectFrom === id) { app.connectFrom = null; render(); return; }
    var a = app.connectFrom, b = id;
    var exists = app.net.links.some(function (l) {
      return (l.a === a && l.b === b) || (l.a === b && l.b === a);
    });
    if (!exists) {
      var na = findNode(a), nb = findNode(b);
      var px = Math.hypot(na.x - nb.x, na.y - nb.y);
      app.net.links.push({ id: ++uid, a: a, b: b, km: Math.max(5, Math.round(px / 4)) });
    }
    app.connectFrom = null;
    render();
    simulate();
  }

  function findOp(id) { return app.circuit.ops.filter(function (o) { return o.id === id; })[0]; }
  function findNode(id) { return app.net.nodes.filter(function (n) { return n.id === id; })[0]; }

  /* ── rendering ─────────────────────────────────────────── */
  function render() {
    clear(layerWires); clear(layerItems);
    if (app.mode === 'circuit') renderCircuit(); else renderNetwork();
    renderInspector();
  }

  function renderCircuit() {
    var maxCol = app.circuit.ops.reduce(function (m, o) { return Math.max(m, o.col); }, 6);
    var width = COL_X + (maxCol + 3) * COL_W;

    for (var q = 0; q < app.circuit.qubits; q++) {
      var y = WIRE_Y + q * WIRE_H;
      el('line', { class: 'sim-wire', x1: 80, y1: y, x2: width, y2: y }, layerWires);
      el('text', { class: 'sim-qlabel', x: 46, y: y + 4 }, layerWires).textContent = 'q' + q;
      el('text', { class: 'sim-ket', x: 62, y: y + 4 }, layerWires).textContent = '|0⟩';
    }

    app.circuit.ops.forEach(function (op) {
      var x = COL_X + op.col * COL_W;
      var y = WIRE_Y + op.q * WIRE_H;
      var sel = app.selected && app.selected.type === 'op' && app.selected.id === op.id;
      var g = el('g', {
        class: 'sim-op' + (sel ? ' is-sel' : '') + (PARAMETRIC[op.type] ? ' is-param' : ''),
        'data-item': op.id, 'data-family': 'op'
      }, layerItems);

      if (TWO_Q[op.type]) {
        var cy = WIRE_Y + op.control * WIRE_H;
        el('line', { class: 'sim-link', x1: x, y1: cy, x2: x, y2: y }, g);
        el('circle', { class: 'sim-ctrl', cx: x, cy: cy, r: 5 }, g);
        if (op.type === 'CNOT') {
          el('circle', { class: 'sim-targ', cx: x, cy: y, r: 12 }, g);
          el('line', { class: 'sim-link', x1: x - 12, y1: y, x2: x + 12, y2: y }, g);
          el('line', { class: 'sim-link', x1: x, y1: y - 12, x2: x, y2: y + 12 }, g);
        } else if (op.type === 'CZ') {
          el('circle', { class: 'sim-ctrl', cx: x, cy: y, r: 5 }, g);
        } else {
          [[x, cy], [x, y]].forEach(function (p) {
            el('line', { class: 'sim-link', x1: p[0] - 7, y1: p[1] - 7, x2: p[0] + 7, y2: p[1] + 7 }, g);
            el('line', { class: 'sim-link', x1: p[0] + 7, y1: p[1] - 7, x2: p[0] - 7, y2: p[1] + 7 }, g);
          });
        }
        el('rect', { class: 'sim-hit', x: x - 16, y: Math.min(y, cy) - 16, width: 32, height: Math.abs(y - cy) + 32 }, g);
      } else {
        el('rect', { class: 'sim-box', x: x - 21, y: y - 18, width: 42, height: 36, rx: 4 }, g);
        var label = op.type;
        if (PARAMETRIC[op.type]) label = op.type;
        el('text', { class: 'sim-glabel', x: x, y: y + 1 }, g).textContent = label;
        if (PARAMETRIC[op.type]) {
          el('text', { class: 'sim-theta', x: x, y: y + 27 }, g)
            .textContent = (op.theta / Math.PI).toFixed(2) + 'π';
        }
      }
    });
  }

  function renderNetwork() {
    app.net.links.forEach(function (l) {
      var a = findNode(l.a), b = findNode(l.b);
      if (!a || !b) return;
      el('line', { class: 'sim-fibre', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, layerWires);
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      el('rect', { class: 'sim-kmbg', x: mx - 26, y: my - 11, width: 52, height: 20, rx: 3 }, layerWires);
      el('text', { class: 'sim-km', x: mx, y: my + 3 }, layerWires).textContent = l.km + ' km';
    });

    app.net.nodes.forEach(function (n) {
      var sel = app.selected && app.selected.type === 'node' && app.selected.id === n.id;
      var pending = app.connectFrom === n.id;
      var g = el('g', {
        class: 'sim-node is-' + n.kind + (sel ? ' is-sel' : '') + (pending ? ' is-pending' : ''),
        'data-item': n.id, 'data-family': 'node'
      }, layerItems);
      if (n.kind === 'repeater') {
        el('rect', { class: 'sim-nbody', x: n.x - 26, y: n.y - 20, width: 52, height: 40, rx: 5 }, g);
      } else if (n.kind === 'qpu') {
        el('rect', { class: 'sim-nbody', x: n.x - 32, y: n.y - 26, width: 64, height: 52, rx: 6 }, g);
      } else {
        el('circle', { class: 'sim-nbody', cx: n.x, cy: n.y, r: 24 }, g);
      }
      el('text', { class: 'sim-nlabel', x: n.x, y: n.y + 4 }, g).textContent = n.label;
      el('text', { class: 'sim-nkind', x: n.x, y: n.y + 40 }, g)
        .textContent = n.kind === 'qpu' ? n.qubits + ' qubits' : n.kind;
    });
  }

  /* ── inspector ─────────────────────────────────────────── */
  function renderInspector() {
    clear2(inspector);
    if (!app.selected) {
      inspector.innerHTML = '<p class="sim-empty">Select an element to edit it.</p>';
      return;
    }
    if (app.selected.type === 'op') {
      var op = findOp(app.selected.id);
      if (!op) { app.selected = null; return renderInspector(); }
      var h = '<p class="sim-ins-h">' + esc(op.type) + ' gate</p>';
      h += row('Wire', 'q' + op.q);
      if (op.control !== undefined) h += row('Control', 'q' + op.control);
      h += row('Column', op.col);
      if (PARAMETRIC[op.type]) {
        h += '<label class="sim-field"><span>θ = <b id="theta-v">' + (op.theta / Math.PI).toFixed(2) +
          'π</b></span><input id="theta" type="range" min="0" max="2" step="0.05" value="' +
          (op.theta / Math.PI) + '"></label>';
      }
      if (TWO_Q[op.type]) h += '<button class="sim-btn" id="flip">Swap control and target</button>';
      h += '<button class="sim-btn sim-btn--del" id="del">Delete gate</button>';
      inspector.innerHTML = h;

      var t = document.getElementById('theta');
      if (t) t.addEventListener('input', function () {
        op.theta = parseFloat(t.value) * Math.PI;
        document.getElementById('theta-v').textContent = parseFloat(t.value).toFixed(2) + 'π';
        render(); simulate();
      });
      var f = document.getElementById('flip');
      if (f) f.addEventListener('click', function () {
        var c = op.control; op.control = op.q; op.q = c; render(); simulate();
      });
      document.getElementById('del').addEventListener('click', function () {
        app.circuit.ops = app.circuit.ops.filter(function (o) { return o.id !== op.id; });
        app.selected = null; render(); simulate();
      });
    } else {
      var n = findNode(app.selected.id);
      if (!n) { app.selected = null; return renderInspector(); }
      var links = app.net.links.filter(function (l) { return l.a === n.id || l.b === n.id; });
      var html = '<p class="sim-ins-h">' + esc(n.label) + '</p>' + row('Type', esc(n.kind));
      if (n.kind === 'qpu') {
        html += '<label class="sim-field"><span>Local qubits <b id="qn-v">' + n.qubits + '</b></span>' +
          '<input id="qn" type="range" min="1" max="6" step="1" value="' + n.qubits + '"></label>';
      }
      links.forEach(function (l, i) {
        html += '<label class="sim-field"><span>Fibre ' + (i + 1) + ' <b id="km-v-' + l.id + '">' +
          l.km + ' km</b></span><input class="km" data-link="' + l.id +
          '" type="range" min="5" max="400" step="5" value="' + l.km + '"></label>';
      });
      html += '<button class="sim-btn sim-btn--del" id="del">Delete node</button>';
      inspector.innerHTML = html;

      var qn = document.getElementById('qn');
      if (qn) qn.addEventListener('input', function () {
        n.qubits = +qn.value;
        document.getElementById('qn-v').textContent = n.qubits;
        render(); simulate();
      });
      [].forEach.call(inspector.querySelectorAll('.km'), function (inp) {
        inp.addEventListener('input', function () {
          var l = app.net.links.filter(function (x) { return x.id === +inp.getAttribute('data-link'); })[0];
          l.km = +inp.value;
          document.getElementById('km-v-' + l.id).textContent = l.km + ' km';
          render(); simulate();
        });
      });
      document.getElementById('del').addEventListener('click', function () {
        app.net.nodes = app.net.nodes.filter(function (x) { return x.id !== n.id; });
        app.net.links = app.net.links.filter(function (l) { return l.a !== n.id && l.b !== n.id; });
        app.selected = null; render(); simulate();
      });
    }
  }
  function row(k, v) { return '<p class="sim-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></p>'; }
  function clear2(node) { node.innerHTML = ''; }

  /* ── charts ────────────────────────────────────────────── */
  function barChart(values, labels, opts) {
    opts = opts || {};
    var W = 560, H = 170, PAD = 34, BOT = 30;
    var s = '<svg class="sim-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.aria || 'chart') + '">';
    var max = Math.max.apply(null, values.concat([1e-9]));
    var n = values.length;
    var bw = (W - PAD - 10) / n;
    [0, 0.5, 1].forEach(function (f) {
      var y = H - BOT - f * (H - BOT - 14);
      s += '<line class="ch-grid" x1="' + PAD + '" y1="' + y + '" x2="' + (W - 6) + '" y2="' + y + '"/>';
      s += '<text class="ch-ax" x="' + (PAD - 6) + '" y="' + (y + 3) + '" text-anchor="end">' +
        (f * max).toFixed(2) + '</text>';
    });
    values.forEach(function (v, i) {
      var h = (v / max) * (H - BOT - 14);
      var x = PAD + i * bw + bw * 0.16;
      var w = bw * 0.68;
      s += '<rect class="ch-bar" x="' + x + '" y="' + (H - BOT - h) + '" width="' + w +
        '" height="' + Math.max(h, 0.5) + '" rx="2"><title>' + esc(labels[i]) + ' — ' +
        v.toFixed(4) + '</title></rect>';
      if (n <= 16) s += '<text class="ch-lab" x="' + (x + w / 2) + '" y="' + (H - BOT + 14) +
        '" text-anchor="middle">' + esc(labels[i]) + '</text>';
    });
    return s + '</svg>';
  }

  function lineChart(series, opts) {
    opts = opts || {};
    var W = 560, H = 180, PADL = 46, PADB = 30, PADT = 12, PADR = 10;
    var xs = series[0].pts.map(function (p) { return p.x; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var all = series.reduce(function (a, s2) { return a.concat(s2.pts.map(function (p) { return p.y; })); }, []);
    var log = !!opts.log;
    var ymin = log ? Math.max(Math.min.apply(null, all.filter(function (v) { return v > 0; })), 1e-6) : 0;
    var ymax = Math.max.apply(null, all) || 1;
    function fy(v) {
      if (log) {
        var lo = Math.log10(ymin), hi = Math.log10(Math.max(ymax, ymin * 10));
        var t = (Math.log10(Math.max(v, ymin)) - lo) / (hi - lo);
        return H - PADB - t * (H - PADB - PADT);
      }
      return H - PADB - (v / ymax) * (H - PADB - PADT);
    }
    function fx(v) { return PADL + ((v - xmin) / (xmax - xmin || 1)) * (W - PADL - PADR); }

    var s = '<svg class="sim-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      (opts.aria || 'chart') + '">';
    [0, 0.5, 1].forEach(function (f) {
      var val = log ? Math.pow(10, Math.log10(ymin) + f * (Math.log10(Math.max(ymax, ymin * 10)) - Math.log10(ymin))) : f * ymax;
      var y = fy(val);
      s += '<line class="ch-grid" x1="' + PADL + '" y1="' + y + '" x2="' + (W - PADR) + '" y2="' + y + '"/>';
      s += '<text class="ch-ax" x="' + (PADL - 6) + '" y="' + (y + 3) + '" text-anchor="end">' +
        (log ? val.toExponential(0) : val.toFixed(2)) + '</text>';
    });
    [xmin, (xmin + xmax) / 2, xmax].forEach(function (v) {
      s += '<text class="ch-ax" x="' + fx(v) + '" y="' + (H - PADB + 15) + '" text-anchor="middle">' +
        Math.round(v) + '</text>';
    });
    series.forEach(function (ser, i) {
      var d = ser.pts.map(function (p, j) { return (j ? 'L' : 'M') + fx(p.x) + ' ' + fy(p.y); }).join(' ');
      s += '<path class="ch-line ch-line--' + i + '" d="' + d + '"/>';
    });
    s += '<text class="ch-ax" x="' + (W / 2) + '" y="' + (H - 2) + '" text-anchor="middle">' +
      (opts.xlabel || '') + '</text>';
    return s + '</svg>';
  }

  function kpi(label, value, note) {
    return '<div class="sim-kpi"><p class="sim-kpi__k">' + esc(label) + '</p>' +
      '<p class="sim-kpi__v">' + esc(value) + '</p>' +
      (note ? '<p class="sim-kpi__n">' + esc(note) + '</p>' : '') + '</div>';
  }

  /* ── simulation ────────────────────────────────────────── */
  function chainFromNet() {
    var totalKm = app.net.links.reduce(function (a, l) { return a + l.km; }, 0);
    var segments = app.net.links.length || 1;
    if (!app.net.links.length) totalKm = app.params.span;
    return QNet.chainMetrics(totalKm, segments, app.params.memoryT2,
      app.params.srcFidelity, app.params.swapQuality);
  }

  function simulate() {
    if (app.mode === 'circuit') return simCircuit();
    if (app.mode === 'network') return simNetwork();
    return simDistributed();
  }

  function simCircuit() {
    if (!app.circuit.ops.length) {
      results.innerHTML = '<p class="sim-empty">Drop a gate onto a wire to run the simulation.</p>';
      return;
    }
    var r = QSim.simulateCircuit(app.circuit, { noise: app.params.noise, trajectories: 140 });
    var n = app.circuit.qubits;
    var labels = [], vals = [];
    for (var i = 0; i < (1 << n); i++) {
      labels.push(i.toString(2).padStart(n, '0'));
      vals.push(r.probs[i]);
    }
    var maxEnt = Math.max.apply(null, r.entropy);
    var html = '<div class="sim-kpis">';
    html += kpi('Qubits', n, 'state dimension ' + (1 << n));
    html += kpi('Depth', r.depth, r.gates + ' gates, ' + r.twoQubit + ' two-qubit');
    html += kpi('Entanglement', fmt(maxEnt, 3) + ' ebit', maxEnt > 0.01 ? 'qubits are correlated' : 'product state');
    html += kpi('State fidelity', app.params.noise > 0 ? fmt(r.fidelity, 4) : '1.0000',
      app.params.noise > 0 ? 'against the noiseless run' : 'noise disabled');
    html += '</div>';
    html += '<div class="sim-plot"><p class="sim-plot__h">Measurement probability by basis state</p>' +
      barChart(vals, labels, { aria: 'Measurement outcome probabilities' }) + '</div>';

    var bz = r.bloch.map(function (b, q) { return { x: q, y: b.z }; });
    html += '<div class="sim-plot"><p class="sim-plot__h">Per-qubit ⟨Z⟩ and entanglement</p>' +
      barChart(r.entropy, r.entropy.map(function (_, q) { return 'q' + q; }),
        { aria: 'Entanglement entropy per qubit' }) +
      '<p class="sim-plot__n">Entropy of each qubit against the rest. Zero means separable, ' +
      '1.0 ebit means maximally entangled.</p></div>';
    results.innerHTML = html;
  }

  function simNetwork() {
    if (app.net.links.length < 1) {
      results.innerHTML = '<p class="sim-empty">Place at least two nodes and connect them to see results.</p>';
      return;
    }
    var m = chainFromNet();
    var totalKm = app.net.links.reduce(function (a, l) { return a + l.km; }, 0);
    var sw = QNet.sweep(Math.max(totalKm * 1.6, 80), m.segments, app.params.memoryT2,
      app.params.srcFidelity, app.params.swapQuality, 44);

    var html = '<div class="sim-kpis">';
    html += kpi('Entanglement rate', sci(m.rate, 'ebit/s'), m.segments + ' segments over ' + Math.round(totalKm) + ' km');
    html += kpi('End-to-end fidelity', fmt(m.fidelity, 4), m.fidelity > 0.5 ? 'usable' : 'below the entanglement threshold');
    html += kpi('QBER', (m.qber * 100).toFixed(2) + ' %', m.qber < 0.11 ? 'under the BB84 limit' : 'above the 11 % limit');
    html += kpi('Secret key rate', sci(m.keyRate, 'bit/s'), m.keyRate > 0 ? 'positive' : 'no key extractable');
    html += kpi('One-way latency', (m.latency * 1000).toFixed(2) + ' ms', 'fibre at 200 000 km/s');
    html += kpi('Per-segment', Math.round(m.segmentKm) + ' km', 'link fidelity ' + fmt(m.linkFidelity, 4));
    html += '</div>';

    html += '<div class="sim-plot"><p class="sim-plot__h">Fidelity against total distance</p>' +
      lineChart([{ pts: sw.map(function (p) { return { x: p.km, y: p.fidelity }; }) }],
        { xlabel: 'distance (km)', aria: 'Fidelity versus distance' }) + '</div>';

    html += '<div class="sim-plot"><p class="sim-plot__h">Entanglement and key rate against distance (log scale)</p>' +
      lineChart([
        { pts: sw.map(function (p) { return { x: p.km, y: Math.max(p.rate, 1e-6) }; }) },
        { pts: sw.map(function (p) { return { x: p.km, y: Math.max(p.keyRate, 1e-6) }; }) }
      ], { log: true, xlabel: 'distance (km)', aria: 'Rate versus distance' }) +
      '<p class="sim-plot__n"><span class="ch-key ch-key--0"></span>raw entanglement rate ' +
      '<span class="ch-key ch-key--1"></span>secret key rate. Loss is exponential in fibre length, ' +
      'which is why adding repeater segments beats extending one link.</p></div>';
    results.innerHTML = html;
  }

  function simDistributed() {
    var qpus = app.net.nodes.filter(function (n) { return n.kind === 'qpu'; });
    if (qpus.length < 2 || app.net.links.length < 1) {
      results.innerHTML = '<p class="sim-empty">Place two or more QPU nodes, connect them, ' +
        'then build a circuit in Circuit mode to distribute across them.</p>';
      return;
    }
    if (!app.circuit.ops.length) {
      results.innerHTML = '<p class="sim-empty">The network is ready. Switch to Circuit mode and ' +
        'build a circuit — its two-qubit gates will be partitioned across these nodes.</p>';
      return;
    }

    /* Split circuit qubits across QPUs in order, respecting capacity. */
    var owner = [], qi = 0;
    qpus.forEach(function (n, idx) {
      for (var c = 0; c < n.qubits && qi < app.circuit.qubits; c++, qi++) owner[qi] = idx;
    });
    for (; qi < app.circuit.qubits; qi++) owner[qi] = qpus.length - 1;

    var cross = 0, local = 0;
    app.circuit.ops.forEach(function (o) {
      if (o.control === undefined) { local++; return; }
      if (owner[o.q] !== owner[o.control]) cross++; else local++;
    });

    var net = chainFromNet();
    var d = QNet.distributedMetrics(cross, local, net);
    var r = QSim.simulateCircuit(app.circuit, { noise: app.params.noise });

    var html = '<div class="sim-kpis">';
    html += kpi('Cross-node gates', cross, 'of ' + app.circuit.ops.length + ' total');
    html += kpi('Entangled pairs', d.ebits + ' ebit', 'one consumed per teleported gate');
    html += kpi('Classical bits', d.classicalBits, 'two per teleported gate');
    html += kpi('Distribution time', isFinite(d.timeS) ? sci(d.timeS, 's') : '∞',
      'at ' + sci(net.rate, 'ebit/s'));
    html += kpi('Circuit fidelity', fmt(d.fidelity, 4), 'link fidelity ' + fmt(net.fidelity, 3) + ' per pair');
    html += kpi('Partition', qpus.length + ' nodes', app.circuit.qubits + ' qubits assigned');
    html += '</div>';

    var counts = [];
    var names = [];
    qpus.forEach(function (n, idx) {
      names.push(n.label);
      counts.push(owner.filter(function (o) { return o === idx; }).length);
    });
    html += '<div class="sim-plot"><p class="sim-plot__h">Qubits per node</p>' +
      barChart(counts, names, { aria: 'Qubit allocation per node' }) + '</div>';

    var sweepPts = [];
    for (var g = 1; g <= 24; g++) {
      sweepPts.push({ x: g, y: Math.pow(net.fidelity, g) });
    }
    html += '<div class="sim-plot"><p class="sim-plot__h">Fidelity against number of teleported gates</p>' +
      lineChart([{ pts: sweepPts }], { xlabel: 'cross-node gates', aria: 'Fidelity versus teleported gate count' }) +
      '<p class="sim-plot__n">Each teleported gate multiplies in the link fidelity. Partitioning the ' +
      'circuit to minimise cross-node gates matters more than raw link quality.</p></div>';
    results.innerHTML = html;
  }

  /* ── palette definition ────────────────────────────────── */
  var PALETTE = {
    circuit: [
      { group: 'Single-qubit', items: [
        { type: 'H', label: 'H', family: 'gate', desc: 'Hadamard — superposition' },
        { type: 'X', label: 'X', family: 'gate', desc: 'Pauli X — bit flip' },
        { type: 'Y', label: 'Y', family: 'gate', desc: 'Pauli Y' },
        { type: 'Z', label: 'Z', family: 'gate', desc: 'Pauli Z — phase flip' },
        { type: 'S', label: 'S', family: 'gate', desc: 'Phase gate, π/2' },
        { type: 'T', label: 'T', family: 'gate', desc: 'π/4 phase gate' }
      ]},
      { group: 'Rotations', items: [
        { type: 'RX', label: 'RX', family: 'gate', desc: 'Rotation about X, adjustable θ' },
        { type: 'RY', label: 'RY', family: 'gate', desc: 'Rotation about Y, adjustable θ' },
        { type: 'RZ', label: 'RZ', family: 'gate', desc: 'Rotation about Z, adjustable θ' }
      ]},
      { group: 'Two-qubit', items: [
        { type: 'CNOT', label: 'CNOT', family: 'gate', desc: 'Controlled NOT — creates entanglement' },
        { type: 'CZ', label: 'CZ', family: 'gate', desc: 'Controlled phase' },
        { type: 'SWAP', label: 'SWAP', family: 'gate', desc: 'Exchange two qubits' }
      ]}
    ],
    network: [
      { group: 'Nodes', items: [
        { type: 'endpoint', label: 'End node', short: 'N', family: 'node', desc: 'Terminates entanglement, holds one memory' },
        { type: 'repeater', label: 'Repeater', short: 'R', family: 'node', desc: 'Swaps entanglement between two segments' },
        { type: 'qpu', label: 'QPU node', short: 'Q', family: 'node', desc: 'Processor with local qubits' }
      ]}
    ]
  };
  PALETTE.distributed = PALETTE.network;

  function buildPalette() {
    var host = document.getElementById('palette');
    clear2(host);
    var groups = PALETTE[app.mode];
    groups.forEach(function (grp) {
      var h = document.createElement('div');
      h.className = 'sim-pgroup';
      h.innerHTML = '<p class="sim-pgroup__h">' + esc(grp.group) + '</p>';
      var wrap = document.createElement('div');
      wrap.className = 'sim-pitems';
      grp.items.forEach(function (it) {
        var b = document.createElement('button');
        b.className = 'sim-pitem' + (it.family === 'node' ? ' is-node' : '');
        b.type = 'button';
        b.innerHTML = '<span class="sim-pitem__l">' + esc(it.label) + '</span>' +
          '<span class="sim-pitem__d">' + esc(it.desc) + '</span>';
        b.addEventListener('pointerdown', function (e) { startPaletteDrag(e, it); });
        b.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            place(it, { x: COL_X + 2 * COL_W, y: WIRE_Y + WIRE_H });
            simulate();
          }
        });
        wrap.appendChild(b);
      });
      h.appendChild(wrap);
      host.appendChild(h);
    });
  }

  /* ── mode switching and controls ───────────────────────── */
  function setMode(m) {
    app.mode = m;
    app.selected = null;
    setLinking(false);
    [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === m));
    });
    document.getElementById('ctl-circuit').hidden = m !== 'circuit';
    document.getElementById('ctl-net').hidden = m === 'circuit';
    document.getElementById('btn-link').hidden = m === 'circuit';
    hint.textContent = defaultHint();
    buildPalette();
    render();
    simulate();
  }

  [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });
  document.getElementById('btn-link').addEventListener('click', function () { setLinking(!app.linking); });
  document.getElementById('btn-clear').addEventListener('click', function () {
    if (app.mode === 'circuit') app.circuit.ops = [];
    else { app.net.nodes = []; app.net.links = []; }
    app.selected = null; render(); simulate();
  });
  document.getElementById('btn-fit').addEventListener('click', function () {
    app.view = { x: 0, y: 0, k: 1 }; applyView();
  });
  document.getElementById('btn-in').addEventListener('click', function () {
    var r = frame.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
  });
  document.getElementById('btn-out').addEventListener('click', function () {
    var r = frame.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
  });

  var qbits = document.getElementById('qubits');
  qbits.addEventListener('input', function () {
    app.circuit.qubits = +qbits.value;
    document.getElementById('qubits-v').textContent = qbits.value;
    app.circuit.ops = app.circuit.ops.filter(function (o) {
      return o.q < app.circuit.qubits && (o.control === undefined || o.control < app.circuit.qubits);
    });
    render(); simulate();
  });
  var noise = document.getElementById('noise');
  noise.addEventListener('input', function () {
    app.params.noise = +noise.value / 100;
    document.getElementById('noise-v').textContent = (+noise.value).toFixed(1) + ' %';
    simulate();
  });
  var mem = document.getElementById('memory');
  mem.addEventListener('input', function () {
    app.params.memoryT2 = +mem.value / 1000;
    document.getElementById('memory-v').textContent = mem.value + ' ms';
    simulate();
  });
  var srcf = document.getElementById('srcfid');
  srcf.addEventListener('input', function () {
    app.params.srcFidelity = +srcf.value / 1000;
    document.getElementById('srcfid-v').textContent = app.params.srcFidelity.toFixed(3);
    simulate();
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.selected) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      var d = document.getElementById('del');
      if (d) d.click();
    }
    if (e.key === 'Escape') { app.selected = null; setLinking(false); render(); }
  });

  /* ── presets ───────────────────────────────────────────── */
  function loadBell() {
    app.circuit.qubits = 4; qbits.value = 4;
    document.getElementById('qubits-v').textContent = 4;
    app.circuit.ops = [
      { id: ++uid, type: 'H', q: 0, col: 0 },
      { id: ++uid, type: 'CNOT', q: 1, control: 0, col: 1 },
      { id: ++uid, type: 'CNOT', q: 2, control: 1, col: 2 },
      { id: ++uid, type: 'CNOT', q: 3, control: 2, col: 3 }
    ];
  }
  function loadNet() {
    var y = 220;
    app.net.nodes = [
      { id: ++uid, kind: 'qpu', x: 200, y: y, label: 'Q1', qubits: 2 },
      { id: ++uid, kind: 'repeater', x: 470, y: y, label: 'R1', qubits: 1 },
      { id: ++uid, kind: 'qpu', x: 740, y: y, label: 'Q2', qubits: 2 }
    ];
    app.net.links = [
      { id: ++uid, a: app.net.nodes[0].id, b: app.net.nodes[1].id, km: 50 },
      { id: ++uid, a: app.net.nodes[1].id, b: app.net.nodes[2].id, km: 50 }
    ];
  }

  document.getElementById('btn-demo').addEventListener('click', function () {
    if (app.mode === 'circuit') loadBell(); else loadNet();
    app.selected = null; render(); simulate();
  });

  /* ── send this setup to us ─────────────────────────────
     Serialises the canvas into a readable brief plus a JSON
     blob, so the setup can be reconstructed exactly.
     ─────────────────────────────────────────────────────── */
  function describeCircuit() {
    if (!app.circuit.ops.length) return 'No circuit built.\n';
    var out = app.circuit.qubits + ' qubits, ' + app.circuit.ops.length + ' gates\n';
    app.circuit.ops.slice().sort(function (a, b) { return a.col - b.col || a.q - b.q; })
      .forEach(function (o) {
        var line = '  col ' + String(o.col).padStart(2) + '  ' + o.type.padEnd(5);
        if (o.control !== undefined) line += ' control q' + o.control + ' -> target q' + o.q;
        else line += ' q' + o.q;
        if (o.theta !== undefined) line += '  theta = ' + (o.theta / Math.PI).toFixed(3) + ' pi';
        out += line + '\n';
      });
    out += 'Gate noise: ' + (app.params.noise * 100).toFixed(1) + ' %\n';
    return out;
  }

  function describeNetwork() {
    if (!app.net.nodes.length) return 'No network built.\n';
    var out = 'Nodes:\n';
    app.net.nodes.forEach(function (n) {
      out += '  ' + n.label + '  ' + n.kind + (n.kind === 'qpu' ? ', ' + n.qubits + ' qubits' : '') + '\n';
    });
    if (app.net.links.length) {
      out += 'Links:\n';
      app.net.links.forEach(function (l) {
        var a = findNode(l.a), b = findNode(l.b);
        if (a && b) out += '  ' + a.label + ' -- ' + b.label + '  ' + l.km + ' km\n';
      });
      var total = app.net.links.reduce(function (s, l) { return s + l.km; }, 0);
      out += 'Total span: ' + total + ' km over ' + app.net.links.length + ' segments\n';
    }
    out += 'Memory T2: ' + (app.params.memoryT2 * 1000).toFixed(0) + ' ms, ' +
      'source fidelity: ' + app.params.srcFidelity.toFixed(3) + '\n';
    return out;
  }

  function describeResults() {
    var out = '';
    if (app.circuit.ops.length) {
      var r = QSim.simulateCircuit(app.circuit, { noise: app.params.noise });
      out += 'Circuit: depth ' + r.depth + ', ' + r.twoQubit + ' two-qubit gates, ' +
        'max entanglement ' + Math.max.apply(null, r.entropy).toFixed(3) + ' ebit';
      if (app.params.noise > 0) out += ', state fidelity ' + r.fidelity.toFixed(4);
      out += '\n';
    }
    if (app.net.links.length) {
      var m = chainFromNet();
      out += 'Network: ' + m.rate.toPrecision(4) + ' ebit/s, fidelity ' + m.fidelity.toFixed(4) +
        ', QBER ' + (m.qber * 100).toFixed(2) + ' %, secret key ' + m.keyRate.toPrecision(4) + ' bit/s\n';
      var qpus = app.net.nodes.filter(function (n) { return n.kind === 'qpu'; });
      if (qpus.length >= 2 && app.circuit.ops.length) {
        var owner = [], qi = 0;
        qpus.forEach(function (n, idx) {
          for (var c = 0; c < n.qubits && qi < app.circuit.qubits; c++, qi++) owner[qi] = idx;
        });
        for (; qi < app.circuit.qubits; qi++) owner[qi] = qpus.length - 1;
        var cross = app.circuit.ops.filter(function (o) {
          return o.control !== undefined && owner[o.q] !== owner[o.control];
        }).length;
        var d = QNet.distributedMetrics(cross, 0, m);
        out += 'Distributed: ' + cross + ' cross-node gates, ' + d.ebits + ' ebits, ' +
          'circuit fidelity ' + d.fidelity.toFixed(4) + '\n';
      }
    }
    return out || 'Nothing built yet.\n';
  }

  function buildBrief(withJson) {
    var b = 'I built this in the Qryptonics simulator and would like it modelled properly.\n\n';
    b += '--- WHAT I BUILT ---\n';
    b += 'Mode: ' + app.mode + '\n\n';
    b += 'CIRCUIT\n' + describeCircuit() + '\n';
    b += 'NETWORK\n' + describeNetwork() + '\n';
    b += '--- RESULTS THE SIMULATOR GAVE ---\n' + describeResults() + '\n';
    b += '--- WHAT I ACTUALLY WANT TO KNOW ---\n(your question here)\n';
    if (withJson) {
      b += '\n--- MACHINE READABLE ---\n' + JSON.stringify({
        mode: app.mode, circuit: app.circuit,
        net: { nodes: app.net.nodes, links: app.net.links },
        params: app.params
      });
    }
    return b;
  }

  /* mailto URLs get truncated or dropped by several clients past
     roughly 2000 characters, so the mail draft carries the readable
     summary and the full setup goes to the clipboard. */
  var MAILTO_LIMIT = 1800;

  document.getElementById('btn-send').addEventListener('click', function () {
    var subject = 'Simulator setup — ' + app.mode +
      (app.net.links.length ? ' — ' + app.net.links.reduce(function (s, l) { return s + l.km; }, 0) + ' km' : '') +
      (app.circuit.ops.length ? ' — ' + app.circuit.qubits + ' qubits' : '');

    var full = buildBrief(true);
    var short = buildBrief(false);
    var href = 'mailto:hello@qryptonics.com?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(short);
    if (href.length > MAILTO_LIMIT) {
      short = short.slice(0, 900) + '\n\n[full setup is on your clipboard — paste it below]\n';
      href = 'mailto:hello@qryptonics.com?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(short);
    }

    function tell(msg) {
      hint.textContent = msg;
      clearTimeout(flash._t);
      flash._t = setTimeout(function () { hint.textContent = defaultHint(); }, 5000);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(function () {
        tell('Setup copied to your clipboard and drafted in your mail app. Paste it into the email.');
      }, function () {
        tell('Mail draft opened. Clipboard was blocked, so describe the setup in your own words.');
      });
    } else {
      tell('Mail draft opened.');
    }
    window.location.href = href;
  });

  /* ── boot ──────────────────────────────────────────────── */
  loadBell();
  loadNet();
  applyView();
  buildPalette();
  setMode('circuit');
})();
