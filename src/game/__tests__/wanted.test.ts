import { describe, expect, it } from 'vitest';
import {
  addHeat,
  clearWanted,
  desiredUnits,
  detectionRadius,
  initialWanted,
  setStars,
  tickWanted,
} from '../wanted';
import { WANTED } from '../config';

describe('heat escalation', () => {
  it('adds a star and resets detection', () => {
    const res = addHeat(initialWanted(), 1);
    expect(res.changed).toBe(true);
    expect(res.state.stars).toBe(1);
    expect(res.state.undetectedFor).toBe(0);
  });

  it('rate-limits repeated gains so contact cannot spam stars', () => {
    let state = addHeat(initialWanted(), 1).state;
    expect(state.stars).toBe(1);

    // An immediate second event is inside the cooldown and is ignored.
    const blocked = addHeat(state, 1);
    expect(blocked.changed).toBe(false);
    expect(blocked.state.stars).toBe(1);

    // After the cooldown elapses it lands.
    state = { ...state, sinceGain: WANTED.gainCooldown + 0.1 };
    const allowed = addHeat(state, 1);
    expect(allowed.changed).toBe(true);
    expect(allowed.state.stars).toBe(2);
  });

  it('caps at the maximum star level', () => {
    let state = setStars(initialWanted(), WANTED.maxStars);
    state = { ...state, sinceGain: 99 };
    const res = addHeat(state, 1);
    expect(res.state.stars).toBe(WANTED.maxStars);
    expect(res.changed).toBe(false);
  });

  it('can be forced to a level and cleared', () => {
    const forced = setStars(initialWanted(), 2);
    expect(forced.stars).toBe(2);
    expect(clearWanted(forced).stars).toBe(0);
    // Out-of-range values are clamped.
    expect(setStars(initialWanted(), 99).stars).toBe(WANTED.maxStars);
    expect(setStars(initialWanted(), -5).stars).toBe(0);
  });
});

describe('heat decay', () => {
  it('decays one star after staying undetected', () => {
    let state = setStars(initialWanted(), 2);
    // Just short of the threshold: no decay yet.
    state = { ...state, undetectedFor: WANTED.decaySeconds - 1 };
    let res = tickWanted(state, { dt: 0.5, detected: false, arrestable: false });
    expect(res.decayed).toBe(false);
    expect(res.state.stars).toBe(2);

    // Crossing the threshold drops exactly one star.
    res = tickWanted(res.state, { dt: 1, detected: false, arrestable: false });
    expect(res.decayed).toBe(true);
    expect(res.state.stars).toBe(1);
    expect(res.state.undetectedFor).toBe(0);
  });

  it('resets the decay countdown whenever the player is detected', () => {
    let state = setStars(initialWanted(), 1);
    state = { ...state, undetectedFor: WANTED.decaySeconds - 0.5 };
    const res = tickWanted(state, { dt: 1, detected: true, arrestable: false });
    expect(res.decayed).toBe(false);
    expect(res.state.undetectedFor).toBe(0);
    expect(res.state.stars).toBe(1);
  });

  it('does nothing at zero stars', () => {
    const res = tickWanted(initialWanted(), {
      dt: 100,
      detected: false,
      arrestable: false,
    });
    expect(res.state.stars).toBe(0);
    expect(res.decayed).toBe(false);
    expect(res.arrested).toBe(false);
  });
});

describe('arrest', () => {
  it('requires the hold to persist for the full duration', () => {
    let state = setStars(initialWanted(), 1);
    // A brief pass-by accumulates a little, then resets.
    let res = tickWanted(state, { dt: 1, detected: true, arrestable: true });
    expect(res.arrested).toBe(false);
    res = tickWanted(res.state, { dt: 1, detected: true, arrestable: false });
    expect(res.state.arrestProgress).toBe(0);

    // A sustained hold arrests.
    state = res.state;
    for (let i = 0; i < WANTED.arrestSeconds + 1; i++) {
      res = tickWanted(state, { dt: 1, detected: true, arrestable: true });
      state = res.state;
      if (res.arrested) break;
    }
    expect(res.arrested).toBe(true);
  });

  it('never arrests at zero stars', () => {
    const res = tickWanted(initialWanted(), {
      dt: 100,
      detected: true,
      arrestable: true,
    });
    expect(res.arrested).toBe(false);
  });
});

describe('pursuit scaling', () => {
  it('scales unit count with stars', () => {
    expect(desiredUnits(0)).toBe(0);
    expect(desiredUnits(1)).toBe(1);
    expect(desiredUnits(2)).toBe(2);
    expect(desiredUnits(3)).toBe(3);
    // Out-of-range input is clamped, not undefined.
    expect(desiredUnits(99)).toBe(3);
  });

  it('widens detection with stars', () => {
    expect(detectionRadius(0)).toBe(0);
    expect(detectionRadius(1)).toBeGreaterThan(0);
    expect(detectionRadius(3)).toBeGreaterThan(detectionRadius(1));
    expect(detectionRadius(99)).toBe(detectionRadius(3));
  });
});
