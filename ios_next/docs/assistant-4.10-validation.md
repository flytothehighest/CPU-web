# iOS 4.10 (63): native assistant and launch recovery

## Root causes and changes

- Foundation `URLSession.AsyncBytes.lines` removes empty lines. The prior SSE decoder waited for those lines to dispatch events and concatenated multiple JSON payloads. A local HTTP reproduction confirmed this; the production decoder now frames raw bytes, preserves UTF-8, handles LF/CRLF/CR, and requires a completed `done` event.
- Assistant action serialization omitted the server-required `owner` field. Native history now preserves it and uses cookie/CSRF-authenticated native requests independent of Web navigation. Failed deletion remains queued locally and is retried without resurrecting the record.
- Guard request generations and account ownership, serialize history writes, prevent delayed history loads from replacing live messages, discard empty cancelled replies, retain partial replies, and retry without duplicating the user question.
- Replace asynchronous composer-height feedback with proposed-width measurement. Preserve Markdown newlines, provide inline errors/retry and keyboard dismissal, limit readable width on iPad, and avoid forcing scroll while the user reads older content.
- Bound background execution with a system background task; expiry cancels the request instead of leaving an infinite loading state.

## Launch protection

- Reject invalid/oversized legacy Live Activity timing caches. Use a deterministic Shanghai timezone fallback and first-valid-wins period normalization instead of forced timezone unwrap and duplicate-key dictionary construction.
- Missing App Group defaults fall back to standard defaults with shared activities disabled and a visible recovery message.
- Preserve background-task registration in `didFinishLaunchingWithOptions`; route scheduler work through a nonisolated callback and a MainActor task. Completion is nonisolated, locked, and idempotent.
- Read at most 8 MiB + 1 byte from the timetable archive; quarantine corrupt or oversized data and continue startup.
- Existing iOS 26 glass and scheduled ActivityKit APIs retain their availability guards and pre-26 native material/remote-activity branches. Watch period mapping already rejects duplicate keys before dictionary construction.

## Verification

- iPhone 17 Pro and iPhone 17e, iOS 26.5 (23F77): native assistant sends against the real service using the existing WK session, long answer completion, keyboard layout, local fixture streaming, error/recovery, stop, history, offline delete/retry, and account switch.
- Production Swift SSE/model tests pass; they execute production types against an in-memory transport.
- Live Activity checks pass, including invalid timezone, duplicate/invalid period cache and unavailable App Group fixtures.
- Swift package: 24 tests pass, including archive quarantine.
- iOS Node suite: 49/50 pass. Existing `native-web-bundle.test.mjs` expects an `official|fall|1|1|` native ID, but the unchanged bundled bridge returns a UUID. Neither that test nor the bridge was modified by this change.
- Debug simulator and Release simulator builds include iPhone, iPhone widgets/Live Activity, Watch and Watch widgets. Release also built with `SWIFT_STRICT_CONCURRENCY=complete`; pre-existing concurrency warnings remain outside the corrected background callback boundary.

## Exact OS limitation

Xcode 26.5 download attempts explicitly reported iOS 18.6.2, 18.6 and 18.5 runtimes unavailable (arm64 and, for 18.5, universal). No connected iOS 18.6.2 device or user .ips report was supplied. The deterministic traps above are fixed and tested; the reported user's exact crash cannot be attributed conclusively, and iOS 18.6.2 execution is NOT claimed.

The 4.9/62 version-bump commit `ccbad04a` immediately precedes the background-registration fix `fd717925cb7c427d32491629dd06e3863ec27698`. Current main includes the fix. App Store Connect shows Build 62 uploaded after that fix's commit time, but no matching local 62 archive is available to prove which source revision the uploaded binary contains. Simulator upgrade testing therefore uses a reconstructed Release build from the version-bump commit, not the encrypted App Store binary.
