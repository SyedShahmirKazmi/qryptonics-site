/* ══════════════════════════════════════════════════════════
   Qryptonics — simulation engines

   QSim  — density-matrix simulation. Tracks the full ρ rather than
           a state vector, so mixed states from decoherence are
           represented exactly instead of sampled. Noise enters as
           Kraus channels, which is what a Lindblad master equation
           reduces to over a fixed gate duration.
   QNet  — entanglement distribution: fibre loss, detector
           efficiency, dark counts, memory decoherence, swap
           success, multiplexing, and shortest-path routing.
   QDist — the merger. Circuits inside QPUs, entanglement routed
           between them, every teleported gate priced in ebits,
           latency and fidelity.

   No dependencies. All physics is implemented here.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SQ = Math.SQRT1_2;

  /* Gate matrices as [re00,im00, re01,im01, re10,im10, re11,im11] */
  var G = {
    I: [1,0, 0,0, 0,0, 1,0],
    H: [SQ,0, SQ,0, SQ,0, -SQ,0],
    X: [0,0, 1,0, 1,0, 0,0],
    Y: [0,0, 0,-1, 0,1, 0,0],
    Z: [1,0, 0,0, 0,0, -1,0],
    S: [1,0, 0,0, 0,0, 0,1],
    SDG: [1,0, 0,0, 0,0, 0,-1],
    T: [1,0, 0,0, 0,0, SQ,SQ],
    TDG: [1,0, 0,0, 0,0, SQ,-SQ],
    SX: [0.5,0.5, 0.5,-0.5, 0.5,-0.5, 0.5,0.5]
  };
  function RX(t){var c=Math.cos(t/2),s=Math.sin(t/2);return [c,0, 0,-s, 0,-s, c,0];}
  function RY(t){var c=Math.cos(t/2),s=Math.sin(t/2);return [c,0, -s,0, s,0, c,0];}
  function RZ(t){var c=Math.cos(t/2),s=Math.sin(t/2);return [c,-s, 0,0, 0,0, c,s];}
  function PH(t){return [1,0, 0,0, 0,0, Math.cos(t),Math.sin(t)];}

  function matrixFor(op){
    switch(op.type){
      case 'RX': return RX(op.theta);
      case 'RY': return RY(op.theta);
      case 'RZ': return RZ(op.theta);
      case 'P':  return PH(op.theta);
      default:   return G[op.type] || G.I;
    }
  }

  /* ══════════════════════════════════════════════════════════
     Density matrix
     ρ is stored as two Float64Arrays of length D², row-major.
     ══════════════════════════════════════════════════════════ */
  function Rho(n){
    this.n = n;
    this.D = 1 << n;
    this.re = new Float64Array(this.D * this.D);
    this.im = new Float64Array(this.D * this.D);
    this.re[0] = 1;                      // |0…0⟩⟨0…0|
  }

  /* ρ → U ρ U†, U acting on qubit q, optionally controlled. */
  Rho.prototype.unitary1 = function (m, q, ctrl) {
    var D = this.D, bit = 1 << q, re = this.re, im = this.im;
    var cbit = (ctrl === undefined || ctrl === null) ? -1 : (1 << ctrl);

    /* left multiply: rows */
    for (var col = 0; col < D; col++) {
      for (var r = 0; r < D; r++) {
        if (r & bit) continue;
        if (cbit >= 0 && !(r & cbit)) continue;
        var i0 = r * D + col, i1 = (r | bit) * D + col;
        var ar = re[i0], ai = im[i0], br = re[i1], bi = im[i1];
        re[i0] = m[0]*ar - m[1]*ai + m[2]*br - m[3]*bi;
        im[i0] = m[0]*ai + m[1]*ar + m[2]*bi + m[3]*br;
        re[i1] = m[4]*ar - m[5]*ai + m[6]*br - m[7]*bi;
        im[i1] = m[4]*ai + m[5]*ar + m[6]*bi + m[7]*br;
      }
    }
    /* right multiply by U†: columns (conjugate transpose) */
    for (var row = 0; row < D; row++) {
      for (var c = 0; c < D; c++) {
        if (c & bit) continue;
        if (cbit >= 0 && !(c & cbit)) continue;
        var j0 = row * D + c, j1 = row * D + (c | bit);
        var xr = re[j0], xi = im[j0], yr = re[j1], yi = im[j1];
        /* (ρU†)[·,c0] = ρ[·,c0]·conj(m00) + ρ[·,c1]·conj(m01)
           (ρU†)[·,c1] = ρ[·,c0]·conj(m10) + ρ[·,c1]·conj(m11) */
        re[j0] = xr*m[0] + xi*m[1] + yr*m[2] + yi*m[3];
        im[j0] = xi*m[0] - xr*m[1] + yi*m[2] - yr*m[3];
        re[j1] = xr*m[4] + xi*m[5] + yr*m[6] + yi*m[7];
        im[j1] = xi*m[4] - xr*m[5] + yi*m[6] - yr*m[7];
      }
    }
  };

  Rho.prototype.swap = function (a, b) {
    var D = this.D, ba = 1 << a, bb = 1 << b;
    function perm(i){ var x=(i&ba)!==0, y=(i&bb)!==0; return x===y ? i : (i ^ ba ^ bb); }
    var re = new Float64Array(D*D), im = new Float64Array(D*D);
    for (var r = 0; r < D; r++) for (var c = 0; c < D; c++) {
      re[perm(r)*D + perm(c)] = this.re[r*D+c];
      im[perm(r)*D + perm(c)] = this.im[r*D+c];
    }
    this.re = re; this.im = im;
  };

  /* ρ → Σ K ρ K†, for a set of single-qubit Kraus operators. */
  Rho.prototype.kraus1 = function (ops, q) {
    var D = this.D, bit = 1 << q;
    var re = new Float64Array(D*D), im = new Float64Array(D*D);
    var self = this;

    ops.forEach(function (K) {
      /* tmp = K ρ */
      var tr = new Float64Array(D*D), ti = new Float64Array(D*D);
      for (var col = 0; col < D; col++) {
        for (var r = 0; r < D; r++) {
          if (r & bit) continue;
          var i0 = r*D+col, i1 = (r|bit)*D+col;
          var ar=self.re[i0], ai=self.im[i0], br=self.re[i1], bi=self.im[i1];
          tr[i0] = K[0]*ar - K[1]*ai + K[2]*br - K[3]*bi;
          ti[i0] = K[0]*ai + K[1]*ar + K[2]*bi + K[3]*br;
          tr[i1] = K[4]*ar - K[5]*ai + K[6]*br - K[7]*bi;
          ti[i1] = K[4]*ai + K[5]*ar + K[6]*bi + K[7]*br;
        }
      }
      /* accumulate tmp K† */
      for (var row = 0; row < D; row++) {
        for (var c = 0; c < D; c++) {
          if (c & bit) continue;
          var j0 = row*D+c, j1 = row*D+(c|bit);
          var xr=tr[j0], xi=ti[j0], yr=tr[j1], yi=ti[j1];
          re[j0] += xr*K[0] + xi*K[1] + yr*K[2] + yi*K[3];
          im[j0] += xi*K[0] - xr*K[1] + yi*K[2] - yr*K[3];
          re[j1] += xr*K[4] + xi*K[5] + yr*K[6] + yi*K[7];
          im[j1] += xi*K[4] - xr*K[5] + yi*K[6] - yr*K[7];
        }
      }
    });
    this.re = re; this.im = im;
  };

  /* Amplitude damping: energy relaxation toward |0⟩ over time t/T1. */
  function ampDamp(g){
    var s = Math.sqrt(Math.max(0, 1-g)), r = Math.sqrt(Math.max(0, g));
    return [[1,0, 0,0, 0,0, s,0], [0,0, r,0, 0,0, 0,0]];
  }
  /* Pure dephasing: loss of phase coherence without energy loss. */
  function phaseDamp(l){
    var a = Math.sqrt(Math.max(0, 1-l/2)), b = Math.sqrt(Math.max(0, l/2));
    return [[a,0, 0,0, 0,0, a,0], [b,0, 0,0, 0,0, -b,0]];
  }
  /* Depolarizing: with probability p the qubit is replaced by I/2. */
  function depol(p){
    var a = Math.sqrt(Math.max(0, 1-3*p/4)), b = Math.sqrt(Math.max(0, p/4));
    return [
      [a,0,0,0,0,0,a,0],
      [0,0,b,0,b,0,0,0],
      [0,0,0,-b,0,b,0,0],
      [b,0,0,0,0,0,-b,0]
    ];
  }

  /* Reduced 2×2 density matrix for one qubit (partial trace of the rest). */
  Rho.prototype.reduced1 = function (q) {
    var D = this.D, bit = 1 << q;
    var r00=0, r11=0, r01r=0, r01i=0;
    for (var i = 0; i < D; i++) {
      if (i & bit) continue;
      var j = i | bit;
      r00 += this.re[i*D+i];
      r11 += this.re[j*D+j];
      r01r += this.re[i*D+j];
      r01i += this.im[i*D+j];
    }
    return [r00, r01r, r01i, r11];
  };

  Rho.prototype.bloch = function (q) {
    var r = this.reduced1(q);
    return { x: 2*r[1], y: -2*r[2], z: r[0]-r[3] };
  };

  Rho.prototype.probs = function () {
    var D = this.D, p = new Float64Array(D);
    for (var i = 0; i < D; i++) p[i] = Math.max(0, this.re[i*D+i]);
    return p;
  };

  Rho.prototype.purity = function () {
    /* Tr(ρ²) = Σ |ρ_ij|²  because ρ is Hermitian */
    var D = this.D, s = 0;
    for (var i = 0; i < D*D; i++) s += this.re[i]*this.re[i] + this.im[i]*this.im[i];
    return s;
  };

  Rho.prototype.trace = function () {
    var D = this.D, s = 0;
    for (var i = 0; i < D; i++) s += this.re[i*D+i];
    return s;
  };

  /* von Neumann entropy of one qubit against the rest, in ebits. */
  Rho.prototype.entropy1 = function (q) {
    var r = this.reduced1(q);
    var tr = r[0]+r[3];
    var det = r[0]*r[3] - (r[1]*r[1] + r[2]*r[2]);
    var disc = Math.max(tr*tr/4 - det, 0);
    var l1 = tr/2 + Math.sqrt(disc), l2 = tr/2 - Math.sqrt(disc);
    function s(l){ return l > 1e-12 ? -l*Math.log2(l) : 0; }
    return s(l1) + s(l2);
  };

  /* F(ρ,|ψ⟩) = ⟨ψ|ρ|ψ⟩ for a pure reference state. */
  function fidelityToPure(rho, psiRe, psiIm) {
    var D = rho.D, acc = 0;
    for (var i = 0; i < D; i++) {
      var sr = 0, si = 0;
      for (var j = 0; j < D; j++) {
        var rr = rho.re[i*D+j], ri = rho.im[i*D+j];
        sr += rr*psiRe[j] - ri*psiIm[j];
        si += rr*psiIm[j] + ri*psiRe[j];
      }
      acc += psiRe[i]*sr + psiIm[i]*si;
    }
    return Math.min(Math.max(acc, 0), 1);
  }

  /* ── state vector, used for the noiseless reference ─────── */
  function Psi(n){
    this.n=n; this.D=1<<n;
    this.re=new Float64Array(this.D); this.im=new Float64Array(this.D);
    this.re[0]=1;
  }
  Psi.prototype.apply1=function(m,q,ctrl){
    var bit=1<<q, cbit=(ctrl===undefined||ctrl===null)?-1:(1<<ctrl);
    for(var i=0;i<this.D;i++){
      if(i&bit) continue;
      if(cbit>=0 && !(i&cbit)) continue;
      var j=i|bit, ar=this.re[i],ai=this.im[i],br=this.re[j],bi=this.im[j];
      this.re[i]=m[0]*ar-m[1]*ai+m[2]*br-m[3]*bi;
      this.im[i]=m[0]*ai+m[1]*ar+m[2]*bi+m[3]*br;
      this.re[j]=m[4]*ar-m[5]*ai+m[6]*br-m[7]*bi;
      this.im[j]=m[4]*ai+m[5]*ar+m[6]*bi+m[7]*br;
    }
  };
  Psi.prototype.swap=function(a,b){
    var ba=1<<a,bb=1<<b;
    for(var i=0;i<this.D;i++){
      var x=(i&ba)!==0,y=(i&bb)!==0;
      if(x===y) continue;
      var j=i^ba^bb; if(j<i) continue;
      var t=this.re[i];this.re[i]=this.re[j];this.re[j]=t;
      t=this.im[i];this.im[i]=this.im[j];this.im[j]=t;
    }
  };

  function runIdeal(circuit){
    var st=new Psi(circuit.qubits);
    circuit.ops.slice().sort(function(a,b){return a.col-b.col;}).forEach(function(op){
      if(op.type==='M') return;
      if(op.type==='SWAP') st.swap(op.q,op.control);
      else if(op.type==='CNOT') st.apply1(G.X,op.q,op.control);
      else if(op.type==='CZ') st.apply1(G.Z,op.q,op.control);
      else st.apply1(matrixFor(op),op.q,null);
    });
    return st;
  }

  /* ══════════════════════════════════════════════════════════
     Circuit simulation
     ══════════════════════════════════════════════════════════ */
  function simulateCircuit(circuit, opts) {
    opts = opts || {};
    var n = circuit.qubits;
    var noise = {
      T1: opts.T1 || 0,               // microseconds, 0 disables
      T2: opts.T2 || 0,
      gate1: opts.gate1ns || 35,      // ns
      gate2: opts.gate2ns || 300,
      depol1: opts.depol1 || 0,
      depol2: opts.depol2 || 0,
      readout: opts.readout || 0
    };
    var noisy = !!(noise.T1 || noise.T2 || noise.depol1 || noise.depol2 || noise.readout);

    var ideal = runIdeal(circuit);
    var idealProbs = new Float64Array(ideal.D);
    for (var k = 0; k < ideal.D; k++) idealProbs[k] = ideal.re[k]*ideal.re[k] + ideal.im[k]*ideal.im[k];

    var ops = circuit.ops.slice().sort(function(a,b){return a.col-b.col;});
    var cols = {}; ops.forEach(function(o){cols[o.col]=1;});
    var depth = Object.keys(cols).length;
    var twoQ = ops.filter(function(o){return o.control!==undefined && o.type!=='M';}).length;

    /* Density matrix is 4ⁿ; beyond 6 qubits that stops being
       interactive, so fall back to the pure-state path. */
    var useRho = noisy && n <= 6;
    var rho = null, probs, purity = 1, fidelity = 1, ent = [], bloch = [];
    var totalNs = 0;

    if (useRho) {
      rho = new Rho(n);
      ops.forEach(function (op) {
        if (op.type === 'M') return;
        var two = op.control !== undefined;
        var dur = two ? noise.gate2 : noise.gate1;
        totalNs += dur;

        if (op.type === 'SWAP') rho.swap(op.q, op.control);
        else if (op.type === 'CNOT') rho.unitary1(G.X, op.q, op.control);
        else if (op.type === 'CZ') rho.unitary1(G.Z, op.q, op.control);
        else rho.unitary1(matrixFor(op), op.q, null);

        var touched = two ? [op.q, op.control] : [op.q];
        touched.forEach(function (q) {
          var p = two ? noise.depol2 : noise.depol1;
          if (p > 0) rho.kraus1(depol(p), q);
          if (noise.T1 > 0) {
            var g = 1 - Math.exp(-(dur/1000) / noise.T1);
            if (g > 1e-12) rho.kraus1(ampDamp(g), q);
          }
          if (noise.T2 > 0) {
            /* Pure dephasing rate follows 1/Tφ = 1/T2 − 1/(2T1). */
            var invTphi = 1/noise.T2 - (noise.T1 > 0 ? 1/(2*noise.T1) : 0);
            if (invTphi > 0) {
              var l = 1 - Math.exp(-(dur/1000) * invTphi);
              if (l > 1e-12) rho.kraus1(phaseDamp(l), q);
            }
          }
        });
      });

      probs = rho.probs();
      purity = rho.purity();
      fidelity = fidelityToPure(rho, ideal.re, ideal.im);
      for (var q1 = 0; q1 < n; q1++) { ent.push(rho.entropy1(q1)); bloch.push(rho.bloch(q1)); }
    } else {
      probs = idealProbs;
      var pn = new Psi(n);
      pn.re = ideal.re; pn.im = ideal.im;
      for (var q2 = 0; q2 < n; q2++) {
        /* single-qubit reduced state straight from the amplitudes */
        var bit = 1<<q2, a00=0,a11=0,a01r=0,a01i=0;
        for (var i2 = 0; i2 < ideal.D; i2++) {
          if (i2 & bit) continue;
          var j2 = i2|bit;
          a00 += ideal.re[i2]*ideal.re[i2] + ideal.im[i2]*ideal.im[i2];
          a11 += ideal.re[j2]*ideal.re[j2] + ideal.im[j2]*ideal.im[j2];
          a01r += ideal.re[i2]*ideal.re[j2] + ideal.im[i2]*ideal.im[j2];
          a01i += ideal.im[i2]*ideal.re[j2] - ideal.re[i2]*ideal.im[j2];
        }
        var tr=a00+a11, det=a00*a11-(a01r*a01r+a01i*a01i);
        var disc=Math.max(tr*tr/4-det,0);
        var l1=tr/2+Math.sqrt(disc), l2=tr/2-Math.sqrt(disc);
        function s(l){return l>1e-12?-l*Math.log2(l):0;}
        ent.push(s(l1)+s(l2));
        bloch.push({x:2*a01r, y:-2*a01i, z:a00-a11});
      }
      ops.forEach(function(o){ totalNs += (o.control!==undefined ? noise.gate2 : noise.gate1); });
    }

    /* Readout error: symmetric bit flip on each measured qubit. */
    if (noise.readout > 0) {
      var e = noise.readout, D = 1<<n;
      var out = new Float64Array(D);
      for (var a = 0; a < D; a++) {
        if (probs[a] <= 0) continue;
        for (var b = 0; b < D; b++) {
          var diff = a ^ b, flips = 0;
          for (var t = 0; t < n; t++) if (diff & (1<<t)) flips++;
          out[b] += probs[a] * Math.pow(e, flips) * Math.pow(1-e, n-flips);
        }
      }
      probs = out;
    }

    /* Sampled counts, so the histogram reflects a finite shot budget. */
    var shots = opts.shots || 0;
    var counts = null;
    if (shots > 0) {
      var rand = mulberry(opts.seed || 0x9E3779B9);
      counts = new Float64Array(probs.length);
      var cum = new Float64Array(probs.length), run = 0;
      for (var ci = 0; ci < probs.length; ci++) { run += probs[ci]; cum[ci] = run; }
      for (var s2 = 0; s2 < shots; s2++) {
        var r2 = rand() * run, lo = 0, hi = cum.length - 1;
        while (lo < hi) { var mid = (lo+hi)>>1; if (cum[mid] < r2) lo = mid+1; else hi = mid; }
        counts[lo]++;
      }
      for (var ck = 0; ck < counts.length; ck++) counts[ck] /= shots;
    }

    return {
      probs: probs, idealProbs: idealProbs, counts: counts,
      rho: rho, mixed: useRho,
      fidelity: fidelity, purity: purity,
      entropy: ent, bloch: bloch,
      depth: depth, gates: ops.length, twoQubit: twoQ,
      durationNs: totalNs, qubits: n
    };
  }

  function mulberry(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a>>>15, 1 | a);
      t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };
  }

  /* ══════════════════════════════════════════════════════════
     Network
     ══════════════════════════════════════════════════════════ */
  var C_FIBRE = 2.0e5;          // km/s in fibre
  var ATTEN = 0.2;              // dB/km

  function transmittance(km){ return Math.pow(10, -(ATTEN*km)/10); }
  function binEnt(e){ return (e<=0||e>=1) ? 0 : -e*Math.log2(e)-(1-e)*Math.log2(1-e); }

  /* One elementary link, source at the midpoint. */
  function linkMetrics(km, p) {
    var half = transmittance(km/2);
    var eta = p.detEff === undefined ? 0.9 : p.detEff;
    var pDet = half*half*eta*eta;
    var modes = Math.max(1, p.multiplex || 1);
    var pSucc = 1 - Math.pow(1 - pDet, modes);

    var travel = km / C_FIBRE;                     // one-way, s
    var attemptRate = Math.min(p.sourceRate || 1e7, 1/travel);
    var rate = pSucc * attemptRate;

    /* Dark counts raise the error floor once the signal is weak. */
    var dark = (p.darkRate || 0) * (p.gateWindow || 1e-9);
    var snr = pDet / (pDet + 4*dark + 1e-18);

    var srcF = p.srcFidelity === undefined ? 0.98 : p.srcFidelity;
    var w0 = (4*srcF - 1) / 3;
    var held = travel;
    var decay = Math.exp(-held / (p.memoryT2 || 0.01));
    var w = w0 * decay * snr;

    return {
      rate: rate, pSucc: pSucc, werner: w,
      fidelity: (3*w + 1)/4, latency: travel, snr: snr
    };
  }

  /* A chain of segments joined by entanglement swapping. */
  function chainMetrics(totalKm, segments, p) {
    segments = Math.max(1, segments);
    var seg = totalKm / segments;
    var link = linkMetrics(seg, p);

    var swapP = p.swapSuccess === undefined ? 0.5 : p.swapSuccess;
    var swapQ = p.swapQuality === undefined ? 0.97 : p.swapQuality;

    var w = Math.pow(link.werner, segments) * Math.pow(swapQ, segments-1);
    var fidelity = (3*w + 1)/4;

    /* Waiting for k links to be ready simultaneously, then surviving
       the swap chain. The (3/2)^log2 k factor is the standard
       approximation for the coincidence penalty. */
    var coincidence = Math.pow(1.5, Math.log2(segments));
    var rate = link.rate / coincidence * Math.pow(swapP, segments-1);

    var qber = 2*(1-fidelity)/3;
    var keyFrac = Math.max(0, 1 - 2*binEnt(qber));

    return {
      rate: rate, fidelity: fidelity, qber: qber, keyRate: rate*keyFrac,
      latency: totalKm / C_FIBRE, segments: segments, segmentKm: seg,
      linkRate: link.rate, linkFidelity: link.fidelity, swapSurvival: Math.pow(swapP, segments-1)
    };
  }

  function sweep(maxKm, segments, p, points) {
    points = points || 44;
    var out = [];
    for (var i = 1; i <= points; i++) {
      var km = maxKm*i/points;
      var m = chainMetrics(km, segments, p);
      out.push({ km: km, rate: m.rate, fidelity: m.fidelity, keyRate: m.keyRate, qber: m.qber });
    }
    return out;
  }

  /* Compare segment counts at a fixed distance — shows the optimum. */
  function segmentSweep(totalKm, maxSeg, p) {
    var out = [];
    for (var s = 1; s <= maxSeg; s++) {
      var m = chainMetrics(totalKm, s, p);
      out.push({ segments: s, rate: m.rate, fidelity: m.fidelity, keyRate: m.keyRate });
    }
    return out;
  }

  /* ── routing ───────────────────────────────────────────────
     Dijkstra over fibre length, so a path through repeaters is
     found the way a real control plane would find it.
     ─────────────────────────────────────────────────────────── */
  function shortestPath(nodes, links, fromId, toId) {
    var dist = {}, prev = {}, unvisited = {};
    nodes.forEach(function (n) { dist[n.id] = Infinity; unvisited[n.id] = true; });
    if (dist[fromId] === undefined || dist[toId] === undefined) return null;
    dist[fromId] = 0;

    var adj = {};
    links.forEach(function (l) {
      (adj[l.a] = adj[l.a] || []).push({ to: l.b, km: l.km });
      (adj[l.b] = adj[l.b] || []).push({ to: l.a, km: l.km });
    });

    while (true) {
      var u = null, best = Infinity;
      for (var id in unvisited) if (dist[id] < best) { best = dist[id]; u = id; }
      if (u === null) break;
      u = isNaN(+u) ? u : +u;
      if (u === toId) break;
      delete unvisited[u];
      (adj[u] || []).forEach(function (e) {
        if (!unvisited[e.to]) return;
        var alt = dist[u] + e.km;
        if (alt < dist[e.to]) { dist[e.to] = alt; prev[e.to] = u; }
      });
    }
    if (!isFinite(dist[toId])) return null;

    var path = [toId], cur = toId;
    while (cur !== fromId) { cur = prev[cur]; if (cur === undefined) return null; path.unshift(cur); }
    return { path: path, km: dist[toId], hops: path.length - 1 };
  }

  /* ══════════════════════════════════════════════════════════
     Distributed: circuits inside QPUs, entanglement between them
     ══════════════════════════════════════════════════════════ */
  /* spec = { qpus, nodes, edges, cuts }
       qpus  — nodes that run a circuit: { id, label, qubits, ops }
       nodes — every routable node, QPUs and repeaters alike
       edges — fibre links: { a, b, km }
       cuts  — two-qubit gates spanning QPUs: { a, b }
     Keeping nodes separate from qpus is what lets a path run through
     repeaters that host no circuit of their own. */
  function distributed(spec, p) {
    var qpus = spec.qpus || [];
    var nodes = spec.nodes && spec.nodes.length ? spec.nodes : qpus;
    var edges = spec.edges || [];
    var cuts = spec.cuts || [];

    /* Every QPU runs its own local circuit. */
    var local = qpus.map(function (q) {
      return {
        id: q.id, label: q.label,
        result: simulateCircuit({ qubits: q.qubits, ops: q.ops || [] }, p)
      };
    });

    /* Each cut is a two-qubit gate spanning two QPUs. Route it. */
    var routed = cuts.map(function (cut) {
      var r = shortestPath(nodes, edges, cut.a, cut.b);
      if (!r) return { cut: cut, reachable: false };
      var m = chainMetrics(r.km, Math.max(1, r.hops), p);
      return { cut: cut, reachable: true, km: r.km, hops: r.hops, path: r.path, net: m };
    });

    var usable = routed.filter(function (r) { return r.reachable; });
    var ebits = usable.length;
    var linkF = usable.length
      ? usable.reduce(function (a, r) { return a * r.net.fidelity; }, 1)
      : 1;

    /* Teleported gate fidelity is bounded by the pair it consumes. */
    var localF = local.reduce(function (a, l) { return a * l.result.fidelity; }, 1);
    var endToEnd = localF * linkF;

    var slowest = usable.reduce(function (a, r) {
      return Math.max(a, r.net.rate > 0 ? 1/r.net.rate : Infinity);
    }, 0);
    var netLatency = usable.reduce(function (a, r) { return Math.max(a, r.net.latency); }, 0);
    var localNs = local.reduce(function (a, l) { return Math.max(a, l.result.durationNs); }, 0);

    return {
      local: local, routed: routed,
      ebits: ebits, classicalBits: ebits*2,
      unreachable: routed.length - usable.length,
      linkFidelity: linkF, localFidelity: localF, fidelity: endToEnd,
      distributionTime: slowest * ebits,
      networkLatency: netLatency,
      localTimeNs: localNs,
      totalQubits: qpus.reduce(function(a,q){return a+q.qubits;},0)
    };
  }

  root.QSim = {
    simulateCircuit: simulateCircuit, Rho: Rho, Psi: Psi,
    gates: G, matrixFor: matrixFor,
    channels: { ampDamp: ampDamp, phaseDamp: phaseDamp, depol: depol }
  };
  root.QNet = {
    linkMetrics: linkMetrics, chainMetrics: chainMetrics,
    sweep: sweep, segmentSweep: segmentSweep,
    shortestPath: shortestPath, transmittance: transmittance,
    C_FIBRE: C_FIBRE
  };
  root.QDist = { distributed: distributed };
})(window);
