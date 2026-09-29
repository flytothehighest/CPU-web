# iOS 15 compatibility and launch regression

Date: 2026-09-29. Source base: `ea0d5c75`, with the local compatibility changes.
Toolchain: Xcode 26.6 (17F113), macOS 26.4, Apple Silicon.

## Fix and feature boundaries

The original 4.11 (64) Release simulator build repeatedly exited before its first
screen on iOS 17.0 (21A328). dyld reported the missing ActivityKit symbol
`_$s11ActivityKit0A5StyleO8standardyA2CmFWC` (`ActivityStyle.standard`).

The app and iOS widget extension now weak-link ActivityKit. The existing
runtime availability checks remain necessary; weak linking alone does not make
new APIs safe to call on older systems. The final simulator and device binaries
both passed `check-legacy-linkage.py` (53 app imports, 7 widget imports).

The app's minimum OS is 15.0. iOS 15–16 use a persistent WKWebView with the legacy
app UA, web login and schedule, a native navigation menu, back/reload, a retry
state and schedule deep links. These versions do not create the modern native
shell, native schedule UI, native assistant, Live Activities, Watch sync or
widget setup. The widget extension retains minimum OS 17.0. iOS 17+ retains the
existing native shell and each newer capability's OS availability gates.

`Object.hasOwn` and `Array.prototype.at` are supplied only when missing in the
legacy WebKit context, covering iOS 15.0–15.3 without a website deployment.
MetricKit's iOS 17-only exception details are guarded; calendar and shared Watch
model APIs also compile at the lower app deployment target.

## Simulator results

All rows below used the final **Release** simulator build with minimum OS 15.0.
Each ran three independent cold launches, polling the PID for 10 seconds per
launch. Screenshots and app logs were saved; the observation logs contained no
missing-symbol, fatal-error or uncaught-exception signature. This is a smoke
test, not a guarantee against every possible crash.

| Runtime | Device | Cold launches | Additional observed UI |
| --- | --- | --- | --- |
| iOS 15.5 (19F70) | iPhone 13 | 3/3 passed | Home, web login, native navigation to schedule/login guidance; background/foreground retained the process; schedule deep link confirmed in the OS prompt |
| iOS 16.4 (20E247) | iPhone 14 | 3/3 passed | Home and schedule/login guidance; final build screenshot verified web shell |
| iOS 17.0 (21A328) | iPhone 15 | 3/3 passed | Welcome and native login. Also tested Debug mock schedule, course detail/editor and background settings without a school account |
| iOS 26.5 (23F77) | iPhone 17 | 3/3 passed | Native welcome screen |

No school credentials were entered. Authenticated academic queries, actual
account/OS upgrades, device memory pressure, push delivery, Watch pairing and
widget timelines require further device testing. iOS 15.0 itself and every minor
release were not tested; 15.5, 16.4 and 17.0 are the sampled older runtimes.

## Build and regression checks

- Release simulator and unsigned generic iOS device builds: passed.
- Debug simulator build used for the native schedule fixture: passed.
- Final app plist: `MinimumOSVersion = 15.0`; widget plist: `17.0`.
- Legacy JS resource exists in the final app bundle.
- ActivityKit imports and framework load commands are weak in both app and widget,
  for both simulator and device Release binaries.
- Swift package: 24 tests passed.
- Live Activity controller checks: passed, including cache recovery and lifecycle.
- Legacy JavaScript compatibility tests: 3 passed, including receiver/index edge
  cases and preservation of newer native implementations.
- All Node tests: **52/53 passed**. The existing
  `native-web-bundle.test.mjs` test `bundled bridge works on a legacy page without
  a deployed native bridge` expects `official|fall|1|1|…`, while the unchanged
  bundled bridge returns a UUID course ID. Both that test and its bundled bridge
  resource are unchanged from the source base; this pre-existing failure remains.
- `git diff --check`: passed.

## Reproduce

With a disposable simulator already booted and a built app installed:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
python3 ios_next/scripts/check-legacy-linkage.py /path/to/CpuTime.app
python3 ios_next/scripts/check-simulator-launch.py DEVICE_UUID --output /tmp/cpu-launch-qa
node --test ios_next/tests/legacy-web-compatibility.test.mjs
```

The launch script intentionally verifies process survival only. Navigation,
web content, OS URL-confirmation dialogs and authenticated features require
separate UI checks; a successful `simctl openurl` alone is not proof of delivery.

## Release 4.12 follow-up

The later release regression fixed the stale bundled-bridge ID expectation to
match UUID IDs; all 53 iOS Node tests now pass. Course deduplication also passes
the complete native store checks after removing the premature rejection of
repeated rows with different IDs. Distinct custom clock times remain separate.
The older-runtime launch matrix above predates these timetable changes and is
not represented as a fresh 4.12 binary test.

## Cleanup

The iOS 15.5, 16.4 and 17.0 runtimes were installed specifically for these tests.
The four `CPU … Compatibility QA` / `CPU iOS 17.0 Crash QA` test devices and those
three old runtimes were removed after collecting evidence. Final `simctl` inventories
confirmed that none of the four test device UUIDs remain and only the original
iOS 26.5 / watchOS 26.5 runtimes remain. The previously
installed iOS 26.5 / watchOS 26.5 runtimes and existing devices are not test
cleanup targets. Downloaded images and the temporary extracted iOS 15 package
were also removed, along with temporary QA build directories. Final cleanup
status is recorded in `cleanup.json` with the local evidence.

The local evidence is saved in the chat workspace under
`output/ios-compatibility-qa/`. These are local QA builds, not signed App Store or
production artifacts. No push, deployment or store release was performed.
