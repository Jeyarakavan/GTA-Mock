import { memo } from 'react';
import type { VehicleSpec } from './config';

interface Props {
  spec: VehicleSpec;
  /** Police light bar flashes when this is true. */
  sirenOn?: boolean;
  /** 0..1 flash phase supplied by the sim (avoids per-car clocks). */
  flash?: number;
}

/**
 * Low-poly vehicle built from primitives. Proportions vary per spec so the
 * three types read differently at a glance: tall compact, low wide sports,
 * boxy police cruiser with a light bar.
 */
export const VehicleModel = memo(function VehicleModel({
  spec,
  sirenOn = false,
  flash = 0,
}: Props) {
  const [hx, hy, hz] = spec.halfExtents;
  const isSports = spec.id === 'sports';
  const isPolice = spec.id === 'police';

  const wheelR = 0.34;
  const wheelPositions: Array<[number, number, number]> = [
    [-hx * 0.94, -hy + wheelR * 0.55, hz * 0.62],
    [hx * 0.94, -hy + wheelR * 0.55, hz * 0.62],
    [-hx * 0.94, -hy + wheelR * 0.55, -hz * 0.62],
    [hx * 0.94, -hy + wheelR * 0.55, -hz * 0.62],
  ];

  return (
    <group>
      {/* Main body */}
      <mesh castShadow position={[0, 0, 0]}>
        <boxGeometry args={[hx * 2, hy * 2, hz * 2]} />
        <meshLambertMaterial color={spec.bodyColor} />
      </mesh>

      {/* Cabin / greenhouse */}
      <mesh
        castShadow
        position={[0, hy + (isSports ? 0.22 : 0.32), isSports ? -0.1 : 0.05]}
      >
        <boxGeometry
          args={[
            hx * 1.72,
            isSports ? 0.44 : 0.64,
            hz * (isSports ? 0.92 : 1.02),
          ]}
        />
        <meshLambertMaterial color={spec.accentColor} />
      </mesh>

      {/* Windscreen strip so the front is obvious */}
      <mesh position={[0, hy + (isSports ? 0.22 : 0.3), hz * (isSports ? 0.36 : 0.5)]}>
        <boxGeometry args={[hx * 1.6, isSports ? 0.3 : 0.42, 0.06]} />
        <meshLambertMaterial color="#9fd4e8" />
      </mesh>

      {/* Headlights */}
      {[-1, 1].map((s) => (
        <mesh key={`hl-${s}`} position={[s * hx * 0.6, -hy * 0.1, hz + 0.02]}>
          <boxGeometry args={[0.32, 0.16, 0.06]} />
          <meshBasicMaterial color="#fff0cf" toneMapped={false} />
        </mesh>
      ))}
      {/* Tail lights */}
      {[-1, 1].map((s) => (
        <mesh key={`tl-${s}`} position={[s * hx * 0.62, -hy * 0.1, -hz - 0.02]}>
          <boxGeometry args={[0.28, 0.14, 0.06]} />
          <meshBasicMaterial color="#ff4d4d" toneMapped={false} />
        </mesh>
      ))}

      {/* Wheels */}
      {wheelPositions.map((p, i) => (
        <mesh
          key={`w-${i}`}
          position={p}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[wheelR, wheelR, 0.24, 10]} />
          <meshLambertMaterial color="#1b1e24" />
        </mesh>
      ))}

      {isSports && (
        <mesh position={[0, hy + 0.16, -hz * 0.92]} castShadow>
          <boxGeometry args={[hx * 1.7, 0.07, 0.36]} />
          <meshLambertMaterial color={spec.accentColor} />
        </mesh>
      )}

      {isPolice && (
        <>
          {/* Light bar: two halves alternate with the flash phase. */}
          <mesh position={[0, hy + 0.72, 0.1]}>
            <boxGeometry args={[hx * 1.3, 0.12, 0.34]} />
            <meshLambertMaterial color="#20262f" />
          </mesh>
          <mesh position={[-hx * 0.35, hy + 0.8, 0.1]}>
            <boxGeometry args={[hx * 0.55, 0.14, 0.3]} />
            <meshBasicMaterial
              color={sirenOn && flash > 0.5 ? '#4aa8ff' : '#16384f'}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[hx * 0.35, hy + 0.8, 0.1]}>
            <boxGeometry args={[hx * 0.55, 0.14, 0.3]} />
            <meshBasicMaterial
              color={sirenOn && flash <= 0.5 ? '#ff4a6a' : '#4a1622'}
              toneMapped={false}
            />
          </mesh>
          {/* Door livery stripe */}
          {[-1, 1].map((s) => (
            <mesh key={`liv-${s}`} position={[s * (hx + 0.01), -hy * 0.1, 0]}>
              <boxGeometry args={[0.04, 0.3, hz * 1.2]} />
              <meshBasicMaterial color="#1d5fa8" toneMapped={false} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
});
