import { SAVE_KEY, SAVE_VERSION } from './config';
import type { MissionId, Quality } from './types';

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storageOverride: SaveStorage | null = null;

/** Native hosts can inject AsyncStorage through a small synchronous cache. */
export function setSaveStorage(storage: SaveStorage | null) {
  storageOverride = storage;
}

function getStorage(): SaveStorage | null {
  if (storageOverride) return storageOverride;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface SaveData {
  version: number;
  cash: number;
  completedMissions: MissionId[];
  volume: number;
  muted: boolean;
  quality: Quality;
  /** A safe free-roam resume position (never mid-chase). */
  resume: { x: number; z: number } | null;
  savedAt: number;
}

export const DEFAULT_SAVE: SaveData = {
  version: SAVE_VERSION,
  cash: 0,
  completedMissions: [],
  volume: 0.7,
  muted: false,
  quality: 'high',
  resume: null,
  savedAt: 0,
};

const VALID_MISSIONS: MissionId[] = ['delivery', 'checkpoint', 'heat'];

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/**
 * Coerce arbitrary parsed JSON into a valid SaveData, or return null when the
 * payload is unusable (wrong version, not an object, corrupted).
 * Never throws — malformed saves must degrade to "no save".
 */
export function validateSave(raw: unknown): SaveData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SAVE_VERSION) return null;

  const missions = Array.isArray(o.completedMissions)
    ? (o.completedMissions.filter(
        (m): m is MissionId =>
          typeof m === 'string' && VALID_MISSIONS.includes(m as MissionId),
      ) as MissionId[])
    : [];

  let resume: SaveData['resume'] = null;
  const r = o.resume as Record<string, unknown> | null | undefined;
  if (r && typeof r === 'object') {
    const x = Number(r.x);
    const z = Number(r.z);
    if (Number.isFinite(x) && Number.isFinite(z)) resume = { x, z };
  }

  return {
    version: SAVE_VERSION,
    cash: Math.floor(clamp(Number(o.cash), 0, 9_999_999)),
    completedMissions: [...new Set(missions)],
    volume: clamp(Number(o.volume), 0, 1),
    muted: o.muted === true,
    quality: o.quality === 'low' ? 'low' : 'high',
    resume,
    savedAt: Number.isFinite(Number(o.savedAt)) ? Number(o.savedAt) : 0,
  };
}

export function loadSave(): SaveData | null {
  try {
    const text = getStorage()?.getItem(SAVE_KEY);
    if (!text) return null;
    return validateSave(JSON.parse(text));
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): boolean {
  try {
    getStorage()?.setItem(
      SAVE_KEY,
      JSON.stringify({ ...data, version: SAVE_VERSION, savedAt: Date.now() }),
    );
    return true;
  } catch {
    // Quota exceeded or storage disabled — gameplay continues regardless.
    return false;
  }
}

export function clearSave(): void {
  try {
    getStorage()?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasValidSave(): boolean {
  const s = loadSave();
  // A save is only worth offering "Continue" for if it holds real progress.
  return !!s && (s.cash > 0 || s.completedMissions.length > 0 || !!s.resume);
}
