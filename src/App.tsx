import { useEffect } from 'react';
import { GameCanvas } from './game/GameCanvas';
import { Hud } from './ui/Hud';
import { StartMenu, PauseMenu, MapOverlay } from './ui/Menus';
import { useGame } from './game/store';
import { audio } from './game/audio';
import { TouchControls } from './ui/TouchControls';
import {
  consumePress,
  onPointerLockChanged,
  clearInput,
} from './game/input';
import './styles.css';

/**
 * Global key handling for UI-level toggles. Gameplay keys are polled by the
 * frame loop; these are discrete UI actions, so they run on a rAF drain of the
 * one-shot press flags rather than duplicating listeners.
 */
function useGlobalKeys() {
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { control, actions } = useGame.getState();

      if (consumePress('pause')) {
        if (control === 'menu') {
          // Nothing to pause from the title screen.
        } else if (useGame.getState().showMap) {
          actions.toggleMap();
        } else {
          actions.togglePause();
        }
      }

      if (control === 'onfoot' || control === 'driving' || control === 'paused') {
        if (consumePress('map')) actions.toggleMap();
        if (consumePress('help')) actions.toggleHelp();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/**
 * If the pointer is released unexpectedly during play (Esc from the browser,
 * alt-tab), pause cleanly rather than leaving the player in a half-controlled
 * state with a free cursor.
 */
function usePointerLockGuard() {
  useEffect(() => {
    return onPointerLockChanged((locked) => {
      if (locked) return;
      const { control, actions } = useGame.getState();
      if (control === 'onfoot' || control === 'driving') {
        clearInput();
        actions.pause();
      }
    });
  }, []);
}

/** Suspend audio and pause the game when the tab is hidden. */
function useVisibilityGuard() {
  useEffect(() => {
    const onVisibility = () => {
      const { control, actions } = useGame.getState();
      if (document.hidden) {
        audio.setSuspended(true);
        if (control === 'onfoot' || control === 'driving') actions.pause();
      } else if (useGame.getState().control !== 'paused') {
        audio.setSuspended(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

/** Keep the audio engine in sync with the stored settings. */
function useAudioSettings() {
  const volume = useGame((s) => s.volume);
  const muted = useGame((s) => s.muted);
  useEffect(() => {
    audio.setVolume(volume);
    audio.setMuted(muted);
  }, [volume, muted]);
}

export default function App() {
  useGlobalKeys();
  usePointerLockGuard();
  useVisibilityGuard();
  useAudioSettings();

  // Tear the audio graph down if the app unmounts.
  useEffect(() => () => audio.dispose(), []);

  return (
    <div className="app">
      <GameCanvas />
      <Hud />
      <TouchControls />
      <MapOverlay />
      <PauseMenu />
      <StartMenu />
    </div>
  );
}
