import SwiftUI

struct NativeWidgetSetupView: View {
    @ObservedObject var session: HybridWebViewStore
    @State private var installing = false
    @State private var message: String?
    @State private var theme = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?.string(forKey: NextWidgetConfiguration.widgetThemeKey) ?? "color-glass"
    @Environment(\.dismiss) private var dismiss

    private let themes = [("color-glass", "彩色玻璃"), ("green", "绿"), ("blue", "蓝"), ("teal", "青"), ("indigo", "靛蓝"), ("violet", "紫"), ("orange", "橙"), ("rose", "玫瑰"), ("slate", "灰")]

    var body: some View {
        NavigationStack {
            Form {
                Section("课表小组件") {
                    Text("临近课程：小号、中号和锁屏样式\n今日课表：中号、大号\n两日课表：大号")
                    Picker("主题", selection: $theme) {
                        ForEach(themes, id: \.0) { value in Text(value.1).tag(value.0) }
                    }
                    .onChange(of: theme) { _, value in session.widgetSettings.setScheduleWidgetTheme(value) }
                    Button(installing ? "正在配置…" : "配置课表小组件") {
                        installing = true
                        Task { @MainActor in
                            do {
                                try await session.configureScheduleWidget(theme: theme)
                                message = session.widgetSettings.status
                            } catch { message = error.localizedDescription }
                            installing = false
                        }
                    }
                    .disabled(installing || !session.bridgeReady)
                    if let message { Text(message).font(.footnote) }
                    else if let status = session.widgetSettings.status { Text(status).font(.footnote) }
                }
                Section {
                    Text("先登录并完成教务授权，再点击配置。保存后长按主屏幕添加小组件，搜索“药大拾间课表”；锁屏样式可在锁屏自定界面添加。课程会定期刷新，点击小组件可打开原生课表。")
                }
            }
            .navigationTitle("小组件")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}
