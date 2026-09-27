import Foundation

@main struct AssistantEventDecoderChecks {
    static func decode(_ text: String) throws -> [AssistantEventDecoder.Event] {
        var parser = AssistantEventDecoder()
        return try text.utf8.compactMap { try parser.append($0) }
    }
    static func main() async throws {
        let frames = "event: status\ndata: {\"status\":\"connected\"}\n\nevent: delta\ndata: {\"delta\":\"药大🌱\"}\n\nevent: done\ndata: {\"answer\":\"药大🌱\"}\n\n"
        for separator in ["\n", "\r\n", "\r"] {
            let events = try decode(frames.replacingOccurrences(of: "\n", with: separator))
            precondition(events.map(\.name) == ["status", "delta", "done"])
            let delta = try JSONSerialization.jsonObject(with: events[1].data) as! [String: String]
            precondition(delta["delta"] == "药大🌱")
        }
        let events = try decode("\u{FEFF}: keepalive\n\nevent: delta\ndata: first\ndata:  second\n\nid: 42\ndata: next\n\n")
        precondition(events.map(\.name) == ["delta", "message"])
        precondition(String(data: events[0].data, encoding: .utf8) == "first\n second")
        let truncated = try decode("event: done\ndata: {}")
        precondition(truncated.isEmpty, "EOF must not turn an incomplete event into success")
        var parser = AssistantEventDecoder()
        do {
            for _ in 0...2_097_152 { _ = try parser.append(65) }
            fatalError("unbounded event accepted")
        } catch AssistantEventDecoder.Failure.oversizedEvent {}
        print("PASS SSE: LF/CRLF/CR, split UTF-8, BOM, comments, multiline data, event reset, truncation, size bound")
    }
}
