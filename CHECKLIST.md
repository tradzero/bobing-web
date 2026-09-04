# 博饼项目路线与验收清单

本文件只保留当前能力和仍有价值的后续任务。历史逐步开发记录由 Git 保存，勾选项不能替代当前命令和运行证据。

## 已完成：核心单机产品

- [x] 6 颗标准骰子的 Three.js 可见动画、cannon-es 碰撞、四点红色和逐骰面映射
- [x] 13 级优先级判奖、严格输入契约、命中骰/剩余骰/带数结果
- [x] `idle / rolling / tilt-confirm / result / error` 单机状态机
- [x] timeout/overload 进入显式异常，不读面、不判奖、不推进历史
- [x] 固定步 exact-cap6 调度、visibility 时间分类、过载出口和静态零帧
- [x] initial/final canonical state、边界/穿透/guard、floor-relaunch 和结算诊断
- [x] watch seed、200-seed acceptance、命名物理 A/B、cadence comparison
- [x] 单机入口继续由 `VITE_MULTIPLAYER_ENABLED=false` 保留

## 已完成：UI 与视觉

- [x] 红金米白桌面/移动 UI、结果/异常/倾斜面板、统计、最近 5 轮、重置和音效
- [x] 移动端真实上下布局，无可拖拽底部浮层
- [x] 骰子单材质 atlas + 6-instance 渲染和明确资源释放
- [x] 程序化木纹桌面、传统海碗、固定俯视轻倾镜头
- [x] 单张无缝青花 WebP、首帧加载遮罩和程序化纹样失败回退
- [x] reduced 质量档 rolling DPR 限 1x；静态恢复基础 DPR
- [x] Playwright 桌面/移动正常流程、异常恢复、soak 与结构性能门禁

## 已完成：多人 MVP

- [x] Web/Server/game-domain/protocol/physics-core workspace 边界
- [x] PostgreSQL migration/repository：房间、成员、游戏、回合、投掷、奖池、领取、状元和事件
- [x] 单默认房间、首位房主、开局锁座、开局后旁观者
- [x] WebSocket protocol v1、RoomHub 广播、版本化 RoomSnapshot
- [x] 服务端共享 headless 物理、seed 广播和客户端动画
- [x] PostgreSQL 绝对 deadline：操作、揭晓、倾斜确认、结束选择
- [x] 63 份实体奖项、库存原子扣减、个人/全员查看和抢状元
- [x] 奖池清空后立即结束/锁定玩家加投一轮
- [x] 原房主按锁定阵容再开一局，后来旁观者不进入
- [x] 浏览器 localStorage 恢复令牌、重启/断线恢复和清房后自动重绑
- [x] 二次确认的停服强制重置 CLI
- [x] 真实 PostgreSQL 集成测试覆盖关键事务语义（只在显式测试库运行）

## 已完成：消融收口

- [x] Web 删除重复规则 façade，统一依赖 `@dice/game-domain`
- [x] `physics-core` 持有 headless roll 编排，调用方统一依赖共享包
- [x] 正式 throw/settle/world 与 lab 变体分层；普通 Web/Server build 不再携带历史候选
- [x] 生产固定 stratified-ring、assist off、exact-cap6、cannon-default；e2e/lab 保留历史 A/B
- [x] 删除无引用场景装饰、旧碗图、根目录生成图和一次性历史 sweep
- [x] 删除只被测试消费的单骰 Mesh API、deadline 旧包装 API 和无状态 RollAuthority 类
- [x] 默认 `pnpm test` 排除 200-seed 慢用例；慢证据迁入 `pnpm test:slow`
- [x] 生产 typecheck 与测试 typecheck 分离，Web/Server build 各自检查生产边界
- [x] 固定 Node 24.11.1 / pnpm 10.14.0，避免跨 V8 canonical hash 漂移
- [x] README、AGENTS、ARCHITECTURE、CHECKLIST、UI-CHECKLIST 与实际入口同步

## 待办：多人扩展

- [ ] 多浏览器同时在线的自动化 WebSocket/e2e，覆盖断线重连、并发命令和服务重启恢复
- [ ] 多人长时间 soak：多人轮转、deadline 自动操作、奖池耗尽、结束选择和再开一局
- [ ] 房间列表、创建、密码验证和访问控制；保持 protocol v1 默认房间兼容
- [ ] 明确离房、踢人、房主转移和座位回收语义后，再提供切换身份入口
- [ ] 为局域网之外的部署增加 TLS、认证、速率限制和可信代理边界

## 待办：架构与运维

- [ ] 将剩余 DOM-free 物理叶模块从 `apps/web/src` 机械迁入 `packages/physics-core`；server tsconfig 已不再依赖 DOM lib
- [ ] 为 migration/reset 增加备份与恢复操作文档；不增加无认证远程 reset API
- [ ] 评估生产日志留存、隐私字段和诊断采样策略
- [ ] 根据真实部署环境决定 health/readiness、优雅停机和数据库连接池告警门槛

## 待办：美术与体验

- [ ] 在不改变桌体/物理的前提下设计桌布，并补齐包边、压纹或垂边
- [ ] 补正式统一 SVG 图标和可商用中文展示字体
- [ ] 在记录浏览器、GPU、DPR 和设备信息的多台真实设备上复核画面与性能
- [ ] 完成多人房间等待、旁观、结束和断线状态的无障碍/触屏验收

## 提交前最小检查

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

按改动风险追加 `pnpm test:slow`、物理 acceptance/A-B、Playwright 和专用 PostgreSQL 集成测试。数据库测试不得自动使用普通 `.env` 的 `DATABASE_URL`。
