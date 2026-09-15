import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { MobileCity } from './src/MobileCity';
import { MobileControls, type MobileInput } from './src/MobileControls';
import { MobileGameController, type MobileTelemetry } from './src/MobileGame';

const SAVE_KEY = 'neon-district-street-run/save/v1';

export default function App() {
  const [paused, setPaused] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [cash, setCash] = useState(0);
  const [telemetry, setTelemetry] = useState<MobileTelemetry | null>(null);
  const controller = useRef(new MobileGameController());
  const input = useRef<MobileInput>({ forward: 0, strafe: 0, sprint: false, jump: false, handbrake: false, lookDX: 0, lookDY: 0 });
  const cashRef = useRef(cash);
  cashRef.current = cash;

  useEffect(() => {
    AsyncStorage.getItem(SAVE_KEY).then((value) => {
      if (!value) return;
      try {
        const save = JSON.parse(value) as { cash?: number; completedMissions?: string[]; resume?: { x: number; z: number } | null };
        controller.current.loadSave(Number(save.cash) || 0, (save.completedMissions ?? []) as never[], save.resume ?? null);
        setCash(controller.current.cash);
      } catch { /* corrupted native save is ignored */ }
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        input.current.forward = 0;
        input.current.strafe = 0;
        input.current.sprint = false;
        input.current.jump = false;
        input.current.handbrake = false;
        setPaused(true);
        void AsyncStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, ...controller.current.getSave() }));
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <MobileCity input={input} controller={controller.current} paused={paused} onTelemetry={(next) => { setTelemetry(next); setCash(next.cash); }} />
      <View pointerEvents="none" style={styles.hud}>
        <Text style={styles.title}>NEON DISTRICT</Text>
        <Text style={styles.stat}>HEALTH {Math.round(telemetry?.health ?? 100)}   CASH ${cash.toLocaleString()}</Text>
        <Text style={styles.stat}>WANTED {'★'.repeat(telemetry?.wanted ?? 0) || 'CLEAR'} {telemetry?.driving ? `  ${Math.round(telemetry.speed * 3.6)} km/h` : ''}</Text>
        <Text style={styles.objective}>{paused ? 'PAUSED' : telemetry?.objective ?? 'Explore the district'}</Text>
        {telemetry?.missionTime !== null && telemetry?.missionTime !== undefined && <Text style={styles.timer}>TIME {Math.ceil(telemetry.missionTime)}s</Text>}
      </View>
      {showHelp && <View style={styles.helpPanel}><Text style={styles.helpTitle}>TOUCH CONTROLS</Text><Text style={styles.helpText}>Left stick: move  |  Right drag: camera</Text><Text style={styles.helpText}>Sprint, jump, action, pause</Text></View>}
      {showMap && <View style={styles.mapPanel}><Text style={styles.helpTitle}>NEON DISTRICT MAP</Text><Text style={styles.helpText}>Player: {Math.round(telemetry?.position.x ?? 0)}, {Math.round(telemetry?.position.z ?? 0)}</Text><Text style={styles.helpText}>Safehouse: {Math.round(controller.current.world.safehouse.x)}, {Math.round(controller.current.world.safehouse.z)}</Text><Text style={styles.helpText}>Garage: {Math.round(controller.current.world.garage.x)}, {Math.round(controller.current.world.garage.z)}</Text><Text style={styles.helpText}>Mission markers are shown in pink in the world.</Text></View>}
      {telemetry?.notification && <View pointerEvents="none" style={styles.notification}><Text style={styles.notificationText}>{telemetry.notification}</Text></View>}
      <MobileControls input={input} onInteract={() => { controller.current.interact(); setPaused(false); }} onRecover={() => controller.current.recover()} onMap={() => setShowMap((value) => !value)} onPause={() => setPaused((value) => !value)} onHelp={() => setShowHelp((value) => !value)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#10141c' },
  hud: { position: 'absolute', top: 18, left: 20 },
  title: { color: '#2ee6c8', fontSize: 16, fontWeight: '800', letterSpacing: 2 },
  stat: { color: '#ffd66b', marginTop: 6, fontSize: 13, fontWeight: '700' },
  objective: { color: '#eaf2f6', marginTop: 8, fontSize: 13 },
  timer: { color: '#ff5fa2', marginTop: 5, fontSize: 14, fontWeight: '800' },
  notification: { position: 'absolute', top: '44%', left: 24, right: 24, alignItems: 'center' },
  notificationText: { color: '#2ee6c8', backgroundColor: 'rgba(16,21,31,0.86)', padding: 10, borderRadius: 8, fontWeight: '700' },
  helpPanel: { position: 'absolute', top: 86, left: 20, right: 20, padding: 16, backgroundColor: 'rgba(16,21,31,0.9)', borderWidth: 1, borderColor: '#2ee6c8', borderRadius: 8 },
  helpTitle: { color: '#2ee6c8', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  helpText: { color: '#eaf2f6', fontSize: 13, marginTop: 4 },
  mapPanel: { position: 'absolute', top: 86, left: 20, right: 20, padding: 16, backgroundColor: 'rgba(16,21,31,0.9)', borderWidth: 1, borderColor: '#ff5fa2', borderRadius: 8 },
});
