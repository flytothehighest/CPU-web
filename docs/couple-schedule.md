# 情侣课表

两名站内账号互相绑定后，可以在 `/schedule/couple` 里一起看课表：双人叠加周视图、共同空闲时段、TA 此刻状态和在一起天数。目前只做了 Web 端；各 App 通过 WebView 打开的页面会同样生效，原生课表页还没有入口。

## 绑定

- 一方在情侣课表页生成邀请码（6 位，字母表 `A-Z 2-9` 去掉 `I`/`O`，24 小时有效），另一方输入后即绑定。邀请码只能用一次。
- `CoupleMember.userId` 是主键，数据库层面保证每个账号同时只属于一条关系（含待接受的邀请）。接受别人的邀请时，自己未被接受的邀请会作废。
- 任意一方都可以解除绑定。解除会删除整条 `CoupleLink`，成员、课表快照随之级联删除，对方会收到站内通知。
- 注销账号时 `accountDeletion` 会调用 `deleteCoupleDataForUser` 删除整条关系。

## 课表同步

服务端不保存教务课表，情侣课表读取的是双方各自上传的快照（`CoupleScheduleSnapshot`，每人一行）。

- 课表页（`Schedule.vue`）加载成功 4 秒后，若账号已绑定，就把**当前学期**完整课表（含自定义修改）和校历上传。翻看往年学期时不上传。
- 页面只有单周数据时需要再向教务请求整学期课表，因此同一份自定义修改最多每 6 小时拉取一次；内容指纹没变时最多每 12 小时刷新一次“同步于”时间。
- 未绑定的状态在浏览器里缓存 10 分钟，避免每次打开课表都查询服务端。情侣课表页的状态变化会立即更新这份缓存。
- 服务端对快照做与“分享课表”相同的校验（最多 600 门课、512 KB），内容哈希相同时只更新 `syncedAt`。

## 页面计算

逻辑都在 `web/src/views/schedule/couple.ts`，有单元测试覆盖：

- 两人的课按**日期**对齐，每人用自己的校历解析周次和调休，所以学期不同也不会错位。
- 共同空闲按小节计算；相邻两节间隔超过 60 分钟（午饭、晚饭）就拆成两段。任何一方当天不在学期内时不计算，避免把“不知道”显示成“有空”。
- “此刻”按北京时间计算，自定义课程的开始/结束时间优先于节次表。

## 接口

全部需要登录，挂在 `/api/couple`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 当前状态：`none` / `pending`（含邀请码）/ `active`（含双方资料和快照时间） |
| POST | `/invite` | 生成或更换邀请码 |
| DELETE | `/invite` | 取消邀请 |
| POST | `/accept` | 接受邀请码（每 IP 10 分钟 15 次） |
| PATCH | `/` | 设置纪念日（`YYYY-MM-DD`，不晚于今天；`null` 清除） |
| DELETE | `/` | 解除绑定 |
| PUT | `/schedule` | 上传自己的课表快照 |
| GET | `/schedules` | 读取双方快照 |

## 测试

- `server/tests/coupleSchedule.test.ts`、`web/tests/coupleSchedule.test.ts`、`web/tests/coupleSync.test.ts` 随 `npm test` 运行。
- `server/tests/coupleSchedule.integration.test.ts` 需要独立的 PostgreSQL，默认跳过：

  ```bash
  COUPLE_INTEGRATION_TEST=1 DATABASE_URL="postgresql://...@127.0.0.1:5432/couple_test" node tools/run-node-tests.mjs server/tests/coupleSchedule.integration.test.ts
  ```
