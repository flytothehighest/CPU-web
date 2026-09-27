import Foundation

/// SSE framing must preserve blank lines. AsyncBytes.lines omits them.
/// Decode UTF-8 only after collecting a complete line so split scalars survive.
struct AssistantEventDecoder {
    struct Event: Equatable {
        let name: String
        let data: Data
    }
    enum Failure: Error { case oversizedEvent, invalidUTF8 }
    private var line: [UInt8] = []
    private var name = "message"
    private var data: [String] = []
    private var dataSize = 0
    private var afterCR = false
    private var firstLine = true
    private let limit = 2 * 1024 * 1024

    mutating func append(_ byte: UInt8) throws -> Event? {
        if afterCR {
            afterCR = false
            if byte == 10 { return nil }
        }
        if byte == 13 || byte == 10 {
            afterCR = byte == 13
            return try consumeLine()
        }
        guard line.count + dataSize < limit else { throw Failure.oversizedEvent }
        line.append(byte)
        return nil
    }

    private mutating func consumeLine() throws -> Event? {
        guard var text = String(bytes: line, encoding: .utf8) else { throw Failure.invalidUTF8 }
        line.removeAll(keepingCapacity: true)
        if firstLine { if text.hasPrefix("\u{FEFF}") { text.removeFirst() }; firstLine = false }
        if text.isEmpty {
            defer { name = "message"; data.removeAll(keepingCapacity: true); dataSize = 0 }
            guard !data.isEmpty else { return nil }
            return Event(name: name, data: Data(data.joined(separator: "\n").utf8))
        }
        if text.hasPrefix(":") { return nil }
        let parts = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        var value = parts.count == 2 ? String(parts[1]) : ""
        if value.hasPrefix(" ") { value.removeFirst() }
        switch parts[0] {
        case "event": name = value.isEmpty ? "message" : value
        case "data": data.append(value); dataSize += value.utf8.count + 1
        default: break
        }
        return nil
    }
}
