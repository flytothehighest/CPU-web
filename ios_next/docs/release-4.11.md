# iOS 4.11 (64)

Release base: remote main `24b68317`, which contains the 4.10 native assistant and launch-recovery fixes (`9d2730bb`). Fast-forward integration preserved those fixes without replacing user runtime files.

The new iOS changes add large-widget timeline/list layouts, clear labels for courses on another day, simplified after-class behavior, published term holidays, refreshed resting/holiday states and interactive holiday celebration. Watch holiday behavior is aligned. Main also includes Android/Harmony local widget data, asynchronous song-review advice and deployment repairs.

All four targets use 4.11 (64): iPhone app, iPhone widgets/Live Activity, Watch app and Watch widgets.

Validation on 2026-09-27:
- Release iOS simulator build with complete strict-concurrency checking succeeded, including all four targets.
- Signed generic iOS archive succeeded; all embedded bundle versions verified.
- Upgraded an existing-session iPhone 17 on iOS 26.5; native timetable rendered after launch.
- Production assistant SSE/model regressions passed; Swift package 24/24 passed; Live Activity checks including upgrade-cache recovery passed.
- Node iOS suite 49/50: the pre-existing bundled-bridge native-ID assertion still expects an `official|fall|1|1|` prefix while the unchanged bridge returns a UUID. No new failure.
- Exact iOS 18.6.2 execution remains unavailable; no claim of testing on that OS. Existing launch safeguards are retained. Real-device APNs/background scheduling is not established by simulator validation.

CI, upload and App Store review results are recorded in the task delivery report after publication steps complete.
