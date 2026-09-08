import * as THREE from 'three';
import type { RapierRigidBody } from '@react-three/rapier';
import { DRIVING, type VehicleSpec } from './config';

export interface DriveInput {
  /** -1..1 — throttle forward / brake-reverse. */
  throttle: number;
  /** -1..1 — steering, positive turns left. */
  steer: number;
  handbrake: boolean;
}

export const NEUTRAL: DriveInput = { throttle: 0, steer: 0, handbrake: false };

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _impulse = new THREE.Vector3();
const _up = new THREE.Vector3();

export interface VehicleTelemetry {
  /** Signed forward speed in m/s (negative = reversing). */
  forwardSpeed: number;
  /** Absolute planar speed in m/s. */
  speed: number;
  /** Lateral slip speed — used for skid audio/effects. */
  slip: number;
  /** True when the chassis is rolled past the flip threshold. */
  flipped: boolean;
}

/**
 * Arcade car model applied to a *dynamic* Rapier body. We only ever add
 * impulses and set angular velocity about Y — we never teleport the body — so
 * collisions and stacking behave correctly.
 *
 * Called once per physics step with a fixed dt.
 */
export function stepVehicle(
  body: RapierRigidBody,
  spec: VehicleSpec,
  input: DriveInput,
  dt: number,
  out: VehicleTelemetry,
): VehicleTelemetry {
  const rot = body.rotation();
  _q.set(rot.x, rot.y, rot.z, rot.w);

  // Chassis basis vectors projected onto the ground plane.
  _fwd.set(0, 0, 1).applyQuaternion(_q);
  _up.set(0, 1, 0).applyQuaternion(_q);
  _fwd.y = 0;
  const fwdLen = _fwd.length();
  if (fwdLen < 1e-4) {
    _fwd.set(0, 0, 1);
  } else {
    _fwd.divideScalar(fwdLen);
  }
  _right.set(_fwd.z, 0, -_fwd.x);

  const lv = body.linvel();
  _vel.set(lv.x, 0, lv.z);

  const forwardSpeed = _vel.dot(_fwd);
  const lateralSpeed = _vel.dot(_right);
  const planarSpeed = _vel.length();

  const upright = _up.y; // 1 = level, < 0 = upside down
  const grounded = upright > 0.35;

  out.forwardSpeed = forwardSpeed;
  out.speed = planarSpeed;
  out.slip = Math.abs(lateralSpeed);
  out.flipped = upright < Math.cos(DRIVING.flippedAngle);

  const mass = spec.mass;

  // ---- Engine / brakes --------------------------------------------------
  let driveForce = 0;
  const throttle = input.throttle;

  if (grounded) {
    if (throttle > 0.01) {
      if (forwardSpeed < spec.maxSpeed) {
        // Taper force near top speed so acceleration eases in rather than
        // clipping abruptly at the limit.
        const headroom = 1 - Math.max(0, forwardSpeed) / spec.maxSpeed;
        driveForce = spec.engineForce * throttle * Math.max(0.12, headroom);
      }
    } else if (throttle < -0.01) {
      if (forwardSpeed > DRIVING.reverseThreshold) {
        // Moving forward + S pressed = brakes, not reverse.
        driveForce = -spec.brakeForce * Math.min(1, -throttle);
      } else if (forwardSpeed > -spec.maxReverseSpeed) {
        driveForce = spec.reverseForce * throttle;
      }
    }

    // Rolling resistance and aerodynamic drag always oppose motion.
    driveForce -= forwardSpeed * spec.rollingResistance;
    driveForce -= Math.sign(forwardSpeed) * forwardSpeed * forwardSpeed * spec.drag;

    // Impulse = force x time. Applied to the body directly (not divided by
    // mass) because applyImpulse already accounts for the body mass.
    _impulse.copy(_fwd).multiplyScalar(driveForce * dt);
    body.applyImpulse({ x: _impulse.x, y: 0, z: _impulse.z }, true);

    // ---- Lateral grip ---------------------------------------------------
    // Cancel a fraction of sideways velocity each step. Lower grip on the
    // handbrake lets the car slide in a controlled way instead of railing.
    const grip = input.handbrake ? spec.handbrakeGrip : spec.grip;
    const gripFactor = Math.min(1, grip * dt);
    _impulse.copy(_right).multiplyScalar(-lateralSpeed * gripFactor * mass);
    body.applyImpulse({ x: _impulse.x, y: 0, z: _impulse.z }, true);

    // Handbrake also scrubs forward speed.
    if (input.handbrake) {
      _impulse.copy(_fwd).multiplyScalar(-forwardSpeed * Math.min(1, 2.2 * dt) * mass);
      body.applyImpulse({ x: _impulse.x, y: 0, z: _impulse.z }, true);
    }
  }

  // ---- Steering ---------------------------------------------------------
  const av = body.angvel();
  if (grounded) {
    const absSpeed = Math.abs(forwardSpeed);
    // Steering authority falls off with speed for high-speed stability.
    const speedFactor =
      DRIVING.minSteerFactor +
      (1 - DRIVING.minSteerFactor) *
        Math.max(0, 1 - absSpeed / DRIVING.steerFalloffSpeed);
    // Below a crawl the car should barely turn (no pivoting on the spot).
    const authority = Math.min(1, absSpeed / 2.2);
    const dir = forwardSpeed < -0.4 ? -1 : 1; // steering inverts in reverse
    const targetYawRate =
      input.steer * spec.steerRate * speedFactor * authority * dir;

    // Drive angular velocity toward the target rather than setting it flat,
    // so collisions can still spin the car.
    const blend = Math.min(1, 12 * dt);
    const newYaw = av.y + (targetYawRate - av.y) * blend;
    body.setAngvel({ x: av.x * 0.86, y: newYaw, z: av.z * 0.86 }, true);
  } else {
    // Airborne: damp spin so landings are predictable.
    body.setAngvel({ x: av.x * 0.97, y: av.y * 0.97, z: av.z * 0.97 }, true);
  }

  return out;
}

/** Convert m/s to km/h for the speedometer. */
export const toKmh = (mps: number) => Math.abs(mps) * 3.6;

/**
 * Nudge a flipped or stuck car back onto its wheels at its current location.
 * Used by the R key and by AI recovery.
 */
export function recoverVehicle(body: RapierRigidBody, yaw: number) {
  const t = body.translation();
  body.setTranslation({ x: t.x, y: Math.max(t.y, 0) + 1.2, z: t.z }, true);
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    yaw,
  );
  body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/** Yaw angle (radians) of a body about the Y axis. */
export function bodyYaw(body: RapierRigidBody): number {
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _fwd.set(0, 0, 1).applyQuaternion(_q);
  return Math.atan2(_fwd.x, _fwd.z);
}

/**
 * Steering/throttle for an AI driver heading to `target`.
 * Shared by traffic and police so their driving feels consistent.
 */
export function driveToward(
  body: RapierRigidBody,
  targetX: number,
  targetZ: number,
  desiredSpeed: number,
  out: DriveInput,
): DriveInput {
  const t = body.translation();
  const yaw = bodyYaw(body);
  const toX = targetX - t.x;
  const toZ = targetZ - t.z;
  const targetYaw = Math.atan2(toX, toZ);

  let d = targetYaw - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;

  const lv = body.linvel();
  const speed = Math.hypot(lv.x, lv.z);

  // Proportional steering with a yaw-rate damping term. A pure P controller
  // saturates at +/-1 for any sizeable heading error and the car then weaves
  // across the road instead of settling onto the heading.
  const yawRate = body.angvel().y;
  const damping = speed > 1 ? yawRate * 0.32 : 0;
  out.steer = Math.max(-1, Math.min(1, d * 0.9 - damping));

  // Ease off the throttle through sharp turns so the AI does not understeer
  // into kerbs at full tilt.
  const turnPenalty = 1 - Math.min(0.75, Math.abs(d) / Math.PI) * 0.9;
  const wanted = desiredSpeed * turnPenalty;

  if (speed < wanted) out.throttle = 1;
  else if (speed > wanted * 1.25) out.throttle = -0.55;
  else out.throttle = 0.1;

  out.handbrake = false;
  return out;
}
