import { WANTED } from './config';

export type HeatReason =
  | 'stolen-vehicle'
  | 'police-ram'
  | 'reckless'
  | 'mission';

export interface WantedState {
  stars: number;
  /** Seconds since the player was last detected by any police unit. */
  undetectedFor: number;
  /** Seconds since the last heat-gain event (anti-spam cooldown). */
  sinceGain: number;
  /** Seconds a police unit has held the player at arrest range. */
  arrestProgress: number;
}

export const initialWanted = (): WantedState => ({
  stars: 0,
  undetectedFor: 0,
  sinceGain: WANTED.gainCooldown,
  arrestProgress: 0,
});

/**
 * Apply a heat event. Gains are rate-limited by `gainCooldown` so continuous
 * contact (e.g. grinding along a police car) cannot escalate every frame.
 */
export function addHeat(
  state: WantedState,
  amount: number,
  force = false,
): { state: WantedState; changed: boolean } {
  if (!force && state.sinceGain < WANTED.gainCooldown) {
    return { state, changed: false };
  }
  const stars = Math.min(WANTED.maxStars, state.stars + amount);
  if (stars === state.stars) {
    // Still refresh detection so an existing chase does not decay mid-contact.
    return { state: { ...state, undetectedFor: 0, sinceGain: 0 }, changed: false };
  }
  return {
    state: { ...state, stars, sinceGain: 0, undetectedFor: 0 },
    changed: true,
  };
}

/** Force an exact star level (used by missions that start the player hot). */
export function setStars(state: WantedState, stars: number): WantedState {
  return {
    ...state,
    stars: Math.max(0, Math.min(WANTED.maxStars, Math.floor(stars))),
    undetectedFor: 0,
    sinceGain: 0,
    arrestProgress: 0,
  };
}

export function clearWanted(state: WantedState): WantedState {
  return { ...state, stars: 0, undetectedFor: 0, arrestProgress: 0 };
}

export interface WantedTickInput {
  dt: number;
  /** True if any police unit currently sees the player. */
  detected: boolean;
  /** True if a police unit is holding the player at arrest range and slow. */
  arrestable: boolean;
}

export interface WantedTickResult {
  state: WantedState;
  /** A star decayed this tick. */
  decayed: boolean;
  /** The player should be arrested now. */
  arrested: boolean;
}

/**
 * Advance timers. Heat decays one star at a time after the player has stayed
 * undetected for `decaySeconds`; any renewed detection resets the countdown.
 */
export function tickWanted(
  state: WantedState,
  input: WantedTickInput,
): WantedTickResult {
  const { dt, detected, arrestable } = input;
  let next: WantedState = {
    ...state,
    sinceGain: state.sinceGain + dt,
    undetectedFor: detected ? 0 : state.undetectedFor + dt,
    arrestProgress: arrestable ? state.arrestProgress + dt : 0,
  };

  if (next.stars === 0) {
    return { state: { ...next, arrestProgress: 0 }, decayed: false, arrested: false };
  }

  if (next.arrestProgress >= WANTED.arrestSeconds) {
    return { state: next, decayed: false, arrested: true };
  }

  let decayed = false;
  if (next.undetectedFor >= WANTED.decaySeconds) {
    next = { ...next, stars: next.stars - 1, undetectedFor: 0 };
    decayed = true;
  }

  return { state: next, decayed, arrested: false };
}

/** How many pursuing units the current star level warrants. */
export function desiredUnits(stars: number): number {
  const idx = Math.max(0, Math.min(WANTED.unitsPerStar.length - 1, stars));
  return WANTED.unitsPerStar[idx];
}

/** Detection radius at the current star level. */
export function detectionRadius(stars: number): number {
  const idx = Math.max(0, Math.min(WANTED.detectRadius.length - 1, stars));
  return WANTED.detectRadius[idx];
}
