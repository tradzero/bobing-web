# 项目定位

这是一个闽南中秋博饼 Web 游戏，包含仍需保留的单机模式和局域网多人模式。技术栈为 React、Three.js、Zustand、cannon-es、Node.js 与 PostgreSQL。优先级始终是：结果真实与规则正确（P0）> 流程、移动端和性能（P1）> 美术与音效（P2）。

开始工作前检查当前代码、`package.json`、工作区状态和相关文档。文档与可复现运行时冲突时，以代码证据为准，并在同一任务修正文档。

| 文档                                 | 用途                           |
| ------------------------------------ | ------------------------------ |
| [README.md](./README.md)             | 项目简介、启动方式、常用命令   |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 当前架构、数据流、状态机与规则 |
| [CHECKLIST.md](./CHECKLIST.md)       | 已完成能力和剩余路线           |
| [UI-CHECKLIST.md](./UI-CHECKLIST.md) | UI/移动端不变量和素材规范      |

## 产品不变量

### 核心玩法与规则

- 使用 6 颗标准骰子；对面之和为 7，点数四为红色。物理朝上面、3D 可见面、客户端展示值必须逐颗一致。
- 流程为：掷骰 → 可见碰撞与翻滚 → 自然停稳或明确异常 → 结算 → 展示 → 下一轮。
- 判奖只接受恰好 6 个、均为 1–6 的有限整数；同时命中时只提交最高优先级奖项。完整优先级和带数见 `ARCHITECTURE.md`。
- timeout、调度过载、非有限状态、越界或不可解释姿态不得伪装成正常中奖结果，也不得推进轮次、历史或奖项。
- 单机模式暂不删除；多人能力不能以破坏单机入口、规则或可复现物理为代价。

### 多人联机

- 启动时保留一个永久默认开放房，根路径先进入大厅，再通过 `/room/<id>` 加入默认房、开放房或密码房。领域逻辑不得写死 `default`。
- PostgreSQL 是房间、成员、对局、回合、投掷、奖池和状元归属的权威层；只通过环境变量连接，项目不得启动或接管数据库。
- 每局实体奖项固定为 63 份：状元 1、对堂 2、三红 4、四进 8、二举 16、一秀 32。普通奖项库存为 0 后仍记录投掷，但不得超发。
- 服务端通过共享 headless 物理生成 seed 和权威结果；客户端只用同一 seed 播放动画，不能提交本地点数、判奖或姿态覆盖服务端结果。
- 所有操作、倾斜确认和结束选择使用 PostgreSQL 中的绝对截止时间；内存 timer 只负责唤醒，时限来自环境变量，进程重启后仍能继续。
- 状元按子级、带数和规则比较抢占。同一玩家只保留最后一次状元，即使新结果更小，再从所有玩家最后一次状元中重算持有者。
- 63 份奖项博完后，只有房主可立即结束或允许锁定玩家每人加投一次；加投不再分配普通奖，但可改变状元。
- 结束后只有原房主可按上一局锁定阵容再开一局；结束后加入者保持旁观，不得改变下一局座位。
- 投掷命令使用 UUID 幂等键；奖项扣减、投掷提交、状元更新和下一回合必须处于同一事务。错误、timeout、重放和事务冲突不得重复扣奖或推进。房间成员、广播、deadline、游戏与奖池必须始终按 `roomId` 隔离。
- 房间创建必须在同一事务绑定创建者为房主并生成 lobby，不能暴露“先建空房、首位加入者抢房主”的窗口。密码房只保存带随机 salt 的 scrypt 派生值；原始密码不进数据库或浏览器会话存储。
- 恢复令牌绑定成员和房间，服务端只保存令牌哈希；已恢复的 WebSocket session 作为房主命令的身份边界。只有房主可主动关闭非默认房，关闭必须原子终止进行中对局、归档房间并通知全部连接。普通断线不等于退出或删除房间。
- 默认房永久保留；非默认空房、闲置房和归档房按 PostgreSQL 时间及环境变量清理。进行中对局长期没有真实操作时必须进入明确 `abandoned` 终态并停止生成新回合，在线心跳只延后房间归档，不得冒充游戏操作。

### UI 与视觉

- 单机核心 UI 保留掷骰、轮次、结果/异常、累计奖级、最近 5 轮、重置与音效；多人 UI 保留成员、倒计时、奖池、个人奖项、全员获取情况和最近结果。
- rolling 时禁用重复操作；移动端使用真实上下布局，不恢复可拖拽底部浮层。
- 保持红、金、米白节庆方向、传统圆桌、海碗与 6 颗骨白骰子。正式美术优先碗纹、桌布与 UI 收口，不主动增加独立 3D 摆件。
- 摄像机保持俯视加轻微倾斜并聚焦碗心，除非用户明确要求改变交互视角。
- 素材替换不得污染规则、状态机、物理真值或资源预算。纹样未完成首帧解码/上传前必须由加载页遮挡；加载失败需显式回退。

## 架构边界

- React 负责 DOM overlay；Three.js/cannon-es 保持命令式、可独立驱动。`GameController`（或等价编排层）拥有业务写入，Zustand store 不自行组合矛盾状态。
- `packages/game-domain` 是判奖、奖池和多人聚合真源；Web 不再维护规则 façade。
- `packages/physics-core` 持有服务端与浏览器共享的 Cannon 配置、PRNG、刚体、读面、停稳、调度、诊断和 headless roll 编排。服务端不得直接引入 DOM/React/Three 渲染代码；`apps/web` 只持有 Three 网格、渲染同步和 UI。
- 正式物理与实验物理分层：生产构建使用 `throw-runtime`、`settle-runtime`、`world-runtime`、`exact-cap6`、`cannon-default`；历史 throw、contact-cluster assist、projected-AABB、legacy/cap4 scheduler、CPU profile 和渲染候选只允许从测试、显式 `lab` mode 脚本或 `e2e` 构建进入。
- 正式路径和实验路径必须复用当前算法的同一实现，不允许复制一套近似生产算法供测试。
- 共享物理/投掷/停稳参数集中在 `packages/physics-core/src/config/`，Web 渲染/UI 参数集中在 `apps/web/src/config/`；服务端连接与时限集中在 `apps/server/src/config/` 并从环境变量读取。
- 骰面材质映射与读面法线共享真源。关键中文注释解释规则优先级、读面、碰撞边界、停稳原因和非直观兜底。

## 物理与诊断原则

- 当前可复现版本为 THROW v3 / SETTLE v4；正式投掷为 `stratified-ring`，contact-cluster assist 关闭，调度为 `exact-cap6`，窄相为 cannon 默认实现。
- 读面依据最终物理四元数与面法线，不使用欧拉角区间，也不得在读面前后改写姿态以制造目标点数。
- 强制 sleep、速度清零、姿态吸附、逃逸反射或截断必须记录为可观察原因；timeout 只提供流程出口，不授权读取仍运动的姿态。
- 逃逸验收以真实碗边界和全过程极值为准；飞出后落回、被 guard 反射后落回仍属于发生过介入。
- PRNG、初始条件或物理算法变化时递增版本。失败记录至少包含 seed、算法版本、固定步长、配置、结算原因和硬断言。
- watch seed 与批量 seed 分开统计；既有失败 seed 不得因轨迹改变而静默删除。

## 证据驱动工作流

1. 用户只要求调查/审查/诊断时保持只读。先检查工作区，保留用户已有改动。
2. 物理、状态机或性能问题先记录 commit、Node/浏览器环境、配置、复现 seed/步骤、期望/实际和首次异常阶段。
3. 区分已确认事实、推断和未知；实验前写明成功指标与失败条件，一次尽量只改变一个变量。
4. 物理候选使用相同 seed、初始条件和预算做 A/B，至少比较 NaN、边界/穿透、结算原因、时间分布、姿态、介入次数和 step 成本。
5. 修复应落在真实算法或所有权边界；诊断脚本补丁不能代替运行时修复。确认失败 seed 后补自动断言。
6. 交付报告说明根因、改动、命令结果、样本量、人工验收、残余风险和受环境限制的项目。

不能通过提高 timeout、放宽边界、增加冻结或降低样本难度让候选“改善”。测试全绿也不能替代对测试断言是否覆盖风险的检查。

## 验收门禁

### 快速默认门禁

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

`pnpm test` 只包含适合频繁执行的单元/集成测试；`apps/**/__tests__/slow/` 被显式排除。慢速证据没有删除，需按风险单独运行：

```bash
pnpm test:slow
pnpm test:collision:acceptance
```

### 定向与领域门禁

```bash
pnpm exec vitest run apps/web/src/__tests__/judge.test.ts
pnpm exec vitest run apps/web/src/__tests__/read-face.test.ts apps/web/src/__tests__/settle.test.ts
pnpm exec vitest run packages/game-domain/src/__tests__/game.test.ts packages/game-domain/src/__tests__/multiplayer.test.ts
pnpm exec vitest run apps/server/src/scheduler/deadlines.test.ts apps/server/src/scheduler/room-lifecycle.test.ts apps/server/src/roll/authority.test.ts
```

数据库集成测试只接受显式 `TEST_DATABASE_URL`：

```bash
TEST_DATABASE_URL=<postgres-test-url> pnpm test:db
DATABASE_URL=<postgres-url> pnpm db:migrate
```

不得自动把 `.env` 中的普通 `DATABASE_URL` 当成测试库，不得删除非本测试随机 room ID/运行名称的数据，也不得为验收启动 Compose。经开发者明确确认数据可丢弃时，可把本地开发库显式传作 `TEST_DATABASE_URL`；生产库禁止这样测试。

### 物理与浏览器门禁

| 命令                                      | 用途                                         |
| ----------------------------------------- | -------------------------------------------- |
| `pnpm test:physics`                       | 固定 watch seeds 与物理/停稳快速回归         |
| `pnpm test:seed -- --seed=<seed>`         | 单 seed 完整结构化复现                       |
| `pnpm test:acceptance`                    | 200 seeds 正式物理验收                       |
| `pnpm test:physics:ab`                    | 历史/current 命名 preset A/B                 |
| `pnpm test:physics:cadence`               | reference/cap6/cap4 cadence、守恒和 overload |
| `pnpm test:e2e`                           | 桌面/移动单机流程、异常恢复和静态调度        |
| `pnpm test:e2e:multiplayer`               | 多房、密码、关房、整局分支、重连/重启与幂等  |
| `pnpm test:e2e:multiplayer:soak`          | 三浏览器连续 deadline、真实投掷和多局重开    |
| `pnpm test:e2e:soak`                      | 正式调度桌面/移动连续多轮                    |
| `pnpm bench:browser`                      | idle/rolling/settled 结构和性能诊断          |
| `pnpm bench:browser:render-ab`            | 隔离渲染候选 A/B                             |
| `pnpm bench:browser:physics-scheduler-ab` | 隔离调度 A/B                                 |
| `pnpm bench:browser:collision-ab`         | 隔离窄相 A/B                                 |

普通浏览器 e2e 强制走单机入口；只有 `test:e2e:multiplayer` 启动真实服务和随机数据库房间。严格 FPS/毫秒门槛只能在记录机器、浏览器、DPR、电源和 warm-up 的稳定环境中判断；不稳定环境只报告观测值和相对趋势。

稳定 sweep 入口通过 `pnpm sweep:parallel -- --list` 查询。sweep 会写 `logs/`，属于诊断工具，除非脚本含与本次目标一致的失败退出码，否则不能当作合并门禁。

## 按改动范围选择验证

- 规则/读面：定向测试 → 快速默认门禁。
- 物理/投掷/停稳/引擎：失败 seed → 相关物理测试 → 相同条件 A/B → 默认门禁 → 桌面/移动多轮。
- 多人/数据库：领域和调度测试 → 专用 PostgreSQL 集成测试 → 多客户端手工或自动化验收。
- UI/音效：组件/controller/store → 默认门禁 → 桌面与移动完整交互；涉及 3D 生命周期时检查 idle/rolling/settled 资源。
- 文档：核对真实文件、脚本和运行时，至少执行 `git diff --check`。
