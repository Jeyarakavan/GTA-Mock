import { useRef, useState } from 'react';
import { useGame } from '../game/store';
import {
  endTouchLook,
  injectPress,
  moveTouchLook,
  setTouchJump,
  setTouchMovement,
  setTouchSprint,
} from '../game/input';

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

function ActionButton({
  label,
  onPress,
  onHoldStart,
  onHoldEnd,
  className = '',
}: {
  label: string;
  onPress?: () => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`touch-button ${className}`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onHoldStart?.();
        onPress?.();
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        onHoldEnd?.();
      }}
      onPointerCancel={() => onHoldEnd?.()}
    >
      {label}
    </button>
  );
}

function Joystick() {
  const origin = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const radius = 58;

  const update = (x: number, y: number) => {
    const dx = clamp(x - origin.current.x, radius);
    const dy = clamp(y - origin.current.y, radius);
    setKnob({ x: dx, y: dy });
    setTouchMovement(-dy / radius, dx / radius);
  };

  const release = () => {
    setKnob({ x: 0, y: 0 });
    setTouchMovement(0, 0);
  };

  return (
    <div
      className="touch-joystick"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        update(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => update(event.clientX, event.clientY)}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="touch-joystick-ring" />
      <span className="touch-joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

function LookPad() {
  const last = useRef({ x: 0, y: 0 });
  return (
    <div
      className="touch-look-pad"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        last.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        moveTouchLook(event.clientX - last.current.x, event.clientY - last.current.y);
        last.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={endTouchLook}
      onPointerCancel={endTouchLook}
    />
  );
}

export function TouchControls() {
  const control = useGame((state) => state.control);
  const promptText = useGame((state) => state.promptText);
  const actions = useGame((state) => state.actions);
  const playing = control === 'onfoot' || control === 'driving';
  if (!playing) return null;

  return (
    <div className="touch-controls" aria-label="Touch controls">
      <LookPad />
      <Joystick />
      <div className="touch-actions">
        <ActionButton label="Sprint" className="touch-sprint" onHoldStart={() => setTouchSprint(true)} onHoldEnd={() => setTouchSprint(false)} />
        <ActionButton label={control === 'driving' ? 'Brake' : 'Jump'} className="touch-jump" onHoldStart={() => setTouchJump(true)} onHoldEnd={() => setTouchJump(false)} />
        <ActionButton label={promptText ? 'Action' : 'Interact'} className="touch-interact" onPress={() => injectPress('interact')} />
        {control === 'driving' && <ActionButton label="Recover" className="touch-recover" onPress={() => injectPress('recover')} />}
      </div>
      <div className="touch-menu-actions">
        <ActionButton label="Map" onPress={() => actions.toggleMap()} />
        <ActionButton label="Help" onPress={() => actions.toggleHelp()} />
        <ActionButton label="Pause" onPress={() => actions.togglePause()} />
      </div>
    </div>
  );
}