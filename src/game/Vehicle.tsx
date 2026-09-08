import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import { VEHICLE_SPECS, DRIVING, type VehicleKindId } from './config';
import { VehicleModel } from './VehicleModel';
import type { VehicleTelemetry } from './vehiclePhysics';
import { NEUTRAL, type DriveInput } from './vehiclePhysics';

export type VehicleRole = 'parked' | 'traffic' | 'police';

export interface VehicleEntry {
  id: string;
  kind: VehicleKindId;
  role: VehicleRole;
  body: RapierRigidBody;
  /** Live driving input written by whichever system owns this car. */
  input: DriveInput;
  telemetry: VehicleTelemetry;
  health: number;
  /** Seconds since this vehicle last took collision damage. */
  damageCooldown: number;
  /** True once a civilian car has been stolen (drives the wanted trigger). */
  stolen: boolean;
  /** Set while the player is driving it. */
  playerDriven: boolean;
  disabled: boolean;
  /** AI bookkeeping (route, stuck timers) — owned by traffic/police systems. */
  ai: {
    path: number[];
    pathIndex: number;
    repathTimer: number;
    stuckTimer: number;
    targetSpeed: number;
    lastX: number;
    lastZ: number;
  };
}

/**
 * Global vehicle registry. Systems look cars up by id without prop-drilling,
 * and per-frame code never touches React state.
 */
export const vehicleRegistry = new Map<string, VehicleEntry>();

export function getVehicle(id: string | null): VehicleEntry | undefined {
  return id ? vehicleRegistry.get(id) : undefined;
}

export function clearVehicleRegistry() {
  vehicleRegistry.clear();
}

interface VehicleProps {
  id: string;
  kind: VehicleKindId;
  role: VehicleRole;
  position: [number, number, number];
  rotation: number;
  /** Bumped by the owning system to flash police lights. */
  sirenOn?: boolean;
}

/**
 * One physical car. The component only registers the body and renders the
 * model; all driving happens in the systems that own the registry entry.
 */
export function Vehicle({
  id,
  kind,
  role,
  position,
  rotation,
  sirenOn = false,
}: VehicleProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const spec = VEHICLE_SPECS[kind];
  const [hx, hy, hz] = spec.halfExtents;
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const entry: VehicleEntry = {
      id,
      kind,
      role,
      body,
      input: { ...NEUTRAL },
      telemetry: { forwardSpeed: 0, speed: 0, slip: 0, flipped: false },
      health: spec.maxHealth,
      damageCooldown: 0,
      stolen: false,
      playerDriven: false,
      disabled: false,
      ai: {
        path: [],
        pathIndex: 0,
        repathTimer: 0,
        stuckTimer: 0,
        targetSpeed: 0,
        lastX: position[0],
        lastZ: position[2],
      },
    };
    vehicleRegistry.set(id, entry);

    return () => {
      // Only drop the entry if it is still ours (guards dev double-mount).
      if (vehicleRegistry.get(id)?.body === body) vehicleRegistry.delete(id);
    };
  }, [id, kind, role, spec.maxHealth, position]);

  // Light bar flash — a cheap 2 Hz interval, not a per-frame state write.
  useEffect(() => {
    if (role !== 'police' || !sirenOn) return;
    const t = window.setInterval(() => setFlash((f) => (f > 0.5 ? 0 : 1)), 260);
    return () => window.clearInterval(t);
  }, [role, sirenOn]);

  const quat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    rotation,
  );

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders={false}
      position={position}
      quaternion={[quat.x, quat.y, quat.z, quat.w]}
      mass={spec.mass}
      linearDamping={0.06}
      angularDamping={0.9}
      canSleep={false}
      ccd
      userData={{ kind: 'vehicle', vehicleId: id, role }}
    >
      <CuboidCollider
        args={[hx, hy, hz]}
        mass={spec.mass}
        // The chassis box slides directly on the road, so Coulomb friction
        // here would fight the engine. Longitudinal resistance and lateral
        // grip are modelled explicitly in stepVehicle instead.
        friction={0.06}
        frictionCombineRule={0}
        restitution={0.05}
      />
      <VehicleModel spec={spec} sirenOn={sirenOn} flash={flash} />
    </RigidBody>
  );
}

/** Apply collision damage with a cooldown so one crash is one event. */
export function damageVehicle(
  entry: VehicleEntry,
  impulse: number,
): { damaged: boolean; destroyed: boolean } {
  if (entry.damageCooldown > 0) return { damaged: false, destroyed: false };
  if (impulse < DRIVING.damageImpulseThreshold) {
    return { damaged: false, destroyed: false };
  }
  entry.damageCooldown = DRIVING.damageCooldown;
  const dmg = (impulse - DRIVING.damageImpulseThreshold) * DRIVING.damagePerImpulse;
  const before = entry.health;
  entry.health = Math.max(0, entry.health - dmg);
  const destroyed = before > 0 && entry.health <= 0;
  if (destroyed) entry.disabled = true;
  return { damaged: dmg > 0.5, destroyed };
}
