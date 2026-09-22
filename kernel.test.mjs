import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hysteresisGate, runSeries } from './kernel.mjs';

// --- input validation: value ---
test('rejects non-number value', () => {
  const r = hysteresisGate('0.9', false);
  assert.equal(r.ok, false);
  assert.match(r.why, /value/);
});
test('rejects NaN value', () => {
  assert.equal(hysteresisGate(NaN, false).ok, false);
});
test('rejects Infinity value', () => {
  assert.equal(hysteresisGate(Infinity, false).ok, false);
  assert.equal(hysteresisGate(-Infinity, false).ok, false);
});

// --- input validation: opts ---
test('rejects non-object opts', () => {
  const r = hysteresisGate(0.9, false, 'nope');
  assert.equal(r.ok, false);
  assert.match(r.why, /opts/);
});
test('rejects null opts', () => {
  assert.equal(hysteresisGate(0.9, false, null).ok, false);
});
test('rejects non-number enterAt', () => {
  const r = hysteresisGate(0.9, false, { enterAt: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.why, /enterAt/);
});
test('rejects non-number exitAt', () => {
  const r = hysteresisGate(0.9, false, { exitAt: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.why, /exitAt/);
});
test('rejects exitAt above enterAt', () => {
  const r = hysteresisGate(0.9, false, { enterAt: 0.5, exitAt: 0.7 });
  assert.equal(r.ok, false);
  assert.equal(r.why, 'opts.exitAt must be <= opts.enterAt (exit cannot sit above enter)');
});
test('accepts exitAt exactly equal to enterAt', () => {
  const r = hysteresisGate(0.6, false, { enterAt: 0.6, exitAt: 0.6 });
  assert.equal(r.ok, true);
});

// --- input validation: prevOpen ---
test('rejects string prevOpen', () => {
  const r = hysteresisGate(0.9, 'open');
  assert.equal(r.ok, false);
  assert.match(r.why, /prevOpen/);
});
test('rejects numeric prevOpen', () => {
  assert.equal(hysteresisGate(0.9, 1).ok, false);
});
test('treats null prevOpen as closed', () => {
  const r = hysteresisGate(0.9, null, { enterAt: 0.7 });
  assert.equal(r.ok, true);
  assert.equal(r.open, true);
  assert.equal(r.reason, 'opened');
});
test('treats undefined prevOpen as closed', () => {
  const r = hysteresisGate(0.9, undefined, { enterAt: 0.7 });
  assert.equal(r.open, true);
});

// --- core hysteresis behavior, default thresholds enterAt=0.7 exitAt=0.5 ---
test('closed, below enter: stays closed', () => {
  const r = hysteresisGate(0.6, false);
  assert.deepEqual(r, { ok: true, open: false, reason: 'held-closed' });
});
test('closed, at enter exactly: opens', () => {
  const r = hysteresisGate(0.7, false);
  assert.equal(r.open, true);
  assert.equal(r.reason, 'opened');
});
test('closed, just below enter: stays closed', () => {
  const r = hysteresisGate(0.699, false);
  assert.equal(r.open, false);
  assert.equal(r.reason, 'held-closed');
});
test('closed, above enter: opens', () => {
  const r = hysteresisGate(0.95, false);
  assert.equal(r.open, true);
  assert.equal(r.reason, 'opened');
});

test('open, above exit: stays open (this is the whole point)', () => {
  const r = hysteresisGate(0.6, true);
  assert.equal(r.open, true);
  assert.equal(r.reason, 'held-open');
});
test('open, at exit exactly: stays open', () => {
  const r = hysteresisGate(0.5, true);
  assert.equal(r.open, true);
  assert.equal(r.reason, 'held-open');
});
test('open, just below exit: closes', () => {
  const r = hysteresisGate(0.499, true);
  assert.equal(r.open, false);
  assert.equal(r.reason, 'closed');
});
test('open, well below exit: closes', () => {
  const r = hysteresisGate(0.1, true);
  assert.equal(r.open, false);
  assert.equal(r.reason, 'closed');
});

// This is the actual defect hysteresis exists to prevent: a value sitting between the two
// thresholds must NOT open a closed gate and must NOT close an open gate.
test('the dead band: value between thresholds holds whatever state it already had', () => {
  const band = 0.6; // strictly between exitAt(0.5) and enterAt(0.7)
  const fromClosed = hysteresisGate(band, false);
  const fromOpen = hysteresisGate(band, true);
  assert.equal(fromClosed.open, false);
  assert.equal(fromOpen.open, true);
});

// --- custom thresholds ---
test('custom thresholds are honored, not the defaults', () => {
  const r = hysteresisGate(0.3, false, { enterAt: 0.2, exitAt: 0.1 });
  assert.equal(r.open, true);
});
test('negative thresholds are valid, ordering is what matters', () => {
  const r = hysteresisGate(-5, false, { enterAt: -10, exitAt: -20 });
  assert.equal(r.open, true);
});
test('explicit exitAt is actually used when open, not silently replaced by the default', () => {
  // prevOpen:true routes through exitAt, not enterAt — this is the only path that can catch
  // a default-substitution bug on the exitAt line.
  const r = hysteresisGate(0.3, true, { enterAt: 0.9, exitAt: 0.2 });
  assert.equal(r.open, true);
  assert.equal(r.reason, 'held-open');
  // and the mirror case: a value that clears the explicit exit but not the default 0.5
  const r2 = hysteresisGate(0.3, true, { enterAt: 0.9, exitAt: 0.5 });
  assert.equal(r2.open, false);
  assert.equal(r2.reason, 'closed');
});

// --- runSeries validation ---
test('runSeries rejects non-array', () => {
  const r = runSeries('not an array');
  assert.equal(r.ok, false);
  assert.match(r.why, /array/);
});
test('runSeries rejects empty array', () => {
  const r = runSeries([]);
  assert.equal(r.ok, false);
  assert.match(r.why, /empty/);
});
test('runSeries rejects a non-number element anywhere in the array', () => {
  assert.equal(runSeries([0.9, 0.8, 'x']).ok, false);
  assert.equal(runSeries(['x', 0.8]).ok, false);
});
test('runSeries rejects non-object opts', () => {
  assert.equal(runSeries([0.9], 5).ok, false);
});
test('runSeries rejects non-number naiveThreshold', () => {
  const r = runSeries([0.9], { naiveThreshold: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.why, /naiveThreshold/);
});
test('runSeries propagates a bad threshold pairing from the underlying gate', () => {
  const r = runSeries([0.9, 0.8], { enterAt: 0.1, exitAt: 0.9 });
  assert.equal(r.ok, false);
});

// --- runSeries core: the actual point of the kernel ---
test('runSeries on a single value matches a single hysteresisGate call', () => {
  const r = runSeries([0.9]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.states, [true]);
  assert.equal(r.flapCount, 0);
});

test('runSeries: a value oscillating inside the dead band never flaps the hysteresis gate, but flaps the naive one', () => {
  // naiveThreshold defaults to enterAt (0.7); this sequence dances around 0.6, which is
  // below enter (so naive reads it as "closed" on every single sample -> no flapping here).
  // Use a sequence that actually straddles the naive threshold to prove the contrast.
  const series = [0.75, 0.68, 0.72, 0.65, 0.71, 0.66]; // straddles naive=0.7 every step
  const r = runSeries(series, { enterAt: 0.7, exitAt: 0.5 });
  assert.equal(r.ok, true);
  // naive (single threshold, no memory) flaps on nearly every step
  assert.equal(r.naiveFlapCount, 5);
  // hysteresis: opens once at 0.75, then 0.68/0.72/0.65/0.71/0.66 are all >= exitAt(0.5) -> held open throughout
  assert.deepEqual(r.states, [true, true, true, true, true, true]);
  assert.equal(r.flapCount, 0);
});

test('runSeries: a real drop below exit still closes the hysteresis gate', () => {
  const series = [0.9, 0.6, 0.3, 0.6, 0.9];
  const r = runSeries(series, { enterAt: 0.7, exitAt: 0.5 });
  assert.equal(r.ok, true);
  // 0.9 opens; 0.6 holds open (>=0.5); 0.3 closes (<0.5); 0.6 stays closed (<0.7 enter); 0.9 reopens
  assert.deepEqual(r.states, [true, true, false, false, true]);
  assert.equal(r.flapCount, 2);
});

test('runSeries: naiveThreshold overrides enterAt for the comparison only, not the gate', () => {
  const series = [0.55, 0.55, 0.55];
  const r = runSeries(series, { enterAt: 0.7, exitAt: 0.5, naiveThreshold: 0.5 });
  assert.equal(r.ok, true);
  // hysteresis: 0.55 never reaches enter(0.7) -> stays closed the whole time
  assert.deepEqual(r.states, [false, false, false]);
  // naive at 0.5: 0.55 >= 0.5 every time -> open every time, no flapping either (both zero, but for different reasons)
  assert.deepEqual(r.naiveStates, [true, true, true]);
  assert.equal(r.naiveThreshold, 0.5);
});

test('runSeries: all-open series has zero flaps in both models', () => {
  const r = runSeries([0.9, 0.95, 0.99]);
  assert.equal(r.flapCount, 0);
  assert.equal(r.naiveFlapCount, 0);
});

test('runSeries: all-closed series has zero flaps in both models', () => {
  const r = runSeries([0.1, 0.05, 0.2]);
  assert.equal(r.flapCount, 0);
  assert.equal(r.naiveFlapCount, 0);
});

test('runSeries: naive comparison is inclusive at the threshold (>=, not >)', () => {
  const r = runSeries([0.5, 0.5], { naiveThreshold: 0.5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.naiveStates, [true, true]);
});

test('runSeries: its own explicit exitAt default is actually used, not silently replaced', () => {
  // runSeries computes its own enterAt/exitAt defaults before handing them to hysteresisGate
  // per step; this isolates THAT computation (distinct from hysteresisGate's own).
  const r = runSeries([0.9, 0.3], { exitAt: 0.2 }); // enterAt defaults to 0.7
  assert.equal(r.ok, true);
  // 0.9 opens (>=0.7 enter); 0.3 held open because 0.3 >= exitAt(0.2)
  assert.deepEqual(r.states, [true, true]);
});
