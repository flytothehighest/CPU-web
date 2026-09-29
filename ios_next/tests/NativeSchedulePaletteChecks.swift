import Foundation

@main
struct NativeSchedulePaletteChecks {
    struct Fixture: Decodable {
        let name: String
        let palette: String
        let dark: Bool
        let top: String
        let bottom: String
        let border: String
        let text: String
    }
    static func parse(_ css: String) -> NativeSchedulePalette.RGBA {
        if css.hasPrefix("#") { return .init(UInt32(css.dropFirst(), radix: 16)!) }
        let values = css.replacingOccurrences(of: "hsla?\\(|[%) ]", with: "", options: .regularExpression)
            .split(separator: ",").map { Double($0)! }
        return NativeSchedulePalette.hsl(values[0], values[1], values[2], values.count > 3 ? values[3] : 1)
    }
    static func main() throws {
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        for fixture in fixtures {
            let actual = NativeSchedulePalette.tone(name: fixture.name, palette: fixture.palette, dark: fixture.dark)
            for (got, expected) in [(actual.top, fixture.top), (actual.bottom, fixture.bottom),
                                    (actual.border, fixture.border), (actual.text, fixture.text)] {
                precondition(got == parse(expected), "Web parity failed: \(fixture.name) / \(fixture.palette) / dark=\(fixture.dark)")
            }
        }
        precondition(NativeSchedulePalette.hsl(0, 100, 50) == .init(0xff0000))
        precondition(NativeSchedulePalette.hsl(120, 100, 50) == .init(0x00ff00))
        precondition(NativeSchedulePalette.hsl(240, 100, 50) == .init(0x0000ff))
        print("\(fixtures.count) Web/Android–iOS palette comparisons passed (including UTF-16, overflow, whitespace, light/dark and all single-color themes)")
    }
}
