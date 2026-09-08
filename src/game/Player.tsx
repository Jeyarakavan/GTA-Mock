import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier';
import { PLAYER } from './config';
import { getInput } from './input';
import { world } from './store';

export interface PlayerHandle {
  /** Current feet position in world space. */
  getPosition: (out: THREE.Vector3) => THREE.Vector3;
  getSpeed: () => number;
  /** Teleport (respawn, vehicle exit). */
  setPosition: (x: number, y: number, z: number) => void;
  setEnabled: (enabled: boolean) => void;
  setFacing: (yaw: number) => void;
  isEnabled: () => boolean;
}

interface PlayerProps {
  /** Camera yaw, so movement is camera-relative. */
  yawRef: React.RefObject<number>;
  active: boolean;
  paused: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A kinematic-position character controller driven by Rapier's built-in
 * KinematicCharacterController: it resolves collisions, slides along walls and
 * steps over kerbs without the jitter of a dynamic capsule.
 */
export const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(
  { yawRef, active, paused },
  ref,
) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const visualRef = useRef<THREE.Group>(null);
  const { world: rapierWorld } = useRapier();

  // Controller is created lazily on first frame — Rapier world must exist.
  const controllerRef = useRef<ReturnType<
    typeof rapierWorld.createCharacterController
  > | null>(null);

  const state = useRef({
    velY: 0,
    grounded: false,
    /** True while the jump key is held, to prevent auto-bunnyhopping. */
    jumpLatched: false,
    speed: 0,
    modelYaw: 0,
    animTime: 0,
    enabled: true,
    position: new THREE.Vector3(
      world.playerSpawn.x,
      PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
      world.playerSpawn.z,
    ),
  });

  const tmp = useMemo(
    () => ({
      desired: new THREE.Vector3(),
      move: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      vel: new THREE.Vector3(),
    }),
    [],
  );

  // Horizontal velocity persists across frames for smooth accel/decel.
  const hVel = useRef(new THREE.Vector3());

  useImperativeHandle(
    ref,
    () => ({
      getPosition: (out) => out.copy(state.current.position),
      getSpeed: () => state.current.speed,
      setPosition: (x, y, z) => {
        state.current.position.set(x, y, z);
        state.current.velY = 0;
        hVel.current.set(0, 0, 0);
        bodyRef.current?.setNextKinematicTranslation({ x, y, z });
        bodyRef.current?.setTranslation({ x, y, z }, true);
      },
      setEnabled: (enabled) => {
        state.current.enabled = enabled;
        if (!enabled) {
          hVel.current.set(0, 0, 0);
          state.current.velY = 0;
          state.current.speed = 0;
        }
        // Park the collider far below the city while riding in a car so it
        // cannot interact with anything.
        if (!enabled) {
          bodyRef.current?.setTranslation({ x: 0, y: -400, z: 0 }, true);
        }
      },
      setFacing: (yaw) => {
        state.current.modelYaw = yaw;
      },
      isEnabled: () => state.current.enabled,
    }),
    [],
  );

  useFrame((_, rawDelta) => {
    const s = state.current;
    const body = bodyRef.current;
    if (!body) return;

    if (!s.enabled || paused) return;

    const dt = Math.min(rawDelta, 0.05);

    if (!controllerRef.current) {
      const c = rapierWorld.createCharacterController(0.02);
      c.enableAutostep(0.42, 0.2, true);
      c.enableSnapToGround(0.4);
      c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
      c.setMinSlopeSlideAngle((38 * Math.PI) / 180);
      c.setApplyImpulsesToDynamicBodies(true);
      controllerRef.current = c;
    }
    const controller = controllerRef.current;

    const input = getInput();
    const yaw = yawRef.current ?? 0;

    // Camera-relative basis on the ground plane.
    tmp.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    tmp.right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    tmp.desired.set(0, 0, 0);
    if (active) {
      tmp.desired
        .addScaledVector(tmp.forward, input.forward)
        .addScaledVector(tmp.right, input.strafe);
      // Normalising means diagonal movement is never faster than cardinal.
      if (tmp.desired.lengthSq() > 1e-6) tmp.desired.normalize();
    }

    const targetSpeed =
      input.sprint && active ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    tmp.vel.copy(tmp.desired).multiplyScalar(targetSpeed);

    // Frame-rate independent approach toward the target velocity.
    const accel = tmp.desired.lengthSq() > 1e-6 ? PLAYER.acceleration : PLAYER.deceleration;
    const maxStep = accel * dt;
    tmp.move.copy(tmp.vel).sub(hVel.current);
    const stepLen = tmp.move.length();
    if (stepLen > maxStep) tmp.move.multiplyScalar(maxStep / stepLen);
    hVel.current.add(tmp.move);

    // Jump: only from the ground, and only on a fresh press.
    if (active && input.jump && s.grounded && !s.jumpLatched) {
      s.velY = PLAYER.jumpSpeed;
      s.grounded = false;
      s.jumpLatched = true;
    }
    if (!input.jump) s.jumpLatched = false;

    s.velY += PLAYER.gravity * dt;
    if (s.velY < -55) s.velY = -55;

    tmp.move.set(hVel.current.x * dt, s.velY * dt, hVel.current.z * dt);

    const collider = body.collider(0);
    if (collider) {
      controller.computeColliderMovement(collider, tmp.move);
      const corrected = controller.computedMovement();
      s.position.x += corrected.x;
      s.position.y += corrected.y;
      s.position.z += corrected.z;

      s.grounded = controller.computedGrounded();
      if (s.grounded && s.velY < 0) s.velY = 0;

      // If the controller shortened our horizontal motion we hit a wall —
      // bleed the blocked component so we do not keep pushing into it.
      const movedX = Math.abs(corrected.x);
      const movedZ = Math.abs(corrected.z);
      if (movedX < Math.abs(tmp.move.x) * 0.6) hVel.current.x *= 0.25;
      if (movedZ < Math.abs(tmp.move.z) * 0.6) hVel.current.z *= 0.25;
    }

    // Recovery if we somehow leave the playable world.
    const limit = world.half + 40;
    if (
      s.position.y < PLAYER.fallResetY ||
      Math.abs(s.position.x) > limit ||
      Math.abs(s.position.z) > limit ||
      !Number.isFinite(s.position.x)
    ) {
      s.position.set(
        world.playerSpawn.x,
        PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
        world.playerSpawn.z,
      );
      s.velY = 0;
      hVel.current.set(0, 0, 0);
    }

    body.setNextKinematicTranslation(s.position);

    s.speed = Math.hypot(hVel.current.x, hVel.current.z);

    // Visual: face the direction of travel, smoothly.
    const visual = visualRef.current;
    if (visual) {
      if (s.speed > 0.35) {
        const moveYaw = Math.atan2(hVel.current.x, hVel.current.z);
        let d = moveYaw - s.modelYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        s.modelYaw += d * Math.min(1, PLAYER.turnSpeed * dt);
      }
      visual.position.set(
        s.position.x,
        s.position.y - (PLAYER.capsuleHalfHeight + PLAYER.radius),
        s.position.z,
      );
      visual.rotation.y = s.modelYaw;

      // Simple procedural walk/run cycle driven by actual speed.
      const cycleRate = s.speed > 0.35 ? 2.0 + s.speed * 0.85 : 0;
      s.animTime += dt * cycleRate;
      const swing = Math.sin(s.animTime) * Math.min(1, s.speed / 5) * 0.85;
      const limbs = visual.userData.limbs as
        | { legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; torso: THREE.Object3D }
        | undefined;
      if (limbs) {
        limbs.legL.rotation.x = swing;
        limbs.legR.rotation.x = -swing;
        limbs.armL.rotation.x = -swing * 0.75;
        limbs.armR.rotation.x = swing * 0.75;
        // Slight bob and forward lean when sprinting.
        limbs.torso.position.y =
          1.02 + Math.abs(Math.sin(s.animTime * 2)) * 0.035 * Math.min(1, s.speed / 5);
        limbs.torso.rotation.x = Math.min(0.22, s.speed * 0.022);
      }
    }
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        position={[
          world.playerSpawn.x,
          PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
          world.playerSpawn.z,
        ]}
        enabledRotations={[false, false, false]}
        userData={{ kind: 'player' }}
      >
        <CapsuleCollider args={[PLAYER.capsuleHalfHeight, PLAYER.radius]} />
      </RigidBody>
      <PlayerModel ref={visualRef} />
    </>
  );
});

/** Stylised low-poly courier: readable silhouette, animated limbs. */
const PlayerModel = forwardRef<THREE.Group>(function PlayerModel(_props, ref) {
  const inner = useRef<THREE.Group>(null);

  const setup = (g: THREE.Group | null) => {
    if (!g) return;
    if (typeof ref === 'function') ref(g);
    else if (ref) (ref as React.RefObject<THREE.Group | null>).current = g;
  };

  return (
    <group ref={setup}>
      <group ref={inner}>
        <PlayerRig />
      </group>
    </group>
  );
});

function PlayerRig() {
  const torso = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);

  // Publish limb refs to the parent group so the frame loop can pose them.
  const attach = (g: THREE.Group | null) => {
    root.current = g;
    if (!g || !g.parent || !g.parent.parent) return;
    const holder = g.parent.parent;
    if (torso.current && legL.current && legR.current && armL.current && armR.current) {
      holder.userData.limbs = {
        torso: torso.current,
        legL: legL.current,
        legR: legR.current,
        armL: armL.current,
        armR: armR.current,
      };
    }
  };

  return (
    <group ref={attach}>
      {/* Legs pivot at the hip. */}
      <group ref={legL} position={[-0.14, 0.82, 0]}>
        <mesh position={[0, -0.41, 0]} castShadow>
          <boxGeometry args={[0.19, 0.82, 0.2]} />
          <meshLambertMaterial color="#2f3a4d" />
        </mesh>
      </group>
      <group ref={legR} position={[0.14, 0.82, 0]}>
        <mesh position={[0, -0.41, 0]} castShadow>
          <boxGeometry args={[0.19, 0.82, 0.2]} />
          <meshLambertMaterial color="#2f3a4d" />
        </mesh>
      </group>

      <group ref={torso} position={[0, 1.02, 0]}>
        <mesh position={[0, 0.26, 0]} castShadow>
          <boxGeometry args={[0.52, 0.64, 0.3]} />
          <meshLambertMaterial color="#e2603a" />
        </mesh>
        {/* Courier satchel — helps read facing from behind. */}
        <mesh position={[0, 0.2, -0.2]} castShadow>
          <boxGeometry args={[0.34, 0.32, 0.16]} />
          <meshLambertMaterial color="#2ee6c8" />
        </mesh>
        <mesh position={[0, 0.78, 0]} castShadow>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          <meshLambertMaterial color="#c99878" />
        </mesh>
        {/* Beanie so the head reads at distance. */}
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[0.33, 0.14, 0.33]} />
          <meshLambertMaterial color="#1f2a3a" />
        </mesh>

        <group ref={armL} position={[-0.34, 0.48, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <boxGeometry args={[0.14, 0.6, 0.16]} />
            <meshLambertMaterial color="#d2542f" />
          </mesh>
        </group>
        <group ref={armR} position={[0.34, 0.48, 0]}>
          <mesh position={[0, -0.28, 0]} castShadow>
            <boxGeometry args={[0.14, 0.6, 0.16]} />
            <meshLambertMaterial color="#d2542f" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export { UP };
