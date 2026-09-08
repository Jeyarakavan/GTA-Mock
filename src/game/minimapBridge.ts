import type { Vec2 } from './types';

/**
 * A plain mutable object shared between the simulation (writer) and the
 * minimap (reader). The minimap samples it on its own interval, so hot-path
 * position updates never trigger a React render.
 */
export const minimapBridge = {
  playerX: 0,
  playerZ: 0,
  playerYaw: 0,
  /** Active objective marker, if any. */
  objective: null as Vec2 | null,
  /** Available mission start markers when no mission is active. */
  missionStarts: [] as Vec2[],
  /** Active police unit positions. */
  police: [] as Vec2[],
};

export function resetMinimapBridge() {
  minimapBridge.playerX = 0;
  minimapBridge.playerZ = 0;
  minimapBridge.playerYaw = 0;
  minimapBridge.objective = null;
  minimapBridge.missionStarts = [];
  minimapBridge.police = [];
}

/**
 * Convert a world XZ position into normalised map space (0..1 on each axis),
 * where 0,0 is the north-west corner of the district.
 *
 * Shared by the minimap and the expanded map so both agree exactly.
 */
export function worldToMap(
  x: number,
  z: number,
  half: number,
): { u: number; v: number } {
  return {
    u: (x + half) / (half * 2),
    v: (z + half) / (half * 2),
  };
}

/** Inverse of worldToMap — used for click-to-inspect and tests. */
export function mapToWorld(
  u: number,
  v: number,
  half: number,
): { x: number; z: number } {
  return {
    x: u * half * 2 - half,
    z: v * half * 2 - half,
  };
}
