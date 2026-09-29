# iOS 4.12 (65)

Integrated remote main `a47ba642` before packaging. All four iPhone/Watch targets use version 4.12, build 65.

Changes:
- Fix the iOS 17.0 ActivityKit startup failure and support iOS 15–16 with a reduced web interface. Modern native features remain available on iOS 17+.
- Match the Web timetable palette and card/grid styling, with shared day/week/month colors and brighter dark-mode text.
- Support period 12 in iOS/Web rendering and editing, shared schedule grids and fallback widget/image schedules. Default time is provisionally 21:15–22:00, following the existing evening-period interval.
- Deduplicate repeated course rows even when bridge IDs differ. Keep separate teachers, rooms, adjacent lessons, custom course IDs and custom clock times distinct.
- Update the bundled bridge regression to its current UUID identity contract and regenerate all shared Web bridges.

Validation:
- Complete NativeScheduleStoreChecks passed, including repeated rows and separate custom clock times.
- iOS Node suite 53/53; combined iOS/Harmony suite 177/177; Android bridge suite 8/8.
- Server/Web schedule suite 88/88; Swift package 24/24; palette parity 32/32; Live Activity and upgrade-cache checks passed.
- Web type checking passed; signed Release archive succeeded; all four bundle versions verified.
- Earlier style/period-12 simulator checks used iOS 26.5. Prior compatibility work sampled iOS 15.5, 16.4 and 17.0; see ios-compatibility-qa.md for the exact scope. Those older-runtime runs predate the final 4.12 binary.
- Temporary test simulators and downloaded older runtimes were removed. No production deployment or App Store review submission is implied by a Git push.

The exact pushed SHA, GitHub build result and exported IPA are recorded in the delivery report.
