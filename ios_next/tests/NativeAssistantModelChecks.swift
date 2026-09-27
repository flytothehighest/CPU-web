import Foundation
import Combine

@MainActor final class HybridWebViewStore {
    struct Auth { var account = "fixture-a"; var authenticated = true; var ready = true }
    var authState = Auth()
    var isLoggedIn = true
    var fail = false
    var delta = ""
    var historyDelay: UInt64 = 0
    var cloud: [NativeAssistantConversation] = []
    var saves = 0
    var deletes = 0
    var cancelCount = 0
    func refreshAuthCapability() async -> Auth? { authState }
    func nativeAssistantStream(message: String, history: [[String: String]], onDelta: @escaping (String) -> Void, onStatus: @escaping (String) -> Void) async throws -> NativeAssistantReply {
        precondition(history.allSatisfy { !($0["content"] ?? "").isEmpty })
        if !delta.isEmpty { onDelta(delta) }
        try await Task.sleep(nanoseconds: 50_000_000)
        if fail { throw NativeAssistantError.requestFailed("fixture failure") }
        return NativeAssistantReply(answer: "complete", actions: [], suggestions: [], fallback: false)
    }
    func cancelNativeAssistantStreams() { cancelCount += 1 }
    func listNativeAssistantConversations() async throws -> [NativeAssistantConversation] {
        let result = cloud
        try await Task.sleep(nanoseconds: historyDelay)
        return result
    }
    func saveNativeAssistantConversation(_ conversation: NativeAssistantConversation) async throws -> NativeAssistantConversation { saves += 1; return conversation }
    func deleteNativeAssistantConversation(id: String) async throws { deletes += 1 }
}

@main struct ModelChecks {
    @MainActor static func main() async throws {
        let session = HybridWebViewStore()
        session.authState.account = "fixture-" + UUID().uuidString
        let firstAccount = session.authState.account
        let model = NativeAssistantModel()
        defer {
            for account in [firstAccount, session.authState.account] {
                UserDefaults.standard.removeObject(forKey: "native-assistant-history:v1:" + account)
                UserDefaults.standard.removeObject(forKey: "native-assistant-history:v1:" + account + ":deletions")
            }
        }
        await model.loadHistory(using: session)
        model.send("hello", using: session)
        try await Task.sleep(nanoseconds: 100_000_000)
        precondition(model.messages.last?.content == "complete" && !model.isLoading)
        precondition(session.saves > 0)
        model.startNewConversation(using: session)
        model.send("stop before delta", using: session)
        model.stop(using: session)
        precondition(!model.messages.contains(where: \.streaming))
        model.send("after stop", using: session)
        try await Task.sleep(nanoseconds: 100_000_000)
        precondition(model.messages.last?.content == "complete")
        model.startNewConversation(using: session)
        session.delta = "partial"
        session.fail = true
        model.send("retry question", using: session)
        try await Task.sleep(nanoseconds: 100_000_000)
        precondition(model.messages.last?.content == "partial" && !model.isLoading)
        precondition(model.retryText == "retry question")
        session.fail = false
        model.retry(using: session)
        try await Task.sleep(nanoseconds: 100_000_000)
        precondition(model.messages.filter { $0.role == .user }.count == 1)
        precondition(model.messages.last?.content == "complete")
        session.cloud = model.conversations
        session.historyDelay = 100_000_000
        let load = Task { await model.loadHistory(using: session) }
        await Task.yield()
        model.startNewConversation(using: session)
        model.send("during history load", using: session)
        await load.value
        precondition(model.messages.first?.content == "during history load")
        model.input = "private draft"
        session.authState.account = "fixture-" + UUID().uuidString
        session.cloud = []
        model.accountDidChange(using: session)
        precondition(model.messages.isEmpty && model.input.isEmpty && model.errorMessage.isEmpty)
        try await Task.sleep(nanoseconds: 150_000_000)
        precondition(model.conversations.isEmpty)
        model.send(String(repeating: "a", count: 501), using: session)
        precondition(model.messages.isEmpty && !model.errorMessage.isEmpty)
        print("PASS model: send, empty stop, immediate resend, partial failure, retry, history race, account isolation, message limit")
    }
}
