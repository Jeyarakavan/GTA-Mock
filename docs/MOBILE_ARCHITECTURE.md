# Neon District mobile architecture

This document records the mobile conversion boundary for the existing game. The browser build remains the reference implementation and is not replaced with a WebView.

## Current architecture

| Area | Browser implementation | Mobile decision |
| --- | --- | --- |
| Entry point | `src/main.tsx` -> `src/App.tsx` | Native entry point in `mobile/App.tsx` |
| Rendering | Three.js through React Three Fiber | Three.js with `expo-gl` and `expo-three`; native UI remains React Native |
| Physics | `@react-three/rapier` in `Simulation.tsx` | Keep deterministic gameplay/data modules shared; native physics is an explicit adapter boundary because the R3F Rapier bindings require a DOM canvas |
| State | Zustand in `src/game/store.ts` | Reuse Zustand and shared mission/world types; native frame data stays in refs |
| Input | Keyboard, mouse and pointer lock | Native gesture handlers and virtual controls feed the same action vocabulary |
| Persistence | Versioned `localStorage` | AsyncStorage-backed native adapter; browser storage remains the default |
| Audio | Web Audio API in `src/game/audio.ts` | Native audio adapter; web audio is never imported by the native entry point |
| Validation | Vitest and Playwright | Jest/unit tests for shared logic plus `expo run:android` and a physical Android smoke test |

## Reuse boundary

The deterministic world generator, mission definitions, wanted rules, vehicle math, save validation, and Zustand state shape are platform-independent. The DOM canvas, React Three Fiber scene graph, pointer lock, Web Audio graph, and browser event listeners are platform-specific and must not be imported by the native entry point.

The browser build now also exposes a touch-first control layer. It is useful for mobile browsers and provides a behavior reference while the native renderer is being validated.

## Native constraints

`@react-three/rapier` is coupled to React Three Fiber and its browser canvas lifecycle. A native implementation therefore needs either a native Rapier binding or a dedicated native physics adapter before claiming parity with the browser `Simulation`. The native project is structured to make that dependency explicit rather than silently substituting a mock game.

## Performance decisions

- Mutable input and simulation values remain outside React state.
- Mobile defaults should use low quality, capped device pixel ratio, and smaller traffic/pedestrian budgets.
- Native app lifecycle events pause the simulation and flush a safe save.
- Android testing must record device model, Android version, renderer, observed FPS, and any thermal or memory issues.
