import Foundation

/// Run with swiftc alongside NativeScheduleStore.swift; no school account is required.
@main
struct NativeScheduleStoreChecks {
    @MainActor
    static func main() async throws {
        let raw = #"{"version":1,"source":"jwxt","fetchedAt":1788739200000,"auth":{"authenticated":true},"data":{"currentSemester":"fall","currentWeek":3,"cells":[]},"calendar":{"currentWeek":"3","weeks":[]}}"#
        let decoded = try JSONDecoder().decode(NativeScheduleSnapshot.self, from: Data(raw.utf8))
        precondition(!decoded.completeSemester, "Old bridges without a scope marker remain week-scoped")
        precondition(decoded.data?.currentWeek == "3")
        precondition(decoded.calendar?.currentWeek == 3)
        precondition(abs(decoded.fetchedAt!.timeIntervalSince1970 - 1_788_739_200) < 1)

        func snapshot() -> NativeScheduleSnapshot {
            NativeScheduleSnapshot(source: .graduate, fetchedAt: .now,
                data: NativeScheduleResult(currentSemester: "fall", currentWeek: "3",
                    cells: [NativeScheduleCell(day: 1, bigSlot: 1, courses: [NativeScheduleCourse(name: "药理学")])]),
                calendar: NativeScheduleCalendar(currentWeek: 3), auth: NativeScheduleAuth(authenticated: true))
        }
        var calls = 0
        let store = NativeScheduleStore(loader: { _ in calls += 1; return snapshot() })
        await store.load(semester: "fall", week: "8")
        precondition(store.selectedWeek == "8", "Graduate payload currentWeek must not replace the selected week")
        await store.selectWeek("9")
        await store.selectWeek("8")
        precondition(store.selectedWeek == "8", "Cache hits must preserve selected week")
        precondition(calls == 2, "Returning to a cached week must not fetch")
        precondition(store.restoreCachedSelection())
        await store.refresh()
        precondition(calls == 3, "Explicit refresh must fetch")
        store.handleAuthChanged()
        precondition(!store.restoreCachedSelection(), "Account changes must invalidate cache")
        precondition(store.result == nil && store.calendar == nil && store.state == .idle)

        var semesterCalls = 0
        let semesterStore = NativeScheduleStore(loader: { _ in
            semesterCalls += 1
            return NativeScheduleSnapshot(completeSemester: true, source: .jwxt, fetchedAt: .now,
                data: snapshot().data, auth: NativeScheduleAuth(authenticated: true))
        })
        await semesterStore.load()
        await semesterStore.selectWeek("12")
        await semesterStore.selectWeek("2")
        precondition(semesterCalls == 1 && semesterStore.selectedWeek == "2", "Complete semester must serve unvisited weeks locally")
        await semesterStore.refresh()
        await semesterStore.selectWeek("12")
        precondition(semesterCalls == 2, "Refresh replaces the complete semester cache")

        var adjacentCalls = 0
        let adjacentStore = NativeScheduleStore(loader: { _ in adjacentCalls += 1; return snapshot() })
        await adjacentStore.load(semester: "fall", week: "3")
        let nextWeek = NativeScheduleSnapshot(source: .jwxt, fetchedAt: .now,
            data: NativeScheduleResult(currentSemester: "fall", currentWeek: "4",
                cells: [NativeScheduleCell(day: 2, bigSlot: 1, courses: [NativeScheduleCourse(name: "下周实验")])]),
            auth: NativeScheduleAuth(authenticated: true))
        adjacentStore.receivePrefetchedSnapshot(nextWeek)
        precondition(adjacentStore.selectedWeek == "3" && adjacentStore.state == .loaded,
                     "Prewarming must not change the visible week or show a spinner")
        await adjacentStore.selectWeek("4")
        precondition(adjacentCalls == 1 && adjacentStore.state == .loaded,
                     "A prewarmed next week must be served locally without a bridge data request")
        precondition(adjacentStore.result?.cells.first?.courses.first?.name == "下周实验")
        adjacentStore.reset()
        adjacentStore.receivePrefetchedSnapshot(nextWeek)
        adjacentStore.selectedSemester = "fall"
        adjacentStore.selectedWeek = "4"
        precondition(!adjacentStore.restoreCachedSelection(), "Late weekly prefetch cannot restore logged-out data")

        let prefetchStore = NativeScheduleStore(loader: { _ in snapshot() })
        await prefetchStore.load(semester: "fall", week: "3")
        let whole = NativeScheduleSnapshot(completeSemester: true, source: .jwxt, fetchedAt: .now,
            data: snapshot().data, auth: NativeScheduleAuth(authenticated: true))
        prefetchStore.receivePrefetchedSnapshot(whole)
        precondition(prefetchStore.selectedWeek == "3", "Background completion must preserve selection")
        await prefetchStore.selectWeek("15")
        precondition(prefetchStore.restoreCachedSelection(), "Pushed semester serves unseen weeks")
        prefetchStore.reset()
        prefetchStore.receivePrefetchedSnapshot(whole)
        prefetchStore.selectedSemester = "fall"
        prefetchStore.selectedWeek = "15"
        precondition(!prefetchStore.restoreCachedSelection(), "A late prefetch must not repopulate a logged-out cache")

        var authorized = true
        let authStore = NativeScheduleStore(loader: { _ in
            authorized ? snapshot() : NativeScheduleSnapshot(auth: NativeScheduleAuth(authenticated: false))
        })
        await authStore.load()
        authorized = false
        await authStore.refresh()
        precondition(authStore.state == .unauthorized && authStore.result == nil, "Expired auth must clear sensitive records")

        var pending: CheckedContinuation<NativeScheduleSnapshot, Never>?
        let raceStore = NativeScheduleStore(loader: { request in
            if request.week == "9" {
                return await withCheckedContinuation { pending = $0 }
            }
            return snapshot()
        })
        await raceStore.load(semester: "fall", week: "8")
        let slow = Task { await raceStore.selectWeek("9") }
        while pending == nil { await Task.yield() }
        await raceStore.selectWeek("8")
        pending?.resume(returning: snapshot())
        await slow.value
        precondition(raceStore.selectedWeek == "8", "A late request must not overwrite a subsequent cache hit")

        var fail = false
        let failedStore = NativeScheduleStore(loader: { _ in
            if fail { throw NativeScheduleStoreError.server("offline") }
            return snapshot()
        })
        await failedStore.load(semester: "fall", week: "8")
        fail = true
        await failedStore.selectWeek("9")
        precondition(failedStore.state == .failed && failedStore.result == nil, "Never show another week's courses under a failed week")
        print("Native schedule checks passed: decoding, selection, cache, auth, races, failed-week isolation")
    }
}
