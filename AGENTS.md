# 项目定位

这是一个基于闽南传统中秋博饼的 Web 小游戏。当前技术栈为 Three.js、React、Zustand 与 cannon-es；项目首先保证结果真实、规则正确、流程稳定和移动端可用，其次才追求视觉与音效表现。

> 文档索引
>
> | 文档                                 | 内容                                                                         |
> | ------------------------------------ | ---------------------------------------------------------------------------- |
> | [ARCHITECTURE.md](./ARCHITECTURE.md) | 当前架构、数据流、状态机、规则与物理方案；它描述现状，不是不可突破的永久约束 |
> | [CHECKLIST.md](./CHECKLIST.md)       | 历史开发清单与未完成项；勾选记录不能替代当前验收证据                         |
> | [UI-CHECKLIST.md](./UI-CHECKLIST.md) | UI 收敛、移动端布局不变量与素材规范                                          |
> | [README.md](./README.md)             | 项目入口、运行方式与常用命令                                                 |

开始工作前先核对当前代码、`package.json` 和相关文档。若文档与运行时冲突，以可复现的当前代码证据为准，并在同一任务中修正文档漂移。

---

## 产品不变量

以下是需要长期保留的产品契约；改变它们必须得到用户明确同意。

### 核心玩法

- 使用 6 颗标准骰子，每颗点数为 1–6，对面之和为 7。
- 点数“四”使用红色特殊标记；物理朝上面、3D 可见面和 UI 展示值必须一致。
- 玩家点击“掷骰”后，骰子从海碗上方投入并发生可见碰撞、翻滚，最终读取每颗骰子的朝上点数。
- 按博饼规则只提交最高优先级奖项；未命中显示“未中奖”。
- 结果必须同时展示 6 颗骰子点数组合与奖级，便于人工核对。
- 完整流程为：掷骰 → 翻滚 → 停稳或明确异常处理 → 结算 → 展示 → 下一轮。

### 博饼规则

- 完整奖级优先级与带数规则见 [ARCHITECTURE.md 的奖级优先级表](./ARCHITECTURE.md#奖级优先级表确认版)。
- 规则应由清晰、可枚举、可维护的数据结构表达；判定函数必须是可独立验证的纯逻辑。
- 输入边界必须明确：正常判定只接受恰好 6 个、均为 1–6 的有限整数；异常输入不得静默判成奖项。
- 多规则同时命中时只取最高优先级；所有带数、命中骰子和剩余骰子必须与输入相互一致。

### 多人联机

- 当前产品入口是服务启动时创建的单个默认房间；协议、表结构和 repository 必须继续保留未来多房间、密码房扩展能力，不能把 `default` 写死进领域逻辑。
- PostgreSQL 是房间、回合、投掷、奖池和状元归属的权威持久层，只能通过环境变量连接；项目不得通过 Docker Compose 启动或接管数据库。
- 一局实体奖项固定为 63 份：状元 1、对堂 2、三红 4、四进 8、二举 16、一秀 32。普通奖项库存为 0 后仍记录投掷，但不得超发。
- 服务端使用共享 headless 物理生成 seed 和可提交结果，客户端使用同一 seed 播放可见动画。客户端点数、判奖或本地姿态不得覆盖服务端权威结果。
- 每个玩家操作、倾斜确认和结束选择都使用 PostgreSQL 保存的绝对截止时间；内存 timer 仅负责唤醒。所有时限通过环境变量配置，重启后必须可继续处理。
- 状元允许抢占：按状元子级、带数及相应规则比较；同一玩家只保留最后一次状元，即使新结果更小，然后在所有玩家最后一次状元中重算最终持有者。
- 63 份奖项博完后，只有房主可以选择立即结束或让本局锁定玩家每人再投一次；加投轮不再分配普通实体奖项，但仍可改变状元归属。
- 本局结束后只有原房主可以按本局锁定阵容再开一局；结束后才加入的成员保持旁观，不得进入下一局或改变座位顺序。
- 权威物理错误、timeout、重复命令或事务冲突不得扣奖或推进两次。投掷命令需使用 UUID 幂等键，奖项扣减、投掷提交、状元更新和下一回合必须处于同一数据库事务。

### UI 与视觉方向

- 核心 UI 包括：掷骰按钮、当前轮次、结果/异常面板、累计奖级记录、最近 5 轮历史、重置按钮和音效开关。
- rolling 时按钮禁用并显示“骰子翻滚中”；异常、超时或不可信姿态不得伪装成正常中奖结果。
- 移动端采用真实上下布局，不恢复可拖拽底部浮层；桌面端与移动端都必须可操作。
- 维持红、金、米白的传统节庆 UI；中奖反馈克制，高频碰撞音效需要节流或强度筛选。
- 骰子维持骨质/象牙白观感；摄像机保持俯视加轻微倾斜并聚焦碗与桌面中心，除非用户明确要求开放交互视角。
- 当前保留传统圆桌、海碗与 6 颗骰子。正式美术优先海碗纹样、桌布和 UI 收口，不主动扩展月饼、灯笼等独立 3D 摆件。
- 程序化青花、木纹等可以继续作为占位；替换素材不应反向污染规则、状态机或物理真值。

### 优先级

1. **P0**：结果真实、规则正确、无飞出/穿模/永久抖动、流程不会卡死或错误结算。
2. **P1**：状态机清楚、UI 反馈准确、桌面端和移动端可用、性能可解释且无明显退化。
3. **P2**：氛围、材质、音效、粒子与高级表现。

---

## 技术决策原则

### 产品契约固定，具体算法可重做

当前的 cannon-es、固定步长、Heightfield 碗底、竖直挡墙、Box/Convex 骰子、分层环形投掷、sleep、低速/姿态窗口、历史接触簇辅助和速度反射都只是现有实现，不是永久约束。当前可复现版本为 THROW v3 / SETTLE v4；运行时默认使用 `stratified-ring` 投掷且关闭 contact-cluster assist，`legacy-v1` / `uniform-area-restarts` 及 assist 开启仅供命名 A/B preset 复现历史行为。

有证据表明现有方案无法满足 P0/P1 时，可以：

- 重写投掷、碰撞、停稳、读面、引擎调度或状态机；
- 更换碗碰撞表示、求解器乃至物理引擎；
- 删除已经被证明会掩盖问题的兜底、冻结或速度修正；
- 调整模块边界和测试 runner，使运行时与测试复用同一条行为链路。

突破现有方案时必须同时提供：问题复现、旧基线、候选方案、同条件 A/B、正确性回归、性能比较、残余风险和必要的文档迁移。不能仅凭体感、单个成功 seed 或测试数量宣布改善。

### 不允许用表面稳定替代结果真实

- 读面应基于物理姿态或同等可解释的真值，不依赖欧拉角区间，也不得在读面前后偷偷改四元数以制造指定结果。
- 任何强制 sleep、速度清零、阻尼增强、姿态吸附、逃逸反射或超时截断，都必须作为可观测的 settlement/intervention 原因记录，不能伪装成自然停稳。
- timeout 的目标是保证流程有出口，不等于允许读取仍在运动的姿态并提交正常奖级。当前产品策略是冻结异常画面并进入显式 `error`，不读面、不判奖、不推进轮次/历史/奖级记录，用户只能选择同轮重新掷骰或重置。
- 测试必须区分“物理更快收敛”和“检测层更早冻结”；至少记录速度、角速度、姿态漂移、结算原因和介入次数。
- 逃逸验收以真实碗边界为准。把允许半径放宽、复制运行时速度补丁或只检查极远坐标，不能证明没有飞出。

### 保持可解释的架构边界

- React 负责 DOM UI overlay；Three.js/物理层保持可独立驱动。若重构这一边界，需要说明收益并保留可测试性。
- 业务状态写入集中在 controller/等价编排层，store 不应允许互相矛盾的 `diceValues`、`JudgeResult` 和 phase。
- 物理、投掷、停稳与 UI 参数优先集中在 `apps/web/src/config/`，避免测试和运行时各复制一套常量或算法；服务端时限与连接配置集中在 `apps/server/src/config/` 并来自环境变量。
- 骰子可见材质面与读面法线应共享一个映射真源。
- 关键逻辑保留必要的中文注释，重点解释读面、规则优先级、碰撞边界、停稳原因和非直观兜底。

---

## 证据驱动工作流

### 1. 先确认任务边界

- 用户只要求调查、审查或诊断时保持只读，不顺手改代码。
- 收到审查意见时先独立复现，不全盘接受，也不因现有测试全绿就直接否定。
- 用户已要求实现时，可以在证据和方案清楚后继续修改；若需要改变玩法、规则、异常处理语义或引入较大依赖，再向用户确认关键取舍。
- 检查工作区状态，保留用户已有改动，不覆盖无关文件。

### 2. 修改前建立复现与基线

每个物理、状态机或性能问题至少记录：

- 当前 commit、运行环境和相关配置；浏览器问题还要记录浏览器、视口、DPR 与设备类别。
- 可复现 seed；若问题与帧调度有关，同时记录时间步序列、页面可见性和交互顺序。
- 期望与实际结果，以及首次异常帧/阶段。
- settlement 原因、结算时间、最大线速度/角速度、姿态置信度、稳定窗口打断数和任何人工介入。
- 飞出、穿模、NaN、重叠或抖动问题所需的位置、速度、接触与极值证据。
- 性能问题的同机基线，包括 warm-up、样本数、统计口径和噪声范围。

没有稳定复现时，先补诊断能力或扩大 seed 样本；不要先凭猜测调一组参数。

### 3. 提出可证伪的假设

- 把已确认事实、推断和未知项分开。
- 每个候选方案说明它作用于根因、症状还是兜底层。
- 一次实验尽量只改变一个独立变量；耦合变更必须说明为什么不能拆分。
- 先写明成功指标和失败条件，再运行实验，避免看结果后移动门槛。

### 4. 物理重构必须做 A/B

基线 A 与候选 B 应使用同一组失败 seed 和批量 seed、相同初始条件、固定模拟预算、相同统计代码。至少比较：

- NaN、穿模、越过真实碗边界、最终重叠/穿透；
- 自然 sleep、低速窗口、只读姿态窗口、人工 assist、timeout 等结算原因；
- 结算时间分布、stable-window 打断、尾段速度/角速度和姿态漂移；
- 倾斜率、低置信度率、人工介入次数；
- `world.step()` 成本和浏览器端渲染表现；
- 失败 seed 是否修复，以及是否产生新的失败 seed。

若只调整停稳/冻结算法而物理轨迹相同，应比较截断结果与继续自然模拟后的最终面/奖级。若更换物理模型导致轨迹本来就不同，不强求逐 seed 点数相同，但必须验证面值分布、公平性、规则不变量和可见结果一致。

候选不能通过提高 timeout、放宽逃逸半径、增加强制冻结或降低测试样本难度来获得“改善”。A/B 结果不足以区分噪声时，结论只能是“不确定”。

### 5. 实现与回归

- 优先修复产生缺陷的算法或所有权边界；诊断脚本中的修补不能代替运行时修复。
- 失败 seed 一旦确认，应加入可自动断言的回归集；纯日志用例不算门禁。
- 生产日志应能在异常发生时拿到 seed 和结算原因，但不得泄露敏感信息。
- PRNG、初始条件生成或物理引擎变更会改变轨迹时，记录算法/配置版本；只保存 seed 而不保存版本不足以长期复现。
- 测试名称声称“不飞出”“不超时”或“结果一致”时，必须真的断言对应条件。

#### 失败 seed 复现纪律

- 失败记录至少包含 seed、PRNG/初始条件生成版本、物理配置、固定步长、结算原因和预期失败断言；仅有一个裸 seed 不足以跨算法版本复现。
- watch seed 与批量随机 seed 分开统计，但 A/B 两侧都必须包含完整 watch seed 集。
- 已确认的失败 seed 不得因新算法改变轨迹就静默删除；应保留旧版本证据，并为新实现迁移成对应的不变量或回归场景。
- 单 seed 用例必须有明确 pass/fail。逐帧日志、截图和 NDJSON 是诊断证据，不代替硬断言。
- 当前可用的完整单 seed 入口是 `pnpm test:seed -- --seed=<seed>`；面向特定物理维度的 sweep 也可接受 `--seeds=` 列表。

### 6. 交付报告

完成时报告：

1. 根因与证据；
2. 实际改动及为何选择；
3. 执行过的命令和结果；
4. A/B 指标、样本量与失败 seed；
5. 手工验收范围；
6. 未解决风险、环境限制和待落地门禁。

不要把“命令能运行”“测试全绿”或诊断脚本只输出日志描述成问题已经解决。

---

## 验收机制

### 正确性门禁

- 6 个可见骰面、物理读面与 UI 点数逐颗一致。
- 所有合法组合遵守奖级优先级与带数；非法输入有明确失败行为。
- 每轮只提交一次，round/history/prizeRecord 与 phase 一致；倾斜、重掷、重置和音效状态不产生提前或重复副作用。
- 人工 assist 或 timeout 不得静默冒充自然停稳。

### 物理稳定门禁

- 失败 seed 回归全部通过，并保留硬断言。
- 批量 seed 中无 NaN、无穿模、无越过真实碗边界、无永久抖动和无无法解释的结算。
- 结算时记录并检查最大速度、角速度、姿态漂移、置信度及最终接触/穿透情况。
- 不能只检查最终位置；飞出后落回、强制反射后落回也属于发生过逃逸/介入。
- 连续多轮真实浏览器操作无按钮状态异常、重复结算或资源泄漏。

### 性能验收

- 物理与渲染分开测量；区分 idle、rolling 和 settled 三种阶段。
- 优先报告中位数、p95/p99、相对倍率、长帧数和样本规模，而不是单次 FPS。
- A/B 必须在同一机器、同一浏览器/Node 版本、相同电源与页面条件下交替运行并 warm-up。
- 不在负载不稳定、共享或硬件未知的 CI 上盲设绝对 wall-clock/FPS 门槛。CI 可以门禁确定性的模拟步数、正确性、相对复杂度或宽松的灾难性退化；严格毫秒/FPS 预算只在记录清楚的稳定基准环境中设定。
- 如果只有不稳定环境数据，只能报告观测值和相对趋势，不得宣称达到通用性能目标。

### UI 验收

- 桌面端和移动竖屏都完成完整一轮及下一轮操作。
- rolling、tilt/异常、result、reset 和静音状态的文案与实际行为一致。
- 结果、带数和最近 5 轮历史可读，不遮挡关键骰子区域。
- 视觉调整不能以降低物理/读面可核对性为代价。

---

## 分层验证命令

先跑与改动最相关的最小层，再逐步扩大。以下命令已与当前 `package.json` 核对。

### 已存在：快速与常规门禁

| 层级 | 命令                                                                                                  | 用途                                             |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 定向 | `pnpm exec vitest run apps/web/src/__tests__/judge.test.ts`                                           | 规则改动                                         |
| 定向 | `pnpm exec vitest run apps/web/src/__tests__/read-face.test.ts apps/web/src/__tests__/settle.test.ts` | 读面/停稳改动                                    |
| 定向 | `pnpm exec vitest run <相关测试文件>`                                                                 | 任意模块的最小回归；`vitest` 当前已安装          |
| 全量 | `pnpm test`                                                                                           | 当前 Vitest 全量套件                             |
| 静态 | `pnpm lint`                                                                                           | ESLint                                           |
| 构建 | `pnpm build`                                                                                          | TypeScript project build + Vite production build |

多人/数据库改动还必须按需执行：

| 层级   | 命令                                                                                                                          | 用途                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 领域   | `pnpm exec vitest run packages/game-domain/src/__tests__/game.test.ts packages/game-domain/src/__tests__/multiplayer.test.ts` | 63 份奖池、抢状元、回合与结束语义    |
| 调度   | `pnpm exec vitest run apps/server/src/scheduler/deadlines.test.ts apps/server/src/roll/authority.test.ts`                     | deadline 唤醒和服务端权威物理        |
| 数据库 | `TEST_DATABASE_URL=<postgres-url> pnpm exec vitest run apps/server/src/room/repository.integration.test.ts`                   | 真实 PostgreSQL 事务、恢复与回合推进 |
| 迁移   | `DATABASE_URL=<postgres-url> pnpm db:migrate`                                                                                 | 应用带校验和与 advisory lock 的迁移  |

数据库集成测试只允许连接明确的测试数据库；测试房间必须使用随机 ID 并在 `afterAll` 精确清理。不得为了验收启动 Compose 或删除不属于当前测试的房间。

### 已存在：物理回归与诊断

```bash
pnpm exec vitest run \
  apps/web/src/__tests__/physics-smoke.test.ts \
  apps/web/src/__tests__/dice-escape.test.ts \
  apps/web/src/__tests__/settle-regression.test.ts \
  apps/web/src/__tests__/freeze-consistency.test.ts \
  apps/web/src/__tests__/contact-cluster-assist.test.ts

pnpm exec vitest run apps/web/src/__tests__/reproduce-seed.test.ts --reporter=verbose
pnpm sweep:jitter -- --seeds=1776310976115,1776311021115
```

这些测试中仍有诊断性或历史上偏宽松的断言。使用它们时必须检查断言是否覆盖本次风险，不能仅看退出码。

### 已存在：长时间 sweep / A/B 工具

| 命令                                             | 当前用途                      |
| ------------------------------------------------ | ----------------------------- |
| `pnpm sweep:param -- --seeds=100`                | 摩擦/恢复系数候选扫描         |
| `pnpm sweep:sleep -- --seeds=100`                | sleep 参数扫描                |
| `pnpm sweep:timeout -- --seeds=100`              | timeout 风险统计              |
| `pnpm sweep:jitter -- --seeds=<逗号分隔seed>`    | 指定失败 seed 的尾段诊断      |
| `pnpm sweep:tilt -- --trials=100`                | 倾斜率统计                    |
| `pnpm sweep:bench -- --frames=300 --rounds=5`    | Box/Chamfer Node 物理相对基准 |
| `pnpm sweep:contact-eq`                          | 接触方程候选扫描              |
| `pnpm sweep:contact-grid`                        | 接触方程网格扫描              |
| `pnpm sweep:contact-validate`                    | 接触方程扩大样本验证          |
| `pnpm sweep:solver-ab -- --seeds=<逗号分隔seed>` | GSSolver/SplitSolver A/B      |
| `pnpm sweep:parallel:core`                       | 并发执行 sleep/timeout/tilt   |
| `pnpm sweep:parallel -- --list`                  | 查看并发 runner 可用任务      |

sweep 通常会向 `logs/` 写 NDJSON 与 summary。它们多数是诊断工具，不天然等于 merge 门禁；先检查脚本是否有有效退出码和与本次目标一致的断言。

### 已落地：统一物理验收

| 命令                              | 用途                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm test:physics`               | 固定 watch seeds 与现有物理回归的提交前门禁                                                               |
| `pnpm test:seed -- --seed=<seed>` | 单 seed 完整复现，输出结构化结算原因、投掷路径和逐帧极值                                                  |
| `pnpm test:acceptance`            | 200 seeds 验收；assist/fallback 预算均为 0，pose-stable 上限 2%，硬失败或其他基线预算回退时返回非零退出码 |
| `pnpm test:physics:ab`            | 交替 A/B、B/A 执行命名 preset，分开 watch/batch cohort，并校验非自然结算的 natural continuation           |
| `pnpm test:physics:cadence`       | versioned cadence comparison v1；比较 reference/cap6/cap4 的 exact 结果、安全与时间守恒，并门禁 overload  |

统一 runner 复用运行时的 `throwDice`、物理世界、逃逸保护和 `checkSettled`，不得在测试中复制一份近似实现。当前单轮 diagnostics schema 为 v4，物理验收报告 schema 为 v3；输出必须包含 commit、Node 版本、算法版本与关键配置，确保 seed 有复现上下文。`runRoll()` 与生产浏览器 `exact-cap6` Engine 复用共享 exact-step session，逐个执行 `world.step(fixed)`；每步按固定顺序采样未介入安全事实、floor tracker、escape guard 与 settle，并以 `simulationStep / simulationTime` 记录真实模拟进度，终态记录 canonical 6-body 完整数组与 Float64 位级签名。`legacy-batched` 仅保留为版本化对照与回滚，不得把其 batched 子步语义重新写回生产默认。NaN、越墙、逃逸保护介入、timeout、帧预算耗尽以及 floor-relaunch tracker 不可用或命中事件都属于硬失败；默认验收同时要求 assist/fallback 为 0、pose-stable 比例不超过 2%，其他倾斜、穿透和结算长尾使用当前基线预算防止回退。

`test:physics:ab` 的 watch cohort 专门保留历史失败 seed，batch cohort 才用于分布和回退预算，避免 watch 过采样污染总体结论。两侧所有非 `natural-sleep` 结果都必须以相同 seed 和投掷算法关闭 assist/pose detector 继续至多 20 秒，对照逐骰面值、倾斜分类、完整奖级与轨迹安全。当前 A/B 报告 schema 为 v4，runtime 与 continuation 都硬门禁 floor-relaunch tracker 不可用或命中事件。

统一 `runRoll()` 每个 Cannon 物理步运行 floor-relaunch tracker v1。每颗骰子先要有至少 2 个连续步骤的真实碗底接触，再有至少 6 个连续步骤的无外部接触支撑（顶点距碗底不超过 0.5mm 也视为支撑），之后的二次离地才进入候选；候选至少持续 2 步，并且 clearance 与按时间顺序计算的 world-Y 抬升都严格大于 5mm 才算事件。条件在首次外部接触前满足便锁存，之后发生的接触不能抹掉事件。sampler 要求碗底 body 只有一个 Heightfield shape，且该 shape 的 offset 为零、orientation 为单位四元数；不满足时必须报告 unavailable。

floor diagnostics 同时记录 `initialContactObservedDiceCount / armedDiceCount` 覆盖量以及 secondary episode 的 floor-only / pre-external 最大值，但 coverage 只用于解释样本，不设比例硬门禁，不能把 0 事件误读成 1200 颗骰子都完整进入检测 armed 状态。当前 200-seed（1200 颗骰子）中，1190 颗观察到所需的真实初始 contact、1158 颗 armed，共 54 个 secondary episode、其中 2 个全程 floor-only，relaunch event 为 0；最大 floor-only clearance / ordered rise 为 2.761mm / 0，最大 pre-external clearance / ordered rise 为 7.795mm / 0。pre-external clearance 单独超过 5mm 不构成事件，必须与 ordered rise 同时严格超过 5mm。旧 seed 171042、25042、146042 的无序高度极差告警已经证明是误报，不能恢复为事件门禁。

### 已落地：浏览器流程与结构性能门禁

| 命令                                      | 用途                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm test:e2e`                           | Playwright 桌面/移动端正常流程、timeout 不提交与同轮恢复、reset、静态零帧及移动布局验收                        |
| `pnpm test:e2e:soak`                      | 生产默认 exact-cap6 桌面/移动各连续 20 轮；门禁提交、调度守恒、安全、静态调度和资源                            |
| `pnpm test:e2e:soak:legacy`               | 显式 legacy-batched 回滚 preset 的桌面/移动 20 轮验收                                                          |
| `pnpm bench:browser`                      | 对 idle/rolling/settled 的 calls、triangles、资源数、DPR/像素预算和静态调度设硬门槛，并输出 JSON/截图 artifact |
| `pnpm bench:browser:render-ab`            | 对固定 5 seeds 交替比较版本化渲染候选，门禁行为/安全等价并保留性能 artifact                                    |
| `pnpm bench:browser:physics-scheduler-ab` | 配对比较 legacy-batched / exact-cap6；行为/安全硬门禁，轨迹分类与性能只观测                                    |
| `pnpm bench:browser:collision-ab`         | 配对比较 cannon-default / projected-aabb-v1；完整物理真值硬门禁，impact 窄相性能按预注册判据评估               |

这些命令会先用 `vite build --mode e2e` 构建隔离产物，再由 Playwright 自动启动并停止严格端口的 preview server。浏览器诊断当前使用 schema v9，必须是带 `schemaVersion / revision / sampleKind: post-render` 的渲染后快照；除 schema v8 已有的 scheduler/accumulator 守恒与 canonical 初末态外，还发布碰撞实验的 `version / explicit / variant`。初末态都以 IEEE-754 Float64 大端字节的 FNV-1a 64 签名锁定 position/quaternion/velocity/angularVelocity，不得用 `toFixed` 或再次消费随机数重建。`?nextSeed=<整数>` 与带版本的 `nextSeeds` 队列只在开发/e2e 模式生效，强制 timeout outcome、调度和碰撞 experiment query 仅在隔离 e2e 构建生效；生产构建忽略这些实验 query，固定使用 `exact-cap6 + cannon-default`。

生产使用 tier-aware rolling DPR：仅当基础质量 `tier=reduced` 时将 rolling 主画布 DPR 限制为 1x；`full` 档 rolling 保持基础 DPR，idle/settled/error 一律恢复由设备 DPR、`1.0～1.5` 范围和 350 万 drawing-buffer 像素预算共同决定的基础 DPR。基础质量档和 1024/512 阴影贴图档不因 rolling DPR 改变，rolling shadow 仍为 `every-frame`。隔离 e2e 的 render experiment v1 只接受预注册的 `baseline / rolling-dpr-1x / shadow-alternate / shadow-frozen`，不是任意生产调参入口；其中 `rolling-dpr-1x` 仍是无条件 1x 的可复现实验候选，不等同于生产 tier-aware 策略。

`bench:browser` 显式使用 `?perfProfile=1&perfProfileVersion=2` 开启固定容量的 rolling CPU profile v2。除 rAF、accumulator、world step、guard、安全、settle、transform、renderer submit、diagnostics publish 与整帧 CPU 指标外，v2 还按 exact step 记录接触/摩擦方程、awake 骰子数及 Cannon 内建 broadphase、narrowphase、约束构造、solve、integrate 五段 CPU 计时，并派生 airborne、首次接触后 500ms impact、结算前 500ms tail 分段；impact 与 tail 允许重叠，不能相加冒充整轮。`rendererSubmitCpuMs` 仍只表示 `renderer.render()` 的同步 CPU submit，不是 GPU 时间。profile 只硬门禁字段完整、数值有限、样本存在和生产 exact 每帧 substeps ≤ 6，所有毫秒分布只写 artifact，不设跨机器阈值。soak 必须逐物理步检查最大半径、真实内壁边界、非有限状态、接触穿透、escape-guard 介入与 accumulator 守恒，不能只看最终位置。当前结构预算集中在 `e2e/helpers/diagnostics.ts`。

碰撞性能实验 v1 只允许 `cannon-default / projected-aabb-v1`。后者以骰子真实凸包顶点在 Heightfield 局部 XY 的投影 AABB 收紧 cell 范围，仍复用并锁定 cannon-es 0.20.0 的 pillar、SAT、contact、friction 与 `justTest` 顺序。Node 侧 200 seeds（含 25042）的完整 `RollRunResult` 与 canonical 终态严格等价；dirty-worktree SwiftShader 浏览器 A/B 每端 5 seeds、20 measured rolls 也全部严格等价。桌面 impact narrowphase p50/p95 中位比为 `0.720000000089407 / 0.8095238101995992`、4/5 seeds 改善，达到预注册判据；移动为 `0.7500000001940256 / 0.8749999995925464`、仅 3/5 改善，未达到至少 4/5 的判据。因此生产仍固定 `cannon-default`，候选只保留为隔离 e2e 实验；该 dirty SwiftShader 结果不是 clean checkpoint 或真实 GPU 结论。

碰撞音频在每次合法投掷/重掷的用户手势栈内先调用 `soundManager.prepare()`，同步创建 AudioContext、触发必要的异步恢复并生成首个碰撞 noise buffer，然后才执行 `throwDice()` 与首个物理步，避免首次 collide 回调把上下文/buffer 初始化成本计入 `world.step()`；静音或 Web Audio 不可用时仍静默降级。当前视觉收口保持原资源预算：rolling 时顶栏关闭大面积背景采样，移除会逐帧重绘阴影的按钮 pulse；移动顶栏、结果卡和桌面侧栏压缩；ResultPanel 的系统“云/兔”字形替换为纯 CSS 细线角纹；海碗使用单张 304KB 横向无缝 WebP 青花纹样，解码与首个纹样渲染完成前由不透明加载页遮住场景并禁用游戏 UI，失败或 8 秒超时则把 wall material 的唯一 map 换成程序化 CanvasTexture。两条路径都只保留一张活动纹理，不增加 mesh、材质、texture 或 shader program 数量。

`bench:browser:render-ab` 对 5 个固定 seed 逐 seed 使用 ABBA/BAAB 交替顺序，比较前先分别 warm-up 两侧，每个 project/comparison 共 20 个 measured rolls。行为结果、投掷计划字段、真实 initial-state v1 数组/签名、结算安全、WebGL context、页面错误和静态零帧属于硬门禁；rAF p95、settlement wall time 与重复噪声只作同环境观测。render A/B artifact schema v2 必须记录完整 HEAD、`worktreeDirty`、porcelain 状态哈希与 HEAD-relative tracked diff 状态/SHA-256，并验证长跑前后 repo state 未变。repository-state schema v2 还会按原始路径稳定哈希未跟踪文件或 symlink 内容，ignored artifact 不进入摘要；正式可归因证据仍必须从 clean worktree 开始，dirty 运行只作探索。durable artifact 写入 `artifacts/render-ab/<project>-<comparison>.json`。

clean checkpoint `6901f4d90e7557f2bdcf2081abffb37952c2f6f5` 的 schema v6 / render artifact schema v2 结果只保留为历史迁移基线。当前 clean checkpoint `e20d359fa18d0954394b23570da8315839e9448f` 的 schema v8 / render artifact schema v2 SwiftShader A/B 四组 start clean、end repository unchanged，流程/正确性 4/4 通过。rolling DPR 桌面/移动 rAF p95 比值中位数为 `0.7667725564854255` / `0.6964818127608844`，均 5/5 改善并达当前判据；`shadow-upper-bound` 为 `0.970057034220532`（3/5）/ `1.0012427506213761`（2/5），两端均未达判据。因此仍只在基础质量 `reduced` 档采用 rolling 1x，`full` 档保持基础 DPR，rolling shadow 仍为 `every-frame`。这些是同一 SwiftShader 环境观测，不是通用 GPU 结论。

不能把 `maxSubSteps` 从 8 裸降为 4 当作性能修复：它会在慢帧下丢弃更多积压模拟时间，seed 25042 已暴露 cadence 分叉风险。生产已改用显式 accumulator，并逐 Cannon 固定步执行 guard、roll safety 与 settle；`exact-cap4` 只用于验证 overload 异常语义，不是生产性能开关。

headless cadence foundation 与 comparison/CLI v1 现在是生产 exact 调度的确定性门禁：`reference-exact / exact-cap6 / exact-cap4` 必须复用同一个 lifecycle 和 exact-step session；versioned cadence 覆盖 60/30Hz、确定性 jitter、单次/持续 100ms 与 visibility suspend。每帧和总量都必须满足 wall/accepted/paused/discarded/executed/queue 守恒；中途结算 backlog 必须记为 terminal abandoned，持续过载必须返回独立 `timing-overload` 且不得生成可提交的正常 roll。`test:physics:cadence` 同时硬门禁 initial/final canonical 6-body state、完整 `RollRunResult`、`JudgeResult`、安全和 accumulator/session 时间守恒。

clean checkpoint `e20d359fa18d0954394b23570da8315839e9448f` 的 cadence artifact `artifacts/cadence/head-e20d359-200-seeds.json` start/end clean unchanged：200 seeds 执行 780/780 runs，normal 560/560、overload 20/20、failure=0；5s hidden 全部归为 paused/discarded，持续 100ms/cap4 在 frame 6、step 20、queue `800/3ms` 时返回 `timing-overload`、`roll=null`。这证明 headless 矩阵内的 exact 真值、安全和异常语义，不证明浏览器性能或真实 OS/tab visibility 已验收。

生产 Engine 默认 `exact-cap6`，使用 `game/fixed-step-accumulator.ts` 与共享 session 显式分类 accepted/paused/discarded wall time、逐步消费 backlog，并在 250ms 高水位锁存 overload。`document.visibilitychange` 已接线；timeout/overload 均进入显式 `error`，冻结 raw 终态且不读面、不提交业务结果。生产构建忽略 scheduler query，`legacy-batched` 仅供隔离 e2e 对照/回滚。

clean `e20d359` 的 schema v8 浏览器门禁结果保留为迁移前基线：`test:e2e` 8/8、`bench:browser` 2/2；legacy rollback soak 2/2；scheduler A/B v2 的 5 seeds 在两端结果/奖级/结算路径/安全等价，但 `trajectoryEquivalentSeedCount=0`，性能只作 observation-only。当前美术/音频/profile 变更对应 clean checkpoint `1060095c10c1d688ba1f1855f2f00ba799179407`：schema v9 production-default soak start/end clean unchanged，桌面/移动各 20 轮均 20 natural，耗时 66.222s / 57.235s，最大 terminal queue 97.3ms / 59.7667ms，最大半径/穿透 `0.6571491133m / 0.0548978013m`，boundary/wall/guard/non-finite/页面错误为 0，资源保持 `1 canvas / 8 geometries / 6 textures / 10 warmed programs`。这些 wall time 仍只是同一环境观察，不是通用 FPS 预算。

手工 Chrome 单轮确认无 query 为 `explicit=false / exact-cap6`：seed 50000 natural-sleep@2.1333s/128 steps，3D 可见面与 UI 同为 `1,5,6,6,4,4`，判“二举，带18”，重置后回第 1 轮且结果/历史清空。用户于 2026-08-14 另行确认了真实 OS/tab 隐藏恢复、当前真实设备画面、连续 20 轮无异常弹跳、移动视觉与高频碰撞听感这五项人工验收；这些是用户报告的主观/操作证据，不得冒充带设备、浏览器、电源、DPR 与 trace 元数据的受控性能实验。本轮最新 UI/材质已由 schema v9 `bench:browser` 保存并人工复核桌面/移动 settled 截图；不同浏览器与更多记录 GPU/驱动的真实设备受控对比仍需另行保留证据。

---

## 按改动范围选择门禁

- **规则/读面**：定向测试 → 非法输入/边界属性测试 → `pnpm test` → `pnpm lint` → `pnpm build`。
- **物理/投掷/停稳/引擎**：失败 seed → 相关物理测试 → 同条件 A/B sweep → 全量测试/静态/构建 → 桌面与移动端连续多轮手工验收。
- **UI/状态机/音效**：组件与 controller/store 定向测试 → 全量测试/构建 → 桌面与移动端完整交互；涉及 3D 生命周期时同时检查 idle/rolling/settled 性能与资源释放。
- **纯性能优化**：先证明行为不变或明确允许的行为变化，再提交同机 A/B；不能用不稳定 CI 的绝对耗时作为唯一证据。
- **文档修改**：核对实际文件、脚本和运行时；执行 `git diff --check`，不得把目标命令写成已存在命令。

最终验收的强度应与风险成比例。P0 物理改动不能只靠单元测试，纯文案改动也不要求无关长时间 sweep。
