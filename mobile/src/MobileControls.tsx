import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface MobileInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
  lookDX: number;
  lookDY: number;
}

interface Props {
  input: React.MutableRefObject<MobileInput>;
  onInteract: () => void;
  onRecover: () => void;
  onMap: () => void;
  onPause: () => void;
  onHelp: () => void;
}

export function MobileControls({ input, onInteract, onRecover, onMap, onPause, onHelp }: Props) {
  const origin = useRef({ x: 0, y: 0 });
  const lookOrigin = useRef({ x: 0, y: 0 });
  const setStick = (x: number, y: number) => {
    const dx = Math.max(-60, Math.min(60, x - origin.current.x));
    const dy = Math.max(-60, Math.min(60, y - origin.current.y));
    input.current.forward = -dy / 60;
    input.current.strafe = dx / 60;
  };
  const releaseStick = () => {
    input.current.forward = 0;
    input.current.strafe = 0;
  };
  const updateLook = (x: number, y: number) => {
    input.current.lookDX += x - lookOrigin.current.x;
    input.current.lookDY += y - lookOrigin.current.y;
    lookOrigin.current = { x, y };
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        style={styles.stick}
        onTouchStart={(event) => {
          const { locationX, locationY } = event.nativeEvent;
          origin.current = { x: locationX, y: locationY };
          setStick(locationX, locationY);
        }}
        onTouchMove={(event) => setStick(event.nativeEvent.locationX, event.nativeEvent.locationY)}
        onTouchEnd={releaseStick}
        onTouchCancel={releaseStick}
      >
        <View style={styles.stickInner} />
      </View>
      <View
        style={styles.lookPad}
        onTouchStart={(event) => {
          lookOrigin.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        }}
        onTouchMove={(event) => updateLook(event.nativeEvent.locationX, event.nativeEvent.locationY)}
      />
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          onPressIn={() => { input.current.sprint = true; }}
          onPressOut={() => { input.current.sprint = false; }}
        >
          <Text style={styles.buttonText}>Sprint</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.jump]}
          onPressIn={() => { input.current.jump = true; }}
          onPressOut={() => { input.current.jump = false; }}
        >
          <Text style={styles.buttonText}>Jump</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.interact]} onPress={onInteract}>
          <Text style={styles.buttonText}>Action</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.recover]} onPress={onRecover}>
          <Text style={styles.buttonText}>Recover</Text>
        </Pressable>
      </View>
      <Pressable style={styles.pause} onPress={onPause}>
        <Text style={styles.buttonText}>Pause</Text>
      </Pressable>
      <Pressable style={styles.help} onPress={onHelp}>
        <Text style={styles.buttonText}>Help</Text>
      </Pressable>
      <Pressable style={styles.map} onPress={onMap}>
        <Text style={styles.buttonText}>Map</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stick: {
    position: 'absolute', bottom: 24, left: 24, width: 132, height: 132,
    borderRadius: 66, borderWidth: 2, borderColor: '#2ee6c8',
    backgroundColor: 'rgba(16,21,31,0.55)', justifyContent: 'center', alignItems: 'center',
  },
  stickInner: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#2ee6c8', borderWidth: 2, borderColor: '#eaf2f6' },
  actions: { position: 'absolute', right: 24, bottom: 24, width: 180, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { minWidth: 78, minHeight: 52, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(16,21,31,0.82)', borderWidth: 1, borderColor: '#ffd66b', justifyContent: 'center', alignItems: 'center' },
  jump: { borderColor: '#ff5fa2' },
  interact: { borderColor: '#2ee6c8' },
  recover: { borderColor: '#ff9d4d' },
  pause: { position: 'absolute', top: 20, right: 20, minWidth: 76, minHeight: 48, borderRadius: 8, backgroundColor: 'rgba(16,21,31,0.82)', borderWidth: 1, borderColor: '#9fb0c0', justifyContent: 'center', alignItems: 'center' },
  help: { position: 'absolute', top: 20, right: 108, minWidth: 76, minHeight: 48, borderRadius: 8, backgroundColor: 'rgba(16,21,31,0.82)', borderWidth: 1, borderColor: '#9fb0c0', justifyContent: 'center', alignItems: 'center' },
  map: { position: 'absolute', top: 20, right: 196, minWidth: 76, minHeight: 48, borderRadius: 8, backgroundColor: 'rgba(16,21,31,0.82)', borderWidth: 1, borderColor: '#9fb0c0', justifyContent: 'center', alignItems: 'center' },
  lookPad: { position: 'absolute', top: 90, right: 0, bottom: 0, left: '42%' },
  buttonText: { color: '#eaf2f6', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
});
