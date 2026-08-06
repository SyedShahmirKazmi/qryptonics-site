/* ══════════════════════════════════════════════════════════
   Qryptonics — simulation engines
   Pure functions, no DOM. Two engines:
     QSim   — state-vector simulation of gate-model circuits
     QNet   — entanglement distribution over repeater chains
   and a small bridge for distributed circuits that span nodes.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SQ = Math.SQRT1_2;

  /* ── complex 2×2 gate matrices ─────────────────────────
     Stored as [re00,im00, re01,im01, re10,im10, re11,im11].
     ─────────────────────────────────────────────────────── */
  var GATES = {
    H: [SQ, 0, SQ, 0, SQ, 0, -SQ, 0],
    X: [0, 0, 1, 0, 1, 0, 0, 0],
    Y: [0, 0, 0, -1, 0, 1, 0, 0],
    Z: [1, 0, 0, 0, 0, 0, -1, 0],
    S: [1, 0, 0, 0, 0, 0, 0, 1],
    T: [1, 0, 0, 0, 0, 0, SQ, SQ],
    I: [1, 0, 0, 0, 0, 0, 1, 0]
  };

  function rx(t) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return [c, 0, 0, -s, 0, -s, c, 0];
  }
  function ry(t) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return [c, 0, -s, 0, s, 0, c, 0];
  }
  function rz(t) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return [c, -s, 0, 0, 0, 0, c, s];
  }

  function matrixFor(op) {
    if (op.type === 'RX') return rx(op.theta);
    if (op.type === 'RY') return ry(op.theta);
    if (op.type === 'RZ') return rz(op.theta);
    return GATES[op.type] || GATES.I;
  }

  /* ── state vector ──────────────────────────────────────── */
  function State(n) {
    this.n = n;
    this.size = 1 << n;
    this.re = new Float64Array(this.size);
    this.im = new Float64Array(this.size);
    this.re[0] = 1;
  }

  /* Apply a 2×2 matrix to qubit q, optionally controlled on `ctrl`
     (and on a second control for Toffoli-style gates). */
  State.prototype.apply1 = function (m, q, ctrl) {
    var bit = 1 << q, re = this.re, im = this.im;
    for (var i = 0; i < this.size; i++) {
      if (i & bit) continue;
      var j = i | bit;
      if (ctrl !== undefined && ctrl !== null) {
        var cbit = 1 << ctrl;
        if (!(i & cbit)) continue;
      }
      var ar = re[i], ai = im[i], br = re[j], bi = im[j];
      re[i] = m[0] * ar - m[1] * ai + m[2] * br - m[3] * bi;
      im[i] = m[0] * ai + m[1] * ar + m[2] * bi + m[3] * br;
      re[j] = m[4] * ar - m[5] * ai + m[6] * br - m[7] * bi;
      im[j] = m[4] * ai + m[5] * ar + m[6] * bi + m[7] * br;
    }
  };

  State.prototype.swap = function (a, b) {
    var ba = 1 << a, bb = 1 << b, re = this.re, im = this.im;
    for (var i = 0; i < this.size; i++) {
      var ia = (i & ba) !== 0, ib = (i & bb) !== 0;
      if (ia === ib) continue;
      var j = i ^ ba ^ bb;
      if (j < i) continue;
      var tr = re[i]; re[i] = re[j]; re[j] = tr;
      var ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  };

  State.prototype.probs = function () {
    var p = new Float64Array(this.size);
    for (var i = 0; i < this.size; i++) p[i] = this.re[i] * this.re[i] + this.im[i] * this.im[i];
    return p;
  };

  /* Reduced density matrix of one qubit, returned as [ρ00, ρ01re, ρ01im, ρ11]. */
  State.prototype.rho1 = function (q) {
    var bit = 1 << q, r00 = 0, r11 = 0, r01re = 0, r01im = 0;
    for (var i = 0; i < this.size; i++) {
      if (i & bit) continue;
      var j = i | bit;
      var ar = this.re[i], ai = this.im[i], br = this.re[j], bi = this.im[j];
      r00 += ar * ar + ai * ai;
      r11 += br * br + bi * bi;
      r01re += ar * br + ai * bi;
      r01im += ai * br - ar * bi;
    }
    return [r00, r01re, r01im, r11];
  };

  /* von Neumann entropy of one qubit against the rest, in ebits. */
  State.prototype.entropy = function (q) {
    var r = this.rho1(q);
    var tr = r[0] + r[3];
    var det = r[0] * r[3] - (r[1] * r[1] + r[2] * r[2]);
    var disc = Math.max(tr * tr / 4 - det, 0);
    var l1 = tr / 2 + Math.sqrt(disc), l2 = tr / 2 - Math.sqrt(disc);
    function s(l) { return l > 1e-12 ? -l * Math.log2(l) : 0; }
    return s(l1) + s(l2);
  };

  State.prototype.bloch = function (q) {
    var r = this.rho1(q);
    return { x: 2 * r[1], y: 2 * r[2], z: r[0] - r[3] };
  };

  /* ── circuit execution ─────────────────────────────────── */
  function runOnce(circuit, noise, rand) {
    var st = new State(circuit.qubits);
    var ops = circuit.ops.slice().sort(function (a, b) { return a.col - b.col; });

    for (var k = 0; k < ops.length; k++) {
      var op = ops[k];
      var touched = [];

      if (op.type === 'SWAP') {
        st.swap(op.q, op.control);
        touched = [op.q, op.control];
      } else if (op.type === 'CNOT') {
        st.apply1(GATES.X, op.q, op.control);
        touched = [op.q, op.control];
      } else if (op.type === 'CZ') {
        st.apply1(GATES.Z, op.q, op.control);
        touched = [op.q, op.control];
      } else if (op.type === 'M') {
        continue;
      } else {
        st.apply1(matrixFor(op), op.q, null);
        touched = [op.q];
      }

      /* Depolarizing noise as a Monte Carlo trajectory: with
         probability p, apply a uniformly random non-identity Pauli. */
      if (noise > 0) {
        for (var t = 0; t < touched.length; t++) {
          if (rand() < noise) {
            var pick = Math.floor(rand() * 3);
            st.apply1(pick === 0 ? GATES.X : pick === 1 ? GATES.Y : GATES.Z, touched[t], null);
          }
        }
      }
    }
    return st;
  }

  /* Deterministic PRNG so a given circuit always yields the same
     sampled histogram. Users comparing two runs need that. */
  function makeRand(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function simulateCircuit(circuit, opts) {
    opts = opts || {};
    var noise = opts.noise || 0;
    var trajectories = noise > 0 ? (opts.trajectories || 160) : 1;
    var rand = makeRand(opts.seed || 12345);

    var size = 1 << circuit.qubits;
    var probs = new Float64Array(size);
    var ideal = runOnce(circuit, 0, makeRand(1));
    var idealProbs = ideal.probs();
    var last = ideal;

    if (noise > 0) {
      for (var t = 0; t < trajectories; t++) {
        var st = runOnce(circuit, noise, rand);
        var p = st.probs();
        for (var i = 0; i < size; i++) probs[i] += p[i] / trajectories;
        last = st;
      }
    } else {
      probs = idealProbs;
    }

    /* Classical fidelity between the noisy and ideal distributions. */
    var fid = 0;
    for (var j = 0; j < size; j++) fid += Math.sqrt(probs[j] * idealProbs[j]);
    fid = Math.min(fid * fid, 1);

    var cols = {};
    circuit.ops.forEach(function (o) { cols[o.col] = true; });

    var ent = [], bloch = [];
    for (var q = 0; q < circuit.qubits; q++) {
      ent.push(ideal.entropy(q));
      bloch.push(ideal.bloch(q));
    }

    return {
      probs: probs,
      idealProbs: idealProbs,
      fidelity: noise > 0 ? fid : 1,
      entropy: ent,
      bloch: bloch,
      depth: Object.keys(cols).length,
      gates: circuit.ops.length,
      twoQubit: circuit.ops.filter(function (o) {
        return o.type === 'CNOT' || o.type === 'CZ' || o.type === 'SWAP';
      }).length
    };
  }

  /* ══════════════════════════════════════════════════════════
     Network engine
     Entanglement distribution across a chain of links, with
     midpoint sources, memory decoherence and swapping.
     ══════════════════════════════════════════════════════════ */
  var C_FIBRE = 2.0e5;          // km/s, light in fibre
  var ATTEN_DB_KM = 0.2;        // standard telecom fibre
  var DETECTOR_EFF = 0.9;
  var SOURCE_RATE = 1e7;        // attempted pair emissions per second

  function transmittance(km) {
    return Math.pow(10, -(ATTEN_DB_KM * km) / 10);
  }

  function binEntropy(e) {
    if (e <= 0 || e >= 1) return 0;
    return -e * Math.log2(e) - (1 - e) * Math.log2(1 - e);
  }

  /* One elementary link with a source at the midpoint: both photons
     travel half the span, so transmittance enters squared. */
  function linkMetrics(km, memoryT2, srcFidelity) {
    var half = transmittance(km / 2);
    var pSucc = half * half * DETECTOR_EFF * DETECTOR_EFF;
    var travel = km / C_FIBRE;                 // one-way, seconds
    var attempts = Math.min(SOURCE_RATE, 1 / travel);
    var rate = pSucc * attempts;               // ebits per second
    var held = travel;                         // heralding wait
    var decay = Math.exp(-held / memoryT2);
    var w0 = (4 * srcFidelity - 1) / 3;        // Werner parameter
    var w = w0 * decay;
    return {
      rate: rate,
      fidelity: (3 * w + 1) / 4,
      werner: w,
      pSucc: pSucc,
      latency: travel
    };
  }

  /* A chain of n identical segments joined by entanglement swapping.
     Werner parameters multiply; rate falls with the number of
     segments that must all succeed before a swap can proceed. */
  function chainMetrics(totalKm, segments, memoryT2, srcFidelity, swapQuality) {
    segments = Math.max(1, segments);
    var seg = totalKm / segments;
    var link = linkMetrics(seg, memoryT2, srcFidelity);

    var w = Math.pow(link.werner, segments) * Math.pow(swapQuality, segments - 1);
    var fidelity = (3 * w + 1) / 4;

    /* Waiting for k independent links scales roughly as the harmonic
       sum of attempts; the standard approximation is a factor of
       ~(3/2)^log2(k) on the elementary link time. */
    var penalty = Math.pow(1.5, Math.log2(segments));
    var rate = link.rate / penalty;

    var qber = 2 * (1 - fidelity) / 3;
    var keyFrac = Math.max(0, 1 - 2 * binEntropy(qber));

    return {
      rate: rate,
      fidelity: fidelity,
      qber: qber,
      keyRate: rate * keyFrac,
      latency: totalKm / C_FIBRE,
      segments: segments,
      segmentKm: seg,
      linkRate: link.rate,
      linkFidelity: link.fidelity
    };
  }

  /* Sweep distance for the plotted curves. */
  function sweep(maxKm, segments, memoryT2, srcFidelity, swapQuality, points) {
    points = points || 40;
    var out = [];
    for (var i = 1; i <= points; i++) {
      var km = maxKm * i / points;
      var m = chainMetrics(km, segments, memoryT2, srcFidelity, swapQuality);
      out.push({ km: km, rate: m.rate, fidelity: m.fidelity, keyRate: m.keyRate });
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════
     Distributed bridge
     A circuit split across nodes needs one shared pair per gate
     that crosses a node boundary, plus classical signalling.
     ══════════════════════════════════════════════════════════ */
  function distributedMetrics(crossGates, localGates, net) {
    var ebits = crossGates;                    // one per teleported gate
    var timeS = net.rate > 0 ? ebits / net.rate : Infinity;
    /* Each teleported gate inherits the link fidelity. */
    var circuitFidelity = Math.pow(net.fidelity, crossGates);
    return {
      ebits: ebits,
      crossGates: crossGates,
      localGates: localGates,
      timeS: timeS,
      classicalBits: crossGates * 2,
      fidelity: circuitFidelity,
      latency: net.latency * crossGates
    };
  }

  root.QSim = {
    simulateCircuit: simulateCircuit,
    State: State,
    GATES: GATES
  };
  root.QNet = {
    linkMetrics: linkMetrics,
    chainMetrics: chainMetrics,
    sweep: sweep,
    transmittance: transmittance,
    distributedMetrics: distributedMetrics,
    C_FIBRE: C_FIBRE
  };
})(window);
