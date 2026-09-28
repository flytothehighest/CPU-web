# 药大拾间 Android 客户端

与新版 iOS（`ios_next`）和 HarmonyOS 客户端结构一致的原生外壳：Jetpack Compose 负责底部五栏、原生顶栏、登录与课表等高频交互；首页、教务、服务、我的及其子页面继续用同一个 WebView 加载现有站点。包名 `cn.lizmt.cpuweb`，版本 `4.0.3 (42)`，最低 Android 6.0（API 23）。

## 原生能力

- **外壳**：Compose 底部导航（首页、教务、课表、服务、我的），默认进入原生课表。Web 栏目使用原生顶栏：根页面显示 Logo 与标题，子页面显示返回键与网页路由标题；右侧为刷新、消息（未读角标）或登录、快捷入口面板（发帖、消息、管理后台、客户端下载、论坛、公告、教务、课表、服务、二手、拾间 AI 与外观切换）。帖子详情等自带导航的页面隐藏原生顶栏和底栏；键盘弹出时隐藏底栏；首页提供原生“投稿”按钮。
- **共享 WebView**：所有 Web 栏目共用一个 WebView，保留 Cookie、DOM 存储、站内路由；网页顶栏和底栏由注入样式隐藏，但仍保留在 DOM 中供抽屉与账号操作复用。系统返回键依次关闭网页弹层、按网页路由返回上级，根页面回到课表后再退出。旋转、深浅色、字体大小变化不重建 Activity，WebView 会话不会丢失。
- **登录门禁**：未登录时显示原生登录页（统一认证、验证码、保持登录；长按图标解锁站内账号登录；须同意隐私政策与用户协议）。登录仍由网页的 Pinia 登录流程完成，HttpOnly 会话 Cookie 留在 WebView 中，原生不保存学校密码。判定与 iOS 相同：以网页登录状态为准，空账号报告先二次核验，Cookie 仅换取有限的恢复窗口，教务授权失效不会触发站点登录门禁。
- **原生课表**：两排工具栏（学期、周/日视图、回到本周今日、更多），周次切换与校历日期，周视图左右滑动切周、日视图左右滑动切换日期，11 节时间轴（优先使用校历下发的节次时间），连续节次合并，同一时段课程逐个查看，下拉刷新。已显示的课表不会被状态页替换：教务授权失效、刷新失败都以顶部横幅提示。
- **缓存**：内存缓存 12 小时、最多 4 个学期；整学期规则只缓存一次，旧服务端的逐周数据由网页桥后台预取并推入原生缓存。最近一次成功的课表写入不参与备份的私有目录，并记录站点会话 Cookie 的指纹；冷启动先核对指纹再显示，随后静默刷新。账号变化或退出登录立即清空内存与磁盘缓存。
- **个人课程**：原生添加、修改、隐藏、删除、恢复教务原始安排与恢复已隐藏课程，经网页同源接口与 CSRF 保存，并核对服务器修改基线以避免覆盖并发编辑；研究生课表沿用网站限制。
- **样式与导出**：九套 Web 主题配色（由 `web/src/components/jwxt/scheduleTheme.ts` 生成）、相册背景（22%–88% 显现，默认 76%；Android 12 起支持 0–18 柔化）、深浅色，所有主题的课程文字对比度有回归检查。可按所选周以文本分享、导出 ICS 日历（北京时间，不含订阅地址或登录信息）。
- **图片**：网页图集交给原生查看器，支持左右切图、双指缩放、双击放大、下滑关闭和保存到相册。
- **网页权限**：仅对本站页面按需申请相机、麦克风；文件选择沿用系统文档选择器。

## 桌面小组件

临近课程 2×2 / 4×2、今日课表 4×2 / 4×4、两日课表 4×4，与 iOS、HarmonyOS 的样式族一致；支持九种主题和系统深浅色，完成的课程变灰，较大卡片标注剩余课程数。

- 首次成功加载原生课表后，会为尚未配置的用户自动建立专用课表订阅；课表“更多 → 桌面课表小组件”可预览、选择主题、重新连接，并在支持的桌面上一键添加。
- 小组件只保存专用订阅地址，不复制登录 Cookie；约每 30 分钟请求刷新（实际由系统调度），离线时使用 12 小时内的缓存，授权失效时清除缓存。账号变化会删除旧订阅。
- 点击小组件打开原生课表并回到本周今日。

## 与网页的协议

UA 追加 `CPUWebScheduleApp/<versionCode> CPUWebScheduleAppVersion/<versionName> CPUTimeNative/1`。`CPUTimeNative/` 让网页按原生外壳处理（`/schedule` 路由交给原生、同步未读数、安装共享课表桥 `web/src/utils/iosNextScheduleBridge.ts`）；`CPUWebScheduleApp` 让网页和服务端继续把它识别为 Android，而不是 iOS。

- `app/src/main/assets/NativeShellBootstrap.js`：页面开始时注入（仅本站来源），隐藏网页栏、创建 `window.CPUTimeNative` 并上报路由、登录状态与外观。消息优先经按来源限定、只接收主框架的 `WebMessageListener` 送达 Kotlin；旧版 WebView 回退到 JavaScript 接口。
- `app/src/main/assets/NativeWebCompatibility.js`：由 `android/bridge/*.ts` 生成，页面加载完成后执行。线上网页尚未提供课表桥时，用现有 Pinia 状态和同源 Cookie 安装兼容桥，并提供原生登录、顶栏状态、返回导航、弹层检测与课程编辑（`CPUAndroidEditor`）。
- 原有 `CPUAndroid` 桥（应用内更新、小组件、图片保存）保留，仅对本站页面开放。

修改 `android/bridge`、共享课表桥或网页主题后，在仓库根目录运行：

```sh
npm ci --prefix web
npm run android:generate
node --test android/tests/*.test.mjs
```

Linux 部署工作流会检查这两个生成文件是否过期，并运行上述测试。

## 构建与测试

需要 JDK 17 与 Android SDK Platform 35。用 Android Studio 打开 `android/`，或在命令行：

```bash
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest :app:lintDebug
```

调试本机开发服务器：`./gradlew :app:assembleDebug -PappUrl=http://10.0.2.2:5173/home`。

Debug 构建可用本地模拟课表检查原生界面（不需要学校账号，登录门禁不出现，WebView 仍加载站点）：

```bash
adb shell am start -n cn.lizmt.cpuweb/cn.lizmt.cpuweb.schedule.MainActivity --ez debugMockSchedule true
```

自动测试与模拟器检查不能代替真机验收：需要用真实账号覆盖登录与验证码、本科/研究生课表、快速切周、授权失效、账号切换、断网恢复、课程编辑、背景与导出、所有小组件尺寸与深浅色、冷/热启动与小组件跳转、应用内更新。

## 发布构建

共享 WebView 默认加载：

```text
https://cputime.cn/home
```

生成 release 包：

```bash
gradle :app:assembleRelease
```

正式分发前需要在 Android Studio 中配置签名证书，或使用 Gradle signingConfig 接入自己的 keystore。不要把 keystore、密码或签名配置提交到仓库。

正式更新使用 `Android release artifact` 工作流生成的精确提交 APK，下载后使用现有发布证书签名，并核对包名、版本号和证书摘要。先上传企业盘原发布目录并下载回读校验，再更新网页版本信息、等待精确提交的 `Linux deployment artifact` 成功并部署。仓库中的 APK 仅留存发布记录，不作为网站或 ESA 的下载来源；稳定下载入口及旧 APK 链接都通过企业盘分发，解析失败时提示重试。

V37 将下载包复制到独立缓存并验证包名、版本和签名，通过 FileProvider 授予安装器读取权限。Web 仅对 V37 及声明 `supportsStagedApkInstall` 的客户端启用应用内更新；旧版打开普通 `/download` 页面交给系统浏览器，避免旧壳拦截 APK 链接。3.x 旧版会收到一次修复引导，手动更新入口始终可用。

V38 支持保存下载任务和待安装文件，重开应用后恢复进度、继续安装或重试。正式版本由 `server/src/releases/android.json` 管理，发布门禁与真机验收步骤见 `docs/android-release.md`。

## 可配置参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `appUrl` | `https://cputime.cn/home` | 共享 WebView 的首个页面（原生课表不受影响） |
| `applicationId` | `cn.lizmt.cpuweb` | Android 包名 |
| `appName` | `药大拾间课表` | 桌面显示名称 |

示例：

```bash
gradle :app:assembleRelease -PappUrl=https://cputime.cn/home -PapplicationId=cn.lizmt.cpuweb -PappName=药大拾间
```
