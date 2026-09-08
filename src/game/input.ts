/**
 * Global input manager. Reads raw keyboard/mouse into a mutable snapshot that
 * frame callbacks poll — no React state is touched per frame.
 *
 * Edge-triggered actions (E, R, Escape, M, H) are exposed as one-shot
 * "consume" flags so a single press cannot be handled twice in one frame, and
 * so E cannot both enter and immediately exit a vehicle.
 */

export interface InputState {
  forward: number; // -1..1 (W/S)
  strafe: number; // -1..1 (A/D)
  sprint: boolean;
  jump: boolean;
  /** Accumulated mouse delta since the last read, in radians-ready units. */
  mouseDX: number;
  mouseDY: number;
  pointerLocked: boolean;
}

const state: InputState = {
  forward: 0,
  strafe: 0,
  sprint: false,
  jump: false,
  mouseDX: 0,
  mouseDY: 0,
  pointerLocked: false,
};

const held = new Set<string>();

/** One-shot press flags, cleared when consumed. */
const pressed = {
  interact: false,
  recover: false,
  pause: false,
  map: false,
  help: false,
};

type PressKey = keyof typeof pressed;

let attached = false;
let canvasEl: HTMLElement | null = null;

function recompute() {
  const f = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
  const s = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
  state.forward = f;
  state.strafe = s;
  state.sprint = held.has('ShiftLeft') || held.has('ShiftRight');
  state.jump = held.has('Space');
}

function onKeyDown(e: KeyboardEvent) {
  // Let the browser keep its own shortcuts (devtools, reload, etc).
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const code = e.code;
  if (
    code === 'Space' ||
    code === 'KeyW' ||
    code === 'KeyA' ||
    code === 'KeyS' ||
    code === 'KeyD'
  ) {
    e.preventDefault();
  }

  if (!held.has(code)) {
    // Edge-triggered only — holding the key does not re-fire.
    if (code === 'KeyE') pressed.interact = true;
    else if (code === 'KeyR') pressed.recover = true;
    else if (code === 'Escape') pressed.pause = true;
    else if (code === 'KeyM') pressed.map = true;
    else if (code === 'KeyH') pressed.help = true;
  }

  held.add(code);
  recompute();
}

function onKeyUp(e: KeyboardEvent) {
  held.delete(e.code);
  recompute();
}

function onMouseMove(e: MouseEvent) {
  if (!state.pointerLocked) return;
  state.mouseDX += e.movementX;
  state.mouseDY += e.movementY;
}

/** Any focus loss must release every key, or movement sticks on. */
function clearHeld() {
  held.clear();
  state.mouseDX = 0;
  state.mouseDY = 0;
  recompute();
}

function onPointerLockChange() {
  state.pointerLocked =
    !!canvasEl && document.pointerLockElement === canvasEl;
  if (!state.pointerLocked) {
    state.mouseDX = 0;
    state.mouseDY = 0;
  }
  for (const cb of lockListeners) cb(state.pointerLocked);
}

const lockListeners = new Set<(locked: boolean) => void>();

export function onPointerLockChanged(cb: (locked: boolean) => void): () => void {
  lockListeners.add(cb);
  return () => lockListeners.delete(cb);
}

export function attachInput(canvas: HTMLElement): () => void {
  canvasEl = canvas;
  if (attached) {
    // Dev-mode double mount: re-point at the new canvas, keep one listener set.
    return () => {};
  }
  attached = true;

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('blur', clearHeld);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('visibilitychange', clearHeld);

  return () => {
    attached = false;
    canvasEl = null;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('blur', clearHeld);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('visibilitychange', clearHeld);
    clearHeld();
  };
}

export function getInput(): Readonly<InputState> {
  return state;
}

/** Read and clear the accumulated mouse delta. */
export function consumeMouse(out: { x: number; y: number }) {
  out.x = state.mouseDX;
  out.y = state.mouseDY;
  state.mouseDX = 0;
  state.mouseDY = 0;
}

/** Read a one-shot press, clearing it so only one consumer sees it. */
export function consumePress(key: PressKey): boolean {
  if (!pressed[key]) return false;
  pressed[key] = false;
  return true;
}

export function peekPress(key: PressKey): boolean {
  return pressed[key];
}

/** Inject a one-shot press (used by the dev automation bridge). */
export function injectPress(key: PressKey) {
  pressed[key] = true;
}

export function clearAllPresses() {
  for (const k of Object.keys(pressed) as PressKey[]) pressed[k] = false;
}

export function requestPointerLock() {
  // Must only ever be called from a user gesture.
  if (!canvasEl || document.pointerLockElement === canvasEl) return;
  const el = canvasEl as HTMLElement & {
    requestPointerLock?: (opts?: unknown) => Promise<void> | void;
  };
  try {
    const r = el.requestPointerLock?.({ unadjustedMovement: false });
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch(() => {
        /* browser refused (e.g. too soon after exit) — play continues */
      });
    }
  } catch {
    /* ignore */
  }
}

export function exitPointerLock() {
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch {
    /* ignore */
  }
}

export function isPointerLocked(): boolean {
  return state.pointerLocked;
}

export { clearHeld as clearInput };
