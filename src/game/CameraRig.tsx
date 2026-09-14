import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { RapierCollider } from './rapierTypes';
import { CAMERA } from './config';
import { consumeMouse, getInput } from './input';

interface CameraRigProps {
  yawRef: React.RefObject<number>;
  pitchRef: React.RefObject<number>;
  /** Point the camera orbits — written by the sim each frame. */
  targetRef: React.RefObject<THREE.Vector3>;
  /** true while driving: pull back and raise for a wider chase view. */
  driving: boolean;
  paused: boolean;
  enabled: boolean;
}

/** Frame-rate independent exponential smoothing. */
function damp(current: number, target: number, halfLife: number, dt: number) {
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/**
 * Third-person orbit camera. Mouse look adjusts yaw/pitch, the boom length
 * blends between foot and chase distance, and a shape-cast keeps the camera
 * from clipping through buildings.
 */
export function CameraRig({
  yawRef,
  pitchRef,
  targetRef,
  driving,
  paused,
  enabled,
}: CameraRigProps) {
  const { camera } = useThree();
  const { world: rapierWorld, rapier } = useRapier();

  const smoothTarget = useRef(new THREE.Vector3(0, 2, 0));
  const smoothPos = useRef(new THREE.Vector3(0, 5, 12));
  const boom = useRef(CAMERA.footDistance);
  const initialised = useRef(false);

  const tmp = useMemo(
    () => ({
      mouse: { x: 0, y: 0 },
      offset: new THREE.Vector3(),
      desired: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      origin: new THREE.Vector3(),
      shape: new rapier.Ball(CAMERA.collisionPadding),
    }),
    [rapier],
  );

  useFrame((_, rawDelta) => {
    if (!enabled) return;
    const dt = Math.min(rawDelta, 0.05);
    const target = targetRef.current;
    if (!target) return;

    // Mouse look — always drained so deltas never accumulate while paused.
    consumeMouse(tmp.mouse);
    if (!paused && (getInput().pointerLocked || getInput().touchLooking)) {
      yawRef.current -= tmp.mouse.x * CAMERA.mouseSensitivity;
      pitchRef.current = Math.max(
        CAMERA.minPitch,
        Math.min(
          CAMERA.maxPitch,
          pitchRef.current + tmp.mouse.y * CAMERA.mouseSensitivity,
        ),
      );
    }

    const wantDistance = driving ? CAMERA.carDistance : CAMERA.footDistance;
    const wantHeight = driving ? CAMERA.carHeight : CAMERA.footHeight;

    // Snap on the first frame so the camera never flies in from the origin.
    if (!initialised.current) {
      smoothTarget.current.copy(target);
      boom.current = wantDistance;
      initialised.current = true;
    }

    // Smooth the look-at point.
    smoothTarget.current.x = damp(smoothTarget.current.x, target.x, CAMERA.targetHalfLife, dt);
    smoothTarget.current.y = damp(smoothTarget.current.y, target.y, CAMERA.targetHalfLife, dt);
    smoothTarget.current.z = damp(smoothTarget.current.z, target.z, CAMERA.targetHalfLife, dt);

    // Blend the boom length between modes.
    boom.current = damp(boom.current, wantDistance, 0.22, dt);

    const yaw = yawRef.current;
    const pitch = pitchRef.current;

    // Orbit offset: a proper spherical direction from the target out to the
    // camera. The mode's height is folded into the pitch as a fixed elevation
    // bias, so the boom stays a unit direction and the camera actually looks
    // down at the street instead of sitting at ground level.
    const heightBias = Math.atan2(wantHeight, Math.max(1, wantDistance));
    const elevation = Math.max(
      -0.4,
      Math.min(1.3, pitch + heightBias),
    );
    const horiz = Math.cos(elevation);
    tmp.dir.set(
      Math.sin(yaw) * horiz,
      Math.sin(elevation),
      Math.cos(yaw) * horiz,
    );
    if (tmp.dir.lengthSq() < 1e-6) tmp.dir.set(0, 0.4, 1);
    tmp.dir.normalize();

    let distance = boom.current;

    // Collision avoidance: cast a small sphere from the target outward and
    // shorten the boom to whatever it hits first.
    tmp.origin.copy(smoothTarget.current);
    const hit = rapierWorld.castShape(
      tmp.origin,
      { x: 0, y: 0, z: 0, w: 1 },
      tmp.dir,
      tmp.shape,
      0,
      distance,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      // Only fixed geometry (buildings, walls) should push the camera in —
      // never the player's own body or the car they are riding in.
      (collider: RapierCollider) => {
        const parent = collider.parent();
        if (!parent?.isFixed()) return false;
        // Buildings block the camera; the ground slab and boundary walls sit
        // right under/around it and would pin the boom to its minimum length.
        const ud = parent.userData as { kind?: string } | undefined;
        return ud?.kind !== 'ground';
      },
    );

    if (hit && hit.time_of_impact > 0) {
      distance = Math.max(CAMERA.minDistance, hit.time_of_impact - CAMERA.collisionPadding);
    }

    tmp.desired
      .copy(smoothTarget.current)
      .addScaledVector(tmp.dir, distance);

    // When the boom is pulled in by a wall, snap harder so we do not lag
    // through the geometry.
    const posHalfLife = distance < boom.current - 0.5 ? 0.03 : CAMERA.positionHalfLife;
    smoothPos.current.x = damp(smoothPos.current.x, tmp.desired.x, posHalfLife, dt);
    smoothPos.current.y = damp(smoothPos.current.y, tmp.desired.y, posHalfLife, dt);
    smoothPos.current.z = damp(smoothPos.current.z, tmp.desired.z, posHalfLife, dt);

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__cam = {
        x: smoothPos.current.x, y: smoothPos.current.y, z: smoothPos.current.z,
      };
      (window as unknown as Record<string, unknown>).__camDbg = {
        yaw, pitch, boom: boom.current, distance, elevation,
      };
    }
    camera.position.copy(smoothPos.current);
    camera.lookAt(
      smoothTarget.current.x,
      smoothTarget.current.y + (driving ? 0.6 : 0.35),
      smoothTarget.current.z,
    );
  });

  return null;
}
