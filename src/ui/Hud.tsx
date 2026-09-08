import { useGame } from '../game/store';
import { missionById } from '../game/store';
import { WANTED } from '../game/config';
import { toKmh } from '../game/vehiclePhysics';
import { Minimap } from './Minimap';

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function WantedStars({ stars }: { stars: number }) {
  return (
    <div
      className="wanted"
      aria-label={`Wanted level ${stars} of ${WANTED.maxStars} stars`}
    >
      {Array.from({ length: WANTED.maxStars }, (_, i) => (
        <span
          key={i}
          className={`star ${i < stars ? 'on' : 'off'}`}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
      {/* Text backup so wanted level never relies on colour alone. */}
      <span className="wanted-label">
        {stars > 0 ? `WANTED ${stars}/${WANTED.maxStars}` : 'CLEAR'}
      </span>
    </div>
  );
}

export function Hud() {
  const control = useGame((s) => s.control);
  const health = useGame((s) => s.health);
  const cash = useGame((s) => s.cash);
  const wantedStars = useGame((s) => s.wantedStars);
  const speed = useGame((s) => s.speed);
  const vehicleHealth = useGame((s) => s.vehicleHealth);
  const promptText = useGame((s) => s.promptText);
  const notifications = useGame((s) => s.notifications);
  const activeMission = useGame((s) => s.activeMission);
  const objectiveText = useGame((s) => s.objectiveText);
  const missionTime = useGame((s) => s.missionTime);
  const currentVehicleId = useGame((s) => s.currentVehicleId);
  const showHelp = useGame((s) => s.showHelp);

  const playing = control === 'onfoot' || control === 'driving';
  if (!playing) return null;

  const driving = control === 'driving';
  const kmh = Math.round(toKmh(speed));
  const mission = activeMission ? missionById(activeMission) : null;

  return (
    <div className="hud" aria-live="polite">
      {/* Top-left: vitals */}
      <div className="hud-panel top-left">
        <div className="stat-row">
          <span className="stat-label">HEALTH</span>
          <div className="bar" role="meter" aria-valuenow={Math.round(health)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="bar-fill health"
              style={{ width: `${Math.max(0, Math.min(100, health))}%` }}
            />
          </div>
          <span className="stat-value">{Math.round(health)}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">CASH</span>
          <span className="cash">${cash.toLocaleString()}</span>
        </div>
        <WantedStars stars={wantedStars} />
      </div>

      {/* Top-right: mission */}
      {mission && (
        <div className="hud-panel top-right mission-panel">
          <div className="mission-title">{mission.title}</div>
          <div className="mission-objective">{objectiveText}</div>
          {missionTime !== null && (
            <div
              className={`mission-timer ${missionTime < 15 ? 'urgent' : ''}`}
            >
              <span className="timer-label">TIME</span>
              <span className="timer-value">{formatTime(missionTime)}</span>
            </div>
          )}
        </div>
      )}

      {/* Bottom-left: minimap */}
      <div className="hud-panel bottom-left minimap-panel">
        <Minimap size={168} viewRange={180} className="minimap" />
        <div className="minimap-caption">NEON DISTRICT</div>
      </div>

      {/* Bottom-right: vehicle */}
      {driving && currentVehicleId && (
        <div className="hud-panel bottom-right vehicle-panel">
          <div className="speedo">
            <span className="speedo-value">{kmh}</span>
            <span className="speedo-unit">km/h</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">CONDITION</span>
            <div
              className="bar"
              role="meter"
              aria-valuenow={Math.round(vehicleHealth)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`bar-fill vehicle ${vehicleHealth < 30 ? 'critical' : ''}`}
                style={{ width: `${Math.max(0, Math.min(100, vehicleHealth))}%` }}
              />
            </div>
            <span className="stat-value">{Math.round(vehicleHealth)}%</span>
          </div>
        </div>
      )}

      {/* Centre-bottom: interaction prompt */}
      {promptText && (
        <div className="prompt" role="status">
          {promptText}
        </div>
      )}

      {/* Notifications */}
      <div className="notifications">
        {notifications.map((n) => (
          <div key={n.id} className={`notification ${n.tone}`}>
            {n.text}
          </div>
        ))}
      </div>

      {showHelp && <ControlsOverlay />}
      {!showHelp && <div className="help-hint">H — Controls · M — Map · Esc — Pause</div>}
    </div>
  );
}

export const CONTROLS: Array<[string, string]> = [
  ['W A S D', 'Move on foot / accelerate, brake, steer'],
  ['Mouse', 'Look around'],
  ['Shift', 'Sprint on foot'],
  ['Space', 'Jump on foot / handbrake while driving'],
  ['E', 'Enter or exit a vehicle, start a mission'],
  ['R', 'Recover a stuck or flipped vehicle'],
  ['M', 'Toggle the expanded map'],
  ['H', 'Toggle this controls list'],
  ['Esc', 'Pause'],
];

function ControlsOverlay() {
  return (
    <div className="controls-overlay">
      <h3>Controls</h3>
      <dl>
        {CONTROLS.map(([key, desc]) => (
          <div className="control-row" key={key}>
            <dt>{key}</dt>
            <dd>{desc}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">Press H to close</p>
    </div>
  );
}
