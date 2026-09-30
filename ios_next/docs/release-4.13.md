# iOS 4.13 (66)

Release base: remote main `8a7a660c`. Compared with 4.12 (65), the iOS changes are:

- `4ecbcbfa`: restore the resident holiday countdown, with a separate switch that respects the master holiday setting. Compact two-course widgets reduce spacing while retaining room information; rest states avoid duplicate countdowns.
- `f01c2cfc`: remove the unused course detail sheet and ICS exporter. The existing course editor remains.

All four targets (iPhone app, iPhone widgets, Watch app and Watch widgets) use version 4.13, build 66. The minimum versions remain iOS 15 for the main app, iOS 17 for its widgets and watchOS 10 for Watch targets.

Validation on 2026-09-30:
- Signed generic iOS Release archive succeeded, including all four targets.
- iOS Node suite: 53/53; Swift package: 24/24.
- Complete native schedule store and Live Activity/upgrade-cache checks passed.
- Actual App/widget configuration struct decoding and encoding checked in an isolated Swift harness: legacy fields preserve disabled settings; all four holiday/resident toggle combinations round-trip across targets.
- ActivityKit runtime import inspection: all 53 app imports and 7 widget imports are weak; both framework loads remain optional.
- Archive code signature verified. No new simulator or runtime was installed for this packaging run; the prior compatibility matrix is not claimed as a new 4.13 runtime test.

The delivery report records the exported IPA, exact pushed SHA and GitHub artifact verification. Git push does not submit App Store review or deploy the website.
