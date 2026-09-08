import { useEffect, useState } from 'react';
import { useGame, missionDefs } from '../game/store';
import { clearSave, loadSave } from '../game/save';
import { audio } from '../game/audio';
import { exitPointerLock, requestPointerLock } from '../game/input';
import { Minimap } from './Minimap';
import { CONTROLS } from './Hud';
import type { Quality } from '../game/types';

function QualityToggle({
  value,
  onChange,
}: {
  value: Quality;
  onChange: (q: Quality) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-label">Quality</span>
      <div className="segmented" role="group" aria-label="Quality setting">
        {(['low', 'high'] as const).map((q) => (
          <button
            key={q}
            type="button"
            className={`seg ${value === q ? 'active' : ''}`}
            aria-pressed={value === q}
            onClick={() => onChange(q)}
          >
            {q === 'low' ? 'Low' : 'High'}
          </button>
        ))}
      </div>
    </div>
  );
}

function AudioSettings() {
  const volume = useGame((s) => s.volume);
  const muted = useGame((s) => s.muted);
  const actions = useGame((s) => s.actions);

  return (
    <>
      <div className="setting-row">
        <span className="setting-label">Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          aria-label="Volume"
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            actions.setVolume(v);
            audio.setVolume(v);
          }}
        />
        <span className="setting-value">{Math.round(volume * 100)}%</span>
      </div>
      <div className="setting-row">
        <span className="setting-label">Sound</span>
        <button
          type="button"
          className={`seg ${muted ? '' : 'active'}`}
          aria-pressed={!muted}
          onClick={() => {
            const next = !muted;
            actions.setMuted(next);
            audio.setMuted(next);
          }}
        >
          {muted ? 'Muted' : 'On'}
        </button>
      </div>
    </>
  );
}

export function StartMenu() {
  const control = useGame((s) => s.control);
  const hasSave = useGame((s) => s.hasSave);
  const quality = useGame((s) => s.quality);
  const actions = useGame((s) => s.actions);

  const [showControls, setShowControls] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (control === 'menu') actions.refreshHasSave();
  }, [control, actions]);

  if (control !== 'menu') return null;

  const save = hasSave ? loadSave() : null;

  const begin = (fromSave: boolean) => {
    // Audio must be created inside the click handler to satisfy autoplay rules.
    audio.init();
    audio.setVolume(useGame.getState().volume);
    audio.setMuted(useGame.getState().muted);
    audio.setSuspended(false);
    audio.startAmbient();
    actions.startGame(fromSave);
    // Same gesture, so pointer lock is allowed here.
    requestPointerLock();
  };

  return (
    <div className="menu-screen start-menu">
      <div className="menu-backdrop" />
      <div className="menu-content">
        <header className="title-block">
          <p className="kicker">Welcome to</p>
          <h1 className="game-title">
            Neon District
            <span className="subtitle">Street Run</span>
          </h1>
          <p className="tagline">
            A coastal city at dusk. A courier with a car and no patience.
          </p>
        </header>

        {!showControls ? (
          <>
            <div className="menu-buttons">
              <button
                className="btn primary large"
                onClick={() => {
                  if (hasSave && !confirmReset) {
                    setConfirmReset(true);
                    return;
                  }
                  clearSave();
                  setConfirmReset(false);
                  begin(false);
                }}
              >
                {confirmReset ? 'Confirm — erase saved progress' : 'New Game'}
              </button>
              {confirmReset && (
                <button className="btn ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              )}

              {hasSave && !confirmReset && (
                <button className="btn large" onClick={() => begin(true)}>
                  Continue
                  {save && (
                    <span className="btn-sub">
                      ${save.cash.toLocaleString()} ·{' '}
                      {save.completedMissions.length}/{missionDefs.length} jobs
                    </span>
                  )}
                </button>
              )}

              <button className="btn ghost" onClick={() => setShowControls(true)}>
                Controls
              </button>
            </div>

            <div className="menu-settings">
              <QualityToggle value={quality} onChange={actions.setQuality} />
              <AudioSettings />
            </div>

            <p className="disclaimer">
              An original game. Not affiliated with, endorsed by, or derived
              from any existing game franchise.
            </p>
          </>
        ) : (
          <div className="controls-list">
            <h2>Controls</h2>
            <dl>
              {CONTROLS.map(([key, desc]) => (
                <div className="control-row" key={key}>
                  <dt>{key}</dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
            <button className="btn" onClick={() => setShowControls(false)}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PauseMenu() {
  const control = useGame((s) => s.control);
  const quality = useGame((s) => s.quality);
  const cash = useGame((s) => s.cash);
  const missionStatus = useGame((s) => s.missionStatus);
  const activeMission = useGame((s) => s.activeMission);
  const actions = useGame((s) => s.actions);
  const [confirmMenu, setConfirmMenu] = useState(false);

  const paused = control === 'paused';

  useEffect(() => {
    if (!paused) return;
    // Pausing must release the pointer and quiet the game.
    exitPointerLock();
    audio.setSuspended(true);
    return () => {
      audio.setSuspended(false);
    };
  }, [paused]);

  // Unmounting on resume already discards confirmMenu, so there is no need to
  // reset it from an effect.
  if (!paused) return null;

  return (
    <div className="menu-screen pause-menu">
      <div className="menu-backdrop" />
      <div className="menu-content narrow">
        <h2>Paused</h2>

        <div className="pause-stats">
          <div>
            <span className="stat-label">Cash</span>
            <strong>${cash.toLocaleString()}</strong>
          </div>
          <div>
            <span className="stat-label">Jobs done</span>
            <strong>
              {Object.values(missionStatus).filter((s) => s === 'completed').length}
              /{missionDefs.length}
            </strong>
          </div>
        </div>

        <div className="menu-buttons">
          <button
            className="btn primary"
            onClick={() => {
              actions.resume();
              audio.setSuspended(false);
              requestPointerLock();
            }}
          >
            Resume
          </button>

          <button
            className="btn"
            disabled={!activeMission}
            onClick={() => {
              actions.restartMission();
              audio.setSuspended(false);
              requestPointerLock();
            }}
            title={
              activeMission ? 'Restart the current job' : 'No mission is active'
            }
          >
            Restart mission
          </button>

          {!confirmMenu ? (
            <button className="btn ghost" onClick={() => setConfirmMenu(true)}>
              Return to menu
            </button>
          ) : (
            <>
              <button
                className="btn danger"
                onClick={() => {
                  actions.saveProgress();
                  actions.returnToMenu();
                }}
              >
                Save and quit to menu
              </button>
              <button className="btn ghost" onClick={() => setConfirmMenu(false)}>
                Cancel
              </button>
            </>
          )}
        </div>

        <div className="menu-settings">
          <QualityToggle value={quality} onChange={actions.setQuality} />
          <AudioSettings />
        </div>

        <div className="mission-log">
          <h3>Jobs</h3>
          {missionDefs.map((m) => (
            <div key={m.id} className={`log-row ${missionStatus[m.id]}`}>
              <span className="log-title">{m.title}</span>
              <span className="log-status">
                {missionStatus[m.id] === 'completed'
                  ? '✓ Done'
                  : missionStatus[m.id] === 'active'
                    ? '● Active'
                    : missionStatus[m.id] === 'failed'
                      ? '× Failed — retry available'
                      : 'Available'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full-screen map, toggled with M. */
export function MapOverlay() {
  const showMap = useGame((s) => s.showMap);
  const control = useGame((s) => s.control);
  const actions = useGame((s) => s.actions);

  const playing = control === 'onfoot' || control === 'driving';
  if (!showMap || !playing) return null;

  const size = Math.min(
    620,
    Math.min(window.innerWidth, window.innerHeight) - 120,
  );

  return (
    <div className="map-overlay" onClick={() => actions.toggleMap()}>
      <div className="map-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Neon District</h2>
        <Minimap size={size} viewRange={0} className="big-map" />
        <div className="map-legend">
          <span><i className="dot teal" /> Safehouse</span>
          <span><i className="dot orange" /> Garage</span>
          <span><i className="dot yellow" /> Available job</span>
          <span><i className="dot pink" /> Objective</span>
          <span><i className="dot blue" /> Police</span>
        </div>
        <button className="btn ghost" onClick={() => actions.toggleMap()}>
          Close (M)
        </button>
      </div>
    </div>
  );
}
