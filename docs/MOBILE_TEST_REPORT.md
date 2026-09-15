# Mobile validation report

Status: native gameplay, touch controls, persistence, Android bundling, and native TypeScript validation are implemented. Android device validation is pending until an emulator or physical device is available.

## Required evidence

| Scenario | Status | Evidence to record |
| --- | --- | --- |
| Install and launch native Android app | Pending | `npx expo run:android` output and launch screenshot |
| Touch movement, sprint, jump | Implemented in native controller and controls | Device recording pending |
| Enter, drive, brake, exit vehicle | Implemented with native arcade vehicle controller | Device recording pending |
| Wanted/police flow | Implemented with shared wanted rules and native pursuit units | Device notes pending |
| Three missions | Existing mission definitions run through native controller | Completion screenshots pending |
| Pause/map/help | Implemented in native UI | Device notes pending |
| Save and continue | AsyncStorage persistence implemented | Close/reopen test pending |
| 10-15 minute stability run | Pending | Device model, OS, average FPS, crashes |

Do not mark pending rows complete without running them on Android.

## Fixes applied on `fix/mobile-save-and-handbrake`

- Save/continue previously discarded completed missions on reload (`App.tsx` passed `[]`
  instead of the persisted `completedMissions` array to `loadSave`). Fixed to restore the
  saved mission progress.
- Vehicle braking previously reused the on-foot `jump` button while driving, which is not
  a distinct control as required by the task's control table. Added a dedicated
  `handbrake` field to `MobileInput` and a separate on-screen Handbrake button; `jump`
  now only affects on-foot movement.

These are code-level fixes only. The device-validation rows above are still pending real
Android hardware testing.
