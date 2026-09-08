import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SAVE,
  clearSave,
  hasValidSave,
  loadSave,
  validateSave,
  writeSave,
} from '../save';
import { SAVE_KEY, SAVE_VERSION } from '../config';

/** Minimal in-memory localStorage for the node test environment. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

const valid = {
  version: SAVE_VERSION,
  cash: 1500,
  completedMissions: ['delivery'],
  volume: 0.5,
  muted: false,
  quality: 'high',
  resume: { x: 10, z: -20 },
  savedAt: 123,
};

describe('save validation', () => {
  it('accepts a well-formed save', () => {
    const s = validateSave(valid);
    expect(s).not.toBeNull();
    expect(s!.cash).toBe(1500);
    expect(s!.completedMissions).toEqual(['delivery']);
    expect(s!.resume).toEqual({ x: 10, z: -20 });
  });

  it('rejects non-objects', () => {
    expect(validateSave(null)).toBeNull();
    expect(validateSave(undefined)).toBeNull();
    expect(validateSave('nope')).toBeNull();
    expect(validateSave(42)).toBeNull();
  });

  it('rejects an outdated version rather than misreading it', () => {
    expect(validateSave({ ...valid, version: SAVE_VERSION - 1 })).toBeNull();
    expect(validateSave({ ...valid, version: undefined })).toBeNull();
  });

  it('drops unknown mission ids', () => {
    const s = validateSave({
      ...valid,
      completedMissions: ['delivery', 'not-a-mission', 42, null],
    });
    expect(s!.completedMissions).toEqual(['delivery']);
  });

  it('deduplicates completed missions', () => {
    const s = validateSave({
      ...valid,
      completedMissions: ['delivery', 'delivery', 'heat'],
    });
    expect(s!.completedMissions).toEqual(['delivery', 'heat']);
  });

  it('clamps out-of-range numbers and never allows negative cash', () => {
    const s = validateSave({ ...valid, cash: -900, volume: 12 });
    expect(s!.cash).toBe(0);
    expect(s!.volume).toBe(1);

    const nan = validateSave({ ...valid, cash: 'abc', volume: NaN });
    expect(nan!.cash).toBe(0);
    expect(nan!.volume).toBe(0);
  });

  it('falls back to a valid quality value', () => {
    expect(validateSave({ ...valid, quality: 'ultra' })!.quality).toBe('high');
    expect(validateSave({ ...valid, quality: 'low' })!.quality).toBe('low');
  });

  it('discards a malformed resume position', () => {
    expect(validateSave({ ...valid, resume: { x: 'a', z: 1 } })!.resume).toBeNull();
    expect(validateSave({ ...valid, resume: 'somewhere' })!.resume).toBeNull();
    expect(validateSave({ ...valid, resume: null })!.resume).toBeNull();
  });
});

describe('save round-trip', () => {
  it('writes and reads back a save', () => {
    expect(writeSave({ ...DEFAULT_SAVE, cash: 750 })).toBe(true);
    const loaded = loadSave();
    expect(loaded).not.toBeNull();
    expect(loaded!.cash).toBe(750);
  });

  it('returns null when nothing is stored', () => {
    expect(loadSave()).toBeNull();
  });

  it('returns null for corrupt JSON instead of throwing', () => {
    localStorage.setItem(SAVE_KEY, '{not json');
    expect(() => loadSave()).not.toThrow();
    expect(loadSave()).toBeNull();
  });

  it('returns null for a stale version payload', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...valid, version: 1 }));
    expect(loadSave()).toBeNull();
  });

  it('clears a save', () => {
    writeSave({ ...DEFAULT_SAVE, cash: 100 });
    clearSave();
    expect(loadSave()).toBeNull();
  });
});

describe('continue availability', () => {
  it('is false with no save and with an empty fresh save', () => {
    expect(hasValidSave()).toBe(false);
    writeSave({ ...DEFAULT_SAVE });
    // A save with no cash, no missions and no position is not worth resuming.
    expect(hasValidSave()).toBe(false);
  });

  it('is true once there is real progress', () => {
    writeSave({ ...DEFAULT_SAVE, cash: 500 });
    expect(hasValidSave()).toBe(true);

    clearSave();
    writeSave({ ...DEFAULT_SAVE, completedMissions: ['delivery'] });
    expect(hasValidSave()).toBe(true);

    clearSave();
    writeSave({ ...DEFAULT_SAVE, resume: { x: 1, z: 2 } });
    expect(hasValidSave()).toBe(true);
  });
});
