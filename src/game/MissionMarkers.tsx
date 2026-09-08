import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MISSION, PALETTE } from './config';
import { missionById, missionDefs } from './store';
import { canStart, type MissionRuntime } from './missions';

interface Props {
  /** The simulation's mutable state ref — read, never written, here. */
  simRef: React.RefObject<{ mission: MissionRuntime }>;
}

/**
 * Floating world markers: a pillar of light at every startable mission, and a
 * highlighted marker on the active objective (only the current one shows, so
 * checkpoint runs read clearly).
 */
export function MissionMarkers({ simRef }: Props) {
  const startGroup = useRef<THREE.Group>(null);
  const objectiveRef = useRef<THREE.Group>(null);
  const spin = useRef(0);

  const starts = useMemo(
    () => missionDefs.map((d) => ({ id: d.id, x: d.start.x, z: d.start.z })),
    [],
  );

  useFrame((_, delta) => {
    spin.current += delta;
    const rt = simRef.current?.mission;
    if (!rt) return;

    // Show a start pillar only for missions that can actually be started now.
    const sg = startGroup.current;
    if (sg) {
      sg.children.forEach((child, i) => {
        const def = starts[i];
        const visible = canStart(rt, def.id);
        child.visible = visible;
        if (visible) {
          child.rotation.y = spin.current * 0.8;
          child.position.y = 0.1 + Math.sin(spin.current * 2 + i) * 0.12;
        }
      });
    }

    // Active objective marker.
    const og = objectiveRef.current;
    if (og) {
      const def = rt.activeId ? missionById(rt.activeId) : null;
      const obj = def?.objectives[rt.objectiveIndex];
      if (obj?.target) {
        og.visible = true;
        og.position.set(obj.target.x, 0, obj.target.z);
        og.rotation.y = spin.current * 1.4;
        const pulse = 1 + Math.sin(spin.current * 3) * 0.06;
        og.scale.setScalar(pulse * (obj.radius / MISSION.zoneRadius));
      } else {
        og.visible = false;
      }
    }
  });

  return (
    <group>
      <group ref={startGroup}>
        {starts.map((s) => (
          <group key={s.id} position={[s.x, 0.1, s.z]}>
            {/* Ground ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
              <ringGeometry args={[MISSION.startRadius - 0.5, MISSION.startRadius, 28]} />
              <meshBasicMaterial
                color={PALETTE.neonTeal}
                toneMapped={false}
                transparent
                opacity={0.85}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Beacon column */}
            <mesh position={[0, 4, 0]}>
              <cylinderGeometry args={[0.5, 0.9, 8, 12, 1, true]} />
              <meshBasicMaterial
                color={PALETTE.neonTeal}
                toneMapped={false}
                transparent
                opacity={0.2}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <mesh position={[0, 2.2, 0]}>
              <octahedronGeometry args={[0.6]} />
              <meshBasicMaterial color={PALETTE.neonTeal} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>

      <group ref={objectiveRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[MISSION.zoneRadius - 0.7, MISSION.zoneRadius, 32]} />
          <meshBasicMaterial
            color={PALETTE.neonPink}
            toneMapped={false}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 6, 0]}>
          <cylinderGeometry args={[0.7, 1.4, 12, 14, 1, true]} />
          <meshBasicMaterial
            color={PALETTE.neonPink}
            toneMapped={false}
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 2.6, 0]}>
          <octahedronGeometry args={[0.8]} />
          <meshBasicMaterial color={PALETTE.neonPink} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
