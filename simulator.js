/* ══════════════════════════════════════════════════════════
   Qryptonics — simulator workbench

   Three modes on one infinite sheet. Distributed is the merger:
   each QPU holds its own circuit, the network routes entanglement
   between them, and every gate that crosses a QPU boundary is
   priced in entangled pairs, latency and fidelity.

   Every control recomputes live on a short debounce, so the KPIs
   and plots move while a slider is being dragged.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var svg = document.getElementById('sheet');
  if (!svg) return;

  var scene = document.getElementById('scene');
  var layerWires = document.getElementById('layer-wires');
  var layerItems = document.getElementById('layer-items');
  var frame = document.getElementById('frame');
  var results = document.getElementById('results');
  var inspector = document.getElementById('inspector');
  var hint = document.getElementById('hint');
  var context = document.getElementById('context');

  var COL_X = 150, COL_W = 74, WIRE_Y = 90, WIRE_H = 74;
  var uid = 0;

  var app = {
    mode: 'circuit',
    view: { x: 0, y: 0, k: 1 },
    circuit: { qubits: 4, ops: [] },
    net: { nodes: [], links: [], cuts: [] },
    params: {},
    selected: null,
    connectFrom: null,
    linking: false,
    cutting: false,
    editingQpu: null
  };

  var TWO_Q = { CNOT: 1, CZ: 1, SWAP: 1 };
  var PARAM = { RX: 1, RY: 1, RZ: 1, P: 1 };

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, attrs, parent) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function fmt(v, d) {
    if (!isFinite(v)) return '∞';
    if (v === 0) return '0';
    return (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3)
      ? v.toExponential(d == null ? 2 : d) : v.toFixed(d == null ? 2 : d);
  }
  function sci(v, unit) {
    if (!isFinite(v)) return '∞';
    if (v === 0) return '0 ' + unit;
    if (v < 1) return v.toExponential(2) + ' ' + unit;
    var u = ['', 'k', 'M', 'G'], i = 0, x = v;
    while (x >= 1000 && i < 3) { x /= 1000; i++; }
    return x.toFixed(x < 10 ? 2 : 1) + ' ' + u[i] + unit;
  }

  /* ── the circuit currently on the canvas ───────────────── */
  function activeCircuit() {
    if (app.mode === 'distributed' && app.editingQpu != null) {
      var n = findNode(app.editingQpu);
      if (n) return n;
    }
    return app.circuit;
  }

  /* ── parameters ────────────────────────────────────────── */
  function num(id) { var e = document.getElementById(id); return e ? +e.value : 0; }

  function readParams() {
    app.params = {
      T1: num('t1'), T2: num('t2'),
      gate1ns: num('g1'), gate2ns: num('g2'),
      depol1: num('d1') / 10000, depol2: num('d2') / 10000,
      readout: num('ro') / 1000, shots: num('shots'), seed: 12345,
      memoryT2: num('memory') / 1000,
      srcFidelity: num('srcfid') / 1000,
      detEff: num('deteff') / 100,
      darkRate: num('dark'),
      multiplex: num('mux'),
      swapSuccess: num('swapp') / 100,
      swapQuality: num('swapq') / 1000,
      sourceRate: 1e7, gateWindow: 1e-9
    };
    var set = function (id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; };
    set('qubits-v', num('qubits'));
    set('t1-v', app.params.T1 ? app.params.T1 + ' µs' : 'off');
    set('t2-v', app.params.T2 ? app.params.T2 + ' µs' : 'off');
    set('g1-v', app.params.gate1ns + ' ns');
    set('g2-v', app.params.gate2ns + ' ns');
    set('d1-v', (app.params.depol1 * 100).toFixed(2) + ' %');
    set('d2-v', (app.params.depol2 * 100).toFixed(2) + ' %');
    set('ro-v', (app.params.readout * 100).toFixed(1) + ' %');
    set('shots-v', app.params.shots ? app.params.shots : 'exact');
    set('memory-v', num('memory') + ' ms');
    set('srcfid-v', app.params.srcFidelity.toFixed(3));
    set('deteff-v', app.params.detEff.toFixed(2));
    set('dark-v', app.params.darkRate + ' /s');
    set('mux-v', app.params.multiplex);
    set('swapp-v', app.params.swapSuccess.toFixed(2));
    set('swapq-v', app.params.swapQuality.toFixed(3));
  }

  /* Live recompute. Short enough to feel immediate, long enough
     that dragging a slider does not queue a hundred density
     matrices. */
  var pending = null;
  function live() {
    clearTimeout(pending);
    pending = setTimeout(function () { readParams(); simulate(); }, 90);
  }

  /* ── palette drag ──────────────────────────────────────── */
  var ghost = null, dragKind = null;

  function startDrag(e, kind) {
    if (e.button != null && e.button !== 0) return;
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
    if (dragKind && e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom) {
      place(dragKind, toSheet(e.clientX, e.clientY));
    }
    dragKind = null;
  }

  function toSheet(cx, cy) {
    var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    var vx = (cx - r.left) * (vb.width / r.width) + vb.x;
    var vy = (cy - r.top) * (vb.height / r.height) + vb.y;
    return { x: (vx - app.view.x) / app.view.k, y: (vy - app.view.y) / app.view.k };
  }
  function applyView() {
    scene.setAttribute('transform',
      'translate(' + app.view.x + ',' + app.view.y + ') scale(' + app.view.k + ')');
  }

  function place(kind, pt) {
    if (kind.family === 'gate') {
      var c = activeCircuit();
      if (app.mode === 'network' || (app.mode === 'distributed' && app.editingQpu == null)) {
        flash('Open a QPU first, then drop gates into its circuit.'); return;
      }
      var q = Math.max(0, Math.min(c.qubits - 1, Math.round((pt.y - WIRE_Y) / WIRE_H)));
      var col = Math.max(0, Math.round((pt.x - COL_X) / COL_W));
      var op = { id: ++uid, type: kind.type, q: q, col: col };
      if (PARAM[kind.type]) op.theta = Math.PI / 2;
      if (TWO_Q[kind.type]) {
        if (c.qubits < 2) { flash('Two-qubit gates need at least two wires.'); return; }
        op.control = q; op.q = (q + 1) % c.qubits;
      }
      while (occupied(c, col, op.q) || (op.control != null && occupied(c, col, op.control))) col++;
      op.col = col;
      c.ops.push(op);
      app.selected = { type: 'op', id: op.id };
    } else {
      if (app.mode === 'circuit') { flash('Switch to Network or Distributed to place nodes.'); return; }
      app.net.nodes.push({
        id: ++uid, kind: kind.type, x: pt.x, y: pt.y,
        label: kind.short + (app.net.nodes.filter(function (n) { return n.kind === kind.type; }).length + 1),
        qubits: kind.type === 'qpu' ? 2 : 1,
        ops: []
      });
      app.selected = { type: 'node', id: uid };
    }
    render(); simulate();
  }

  function occupied(c, col, q) {
    return c.ops.some(function (o) { return o.col === col && (o.q === q || o.control === q); });
  }

  function flash(msg) {
    hint.textContent = msg;
    hint.classList.add('is-warn');
    clearTimeout(flash._t);
    flash._t = setTimeout(function () {
      hint.classList.remove('is-warn'); hint.textContent = defaultHint();
    }, 2800);
  }
  function defaultHint() {
    if (app.mode === 'circuit') return 'Drag gates onto the wires. Drag a placed gate to move it.';
    if (app.mode === 'network') return 'Drop nodes, then Lay fibre to connect them.';
    if (app.editingQpu != null) return 'Editing this QPU’s circuit. Back to network when done.';
    return 'Drop QPUs and repeaters. Lay fibre between them, then add cross-QPU gates.';
  }
  function setContext() {
    if (!context) return;
    if (app.mode === 'distributed' && app.editingQpu != null) {
      var n = findNode(app.editingQpu);
      context.textContent = 'Editing circuit inside ' + (n ? n.label : '') +
        ' · ' + (n ? n.qubits : 0) + ' qubits · ' + (n ? n.ops.length : 0) + ' gates';
      context.hidden = false;
    } else if (app.mode === 'distributed') {
      var q = app.net.nodes.filter(function (x) { return x.kind === 'qpu'; }).length;
      context.textContent = q + ' QPUs · ' + app.net.links.length + ' fibre links · ' +
        app.net.cuts.length + ' cross-QPU gates';
      context.hidden = false;
    } else { context.hidden = true; }
  }

  /* ── canvas interaction ────────────────────────────────── */
  var panning = null, moving = null;

  svg.addEventListener('pointerdown', function (e) {
    var t = e.target.closest('[data-item]');
    if (t) {
      var id = +t.getAttribute('data-item');
      var fam = t.getAttribute('data-family');
      if ((app.linking || app.cutting) && fam === 'node') { pickNode(id); return; }
      app.selected = { type: fam === 'node' ? 'node' : 'op', id: id };
      moving = { id: id, family: fam };
      svg.setPointerCapture(e.pointerId);
      render();
      return;
    }
    if (app.linking || app.cutting) { app.connectFrom = null; setLinking(false); setCutting(false); return; }
    app.selected = null;
    panning = { x: e.clientX, y: e.clientY, vx: app.view.x, vy: app.view.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('is-panning');
    render();
  });

  svg.addEventListener('pointermove', function (e) {
    if (moving) {
      var pt = toSheet(e.clientX, e.clientY);
      if (moving.family === 'node') {
        var n = findNode(moving.id);
        if (n) { n.x = pt.x; n.y = pt.y; render(); }
      } else {
        var c = activeCircuit();
        var op = c.ops.filter(function (o) { return o.id === moving.id; })[0];
        if (!op) return;
        var q = Math.max(0, Math.min(c.qubits - 1, Math.round((pt.y - WIRE_Y) / WIRE_H)));
        if (TWO_Q[op.type]) {
          var span = op.q - op.control;
          op.control = q;
          op.q = Math.max(0, Math.min(c.qubits - 1, q + span));
          if (op.q === op.control) op.q = (op.control + 1) % c.qubits;
        } else op.q = q;
        op.col = Math.max(0, Math.round((pt.x - COL_X) / COL_W));
        render();
      }
      return;
    }
    if (panning) {
      var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      app.view.x = panning.vx + (e.clientX - panning.x) * (vb.width / r.width);
      app.view.y = panning.vy + (e.clientY - panning.y) * (vb.height / r.height);
      applyView();
    }
  });

  function endPointer(e) {
    if (moving) { moving = null; simulate(); }
    if (panning) { panning = null; svg.classList.remove('is-panning'); }
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  function zoomAt(cx, cy, f) {
    var a = toSheet(cx, cy);
    app.view.k = Math.max(0.35, Math.min(2.6, app.view.k * f));
    var b = toSheet(cx, cy);
    app.view.x += (b.x - a.x) * app.view.k;
    app.view.y += (b.y - a.y) * app.view.k;
    applyView();
  }

  /* ── linking and cuts ──────────────────────────────────── */
  function setLinking(on) {
    app.linking = on;
    document.getElementById('btn-link').setAttribute('aria-pressed', String(on));
    frame.classList.toggle('is-linking', on);
    if (on) setCutting(false); else app.connectFrom = null;
    hint.textContent = on ? 'Click two nodes to lay fibre between them.' : defaultHint();
    render();
  }
  function setCutting(on) {
    app.cutting = on;
    var b = document.getElementById('btn-cut');
    if (b) b.setAttribute('aria-pressed', String(on));
    frame.classList.toggle('is-cutting', on);
    if (on) setLinking(false); else app.connectFrom = null;
    hint.textContent = on ? 'Click two QPUs to add a gate that spans them.' : defaultHint();
    render();
  }
  function pickNode(id) {
    if (app.connectFrom == null) { app.connectFrom = id; render(); return; }
    if (app.connectFrom === id) { app.connectFrom = null; render(); return; }
    var a = app.connectFrom, b = id;
    if (app.linking) {
      var dup = app.net.links.some(function (l) {
        return (l.a === a && l.b === b) || (l.a === b && l.b === a);
      });
      if (!dup) {
        var na = findNode(a), nb = findNode(b);
        app.net.links.push({ id: ++uid, a: a, b: b, km: Math.max(5, Math.round(Math.hypot(na.x-nb.x, na.y-nb.y) / 4)) });
      }
    } else if (app.cutting) {
      var na2 = findNode(a), nb2 = findNode(b);
      if (na2.kind !== 'qpu' || nb2.kind !== 'qpu') flash('Cross-QPU gates connect two QPUs.');
      else app.net.cuts.push({ id: ++uid, a: a, b: b });
    }
    app.connectFrom = null;
    render(); simulate();
  }
  function findNode(id) { return app.net.nodes.filter(function (n) { return n.id === id; })[0]; }

  /* ── rendering ─────────────────────────────────────────── */
  function render() {
    clear(layerWires); clear(layerItems);
    if (app.mode === 'circuit' || (app.mode === 'distributed' && app.editingQpu != null)) renderCircuit();
    else renderNetwork();
    renderInspector();
    setContext();
    var back = document.getElementById('btn-back');
    if (back) back.hidden = !(app.mode === 'distributed' && app.editingQpu != null);
  }

  function renderCircuit() {
    var c = activeCircuit();
    var maxCol = c.ops.reduce(function (m, o) { return Math.max(m, o.col); }, 6);
    var width = COL_X + (maxCol + 3) * COL_W;

    for (var q = 0; q < c.qubits; q++) {
      var y = WIRE_Y + q * WIRE_H;
      el('line', { class: 'sim-wire', x1: 80, y1: y, x2: width, y2: y }, layerWires);
      el('text', { class: 'sim-qlabel', x: 46, y: y + 4 }, layerWires).textContent = 'q' + q;
      el('text', { class: 'sim-ket', x: 62, y: y + 4 }, layerWires).textContent = '|0⟩';
    }

    c.ops.forEach(function (op) {
      var x = COL_X + op.col * COL_W, y = WIRE_Y + op.q * WIRE_H;
      var sel = app.selected && app.selected.type === 'op' && app.selected.id === op.id;
      var g = el('g', {
        class: 'sim-op' + (sel ? ' is-sel' : '') + (PARAM[op.type] ? ' is-param' : ''),
        'data-item': op.id, 'data-family': 'op'
      }, layerItems);

      if (TWO_Q[op.type]) {
        var cy = WIRE_Y + op.control * WIRE_H;
        el('line', { class: 'sim-link', x1: x, y1: cy, x2: x, y2: y }, g);
        el('circle', { class: 'sim-ctrl', cx: x, cy: cy, r: 5 }, g);
        if (op.type === 'CNOT') {
          el('circle', { class: 'sim-targ', cx: x, cy: y, r: 12 }, g);
          el('line', { class: 'sim-link', x1: x-12, y1: y, x2: x+12, y2: y }, g);
          el('line', { class: 'sim-link', x1: x, y1: y-12, x2: x, y2: y+12 }, g);
        } else if (op.type === 'CZ') {
          el('circle', { class: 'sim-ctrl', cx: x, cy: y, r: 5 }, g);
        } else {
          [[x, cy], [x, y]].forEach(function (p) {
            el('line', { class: 'sim-link', x1: p[0]-7, y1: p[1]-7, x2: p[0]+7, y2: p[1]+7 }, g);
            el('line', { class: 'sim-link', x1: p[0]+7, y1: p[1]-7, x2: p[0]-7, y2: p[1]+7 }, g);
          });
        }
        el('rect', { class: 'sim-hit', x: x-16, y: Math.min(y, cy)-16,
                     width: 32, height: Math.abs(y-cy)+32 }, g);
      } else {
        el('rect', { class: 'sim-box', x: x-21, y: y-18, width: 42, height: 36, rx: 4 }, g);
        el('text', { class: 'sim-glabel', x: x, y: y+1 }, g).textContent = op.type;
        if (PARAM[op.type]) {
          el('text', { class: 'sim-theta', x: x, y: y+27 }, g)
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
      var mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
      el('rect', { class: 'sim-kmbg', x: mx-26, y: my-11, width: 52, height: 20, rx: 3 }, layerWires);
      el('text', { class: 'sim-km', x: mx, y: my+3 }, layerWires).textContent = l.km + ' km';
    });

    /* Cross-QPU gates drawn as a distinct arc, since they are logical
       rather than physical connections. */
    app.net.cuts.forEach(function (cut) {
      var a = findNode(cut.a), b = findNode(cut.b);
      if (!a || !b) return;
      var mx = (a.x+b.x)/2, my = (a.y+b.y)/2 - 46;
      el('path', { class: 'sim-cut', d: 'M' + a.x + ' ' + a.y + ' Q' + mx + ' ' + my + ' ' + b.x + ' ' + b.y },
         layerWires);
    });

    app.net.nodes.forEach(function (n) {
      var sel = app.selected && app.selected.type === 'node' && app.selected.id === n.id;
      var pend = app.connectFrom === n.id;
      var g = el('g', {
        class: 'sim-node is-' + n.kind + (sel ? ' is-sel' : '') + (pend ? ' is-pending' : ''),
        'data-item': n.id, 'data-family': 'node'
      }, layerItems);
      if (n.kind === 'repeater') el('rect', { class: 'sim-nbody', x: n.x-26, y: n.y-20, width: 52, height: 40, rx: 5 }, g);
      else if (n.kind === 'qpu') el('rect', { class: 'sim-nbody', x: n.x-34, y: n.y-27, width: 68, height: 54, rx: 6 }, g);
      else el('circle', { class: 'sim-nbody', cx: n.x, cy: n.y, r: 24 }, g);
      el('text', { class: 'sim-nlabel', x: n.x, y: n.y-3 }, g).textContent = n.label;
      if (n.kind === 'qpu') {
        el('text', { class: 'sim-nsub', x: n.x, y: n.y+12 }, g)
          .textContent = n.qubits + 'q · ' + n.ops.length + 'g';
      }
      el('text', { class: 'sim-nkind', x: n.x, y: n.y+42 }, g).textContent = n.kind;
    });
  }

  /* ── inspector ─────────────────────────────────────────── */
  function row(k, v) { return '<p class="sim-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></p>'; }

  function renderInspector() {
    inspector.innerHTML = '';
    if (!app.selected) {
      inspector.innerHTML = '<p class="sim-empty">Select an element to edit it.</p>';
      return;
    }
    if (app.selected.type === 'op') {
      var c = activeCircuit();
      var op = c.ops.filter(function (o) { return o.id === app.selected.id; })[0];
      if (!op) { app.selected = null; return renderInspector(); }
      var h = '<p class="sim-ins-h">' + esc(op.type) + ' gate</p>' + row('Wire', 'q' + op.q);
      if (op.control != null) h += row('Control', 'q' + op.control);
      h += row('Column', op.col);
      if (PARAM[op.type]) {
        h += '<label class="sim-field"><span>θ = <b id="th-v">' +
             (op.theta/Math.PI).toFixed(2) + 'π</b></span>' +
             '<input id="th" type="range" min="0" max="2" step="0.02" value="' + (op.theta/Math.PI) + '"></label>';
      }
      if (TWO_Q[op.type]) h += '<button class="sim-btn" id="flip">Swap control and target</button>';
      h += '<button class="sim-btn sim-btn--del" id="del">Delete gate</button>';
      inspector.innerHTML = h;

      var th = document.getElementById('th');
      if (th) th.addEventListener('input', function () {
        op.theta = parseFloat(th.value) * Math.PI;
        document.getElementById('th-v').textContent = parseFloat(th.value).toFixed(2) + 'π';
        renderCircuitOnly(); live();
      });
      var fl = document.getElementById('flip');
      if (fl) fl.addEventListener('click', function () {
        var t = op.control; op.control = op.q; op.q = t; render(); simulate();
      });
      document.getElementById('del').addEventListener('click', function () {
        c.ops = c.ops.filter(function (o) { return o.id !== op.id; });
        app.selected = null; render(); simulate();
      });
      return;
    }

    var n = findNode(app.selected.id);
    if (!n) { app.selected = null; return renderInspector(); }
    var links = app.net.links.filter(function (l) { return l.a === n.id || l.b === n.id; });
    var html = '<p class="sim-ins-h">' + esc(n.label) + '</p>' + row('Type', n.kind);

    if (n.kind === 'qpu') {
      html += row('Local gates', n.ops.length);
      html += '<label class="sim-field"><span>Qubits <b id="qn-v">' + n.qubits + '</b></span>' +
              '<input id="qn" type="range" min="1" max="6" step="1" value="' + n.qubits + '"></label>';
      html += '<button class="sim-btn sim-btn--go" id="open">Open this QPU’s circuit</button>';
    }
    links.forEach(function (l, i) {
      html += '<label class="sim-field"><span>Fibre ' + (i+1) + ' <b id="km-' + l.id + '">' +
              l.km + ' km</b></span><input class="kmr" data-l="' + l.id +
              '" type="range" min="5" max="500" step="5" value="' + l.km + '"></label>';
    });
    html += '<button class="sim-btn sim-btn--del" id="del">Delete node</button>';
    inspector.innerHTML = html;

    var qn = document.getElementById('qn');
    if (qn) qn.addEventListener('input', function () {
      n.qubits = +qn.value;
      n.ops = n.ops.filter(function (o) {
        return o.q < n.qubits && (o.control == null || o.control < n.qubits);
      });
      document.getElementById('qn-v').textContent = n.qubits;
      render(); live();
    });
    var open = document.getElementById('open');
    if (open) open.addEventListener('click', function () {
      app.editingQpu = n.id; app.selected = null;
      buildPalette(); render(); simulate();
    });
    [].forEach.call(inspector.querySelectorAll('.kmr'), function (inp) {
      inp.addEventListener('input', function () {
        var l = app.net.links.filter(function (x) { return x.id === +inp.getAttribute('data-l'); })[0];
        l.km = +inp.value;
        document.getElementById('km-' + l.id).textContent = l.km + ' km';
        renderNetworkOnly(); live();
      });
    });
    document.getElementById('del').addEventListener('click', function () {
      app.net.nodes = app.net.nodes.filter(function (x) { return x.id !== n.id; });
      app.net.links = app.net.links.filter(function (l) { return l.a !== n.id && l.b !== n.id; });
      app.net.cuts = app.net.cuts.filter(function (c2) { return c2.a !== n.id && c2.b !== n.id; });
      app.selected = null; render(); simulate();
    });
  }
  function renderCircuitOnly() { clear(layerWires); clear(layerItems); renderCircuit(); }
  function renderNetworkOnly() { clear(layerWires); clear(layerItems); renderNetwork(); }

  /* ── charts ────────────────────────────────────────────── */
  function bars(values, labels, opts) {
    opts = opts || {};
    var W = 560, H = 170, PAD = 40, BOT = 30;
    var max = Math.max.apply(null, values.concat([1e-9]));
    var n = values.length, bw = (W - PAD - 10) / n;
    var s = '<svg class="sim-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
            esc(opts.aria || 'chart') + '">';
    [0, .5, 1].forEach(function (f) {
      var y = H - BOT - f * (H - BOT - 14);
      s += '<line class="ch-grid" x1="' + PAD + '" y1="' + y + '" x2="' + (W-6) + '" y2="' + y + '"/>' +
           '<text class="ch-ax" x="' + (PAD-6) + '" y="' + (y+3) + '" text-anchor="end">' +
           (f*max).toFixed(2) + '</text>';
    });
    values.forEach(function (v, i) {
      var h = (v / max) * (H - BOT - 14), x = PAD + i*bw + bw*0.16, w = bw*0.68;
      s += '<rect class="ch-bar' + (opts.alt && opts.alt[i] ? ' ch-bar--alt' : '') +
           '" x="' + x + '" y="' + (H-BOT-h) + '" width="' + w + '" height="' + Math.max(h, 0.5) +
           '" rx="2"><title>' + esc(labels[i]) + ' — ' + v.toFixed(4) + '</title></rect>';
      if (n <= 16) s += '<text class="ch-lab" x="' + (x+w/2) + '" y="' + (H-BOT+14) +
                        '" text-anchor="middle">' + esc(labels[i]) + '</text>';
    });
    return s + '</svg>';
  }

  function lines(series, opts) {
    opts = opts || {};
    var W = 560, H = 180, L = 48, B = 30, T = 12, R = 10;
    var xs = series[0].pts.map(function (p) { return p.x; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var all = series.reduce(function (a, s2) { return a.concat(s2.pts.map(function (p) { return p.y; })); }, []);
    var log = !!opts.log;
    var ymin = log ? Math.max(Math.min.apply(null, all.filter(function (v) { return v > 0; })), 1e-9) : 0;
    var ymax = Math.max.apply(null, all) || 1;
    function fy(v) {
      if (log) {
        var lo = Math.log10(ymin), hi = Math.log10(Math.max(ymax, ymin*10));
        return H - B - ((Math.log10(Math.max(v, ymin)) - lo) / (hi - lo)) * (H - B - T);
      }
      return H - B - (v / ymax) * (H - B - T);
    }
    function fx(v) { return L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - R); }
    var s = '<svg class="sim-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
            esc(opts.aria || 'chart') + '">';
    [0, .5, 1].forEach(function (f) {
      var val = log ? Math.pow(10, Math.log10(ymin) + f*(Math.log10(Math.max(ymax, ymin*10)) - Math.log10(ymin))) : f*ymax;
      var y = fy(val);
      s += '<line class="ch-grid" x1="' + L + '" y1="' + y + '" x2="' + (W-R) + '" y2="' + y + '"/>' +
           '<text class="ch-ax" x="' + (L-6) + '" y="' + (y+3) + '" text-anchor="end">' +
           (log ? val.toExponential(0) : val.toFixed(2)) + '</text>';
    });
    [xmin, (xmin+xmax)/2, xmax].forEach(function (v) {
      s += '<text class="ch-ax" x="' + fx(v) + '" y="' + (H-B+15) + '" text-anchor="middle">' +
           Math.round(v) + '</text>';
    });
    series.forEach(function (ser, i) {
      s += '<path class="ch-line ch-line--' + i + '" d="' +
           ser.pts.map(function (p, j) { return (j ? 'L' : 'M') + fx(p.x) + ' ' + fy(p.y); }).join(' ') + '"/>';
    });
    return s + '<text class="ch-ax" x="' + (W/2) + '" y="' + (H-2) + '" text-anchor="middle">' +
           esc(opts.xlabel || '') + '</text></svg>';
  }

  /* Bloch projection: each qubit as a point in the x–z plane with its
     length showing how much purity survived. */
  function blochChart(vectors) {
    var R = 62, W = 560, H = 170;
    var s = '<svg class="sim-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
            'aria-label="Bloch vector for each qubit">';
    vectors.forEach(function (b, i) {
      var cx = 70 + i * Math.min(110, (W - 120) / Math.max(1, vectors.length - 1 || 1));
      if (vectors.length === 1) cx = W / 2;
      var cy = H / 2;
      var len = Math.min(1, Math.sqrt(b.x*b.x + b.y*b.y + b.z*b.z));
      s += '<circle class="bl-sphere" cx="' + cx + '" cy="' + cy + '" r="' + R*0.55 + '"/>';
      s += '<line class="bl-axis" x1="' + (cx-R*0.55) + '" y1="' + cy + '" x2="' + (cx+R*0.55) + '" y2="' + cy + '"/>';
      s += '<line class="bl-axis" x1="' + cx + '" y1="' + (cy-R*0.55) + '" x2="' + cx + '" y2="' + (cy+R*0.55) + '"/>';
      var px = cx + b.x * R*0.55, py = cy - b.z * R*0.55;
      s += '<line class="bl-vec" x1="' + cx + '" y1="' + cy + '" x2="' + px + '" y2="' + py + '"/>';
      s += '<circle class="bl-tip" cx="' + px + '" cy="' + py + '" r="4"><title>q' + i +
           ' |r| = ' + len.toFixed(3) + '</title></circle>';
      s += '<text class="ch-lab" x="' + cx + '" y="' + (cy + R*0.55 + 16) + '" text-anchor="middle">q' + i +
           ' · ' + len.toFixed(2) + '</text>';
    });
    return s + '</svg>';
  }

  /* |ρ| as a heatmap — the visual difference between a pure and a
     decohered state is the off-diagonal mass. */
  function rhoHeatmap(rho) {
    var D = rho.D, cell = Math.min(26, 300 / D), W = 560, H = D * cell + 34;
    var ox = (W - D * cell) / 2;
    var s = '<svg class="sim-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
            'aria-label="Magnitude of each density matrix element">';
    var max = 0;
    for (var i = 0; i < D*D; i++) {
      var m = Math.hypot(rho.re[i], rho.im[i]);
      if (m > max) max = m;
    }
    for (var r = 0; r < D; r++) for (var c = 0; c < D; c++) {
      var v = Math.hypot(rho.re[r*D+c], rho.im[r*D+c]) / (max || 1);
      s += '<rect x="' + (ox + c*cell) + '" y="' + (r*cell) + '" width="' + (cell-1) + '" height="' + (cell-1) +
           '" fill="var(--g-1q)" opacity="' + v.toFixed(3) + '"><title>|ρ[' + r + ',' + c + ']| = ' +
           (v*max).toFixed(4) + '</title></rect>';
    }
    return s + '<text class="ch-ax" x="' + (W/2) + '" y="' + (H-8) +
           '" text-anchor="middle">diagonal = populations, off-diagonal = coherence</text></svg>';
  }

  function kpi(label, value, note, tone) {
    return '<div class="sim-kpi' + (tone ? ' is-' + tone : '') + '">' +
           '<p class="sim-kpi__k">' + esc(label) + '</p>' +
           '<p class="sim-kpi__v">' + esc(value) + '</p>' +
           (note ? '<p class="sim-kpi__n">' + esc(note) + '</p>' : '') + '</div>';
  }
  function plot(title, body, note) {
    return '<div class="sim-plot"><p class="sim-plot__h">' + esc(title) + '</p>' + body +
           (note ? '<p class="sim-plot__n">' + note + '</p>' : '') + '</div>';
  }

  /* ── simulation ────────────────────────────────────────── */
  function netSpec() {
    return {
      qpus: app.net.nodes.filter(function (n) { return n.kind === 'qpu'; }),
      nodes: app.net.nodes,
      edges: app.net.links,
      cuts: app.net.cuts
    };
  }
  function chainFromNet() {
    var total = app.net.links.reduce(function (a, l) { return a + l.km; }, 0) || 100;
    return QNet.chainMetrics(total, app.net.links.length || 1, app.params);
  }

  function simulate() {
    if (!app.params.T1 && app.params.T1 !== 0) readParams();
    if (app.mode === 'circuit' || (app.mode === 'distributed' && app.editingQpu != null)) return simCircuit();
    if (app.mode === 'network') return simNetwork();
    return simDistributed();
  }

  function simCircuit() {
    var c = activeCircuit();
    if (!c.ops.length) {
      results.innerHTML = '<p class="sim-empty">Drop a gate onto a wire to run the simulation.</p>';
      return;
    }
    var r = QSim.simulateCircuit({ qubits: c.qubits, ops: c.ops }, app.params);
    var n = c.qubits, labels = [], vals = [];
    var shown = r.counts || r.probs;
    for (var i = 0; i < (1 << n); i++) {
      labels.push(i.toString(2).padStart(n, '0'));
      vals.push(shown[i]);
    }
    var maxEnt = Math.max.apply(null, r.entropy);

    var html = '<div class="sim-kpis">';
    html += kpi('Qubits', n, 'Hilbert dimension ' + (1 << n));
    html += kpi('Depth', r.depth, r.gates + ' gates, ' + r.twoQubit + ' two-qubit');
    html += kpi('Circuit time', (r.durationNs / 1000).toFixed(2) + ' µs',
                app.params.T1 ? 'against T₁ ' + app.params.T1 + ' µs' : 'coherence off');
    html += kpi('State fidelity', fmt(r.fidelity, 4), 'against the noiseless run',
                r.fidelity > 0.9 ? 'good' : r.fidelity > 0.6 ? 'warn' : 'bad');
    html += kpi('Purity Tr(ρ²)', fmt(r.purity, 4),
                r.purity > 0.99 ? 'nearly pure' : 'mixed by decoherence');
    html += kpi('Entanglement', fmt(maxEnt, 3) + ' ebit',
                maxEnt > 0.01 ? 'qubits are correlated' : 'product state');
    html += '</div>';

    html += plot(r.counts ? 'Measured outcomes over ' + app.params.shots + ' shots'
                          : 'Outcome probabilities (exact)',
      bars(vals, labels, { aria: 'Measurement outcome distribution' }),
      r.counts ? 'Sampling noise is visible at low shot counts. Set shots to zero for exact probabilities.'
               : 'Exact distribution from the density matrix.');

    html += plot('Bloch vector per qubit', blochChart(r.bloch),
      'Vector length is coherence. A qubit entangled with the rest sits near the origin ' +
      'because its own reduced state is mixed — that is what entanglement looks like locally.');

    if (r.rho) {
      html += plot('Density matrix magnitude', rhoHeatmap(r.rho),
        'Off-diagonal elements are coherence. Decoherence erases them from the outside in.');
    }

    html += plot('Entanglement entropy per qubit',
      bars(r.entropy, r.entropy.map(function (_, q) { return 'q' + q; }),
           { aria: 'Entanglement entropy per qubit' }),
      'Von Neumann entropy of each qubit against the rest. 1.0 ebit is maximal.');

    results.innerHTML = html;
  }

  function simNetwork() {
    if (!app.net.links.length) {
      results.innerHTML = '<p class="sim-empty">Place two nodes and lay fibre between them.</p>';
      return;
    }
    var m = chainFromNet();
    var total = app.net.links.reduce(function (a, l) { return a + l.km; }, 0);
    var sw = QNet.sweep(Math.max(total * 1.6, 80), m.segments, app.params, 44);
    var seg = QNet.segmentSweep(total, Math.min(12, Math.max(4, m.segments + 4)), app.params);

    var html = '<div class="sim-kpis">';
    html += kpi('Entanglement rate', sci(m.rate, 'ebit/s'),
                m.segments + ' segments over ' + Math.round(total) + ' km');
    html += kpi('End-to-end fidelity', fmt(m.fidelity, 4),
                m.fidelity > 0.5 ? 'above the entanglement threshold' : 'below threshold',
                m.fidelity > 0.8 ? 'good' : m.fidelity > 0.5 ? 'warn' : 'bad');
    html += kpi('QBER', (m.qber * 100).toFixed(2) + ' %',
                m.qber < 0.11 ? 'under the BB84 limit' : 'above the 11 % limit',
                m.qber < 0.08 ? 'good' : m.qber < 0.11 ? 'warn' : 'bad');
    html += kpi('Secret key rate', sci(m.keyRate, 'bit/s'),
                m.keyRate > 0 ? 'positive' : 'no key extractable',
                m.keyRate > 0 ? 'good' : 'bad');
    html += kpi('Swap survival', (m.swapSurvival * 100).toFixed(1) + ' %',
                'across ' + Math.max(0, m.segments - 1) + ' swaps');
    html += kpi('One-way latency', (m.latency * 1000).toFixed(2) + ' ms', 'fibre at 200 000 km/s');
    html += '</div>';

    html += plot('Fidelity against total distance',
      lines([{ pts: sw.map(function (p) { return { x: p.km, y: p.fidelity }; }) }],
            { xlabel: 'distance (km)', aria: 'Fidelity versus distance' }));

    html += plot('Rate and key rate against distance (log)',
      lines([{ pts: sw.map(function (p) { return { x: p.km, y: Math.max(p.rate, 1e-9) }; }) },
             { pts: sw.map(function (p) { return { x: p.km, y: Math.max(p.keyRate, 1e-9) }; }) }],
            { log: true, xlabel: 'distance (km)', aria: 'Rate versus distance' }),
      '<span class="ch-key ch-key--0"></span>raw entanglement ' +
      '<span class="ch-key ch-key--1"></span>secret key. Loss is exponential in fibre length.');

    html += plot('Optimal number of segments at ' + Math.round(total) + ' km',
      lines([{ pts: seg.map(function (p) { return { x: p.segments, y: Math.max(p.keyRate, 1e-9) }; }) }],
            { log: true, xlabel: 'segments', aria: 'Key rate versus segment count' }),
      'More repeaters shorten each span but add swaps. The peak is the engineering answer.');

    results.innerHTML = html;
  }

  function simDistributed() {
    var spec = netSpec();
    if (spec.qpus.length < 2) {
      results.innerHTML = '<p class="sim-empty">Place at least two QPU nodes, lay fibre between them, ' +
        'then add cross-QPU gates.</p>';
      return;
    }
    var d = QDist.distributed(spec, app.params);
    var net = chainFromNet();

    var html = '<div class="sim-kpis">';
    html += kpi('QPUs', spec.qpus.length, d.totalQubits + ' qubits total');
    html += kpi('Cross-QPU gates', spec.cuts.length,
                d.unreachable ? d.unreachable + ' unroutable' : 'all routed',
                d.unreachable ? 'bad' : 'good');
    html += kpi('Entangled pairs', d.ebits + ' ebit', d.classicalBits + ' classical bits');
    html += kpi('End-to-end fidelity', fmt(d.fidelity, 4),
                'local ' + fmt(d.localFidelity, 3) + ' × link ' + fmt(d.linkFidelity, 3),
                d.fidelity > 0.8 ? 'good' : d.fidelity > 0.5 ? 'warn' : 'bad');
    html += kpi('Distribution time', isFinite(d.distributionTime) ? sci(d.distributionTime, 's') : '∞',
                'at ' + sci(net.rate, 'ebit/s'));
    html += kpi('Local circuit time', (d.localTimeNs / 1000).toFixed(2) + ' µs',
                'slowest QPU');
    html += '</div>';

    html += plot('Fidelity contributed by each QPU',
      bars(d.local.map(function (l) { return l.result.fidelity; }),
           d.local.map(function (l) { return l.label; }),
           { aria: 'Local fidelity per QPU' }),
      'Each QPU runs its own circuit under the device parameters on the left. ' +
      'The end-to-end number multiplies these together with the link fidelity.');

    if (spec.cuts.length) {
      var routes = d.routed.filter(function (r) { return r.reachable; });
      if (routes.length) {
        html += plot('Route quality per cross-QPU gate',
          bars(routes.map(function (r) { return r.net.fidelity; }),
               routes.map(function (r) {
                 var a = findNode(r.cut.a), b = findNode(r.cut.b);
                 return (a ? a.label : '?') + '→' + (b ? b.label : '?');
               }), { aria: 'Fidelity of each routed gate' }),
          'Each teleported gate consumes one pair at this fidelity. Routes through more ' +
          'repeaters cost more.');
      }
      var pts = [];
      for (var g = 1; g <= 24; g++) pts.push({ x: g, y: Math.pow(net.fidelity, g) });
      html += plot('Fidelity against number of teleported gates',
        lines([{ pts: pts }], { xlabel: 'cross-QPU gates', aria: 'Fidelity versus teleported gates' }),
        'Compounding is why partitioning a circuit to minimise cuts matters more than link quality.');
    } else {
      html += '<p class="sim-empty">No cross-QPU gates yet. Use <b>Add cross-QPU gate</b> to connect ' +
              'two QPUs logically, and the entanglement cost appears here.</p>';
    }

    results.innerHTML = html;
  }

  /* ── palette ───────────────────────────────────────────── */
  var PALETTE = {
    gates: [
      { group: 'Single-qubit', items: [
        { type: 'H', label: 'H', family: 'gate', desc: 'Hadamard — superposition' },
        { type: 'X', label: 'X', family: 'gate', desc: 'Pauli X — bit flip' },
        { type: 'Y', label: 'Y', family: 'gate', desc: 'Pauli Y' },
        { type: 'Z', label: 'Z', family: 'gate', desc: 'Pauli Z — phase flip' },
        { type: 'S', label: 'S', family: 'gate', desc: 'Phase, π/2' },
        { type: 'T', label: 'T', family: 'gate', desc: 'π/4 phase' },
        { type: 'SX', label: '√X', family: 'gate', desc: 'Square root of X' }
      ]},
      { group: 'Rotations', items: [
        { type: 'RX', label: 'RX', family: 'gate', desc: 'Rotation about X, tunable θ' },
        { type: 'RY', label: 'RY', family: 'gate', desc: 'Rotation about Y, tunable θ' },
        { type: 'RZ', label: 'RZ', family: 'gate', desc: 'Rotation about Z, tunable θ' },
        { type: 'P', label: 'P', family: 'gate', desc: 'Phase shift, tunable θ' }
      ]},
      { group: 'Two-qubit', items: [
        { type: 'CNOT', label: 'CNOT', family: 'gate', desc: 'Controlled NOT — entangles' },
        { type: 'CZ', label: 'CZ', family: 'gate', desc: 'Controlled phase' },
        { type: 'SWAP', label: 'SWAP', family: 'gate', desc: 'Exchange two qubits' }
      ]}
    ],
    nodes: [
      { group: 'Nodes', items: [
        { type: 'qpu', label: 'QPU', short: 'Q', family: 'node', desc: 'Processor with its own circuit' },
        { type: 'repeater', label: 'Repeater', short: 'R', family: 'node', desc: 'Swaps entanglement between spans' },
        { type: 'endpoint', label: 'End node', short: 'N', family: 'node', desc: 'Terminates entanglement' }
      ]}
    ]
  };

  function buildPalette() {
    var host = document.getElementById('palette');
    host.innerHTML = '';
    var groups = (app.mode === 'circuit' || (app.mode === 'distributed' && app.editingQpu != null))
      ? PALETTE.gates : PALETTE.nodes;
    groups.forEach(function (grp) {
      var wrap = document.createElement('div');
      wrap.className = 'sim-pgroup';
      wrap.innerHTML = '<p class="sim-pgroup__h">' + esc(grp.group) + '</p>';
      var items = document.createElement('div');
      items.className = 'sim-pitems';
      grp.items.forEach(function (it) {
        var b = document.createElement('button');
        b.className = 'sim-pitem' + (it.family === 'node' ? ' is-node' : '');
        b.type = 'button';
        b.innerHTML = '<span class="sim-pitem__l">' + esc(it.label) + '</span>' +
                      '<span class="sim-pitem__d">' + esc(it.desc) + '</span>';
        b.addEventListener('pointerdown', function (e) { startDrag(e, it); });
        b.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            place(it, { x: COL_X + 2*COL_W, y: WIRE_Y + WIRE_H });
          }
        });
        items.appendChild(b);
      });
      wrap.appendChild(items);
      host.appendChild(wrap);
    });
  }

  /* ── mode and controls ─────────────────────────────────── */
  function setMode(m) {
    app.mode = m;
    app.selected = null;
    app.editingQpu = null;
    setLinking(false); setCutting(false);
    [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === m));
    });
    document.getElementById('ctl-circuit').hidden = (m === 'network');
    document.getElementById('ctl-net').hidden = (m === 'circuit');
    document.getElementById('btn-link').hidden = (m === 'circuit');
    document.getElementById('btn-cut').hidden = (m !== 'distributed');
    hint.textContent = defaultHint();
    buildPalette(); render(); simulate();
  }

  [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });
  document.getElementById('btn-link').addEventListener('click', function () { setLinking(!app.linking); });
  document.getElementById('btn-cut').addEventListener('click', function () { setCutting(!app.cutting); });
  document.getElementById('btn-back').addEventListener('click', function () {
    app.editingQpu = null; app.selected = null; buildPalette(); render(); simulate();
  });
  document.getElementById('btn-clear').addEventListener('click', function () {
    if (app.mode === 'circuit') app.circuit.ops = [];
    else if (app.editingQpu != null) { var n = findNode(app.editingQpu); if (n) n.ops = []; }
    else { app.net.nodes = []; app.net.links = []; app.net.cuts = []; }
    app.selected = null; render(); simulate();
  });
  document.getElementById('btn-fit').addEventListener('click', function () {
    app.view = { x: 0, y: 0, k: 1 }; applyView();
  });
  document.getElementById('btn-in').addEventListener('click', function () {
    var r = frame.getBoundingClientRect(); zoomAt(r.left + r.width/2, r.top + r.height/2, 1.2);
  });
  document.getElementById('btn-out').addEventListener('click', function () {
    var r = frame.getBoundingClientRect(); zoomAt(r.left + r.width/2, r.top + r.height/2, 1/1.2);
  });

  /* Every parameter recomputes live. */
  ['t1','t2','g1','g2','d1','d2','ro','shots','memory','srcfid','deteff','dark','mux','swapp','swapq']
    .forEach(function (id) {
      var e = document.getElementById(id);
      if (e) e.addEventListener('input', live);
    });
  var qb = document.getElementById('qubits');
  if (qb) qb.addEventListener('input', function () {
    app.circuit.qubits = +qb.value;
    app.circuit.ops = app.circuit.ops.filter(function (o) {
      return o.q < app.circuit.qubits && (o.control == null || o.control < app.circuit.qubits);
    });
    readParams(); render(); live();
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.selected) {
      e.preventDefault();
      var d = document.getElementById('del'); if (d) d.click();
    }
    if (e.key === 'Escape') {
      app.selected = null; setLinking(false); setCutting(false); render();
    }
  });

  /* ── examples ──────────────────────────────────────────── */
  function loadGHZ() {
    app.circuit.qubits = 4;
    var qbEl = document.getElementById('qubits');
    if (qbEl) qbEl.value = 4;
    app.circuit.ops = [
      { id: ++uid, type: 'H', q: 0, col: 0 },
      { id: ++uid, type: 'CNOT', q: 1, control: 0, col: 1 },
      { id: ++uid, type: 'CNOT', q: 2, control: 1, col: 2 },
      { id: ++uid, type: 'CNOT', q: 3, control: 2, col: 3 }
    ];
  }
  function loadNetwork() {
    var y = 210;
    var q1 = { id: ++uid, kind: 'qpu', x: 170, y: y, label: 'Q1', qubits: 2,
               ops: [{ id: ++uid, type: 'H', q: 0, col: 0 },
                     { id: ++uid, type: 'CNOT', q: 1, control: 0, col: 1 }] };
    var r1 = { id: ++uid, kind: 'repeater', x: 430, y: y, label: 'R1', qubits: 1, ops: [] };
    var q2 = { id: ++uid, kind: 'qpu', x: 690, y: y, label: 'Q2', qubits: 2,
               ops: [{ id: ++uid, type: 'H', q: 0, col: 0 }] };
    app.net.nodes = [q1, r1, q2];
    app.net.links = [
      { id: ++uid, a: q1.id, b: r1.id, km: 50 },
      { id: ++uid, a: r1.id, b: q2.id, km: 50 }
    ];
    app.net.cuts = [{ id: ++uid, a: q1.id, b: q2.id }];
  }
  document.getElementById('btn-demo').addEventListener('click', function () {
    if (app.mode === 'circuit') loadGHZ(); else loadNetwork();
    app.selected = null; app.editingQpu = null;
    buildPalette(); render(); simulate();
  });

  /* ── boot ──────────────────────────────────────────────── */
  readParams();
  loadGHZ();
  loadNetwork();
  applyView();
  setMode('circuit');
})();
