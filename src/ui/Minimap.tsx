import { useEffect, useRef } from 'react';
import { WORLD, PALETTE } from '../game/config';
import { world } from '../game/store';
import { minimapBridge } from '../game/minimapBridge';
import { roadLineCoord } from '../game/world';

interface Props {
  /** Pixel size of the square canvas. */
  size: number;
  /** Metres of world visible across the map; 0 = show the whole city. */
  viewRange: number;
  className?: string;
}

const DISTRICT_COLORS: Record<string, string> = {
  commercial: '#4f5a6d',
  residential: '#6f6053',
  industrial: '#525853',
  park: PALETTE.parkGrass,
  plaza: PALETTE.plaza,
  safehouse: '#6d5a78',
  garage: '#5a6468',
};

/**
 * Canvas minimap driven by the same WorldData the 3D city is built from, so
 * the layout always matches. Redraws on an interval rather than every frame.
 */
export function Minimap({ size, viewRange, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // ~20 Hz is plenty for a map and keeps the main thread free.
      if (now - last < 50) return;
      last = now;

      const half = world.half;
      const px = minimapBridge.playerX;
      const pz = minimapBridge.playerZ;

      // Scale: full-city view, or a window centred on the player.
      const spanMeters = viewRange > 0 ? viewRange : half * 2;
      const scale = (size * dpr) / spanMeters;

      const centerX = viewRange > 0 ? px : 0;
      const centerZ = viewRange > 0 ? pz : 0;

      const toX = (wx: number) => (wx - centerX) * scale + (size * dpr) / 2;
      const toY = (wz: number) => (wz - centerZ) * scale + (size * dpr) / 2;

      ctx.save();
      ctx.clearRect(0, 0, size * dpr, size * dpr);

      // Ground
      ctx.fillStyle = '#20242e';
      ctx.fillRect(0, 0, size * dpr, size * dpr);

      // City blocks, coloured by district.
      for (const b of world.blocks) {
        ctx.fillStyle = DISTRICT_COLORS[b.district] ?? '#4a5160';
        const s = b.size * scale;
        ctx.fillRect(toX(b.x) - s / 2, toY(b.z) - s / 2, s, s);
      }

      // Roads drawn as strokes along the grid lines.
      ctx.strokeStyle = '#2f3540';
      ctx.lineWidth = Math.max(1, WORLD.roadWidth * scale);
      ctx.beginPath();
      for (let c = 0; c <= WORLD.gridCols; c++) {
        const x = toX(roadLineCoord(c, WORLD.gridCols));
        ctx.moveTo(x, toY(-half));
        ctx.lineTo(x, toY(half));
      }
      for (let r = 0; r <= WORLD.gridRows; r++) {
        const y = toY(roadLineCoord(r, WORLD.gridRows));
        ctx.moveTo(toX(-half), y);
        ctx.lineTo(toX(half), y);
      }
      ctx.stroke();

      // District boundary / world edge.
      ctx.strokeStyle = PALETTE.neonTeal;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(
        toX(-half),
        toY(-half),
        half * 2 * scale,
        half * 2 * scale,
      );

      // Safehouse
      const sh = { x: toX(world.safehouse.x), y: toY(world.safehouse.z) };
      ctx.fillStyle = PALETTE.neonTeal;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y - 6 * dpr);
      ctx.lineTo(sh.x + 5 * dpr, sh.y + 4 * dpr);
      ctx.lineTo(sh.x - 5 * dpr, sh.y + 4 * dpr);
      ctx.closePath();
      ctx.fill();

      // Garage
      ctx.fillStyle = PALETTE.neonOrange;
      ctx.fillRect(
        toX(world.garage.x) - 4 * dpr,
        toY(world.garage.z) - 4 * dpr,
        8 * dpr,
        8 * dpr,
      );

      // Available mission starts.
      for (const m of minimapBridge.missionStarts) {
        ctx.fillStyle = '#ffd66b';
        ctx.beginPath();
        ctx.arc(toX(m.x), toY(m.z), 4.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1b1e24';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }

      // Active objective — pulsing so it is unmistakable.
      const obj = minimapBridge.objective;
      if (obj) {
        const pulse = 4.5 + Math.sin(now / 220) * 1.8;
        ctx.fillStyle = PALETTE.neonPink;
        ctx.beginPath();
        ctx.arc(toX(obj.x), toY(obj.z), pulse * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }

      // Police units.
      for (const p of minimapBridge.police) {
        ctx.fillStyle = '#4aa8ff';
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.z), 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Player arrow, rotated to heading.
      const pxs = toX(px);
      const pys = toY(pz);
      ctx.save();
      ctx.translate(pxs, pys);
      ctx.rotate(-minimapBridge.playerYaw + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -7 * dpr);
      ctx.lineTo(5 * dpr, 6 * dpr);
      ctx.lineTo(0, 3 * dpr);
      ctx.lineTo(-5 * dpr, 6 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#12151b';
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, viewRange]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      aria-label="City minimap"
      role="img"
    />
  );
}
