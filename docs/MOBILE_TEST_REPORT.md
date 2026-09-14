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
