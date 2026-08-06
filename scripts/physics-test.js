#!/usr/bin/env node
/* Physics regression tests for qsim.js.
   Every assertion has a known analytic answer, so a refactor that
   quietly breaks the maths fails the build instead of shipping
   plausible-looking numbers. */
'use strict';

global.window = {};
require(require('path').join(process.cwd(), 'qsim.js'));
const { QSim, QNet, QDist, QOptics } = global.window;

let fails = 0, total = 0;
function chk(name, cond, detail) {
  total++;
  if (cond) console.log('  ok    ' + name);
  else { fails++; console.log('  FAIL  ' + name + (detail !== undefined ? '  (' + detail + ')' : '')); }
}
const close = (a, b, t) => Math.abs(a - b) < (t || 1e-9);

/* ── density matrix ──────────────────────────────────────── */
console.log('\nDensity matrix');
{
  const { Rho, gates, channels } = QSim;

  const bell = new Rho(2);
  bell.unitary1(gates.H, 0, null);
  bell.unitary1(gates.X, 1, 0);                     // CNOT(0->1)
  chk('Bell: trace = 1', close(bell.trace(), 1), bell.trace());
  chk('Bell: purity = 1', close(bell.purity(), 1), bell.purity());
  const bp = bell.probs();
  chk('Bell: p(00) = p(11) = 0.5',
      close(bp[0], .5) && close(bp[3], .5) && close(bp[1], 0) && close(bp[2], 0),
      Array.from(bp).map(x => x.toFixed(3)).join(','));
  chk('Bell: 1 ebit of entanglement per qubit',
      close(bell.entropy1(0), 1, 1e-6) && close(bell.entropy1(1), 1, 1e-6),
      bell.entropy1(0).toFixed(6));

  let herm = true;
  for (let i = 0; i < bell.D; i++) for (let j = 0; j < bell.D; j++) {
    if (!close(bell.re[i * bell.D + j], bell.re[j * bell.D + i], 1e-12)) herm = false;
    if (!close(bell.im[i * bell.D + j], -bell.im[j * bell.D + i], 1e-12)) herm = false;
  }
  chk('Bell: rho is Hermitian', herm);

  const relax = new Rho(1);
  relax.unitary1(gates.X, 0, null);
  relax.kraus1(channels.ampDamp(1.0), 0);
  chk('amplitude damping g=1 sends |1> to |0>', close(relax.probs()[0], 1), relax.probs()[0]);
  chk('amplitude damping preserves trace', close(relax.trace(), 1));

  const dep = new Rho(1);
  dep.unitary1(gates.H, 0, null);
  dep.kraus1(channels.depol(1.0), 0);
  chk('depolarizing p=1 gives purity 0.5', close(dep.purity(), 0.5), dep.purity());
  chk('depolarizing preserves trace', close(dep.trace(), 1));

  const deph = new Rho(1);
  deph.unitary1(gates.H, 0, null);
  deph.kraus1(channels.phaseDamp(1.0), 0);
  const b = deph.bloch(0);
  chk('full dephasing collapses the Bloch vector',
      close(b.x, 0) && close(b.y, 0) && close(b.z, 0),
      'x=' + b.x.toFixed(3) + ' z=' + b.z.toFixed(3));
  chk('dephasing preserves trace', close(deph.trace(), 1));
}

/* ── circuit simulation ──────────────────────────────────── */
console.log('\nCircuit simulation');
{
  const ghz = { qubits: 3, ops: [
    { type: 'H', q: 0, col: 0 },
    { type: 'CNOT', q: 1, control: 0, col: 1 },
    { type: 'CNOT', q: 2, control: 1, col: 2 }] };

  const pure = QSim.simulateCircuit(ghz, {});
  chk('GHZ: p(000) = p(111) = 0.5', close(pure.probs[0], .5) && close(pure.probs[7], .5));
  chk('GHZ: fidelity 1 with no noise', close(pure.fidelity, 1));
  chk('GHZ: 1 ebit per qubit', close(pure.entropy[0], 1, 1e-6));

  const nearZero = QSim.simulateCircuit(ghz, { depol1: 1e-12 });
  let agree = true;
  for (let i = 0; i < 8; i++) if (!close(pure.probs[i], nearZero.probs[i], 1e-6)) agree = false;
  chk('density path matches pure path at ~zero noise', agree);
  chk('density path reports a mixed state', nearZero.mixed === true);

  const f = p => QSim.simulateCircuit(ghz, { depol1: p, depol2: p }).fidelity;
  chk('fidelity falls as depolarizing rises', f(0.001) > f(0.01) && f(0.01) > f(0.05),
      f(0.001).toFixed(4) + ' > ' + f(0.01).toFixed(4) + ' > ' + f(0.05).toFixed(4));

  const pur = p => QSim.simulateCircuit(ghz, { depol1: p, depol2: p }).purity;
  chk('purity falls as noise rises', pur(0.001) > pur(0.05),
      pur(0.001).toFixed(4) + ' > ' + pur(0.05).toFixed(4));

  const tf = t => QSim.simulateCircuit(ghz, { T1: t, T2: 2 * t }).fidelity;
  chk('longer coherence times give higher fidelity', tf(200) > tf(20),
      tf(200).toFixed(4) + ' > ' + tf(20).toFixed(4));

  const ro = QSim.simulateCircuit({ qubits: 1, ops: [{ type: 'X', q: 0, col: 0 }] }, { readout: 0.1 });
  chk('10% readout error misreports 10% of shots',
      close(ro.probs[0], 0.1, 1e-6) && close(ro.probs[1], 0.9, 1e-6),
      ro.probs[0].toFixed(3) + '/' + ro.probs[1].toFixed(3));

  const sh = QSim.simulateCircuit(ghz, { shots: 4000, seed: 7 });
  chk('sampled counts normalise to 1',
      close(Array.from(sh.counts).reduce((x, y) => x + y, 0), 1));
  chk('sampled counts approximate the distribution',
      Math.abs(sh.counts[0] - 0.5) < 0.03 && Math.abs(sh.counts[7] - 0.5) < 0.03,
      sh.counts[0].toFixed(3) + '/' + sh.counts[7].toFixed(3));
}

/* ── network and routing ─────────────────────────────────── */
console.log('\nNetwork and routing');
{
  const P = { detEff: 0.9, multiplex: 1, sourceRate: 1e7, srcFidelity: 0.98,
              memoryT2: 0.01, swapSuccess: 0.5, swapQuality: 0.97,
              darkRate: 0, gateWindow: 1e-9 };

  chk('fibre attenuates 0.2 dB/km: 50 km -> 0.1', close(QNet.transmittance(50), 0.1));
  chk('fibre: 100 km -> 0.01', close(QNet.transmittance(100), 0.01));

  const one = QNet.chainMetrics(100, 1, P);
  const two = QNet.chainMetrics(100, 2, P);
  const four = QNet.chainMetrics(100, 4, P);
  chk('shorter segments raise the elementary link rate', two.linkRate > one.linkRate);
  chk('more swaps lower end-to-end fidelity',
      one.fidelity > two.fidelity && two.fidelity > four.fidelity,
      one.fidelity.toFixed(4) + ' > ' + two.fidelity.toFixed(4) + ' > ' + four.fidelity.toFixed(4));
  chk('swap success compounds across hops',
      close(two.swapSurvival, 0.5) && close(four.swapSurvival, 0.125),
      '2seg=' + two.swapSurvival + ' 4seg=' + four.swapSurvival);
  chk('QBER grows with distance',
      QNet.chainMetrics(600, 4, P).qber > QNet.chainMetrics(100, 4, P).qber);
  chk('key rate collapses past the 11% QBER limit',
      QNet.chainMetrics(800, 4, P).keyRate === 0,
      'qber=' + QNet.chainMetrics(800, 4, P).qber.toFixed(3));

  const mux1 = QNet.linkMetrics(100, P);
  const mux50 = QNet.linkMetrics(100, Object.assign({}, P, { multiplex: 50 }));
  chk('multiplexing raises success probability', mux50.pSucc > mux1.pSucc,
      mux1.pSucc.toExponential(2) + ' -> ' + mux50.pSucc.toExponential(2));

  const dark = QNet.linkMetrics(200, Object.assign({}, P, { darkRate: 1e3 }));
  chk('dark counts degrade fidelity', dark.fidelity < QNet.linkMetrics(200, P).fidelity,
      dark.fidelity.toFixed(4) + ' < ' + QNet.linkMetrics(200, P).fidelity.toFixed(4));

  /* Ideal means every component ideal, including the source. A real
     SPDC source has g2 around 0.01 and those multi-photon events cost
     fidelity, so leaving g2 at its default is not an ideal link. */
  const ideal = QNet.chainMetrics(10, 1, Object.assign({}, P,
      { srcFidelity: 1, memoryT2: 1e9, detEff: 1, srcG2: 0, detector: 'snspd' }));
  chk('fully ideal components approach fidelity 1', ideal.fidelity > 0.999, ideal.fidelity.toFixed(6));

  const g2bad = QNet.chainMetrics(10, 1, Object.assign({}, P,
      { srcFidelity: 1, memoryT2: 1e9, detEff: 1, srcG2: 0.05, detector: 'snspd' }));
  chk('source multi-photon events cost fidelity', g2bad.fidelity < ideal.fidelity,
      g2bad.fidelity.toFixed(4) + ' < ' + ideal.fidelity.toFixed(4));

  const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const edges = [{ a: 1, b: 2, km: 40 }, { a: 2, b: 3, km: 40 },
                 { a: 1, b: 4, km: 200 }, { a: 4, b: 3, km: 200 }];
  const route = QNet.shortestPath(nodes, edges, 1, 3);
  chk('Dijkstra takes the short path', route && route.km === 80 && route.hops === 2,
      route ? 'km=' + route.km + ' hops=' + route.hops : 'null');
  chk('an unreachable pair returns null',
      QNet.shortestPath([{ id: 1 }, { id: 9 }], [], 1, 9) === null);

  const qpus = [
    { id: 1, label: 'Q1', qubits: 2, ops: [{ type: 'H', q: 0, col: 0 },
                                           { type: 'CNOT', q: 1, control: 0, col: 1 }] },
    { id: 3, label: 'Q2', qubits: 2, ops: [{ type: 'H', q: 0, col: 0 }] }];
  const all = qpus.concat([{ id: 2, label: 'R1', qubits: 1 }]);
  const spec = { qpus: qpus, nodes: all, edges: edges, cuts: [{ a: 1, b: 3 }] };
  const d = QDist.distributed(spec, P);

  chk('a cut across QPUs is routed', d.routed[0].reachable);
  chk('the route runs through the repeater', d.routed[0].path.join('-') === '1-2-3',
      d.routed[0].path.join('-'));
  chk('one cut consumes one entangled pair', d.ebits === 1);
  chk('two classical bits per teleported gate', d.classicalBits === 2);
  chk('end-to-end fidelity = local x link',
      close(d.fidelity, d.localFidelity * d.linkFidelity, 1e-12),
      d.fidelity.toFixed(5) + ' vs ' + (d.localFidelity * d.linkFidelity).toFixed(5));
  chk('each QPU runs its own circuit',
      d.local.length === 2 && d.local[0].result.qubits === 2);
  chk('an unroutable cut is counted, not crashed',
      QDist.distributed({ qpus: qpus, nodes: all, edges: [], cuts: [{ a: 1, b: 3 }] }, P).unreachable === 1);

  const noisy = QDist.distributed(spec, Object.assign({}, P, { depol1: 0.02, depol2: 0.02 }));
  chk('local gate noise lowers end-to-end fidelity', noisy.fidelity < d.fidelity,
      noisy.fidelity.toFixed(4) + ' < ' + d.fidelity.toFixed(4));
}

/* ── connectivity and routing ────────────────────────────── */
console.log('\nQPU topology and routing');
{

// coupling maps
chk('line on 5 qubits has 4 edges', QSim.couplingMap('line',5).length===4);
chk('ring on 5 qubits has 5 edges', QSim.couplingMap('ring',5).length===5);
chk('all-to-all on 5 has 10 edges', QSim.couplingMap('all',5).length===10);
chk('grid on 4 is a square', QSim.couplingMap('grid',4).length===4, JSON.stringify(QSim.couplingMap('grid',4)));

// distance
const adj=QSim.adjacency(5,QSim.couplingMap('line',5));
chk('line: path 0->4 has 5 nodes', QSim.qubitPath(adj,0,4).length===5);
chk('line: neighbours are adjacent', QSim.qubitPath(adj,1,2).length===2);
const ringAdj=QSim.adjacency(5,QSim.couplingMap('ring',5));
chk('ring shortens the far hop', QSim.qubitPath(ringAdj,0,4).length===2, QSim.qubitPath(ringAdj,0,4).join('-'));

// routing inserts SWAPs only when needed
const far={qubits:5,ops:[{type:'CNOT',q:4,control:0,col:0}]};
const rAll=QSim.transpile(far,'all'), rLine=QSim.transpile(far,'line');
chk('all-to-all needs no SWAPs', rAll.swaps===0, rAll.swaps);
chk('line needs 3 SWAPs for 0->4', rLine.swaps===3, rLine.swaps);
chk('routing deepens the circuit', rLine.routedDepth>rLine.nativeDepth,
    rLine.nativeDepth+' -> '+rLine.routedDepth);
const near={qubits:5,ops:[{type:'CNOT',q:1,control:0,col:0}]};
chk('adjacent gate needs no SWAP on a line', QSim.transpile(near,'line').swaps===0);

// THE critical test: routing must not change the physics
function dist(c,topo){
  const tr=QSim.transpile(c,topo||'all');
  return QSim.simulateCircuit(tr.circuit,{});
}
const ghz={qubits:4,ops:[
  {type:'H',q:0,col:0},{type:'CNOT',q:1,control:0,col:1},
  {type:'CNOT',q:2,control:1,col:2},{type:'CNOT',q:3,control:2,col:3}]};
const a=dist(ghz,'all'), l=dist(ghz,'line'), r=dist(ghz,'ring'), g=dist(ghz,'grid');
const sortP=x=>Array.from(x.probs).map(v=>+v.toFixed(9)).sort((p,q)=>q-p);
chk('GHZ outcome distribution is identical on every topology',
    JSON.stringify(sortP(a))===JSON.stringify(sortP(l)) &&
    JSON.stringify(sortP(l))===JSON.stringify(sortP(r)) &&
    JSON.stringify(sortP(r))===JSON.stringify(sortP(g)),
    'all='+sortP(a).slice(0,2)+' line='+sortP(l).slice(0,2));
chk('GHZ stays maximally entangled after routing',
    close(l.entropy[0],1,1e-6), l.entropy[0].toFixed(6));

// a swap-heavy route on real noise must cost fidelity
// A GHZ chain maps perfectly onto a line and needs no SWAPs, so it
// cannot show routing cost. Use a circuit that spans the register.
const spanning={qubits:5,ops:[
  {type:'H',q:0,col:0},{type:'CNOT',q:4,control:0,col:1},
  {type:'CNOT',q:3,control:1,col:2},{type:'CNOT',q:0,control:4,col:3}]};
const sw=o=>QSim.transpile(spanning,o).swaps;
chk('a line needs SWAPs for a spanning circuit', sw('line')>0, 'line='+sw('line')+' all='+sw('all'));
chk('all-to-all needs none', sw('all')===0);
chk('ring needs fewer SWAPs than a line', sw('ring')<sw('line'), 'ring='+sw('ring')+' line='+sw('line'));
const nf=o=>QSim.simulateCircuit(QSim.transpile(spanning,o).circuit,{depol2:0.01}).fidelity;
chk('routing overhead costs fidelity', nf('line')<nf('all'),
    nf('line').toFixed(4)+' < '+nf('all').toFixed(4));
const idealLine=QSim.simulateCircuit(QSim.transpile(spanning,'line').circuit,{});
const idealAll=QSim.simulateCircuit(QSim.transpile(spanning,'all').circuit,{});
const sp=x=>Array.from(x.probs).map(v=>+v.toFixed(9)).sort((p,q)=>q-p);
chk('but noiseless physics is unchanged by routing',
    JSON.stringify(sp(idealLine))===JSON.stringify(sp(idealAll)));

// roles
const roles=['data','data','ancilla','comm'];
const rc=QSim.roleCheck({ops:[]},roles);
chk('roles counted', rc.data===2&&rc.ancilla===1&&rc.comm===1,
    JSON.stringify(rc));

}

/* ── optical layer ───────────────────────────────────────── */
console.log('\nOptical layer');
{

// known engineering values
const b=QOptics.linkBudget(100,{fibre:'smf28',wavelength:1550,connectors:2});
chk('SMF-28 @1550 is 0.2 dB/km', close(b.perKm,0.20), b.perKm);
chk('100 km of fibre = 20 dB', close(b.fibreDb,20), b.fibreDb);
chk('2 connectors = 0.6 dB', close(b.connectorDb,0.6), b.connectorDb);
chk('100 km needs 20 splices = 1.0 dB', b.splices===20&&close(b.spliceDb,1.0), b.splices+'/'+b.spliceDb);
chk('coupling in+out = 2 dB', close(b.couplingDb,2.0));
chk('total budget = 23.6 dB', close(b.totalDb,23.6,1e-9), b.totalDb);
chk('transmittance matches 10^(-dB/10)', close(b.transmittance,Math.pow(10,-2.36),1e-12), b.transmittance.toExponential(3));

// wavelength matters
const at1310=QOptics.linkBudget(100,{wavelength:1310}).totalDb;
const at1550=QOptics.linkBudget(100,{wavelength:1550}).totalDb;
chk('1310nm is lossier than 1550nm', at1310>at1550, at1310.toFixed(1)+' > '+at1550.toFixed(1));
chk('850nm is far worse', QOptics.linkBudget(100,{wavelength:850}).totalDb>200);

// fibre grades
const ull=QOptics.linkBudget(200,{fibre:'ull'}).totalDb;
const std=QOptics.linkBudget(200,{fibre:'smf28'}).totalDb;
const leg=QOptics.linkBudget(200,{fibre:'legacy'}).totalDb;
chk('ultra-low-loss beats standard beats legacy', ull<std&&std<leg,
    ull.toFixed(1)+' < '+std.toFixed(1)+' < '+leg.toFixed(1));
chk('ULL saves ~8 dB over 200 km', close(std-ull,8,0.01), (std-ull).toFixed(2));

// detectors
const P={fibre:'smf28',wavelength:1550,multiplex:1,srcFidelity:0.98,memoryT2:0.01,source:'spdc'};
const snspd=QNet.linkMetrics(100,Object.assign({},P,{detector:'snspd'}));
const apd=QNet.linkMetrics(100,Object.assign({},P,{detector:'apd'}));
chk('SNSPD beats InGaAs APD on rate', snspd.rate>apd.rate,
    snspd.rate.toExponential(2)+' > '+apd.rate.toExponential(2));
chk('SNSPD beats APD on fidelity', snspd.fidelity>apd.fidelity,
    snspd.fidelity.toFixed(4)+' > '+apd.fidelity.toFixed(4));
chk('APD dead time caps its rate ceiling', apd.detCeiling===1e6, apd.detCeiling);
chk('SNSPD ceiling is 50 MHz', close(snspd.detCeiling,5e7), snspd.detCeiling);
chk('coincidence window is at least 100 ps', snspd.window>=100e-12, (snspd.window*1e12).toFixed(0)+' ps');

// dark counts dominate at long range
const near=QNet.linkMetrics(20,Object.assign({},P,{detector:'apd'}));
const far=QNet.linkMetrics(300,Object.assign({},P,{detector:'apd'}));
chk('SNR collapses with distance', far.snr<near.snr,
    near.snr.toFixed(4)+' -> '+far.snr.toFixed(6));
chk('fidelity follows SNR down', far.fidelity<near.fidelity);

// ULL fibre should extend usable range
const stdF=QNet.linkMetrics(250,Object.assign({},P,{fibre:'smf28',detector:'snspd'})).rate;
const ullF=QNet.linkMetrics(250,Object.assign({},P,{fibre:'ull',detector:'snspd'})).rate;
chk('ULL fibre raises rate at 250 km', ullF>stdF, stdF.toExponential(2)+' -> '+ullF.toExponential(2));

// budget must be monotonic in every term
chk('more connectors cost more', QOptics.linkBudget(50,{connectors:6}).totalDb>QOptics.linkBudget(50,{connectors:2}).totalDb);
chk('longer span costs more', QOptics.linkBudget(200,{}).totalDb>QOptics.linkBudget(100,{}).totalDb);
chk('zero length still has fixed losses', QOptics.linkBudget(0,{}).totalDb>0, QOptics.linkBudget(0,{}).totalDb);

}

/* ── invariants that must hold for any input ─────────────── */
console.log('\nInvariants under adversarial input');
{
  const P = { detector: 'snspd', source: 'spdc', fibre: 'smf28', wavelength: 1550,
              srcFidelity: 0.98, memoryT2: 0.01, swapSuccess: 0.5,
              swapQuality: 0.97, multiplex: 1 };
  let finite = true, ranged = true, probs = true, qberOk = true, keyOk = true;

  [[0,1],[0.001,1],[1e5,1],[100,64]].forEach(c => {
    const m = QNet.chainMetrics(c[0], c[1], P);
    ['rate','fidelity','qber','keyRate','latency'].forEach(k => {
      if (!isFinite(m[k])) finite = false;
    });
  });
  chk('no NaN or Infinity for degenerate spans or segment counts', finite);

  [1,10,100,500,1000,5000].forEach(km => {
    const f = QNet.chainMetrics(km, 4, P).fidelity;
    if (f < 0.24 || f > 1.0001) ranged = false;
  });
  chk('fidelity stays between the mixed-state floor and 1', ranged);

  [1,50,200,1000].forEach(km => {
    const m = QNet.linkMetrics(km, P);
    if (m.pSucc < 0 || m.pSucc > 1 || m.snr < 0 || m.snr > 1.0001) probs = false;
  });
  chk('success probability and SNR stay in [0,1]', probs);

  [100,1000,5000].forEach(km => { if (QNet.chainMetrics(km,4,P).qber > 0.5001) qberOk = false; });
  chk('QBER never exceeds a coin flip', qberOk);

  [500,2000].forEach(km => { if (QNet.chainMetrics(km,4,P).keyRate < 0) keyOk = false; });
  chk('key rate floors at zero rather than going negative', keyOk);

  let survived = true;
  try { QNet.linkMetrics(50, Object.assign({}, P,
    { detector: 'nonsense', fibre: 'nope', source: 'bogus' })); }
  catch (e) { survived = false; }
  chk('unknown component names fall back instead of crashing', survived);
}

/* ── detector choice: the reason quantum networks use SNSPDs ─ */
console.log('\nDetector physics at range');
{
  const base = { source: 'spdc', fibre: 'smf28', wavelength: 1550,
                 srcFidelity: 0.98, memoryT2: 0.01, multiplex: 1, connectors: 2 };
  const at = (km, d) => QNet.linkMetrics(km, Object.assign({}, base, { detector: d }));

  const near_s = at(50, 'snspd'), near_a = at(50, 'apd');
  chk('at short range detector choice barely affects fidelity',
      Math.abs(near_s.fidelity - near_a.fidelity) < 0.01,
      near_s.fidelity.toFixed(4) + ' vs ' + near_a.fidelity.toFixed(4));

  const far_s = at(500, 'snspd'), far_a = at(500, 'apd');
  chk('at long range dark counts destroy the APD link',
      far_a.fidelity < far_s.fidelity - 0.3,
      far_s.fidelity.toFixed(4) + ' vs ' + far_a.fidelity.toFixed(4));
  chk('the APD falls below the entanglement threshold at 500 km',
      far_a.fidelity < 0.5, far_a.fidelity.toFixed(4));
  chk('the SNSPD stays above it', far_s.fidelity > 0.5, far_s.fidelity.toFixed(4));
  chk('SNR is what collapses', far_a.snr < 0.2 && far_s.snr > 0.9,
      far_a.snr.toFixed(4) + ' vs ' + far_s.snr.toFixed(4));
}

console.log('\n  ' + (fails
  ? fails + ' FAILURE(S) of ' + total
  : 'all ' + total + ' physics tests passed') + '\n');
process.exit(fails ? 1 : 0);
