import Foundation

@main
struct NativeSchedulePeriodChecks {
    static func main() throws {
        let snapshot = try JSONDecoder().decode(NativeScheduleSnapshot.self, from: Data(#"{"version":1,"data":{"currentSemester":"fall","cells":[]}}"#.utf8))
        let periods = snapshot.periods
        let single = NativeSchedulePeriod.normalizedRange(bigSlot: 6, startSlot: 12, endSlot: 12, periods: periods)
        precondition(single.start == 12 && single.end == 12)
        let pair = NativeSchedulePeriod.normalizedRange(bigSlot: 6, startSlot: nil, endSlot: nil, periods: periods)
        precondition(pair.start == 11 && pair.end == 12)
        let extended = NativeSchedulePeriod.normalizedRange(bigSlot: 5, startSlot: 9, endSlot: 12, periods: periods)
        precondition(extended.start == 9 && extended.end == 12)
        precondition(periods.first(where: { $0.number == 12 })?.startTime == "21:15")
        precondition(periods.first(where: { $0.number == 12 })?.endTime == "22:00")
        print("Twelfth-period legacy decoding and single/paired/extended course ranges passed")
    }
}
