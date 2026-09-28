# Android 单指滚动故障：真机定位记录

2026-09-28。在连接的 PJE110、Android 15、System WebView 149.0.7827.159 上复现。V42、V43 的触摸请求补丁和 V44 的原生容器重写均未解决实际故障；此前模拟器使用 WebView 124，不能代表本次故障环境。

## 证据

- 真实首页的可滚动高度超过视口。单指 `touchstart`、连续 `touchmove`、`touchend` 都到达网页，`defaultPrevented` 始终为 false，但 `window.scrollY` 为 0。
- `html` 和 `body` 均匹配共享 iOS 规则，得到 `overflow-x:hidden; overflow-y:auto`。`body` 为内容自动高度，自身没有滚动范围，同时全局 `overscroll-behavior:none` 阻止向文档传递滚动。
- 保持原生代码、登录状态和内容不变，只把 body 的 overflow 改为 visible，同样的单指滑动使文档滚动约 374 CSS px。恢复原样式，再次变为 0。用户手动确认单指恢复。
- 只把 body 的 overscroll-behavior-y 改为 auto 也能恢复，进一步定位到内层滚动容器阻断传递，而非原生丢失触摸事件。

## 修正

Android 的 `NativeShellBootstrap.js` 明确让普通 body 使用 `overflow:visible`，由文档负责滚动。规则比共享 iOS body 规则更具体，不依赖重新部署网页。对 Element Plus 弹窗、消息框、图片查看器和引导的锁屏 class 显式保留 `overflow:hidden`；课表和私信的独立全屏锁定仍遵循原页面规则。

## 验证与发布边界

本地 V45（4.0.6-test）已使用原证书签名并覆盖安装，最终包关闭 WebView 调试。真机真实登录页面中，首页、教务、服务、个人中心各两轮独立单指上下滑动通过，刷新首页后仍通过。真实网页未注入虚构长内容。自动运行测试使用同样的双层 overflow/overscroll CSS，验证 APK 内置 bootstrap 能恢复文档滚动，同时保留弹窗滚动锁。

V45 未上传、未推送、未上线。官网安卓下载保持用户要求回退的 V38。
