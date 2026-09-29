import SwiftUI
import UIKit
import Combine

@MainActor
@available(iOS 17.0, *)
final class NativeAssistantModel: ObservableObject {
    @Published var input = ""
    @Published var messages: [NativeAssistantMessage] = []
    @Published var isLoading = false
    @Published var errorMessage = ""
    @Published private(set) var conversations: [NativeAssistantConversation] = []
    @Published private(set) var historyLoaded = false
    @Published private(set) var historyLoading = false
    @Published private(set) var historyError = ""
    @Published private(set) var retryText = ""
    private var historyGeneration = 0
    private var syncTask: Task<Void, Never>?
    private var pendingDeletes: Set<String> = []

    private(set) var activeConversationID = ""
    private var requestGeneration = 0
    private var messageSequence = 0
    private var streamTask: Task<Void, Never>?
    private var accountChangeTask: Task<Void, Never>?
    /// WebKit reports a few empty account states while restoring its cookie
    /// session. Keep the last confirmed identity so those bootstrap events do
    /// not cancel an otherwise healthy streaming answer.
    private var confirmedAccount = ""

    deinit {
        streamTask?.cancel()
        accountChangeTask?.cancel()
    }

    func send(_ value: String, using session: HybridWebViewStore) {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isLoading else { return }

        guard text.utf16.count <= 500 else {
            errorMessage = "每条消息最多 500 字，请缩短后发送。"
            return
        }
        retryText = ""
        input = ""
        historyGeneration += 1
        let history = messages.filter { !$0.streaming && !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.suffix(60).map {
            [
                "role": $0.role.rawValue,
                "content": String($0.content.prefix(4000)),
            ]
        }
        ensureConversation(title: text)
        messages.append(NativeAssistantMessage(id: nextMessageID(), role: .user, content: text))
        persistActiveConversation(using: session, syncCloud: false)

        let assistantID = nextMessageID()
        messages.append(NativeAssistantMessage(id: assistantID, role: .assistant, content: "", streaming: true))
        isLoading = true
        errorMessage = ""
        requestGeneration += 1
        let generation = requestGeneration

        // Keep the shared Web session alive while the sheet is dismissed. The
        // model itself lives on HybridWebViewStore, so leaving the AI surface
        // must not cancel or orphan this task.
        // Retain the model for the lifetime of the request. The assistant
        // surface is a dismissible sheet, so its view can disappear while the
        // shared Web session continues delivering the answer.
        streamTask = Task { @MainActor [self, session] in
            do {
                let reply = try await session.nativeAssistantStream(
                    message: text,
                    history: history,
                    onDelta: { [weak self] delta in
                            guard let self, generation == self.requestGeneration,
                                  let index = self.messages.firstIndex(where: { $0.id == assistantID }) else { return }
                            self.messages[index].content += delta
                            self.messages[index].streaming = true
                            self.messages[index].streamStatus = "正在生成回答…"
                    },
                    onStatus: { [weak self] status in
                            guard let self, generation == self.requestGeneration,
                                  let index = self.messages.firstIndex(where: { $0.id == assistantID }) else { return }
                            self.messages[index].streamStatus = status
                    }
                )
                guard generation == self.requestGeneration,
                      let index = self.messages.firstIndex(where: { $0.id == assistantID }) else { return }
                self.messages[index].content = reply.answer
                self.messages[index].actions = reply.actions
                self.messages[index].suggestions = reply.suggestions
                self.messages[index].images = reply.images
                self.messages[index].sources = reply.sources
                self.messages[index].streaming = false
                self.messages[index].streamStatus = ""
                self.persistActiveConversation(using: session, syncCloud: true)
            } catch is CancellationError {
                guard generation == self.requestGeneration else { return }
                if let index = self.messages.firstIndex(where: { $0.id == assistantID }),
                   !self.messages[index].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self.messages[index].streaming = false
                    self.messages[index].streamStatus = "回答已中断，可重新提问"
                } else {
                    self.messages.removeAll { $0.id == assistantID }
                }
                self.persistActiveConversation(using: session, syncCloud: false)
            } catch {
                guard generation == self.requestGeneration else { return }
                if let index = self.messages.firstIndex(where: { $0.id == assistantID }),
                   !self.messages[index].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self.messages[index].streaming = false
                    self.messages[index].streamStatus = "回答未完成，可重新提问"
                } else {
                    self.messages.removeAll { $0.id == assistantID }
                }
                self.persistActiveConversation(using: session, syncCloud: false)
                self.retryText = text
                self.errorMessage = (error as? LocalizedError)?.errorDescription ?? "网络连接中断，请检查网络后重试。"
            }
            if generation == self.requestGeneration {
                self.isLoading = false
                self.streamTask = nil
            }
        }
    }

    func retry(using session: HybridWebViewStore) {
        guard !retryText.isEmpty, !isLoading else { return }
        let text = retryText
        if let index = messages.lastIndex(where: { $0.role == .user && $0.content == text }) {
            messages.removeSubrange(index...)
        }
        send(text, using: session)
    }

    func startNewConversation(using session: HybridWebViewStore) {
        cancelStream(using: session)
        historyGeneration += 1
        retryText = ""
        messages.removeAll()
        input = ""
        errorMessage = ""
        activeConversationID = ""
    }

    /// Cancellation is an explicit user action. Dismissing the native sheet
    /// must leave the shared stream alive so it can finish in the background.
    func stop(using session: HybridWebViewStore) {
        cancelStream(using: session)
        if let index = messages.lastIndex(where: { $0.role == .assistant }) {
            if messages[index].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                messages.remove(at: index)
            } else {
                messages[index].streaming = false
                messages[index].streamStatus = "已停止生成，可重新提问"
            }
        }
        persistActiveConversation(using: session, syncCloud: true)
    }

    func openConversation(_ conversation: NativeAssistantConversation, using session: HybridWebViewStore) {
        cancelStream(using: session)
        historyGeneration += 1
        retryText = ""
        activeConversationID = conversation.id
        messages = conversation.messages.map(NativeAssistantMessage.init)
        messageSequence = messages.map(\.id).max() ?? 0
        input = ""
        errorMessage = ""
    }

    func deleteConversation(_ conversation: NativeAssistantConversation, using session: HybridWebViewStore) {
        historyGeneration += 1
        pendingDeletes.insert(conversation.id)
        conversations.removeAll { $0.id == conversation.id }
        saveLocalHistory(using: session)
        if activeConversationID == conversation.id { startNewConversation(using: session) }
        syncHistory(using: session)
    }

    func accountDidChange(using session: HybridWebViewStore) {
        accountChangeTask?.cancel()
        if session.authState.ready, !session.authState.account.isEmpty,
           session.authState.account != confirmedAccount {
            applyConfirmedAccountChange(using: session)
            return
        }
        // WKWebView can publish a transient empty or unauthenticated report
        // while restoring cookies after a route change. Confirm the state after
        // a short quiet period before clearing a conversation or its stream.
        accountChangeTask = Task { @MainActor [weak self, weak session] in
            // Logout/account probes can briefly publish an empty state while
            // WebKit restores cookies after a sheet or route transition. Give
            // an active answer a longer quiet window before treating that as
            // a real account change.
            let delay: UInt64 = self?.streamTask == nil ? 450_000_000 : 1_200_000_000
            try? await Task.sleep(nanoseconds: delay)
            guard let self, let session, !Task.isCancelled else { return }
            // Re-read the Web session after the quiet period. WebKit can emit
            // an empty auth report while the native sheet changes routes; only
            // a confirmed probe may turn that transient value into a logout.
            _ = await session.refreshAuthCapability()
            guard !Task.isCancelled else { return }
            self.applyConfirmedAccountChange(using: session)
        }
    }

    private func applyConfirmedAccountChange(using session: HybridWebViewStore) {
        guard session.authState.ready else { return }
        let nextAccount = session.authState.account.trimmingCharacters(in: .whitespacesAndNewlines)
        if nextAccount.isEmpty, session.authState.authenticated { return }
        guard nextAccount != confirmedAccount else { return }
        let hadConfirmedAccount = !confirmedAccount.isEmpty
        confirmedAccount = nextAccount
        // The first non-empty report after launch only establishes the account
        // used for local history. A real switch or a confirmed logout clears a
        // live stream and all account-scoped messages.
        guard hadConfirmedAccount || nextAccount.isEmpty else {
            historyLoaded = false
            Task { @MainActor [weak self, weak session] in
                guard let self, let session else { return }
                await self.loadHistory(using: session)
            }
            return
        }
        cancelStream(using: session)
        historyGeneration += 1
        syncTask?.cancel()
        syncTask = nil
        input = ""
        errorMessage = ""
        retryText = ""
        historyError = ""
        pendingDeletes.removeAll()
        messages.removeAll()
        conversations.removeAll()
        activeConversationID = ""
        messageSequence = 0
        historyLoaded = false
        Task { @MainActor [weak self, weak session] in
            guard let self, let session else { return }
            await self.loadHistory(using: session)
        }
    }

    func loadHistory(using session: HybridWebViewStore) async {
        guard !historyLoading, session.authState.ready, session.isLoggedIn,
              !session.authState.account.isEmpty else { return }
        let account = session.authState.account
        confirmedAccount = account
        if !historyLoaded {
            pendingDeletes = Set(UserDefaults.standard.stringArray(forKey: historyStorageKey(using: session) + ":deletions") ?? [])
            conversations = loadLocalHistory(using: session).filter { !pendingDeletes.contains($0.id) }
            historyLoaded = true
        }
        // Loading history must never replace a live answer or a newly opened draft.
        let generation = historyGeneration
        historyLoading = true
        defer {
            historyLoading = false
            if session.authState.account != account {
                Task { await self.loadHistory(using: session) }
            }
        }
        do {
            let cloud = try await session.listNativeAssistantConversations()
            guard session.authState.account == account, confirmedAccount == account,
                  generation == historyGeneration else { return }
            conversations = mergeConversations(local: conversations, cloud: cloud)
                .filter { !pendingDeletes.contains($0.id) }
            saveLocalHistory(using: session)
            if generation == historyGeneration, !isLoading, !activeConversationID.isEmpty,
               let active = conversations.first(where: { $0.id == activeConversationID }) {
                messages = active.messages.map(NativeAssistantMessage.init)
                messageSequence = messages.map(\.id).max() ?? 0
            }
            historyError = ""
            syncHistory(using: session)
        } catch {
            guard session.authState.account == account else { return }
            historyError = "历史同步失败，已保留本机记录。请重试。"
        }
    }

    private func syncHistory(using session: HybridWebViewStore) {
        guard session.isLoggedIn, !confirmedAccount.isEmpty else { return }
        let account = confirmedAccount
        let previous = syncTask
        let deletions = pendingDeletes
        let records = conversations
        syncTask = Task { @MainActor [weak self, weak session] in
            await previous?.value
            guard let self, let session, !Task.isCancelled,
                  session.authState.account == account, self.confirmedAccount == account else { return }
            do {
                for id in deletions {
                    try Task.checkCancellation()
                    guard session.authState.account == account else { return }
                    try await session.deleteNativeAssistantConversation(id: id)
                    guard session.authState.account == account else { return }
                    self.pendingDeletes.remove(id)
                    self.saveLocalHistory(using: session)
                }
                for record in records where !record.messages.isEmpty {
                    try Task.checkCancellation()
                    guard session.authState.account == account else { return }
                    if self.pendingDeletes.contains(record.id) { continue }
                    _ = try await session.saveNativeAssistantConversation(record)
                }
                if session.authState.account == account { self.historyError = "" }
            } catch {
                if !Task.isCancelled, session.authState.account == account {
                    self.historyError = "历史同步失败，已保留本机记录。请重试。"
                }
            }
        }
    }

    private func cancelStream(using session: HybridWebViewStore) {
        requestGeneration += 1
        isLoading = false
        streamTask?.cancel()
        streamTask = nil
        session.cancelNativeAssistantStreams()
    }

    private func ensureConversation(title: String) {
        guard !conversations.contains(where: { $0.id == activeConversationID }) else { return }
        let conversation = NativeAssistantConversation(
            id: UUID().uuidString.lowercased(),
            title: String(title.prefix(80)),
            messages: []
        )
        activeConversationID = conversation.id
        conversations.insert(conversation, at: 0)
    }

    private func nextMessageID() -> Int {
        messageSequence += 1
        return messageSequence
    }

    private func persistActiveConversation(using session: HybridWebViewStore, syncCloud: Bool) {
        guard let index = conversations.firstIndex(where: { $0.id == activeConversationID }) else { return }
        let stored = messages
            .filter { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !$0.streaming }
            .suffix(60)
            .map(\.stored)
        guard !stored.isEmpty else { return }
        conversations[index].messages = Array(stored)
        conversations[index].updatedAt = Int(Date().timeIntervalSince1970 * 1000)
        if let firstUser = stored.first(where: { $0.role == .user }) {
            conversations[index].title = String(firstUser.content.prefix(80))
        }
        conversations.sort { $0.updatedAt > $1.updatedAt }
        saveLocalHistory(using: session)
        if syncCloud { syncHistory(using: session) }
    }

    private func historyStorageKey(using session: HybridWebViewStore) -> String {
        let account = confirmedAccount
        return "native-assistant-history:v1:\(account.isEmpty ? "default" : account)"
    }

    private func loadLocalHistory(using session: HybridWebViewStore) -> [NativeAssistantConversation] {
        guard let data = UserDefaults.standard.data(forKey: historyStorageKey(using: session)),
              let decoded = try? JSONDecoder().decode([NativeAssistantConversation].self, from: data) else { return [] }
        return decoded.filter { !$0.messages.isEmpty }.sorted { $0.updatedAt > $1.updatedAt }.prefix(20).map { $0 }
    }

    private func saveLocalHistory(using session: HybridWebViewStore) {
        guard !confirmedAccount.isEmpty, let data = try? JSONEncoder().encode(conversations) else { return }
        UserDefaults.standard.set(Array(pendingDeletes), forKey: historyStorageKey(using: session) + ":deletions")
        UserDefaults.standard.set(data, forKey: historyStorageKey(using: session))
    }

    private func mergeConversations(local: [NativeAssistantConversation], cloud: [NativeAssistantConversation]) -> [NativeAssistantConversation] {
        var merged: [String: NativeAssistantConversation] = [:]
        let deletedIDs = Set(cloud.filter { $0.deletedAt != nil }.map(\.id))
        for conversation in local + cloud where conversation.deletedAt == nil && !deletedIDs.contains(conversation.id) && !conversation.messages.isEmpty {
            if let current = merged[conversation.id], current.updatedAt >= conversation.updatedAt { continue }
            merged[conversation.id] = conversation
        }
        return merged.values.sorted { $0.updatedAt > $1.updatedAt }.prefix(20).map { $0 }
    }
}

/// Native conversation surface for the iOS shell. The Web session remains the
/// transport owner, while SwiftUI owns the keyboard, composer and scroll
/// geometry so the page above never gets pushed out of view.
@available(iOS 17.0, *)
struct NativeAssistantView: View {
    @ObservedObject var session: HybridWebViewStore
    @ObservedObject private var assistant: NativeAssistantModel
    let onOpen: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var composerFocused = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var followsLatest = true
    @State private var historyPresented = false

    private let suggestions = ["宿舍电费在哪里查？", "怎么打开药苑之声？", "AI 额度怎么计算？"]

    init(session: HybridWebViewStore, onOpen: @escaping (String) -> Void) {
        self.session = session
        self.onOpen = onOpen
        _assistant = ObservedObject(wrappedValue: session.assistantModel)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if assistant.messages.isEmpty {
                    welcome
                } else {
                    conversation
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composer
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("拾间 AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button {
                        composerFocused = false
                    historyPresented = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                    .accessibilityLabel("历史对话")
                    Button {
                        assistant.startNewConversation(using: session)
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(assistant.messages.isEmpty && assistant.input.isEmpty)
                    .accessibilityLabel("新建对话")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .tint(.cpuBrand)
            .sheet(isPresented: $historyPresented) {
                historySheet
                    .preferredColorScheme(session.pageColorScheme)
            }
        }
        .preferredColorScheme(session.pageColorScheme)
        .task {
            await assistant.loadHistory(using: session)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await assistant.loadHistory(using: session) } }
        }
    }

    private var welcome: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 25, weight: .semibold))
                    .foregroundStyle(Color.cpuBrand)
                    .frame(width: 48, height: 48)
                    .background(Color.cpuBrand.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                Text("想做什么？直接告诉我。")
                    .font(.title3.weight(.bold))
                Text("可以询问站内功能、校园服务和操作步骤，也可以直接聊天。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("拾间 AI 不会读取你的课表、成绩或其他个人数据；涉及本人数据时会引导你进入对应页面自行查看。")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 3)
                VStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button { assistant.send(suggestion, using: session) } label: {
                            Text(suggestion)
                                .font(.caption.weight(.medium))
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 11)
                                .padding(.vertical, 10)
                                .background(Color(uiColor: .secondarySystemGroupedBackground))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(Color(uiColor: .separator).opacity(0.55), lineWidth: 1)
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.primary)
                    }
                }
                .padding(.top, 6)
            }
            .frame(maxWidth: 620, alignment: .topLeading)
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var historySheet: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if assistant.historyLoading { ProgressView("正在同步历史…").padding() }
                if !assistant.historyError.isEmpty {
                    Text(assistant.historyError).font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                    Button("重试同步") { Task { await assistant.loadHistory(using: session) } }.padding(.bottom, 8)
                }
                if assistant.conversations.isEmpty {
                    ContentUnavailableView(
                        "暂无历史对话",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("发送第一条消息后，对话会自动保存在这里。")
                    )
                } else {
                    List {
                        ForEach(assistant.conversations) { conversation in
                            Button {
                                assistant.openConversation(conversation, using: session)
                                historyPresented = false
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(conversation.title)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    Text(conversationPreview(conversation))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                    Text(formatHistoryDate(conversation.updatedAt))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    assistant.deleteConversation(conversation, using: session)
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .task { await assistant.loadHistory(using: session) }
            .navigationTitle("历史对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("新建") { assistant.startNewConversation(using: session); historyPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { historyPresented = false }
                }
            }
        }
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(assistant.messages) { message in
                        messageView(message)
                            .id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                        .onAppear { followsLatest = true }

                }
                .frame(maxWidth: 700, alignment: .leading)
                .padding(.horizontal, 18)
                .padding(.vertical, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .simultaneousGesture(DragGesture().onChanged { _ in followsLatest = false })
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: assistant.isLoading) { _, loading in
                if !loading, followsLatest { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: assistant.messages.count) { _, _ in
                followsLatest = true
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .onChange(of: assistant.messages.last?.content) { _, _ in
                guard assistant.isLoading, followsLatest else { return }
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .onChange(of: composerFocused) { _, focused in
                if focused { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .overlay(alignment: .bottomTrailing) {
                if !followsLatest {
                    Button { followsLatest = true; proxy.scrollTo("bottom", anchor: .bottom) } label: {
                        Image(systemName: "arrow.down").padding(12).background(.regularMaterial, in: Circle())
                    }.accessibilityLabel("滚动到最新消息").padding()
                }
            }
        }
    }

    @ViewBuilder
    private func messageView(_ message: NativeAssistantMessage) -> some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 7) {
            if message.role == .user {
                Text(message.content)
                    .font(.body)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(Color.cpuBrand)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                HStack(spacing: 5) {
                    Image(systemName: "sparkles").foregroundStyle(Color.cpuBrand)
                    Text("拾间 AI").foregroundStyle(.secondary)
                }.font(.caption.weight(.medium))
                HStack(alignment: .bottom, spacing: 2) {
                    Text(message.streaming ? AttributedString(message.content) : markdown(message.content))
                        .font(.body)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: 620, alignment: .leading)
                        .textSelection(.enabled)
                }
                if message.streaming || !message.streamStatus.isEmpty {
                    HStack(spacing: 6) {
                        if message.streaming { ProgressView().controlSize(.mini).tint(.cpuBrand) }
                        Text(message.streamStatus.isEmpty ? "正在生成回答…" : message.streamStatus)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if !message.actions.isEmpty {
                    VStack(spacing: 8) {
                        ForEach(message.actions) { action in
                            Button { open(action.url) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "arrow.up.right.square")
                                        .foregroundStyle(Color.cpuBrand)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(action.label).font(.subheadline.weight(.semibold))
                                        Text(action.description)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                    Spacer(minLength: 4)
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(maxWidth: 620, alignment: .leading)
                                .padding(11)
                                .background(Color(uiColor: .secondarySystemGroupedBackground))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(Color(uiColor: .separator).opacity(0.5), lineWidth: 1)
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 2)
                }
                if !message.images.isEmpty {
                    ForEach(message.images) { image in
                        AsyncImage(url: resourceURL(image.url)) { state in
                            switch state {
                            case .success(let content):
                                content
                                    .resizable()
                                    .scaledToFit()
                            case .failure:
                                Label("图片暂时无法加载", systemImage: "photo.badge.exclamationmark")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, minHeight: 84)
                            default:
                                ProgressView()
                                    .frame(maxWidth: .infinity, minHeight: 84)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityLabel(image.alt)
                    }
                }
                if !message.sources.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(message.sources) { source in
                                Button {
                                    open(source.url)
                                } label: {
                                    Label(source.title, systemImage: "link")
                                        .font(.caption)
                                        .lineLimit(1)
                                        .padding(.horizontal, 9)
                                        .padding(.vertical, 7)
                                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(Color.cpuBrand)
                            }
                        }
                    }
                }
                if !message.suggestions.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(message.suggestions, id: \.self) { suggestion in
                                Button(suggestion) { assistant.send(suggestion, using: session) }
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                                    .background(Color.cpuBrand.opacity(0.1))
                                    .clipShape(Capsule())
                                    .buttonStyle(.plain)
                                    .foregroundStyle(Color.cpuBrand)
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if !assistant.errorMessage.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(.orange)
                    Text(assistant.errorMessage).font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    if !assistant.retryText.isEmpty {
                        Button("重试") { assistant.retry(using: session) }.font(.subheadline.weight(.semibold))
                    }
                    Button { assistant.errorMessage = "" } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("关闭错误提示")
                }
                .padding(.horizontal, 4)
            }
            HStack(alignment: .bottom, spacing: 8) {
                ZStack(alignment: .topLeading) {
                    NativeAssistantTextEditor(text: $assistant.input, isFocused: $composerFocused,
                        onSubmit: { assistant.send(assistant.input, using: session) })
                    if assistant.input.isEmpty {
                        Text("给拾间 AI 发消息").font(.body).foregroundStyle(.tertiary)
                            .padding(.leading, 12).padding(.top, 10).allowsHitTesting(false)
                    }
                }
                .background(Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 18))
                .overlay { RoundedRectangle(cornerRadius: 18).stroke(composerFocused ? Color.cpuBrand : Color(uiColor: .separator).opacity(0.4), lineWidth: 1) }
                Button {
                    if assistant.isLoading { assistant.stop(using: session) }
                    else { assistant.send(assistant.input, using: session) }
                } label: {
                    Image(systemName: assistant.isLoading ? "stop.fill" : "arrow.up")
                        .font(.system(size: 17, weight: .semibold)).frame(width: 44, height: 44)
                        .foregroundStyle(.white).background(Color.cpuBrand, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(!assistant.isLoading && assistant.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(!assistant.isLoading && assistant.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
                .accessibilityLabel(assistant.isLoading ? "停止生成" : "发送")
            }
            if composerFocused {
                HStack {
                    Text("\(assistant.input.utf16.count)/500").font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Button { composerFocused = false } label: { Image(systemName: "keyboard.chevron.compact.down") }
                        .accessibilityLabel("收起键盘")
                }
            }
        }
        .frame(maxWidth: 700)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private var errorAlertBinding: Binding<Bool> {
        Binding(
            get: { !assistant.errorMessage.isEmpty },
            set: { if !$0 { assistant.errorMessage = "" } }
        )
    }

    private func conversationPreview(_ conversation: NativeAssistantConversation) -> String {
        conversation.messages.last(where: { !$0.content.isEmpty })?.content ?? "空对话"
    }

    private func formatHistoryDate(_ value: Int) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(value) / 1000)
        if Calendar.current.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month().day())
    }

    private func markdown(_ value: String) -> AttributedString {
        (try? AttributedString(markdown: value, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(value)
    }

    private func resourceURL(_ value: String) -> URL? {
        guard let url = URL(string: value) else { return nil }
        if url.scheme != nil { return url }
        return URL(string: value, relativeTo: IOSNextWebConfiguration.appURL)?.absoluteURL
    }

    private func open(_ value: String) {
        let url = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        if url.hasPrefix("/") {
            onOpen(url)
        } else if let external = URL(string: url) {
            UIApplication.shared.open(external)
        }
    }
}

/// Size from SwiftUI's proposed width, without publishing measurements back
/// into layout. This avoids a UIKit/SwiftUI layout feedback loop while typing.
@available(iOS 17.0, *)
private struct NativeAssistantTextEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let onSubmit: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = .label
        view.tintColor = UIColor(Color.cpuBrand)
        view.textContainerInset = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        view.textContainer.lineFragmentPadding = 0
        view.textContainer.lineBreakMode = .byCharWrapping
        view.isScrollEnabled = true
        view.returnKeyType = .send
        view.keyboardDismissMode = .interactive
        view.accessibilityLabel = "给拾间 AI 发消息"
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text { view.text = text }
        view.font = UIFont.preferredFont(forTextStyle: .body)
        if isFocused, !view.isFirstResponder { view.becomeFirstResponder() }
        else if !isFocused, view.isFirstResponder { view.resignFirstResponder() }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let line = uiView.font?.lineHeight ?? 22
        let height = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        return CGSize(width: width, height: min(max(height, line + 20), min(180, line * 5 + 20)))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: NativeAssistantTextEditor
        init(parent: NativeAssistantTextEditor) { self.parent = parent }
        func textViewDidChange(_ view: UITextView) { parent.text = view.text }
        func textViewDidBeginEditing(_ view: UITextView) { parent.isFocused = true }
        func textViewDidEndEditing(_ view: UITextView) { parent.isFocused = false }
        func textView(_ view: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            if text == "\n", view.markedTextRange == nil { parent.onSubmit(); return false }
            return true
        }
    }
}

struct NativeAssistantMessage: Identifiable {
    enum Role: String { case user, assistant }

    let id: Int
    let role: Role
    var content: String
    var actions: [NativeAssistantAction] = []
    var suggestions: [String] = []
    var images: [NativeAssistantGeneratedImage] = []
    var sources: [NativeAssistantSource] = []
    var streaming = false
    var streamStatus = ""

    nonisolated init(
        id: Int,
        role: Role,
        content: String,
        actions: [NativeAssistantAction] = [],
        suggestions: [String] = [],
        images: [NativeAssistantGeneratedImage] = [],
        sources: [NativeAssistantSource] = [],
        streaming: Bool = false,
        streamStatus: String = ""
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.actions = actions
        self.suggestions = suggestions
        self.images = images
        self.sources = sources
        self.streaming = streaming
        self.streamStatus = streamStatus
    }

    nonisolated init(_ stored: NativeAssistantStoredMessage) {
        self.init(
            id: stored.id,
            role: Role(rawValue: stored.role.rawValue) ?? .assistant,
            content: stored.content,
            actions: stored.actions,
            suggestions: stored.suggestions,
            images: stored.images,
            sources: stored.sources
        )
    }

    var stored: NativeAssistantStoredMessage {
        NativeAssistantStoredMessage(
            id: id,
            role: NativeAssistantStoredMessage.Role(rawValue: role.rawValue) ?? .assistant,
            content: String(content.prefix(4000)),
            actions: actions,
            suggestions: suggestions,
            images: images,
            sources: sources
        )
    }
}
