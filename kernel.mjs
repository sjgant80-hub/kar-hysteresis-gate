// HysteresisGate — a two-threshold (enter/exit) gate for a noisy live signal, so a value
// hovering near one shared boundary cannot flap open/closed on every single read.
//
// The problem: a bare `value >= threshold` check on a noisy signal — a health probe, an
// attestation score, a door-queue vote share — flips state every time the signal jitters
// across that one line. HysteresisGate separates "what it takes to open" (enterAt) from
// "what it takes to stay open" (exitAt), with enterAt >= exitAt, so a value that's already
// open rides out small dips before it actually closes, and a value that's closed needs a
// real rise before it opens. Total functions: never throw on bad input, always say why.

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// hysteresisGate(value, prevOpen, opts) -> { ok, open, reason } | { ok:false, why }
//   value     — the current noisy reading
//   prevOpen  — true|false|null (null/undefined = no prior state, treated as closed)
//   opts.enterAt — threshold to OPEN from closed (default 0.7)
//   opts.exitAt  — threshold to STAY open once open (default 0.5); must be <= enterAt
export function hysteresisGate(value, prevOpen, opts = {}) {
  if (!isFiniteNumber(value)) return { ok: false, why: 'value must be a finite number' };
  if (opts === null || typeof opts !== 'object') return { ok: false, why: 'opts must be an object' };

  const enterAt = opts.enterAt === undefined ? 0.7 : opts.enterAt;
  const exitAt = opts.exitAt === undefined ? 0.5 : opts.exitAt;
  if (!isFiniteNumber(enterAt)) return { ok: false, why: 'opts.enterAt must be a finite number' };
  if (!isFiniteNumber(exitAt)) return { ok: false, why: 'opts.exitAt must be a finite number' };
  if (exitAt > enterAt) return { ok: false, why: 'opts.exitAt must be <= opts.enterAt (exit cannot sit above enter)' };

  let wasOpen;
  if (prevOpen === true || prevOpen === false) wasOpen = prevOpen;
  else if (prevOpen === null || prevOpen === undefined) wasOpen = false;
  else return { ok: false, why: 'prevOpen must be true, false, null, or undefined' };

  const open = wasOpen ? value >= exitAt : value >= enterAt;
  let reason;
  if (wasOpen && open) reason = 'held-open';
  else if (wasOpen && !open) reason = 'closed';
  else if (!wasOpen && open) reason = 'opened';
  else reason = 'held-closed';

  return { ok: true, open, reason };
}

// runSeries(values, opts) -> { ok, states, flapCount, naiveStates, naiveFlapCount, naiveThreshold }
// Feeds a whole series through hysteresisGate (starting closed) and, for comparison, through
// a naive single-threshold check (opts.naiveThreshold, default = opts.enterAt) that has no
// memory of the previous read at all. flapCount counts open<->closed transitions in each.
export function runSeries(values, opts = {}) {
  if (!Array.isArray(values)) return { ok: false, why: 'values must be an array' };
  if (values.length === 0) return { ok: false, why: 'values must not be empty' };
  for (const v of values) if (!isFiniteNumber(v)) return { ok: false, why: 'every value must be a finite number' };
  if (opts === null || typeof opts !== 'object') return { ok: false, why: 'opts must be an object' };

  const enterAt = opts.enterAt === undefined ? 0.7 : opts.enterAt;
  const exitAt = opts.exitAt === undefined ? 0.5 : opts.exitAt;
  const naiveThreshold = opts.naiveThreshold === undefined ? enterAt : opts.naiveThreshold;
  if (!isFiniteNumber(naiveThreshold)) return { ok: false, why: 'opts.naiveThreshold must be a finite number' };

  const states = [];
  let prevOpen = false;
  for (const v of values) {
    const step = hysteresisGate(v, prevOpen, { enterAt, exitAt });
    if (!step.ok) return step;
    states.push(step.open);
    prevOpen = step.open;
  }

  const naiveStates = values.map((v) => v >= naiveThreshold);

  const flaps = (arr) => {
    let n = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] !== arr[i - 1]) n++;
    return n;
  };

  return {
    ok: true,
    states,
    flapCount: flaps(states),
    naiveStates,
    naiveFlapCount: flaps(naiveStates),
    naiveThreshold,
  };
}
