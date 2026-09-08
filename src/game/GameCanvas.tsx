import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { PALETTE, PHYSICS, RENDER, CAMERA } from './config';
import { City } from './City';
import { Simulation } from './Simulation';
import { useGame } from './store';
import { minimapBridge } from './minimapBridge';
import { attachInput, requestPointerLock } from './input';
import type { Quality } from './types';

/** Dusk sky: a vertical gradient dome, cheap and matched to the fog colour. */
function SkyDome() {
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useRef({
    topColor: {
      value: new THREE.Color().setStyle(PALETTE.skyTop, THREE.SRGBColorSpace),
    },
    bottomColor: {
      value: new THREE.Color().setStyle(PALETTE.skyBottom, THREE.SRGBColorSpace),
    },
    exponent: { value: 0.85 },
  });

  // Keep the dome centred on the camera. Anchored at the origin it clips
  // against the far plane once the player drives toward the city edge, and
  // the cleared background shows through instead of the gradient.
  useFrame(({ camera }) => {
    meshRef.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={meshRef} scale={[-1, 1, 1]} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[600, 24, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        // The gradient is authored in display space; tone mapping and the
        // renderer's sRGB conversion would otherwise crush it toward black.
        toneMapped={false}
        fog={false}
        uniforms={uniforms.current}
        vertexShader={`
          varying vec3 vDir;
          void main() {
            // Direction from the dome centre, not a world position: the dome
            // is re-centred on the camera each frame, so a world-space height
            // would slide with the player instead of staying on the horizon.
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          uniform float exponent;
          varying vec3 vDir;
          void main() {
            // The dome is mirrored on X (scale -1), so flip the direction back
            // before reading its elevation.
            float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = mix(
              bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)
            );
            gl_FragColor = vec4(col, 1.0);
            // A raw ShaderMaterial bypasses the material 'toneMapped' flag, so
            // the renderer's tone mapping and sRGB encode still run over this
            // output. Emit the colour already in linear space and let those
            // stages convert it back to the palette values we authored.
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `}
      />
    </mesh>
  );
}

function Lighting({ quality }: { quality: Quality }) {
  const settings = RENDER[quality];
  const ref = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const light = ref.current;
    if (!light || !settings.shadows) return;
    // A tight frustum around the player keeps shadow texels small enough to
    // stay sharp; it is re-centred every frame in the loop below.
    const cam = light.shadow.camera;
    cam.left = -90;
    cam.right = 90;
    cam.top = 90;
    cam.bottom = -90;
    cam.near = 1;
    cam.far = 500;
    cam.updateProjectionMatrix();
    light.shadow.bias = -0.0012;
    light.shadow.normalBias = 0.05;
  }, [settings.shadows]);

  /**
   * Follow the player with the shadow frustum. A frustum fixed at the origin
   * either has to cover the whole city (blurry) or leaves most streets
   * unshadowed, and at this sun angle that reads as a permanent eclipse.
   */
  useFrame(() => {
    const light = ref.current;
    if (!light || !settings.shadows) return;
    const px = minimapBridge.playerX;
    const pz = minimapBridge.playerZ;
    light.position.set(px - 120, 190, pz + 70);
    light.target.position.set(px, 0, pz);
    light.target.updateMatrixWorld();
  });

  return (
    <>
      {/* Warm sun from the west — the dusk key light. Kept high enough that
          tower shadows do not blanket the whole street grid. */}
      <directionalLight
        ref={ref}
        position={[-120, 190, 70]}
        intensity={2.9}
        color={PALETTE.sun}
        castShadow={settings.shadows}
        shadow-mapSize-width={settings.shadowMapSize}
        shadow-mapSize-height={settings.shadowMapSize}
      />
      {/* Cool sky fill keeps shadows blue rather than black. */}
      <hemisphereLight
        args={[PALETTE.ambient, '#4d5468', 1.9]}
      />
      <ambientLight intensity={1.0} color="#a8bcd8" />
    </>
  );
}

/** Shown when the browser cannot give us a WebGL context. */
function WebGLFallback() {
  return (
    <div className="webgl-fallback">
      <h1>Neon District: Street Run</h1>
      <p>
        This game needs WebGL, which your browser could not start.
      </p>
      <ul>
        <li>Update your browser to a current version of Chrome, Edge or Firefox.</li>
        <li>Enable hardware acceleration in your browser settings.</li>
        <li>Update your graphics drivers, then reload this page.</li>
      </ul>
      <p className="muted">
        You can check WebGL support at <code>about:gpu</code> in Chrome or Edge.
      </p>
    </div>
  );
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

export function GameCanvas() {
  const quality = useGame((s) => s.quality);
  const control = useGame((s) => s.control);
  const resetToken = useGame((s) => s.resetToken);
  const started = useGame((s) => s.started);

  const [webgl] = useState(supportsWebGL);
  const [contextLost, setContextLost] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const settings = RENDER[quality];
  const paused = control === 'paused' || control === 'menu';

  // Attach global input to the canvas element once it exists.
  useEffect(() => {
    const el = wrapperRef.current?.querySelector('canvas');
    if (!el) return;
    return attachInput(el);
  }, [webgl]);

  // Clicking the canvas during play re-acquires pointer lock (user gesture).
  useEffect(() => {
    const el = wrapperRef.current?.querySelector('canvas');
    if (!el) return;
    const onClick = () => {
      const c = useGame.getState().control;
      if (c === 'onfoot' || c === 'driving') requestPointerLock();
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [webgl]);

  if (!webgl) return <WebGLFallback />;
  if (contextLost) {
    return (
      <div className="webgl-fallback">
        <h1>Graphics context lost</h1>
        <p>The browser dropped the WebGL context. Reload to keep playing.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="canvas-wrapper" ref={wrapperRef}>
      <Canvas
        shadows={settings.shadows}
        dpr={[1, settings.maxPixelRatio]}
        camera={{ fov: CAMERA.fov, near: 0.35, far: 900 }}
        gl={{
          antialias: quality === 'high',
          powerPreference: 'high-performance',
          alpha: false,
        }}
        onCreated={({ gl, scene }) => {
          if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__scene = scene;
            (window as unknown as Record<string, unknown>).__gl = gl;
          }
          gl.setClearColor(PALETTE.fog);
          scene.fog = new THREE.Fog(
            PALETTE.fog,
            settings.fogNear,
            settings.fogFar,
          );
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            setContextLost(true);
          });
        }}
      >
        <Suspense fallback={null}>
          <SkyDome />
          <Lighting quality={quality} />
          {/* `paused` freezes the whole physics world, not just our systems. */}
          <Physics
            gravity={PHYSICS.gravity}
            timeStep={PHYSICS.timeStep}
            paused={paused}
            // "follow" steps physics inside R3F's frame loop, after our
            // systems have written this frame's driving inputs. The
            // "independent" loop runs outside it and never picked them up.
            updateLoop="follow"
          >
            <City quality={quality} />
            {started && (
              <Simulation key={resetToken} quality={quality} />
            )}
          </Physics>
        </Suspense>
      </Canvas>
    </div>
  );
}

export { supportsWebGL };
