# 闽南博饼 Web 小游戏

一个使用 Three.js + cannon-es 实现的中秋博饼小游戏。

项目当前优先级是先把核心玩法、物理稳定性、结算可靠性和移动端可用性做扎实，再逐步补齐最终视觉素材。

## 当前状态

- 已完成 6 颗骰子的投掷、碰撞、停稳检测、点数读取与博饼奖级判定
- 已完成当轮结果、累计奖级记录、最近 5 轮历史、音效生命周期、timeout 异常恢复与重置流程
- 已完成移动端真实上下布局，不再使用可拖拽底部浮层
- 已完成桌面程序化木纹与海碗程序化青花的第一轮低 GPU 收口：复用既有 CanvasTexture/几何/材质数量，细化长向木纹、无缝云头/折枝纹与瓷釉参数
- 当前 THROW v3 默认投掷为 `stratified-ring`（六槽、随机整体旋转与槽位分配）；SETTLE v4 中 contact-cluster assist 默认关闭
- 已落地统一物理 runner、命名 variant A/B、单 seed 复现、200-seed 验收、headless cadence comparison v1、floor-relaunch 事件门禁、浏览器结构/CPU profile 门禁与连续 20 轮 soak
- 生产物理调度默认使用 `exact-cap6`：显式 accumulator 逐 Cannon 固定步执行共享 session、安全采样与停稳检测；`legacy-batched` 只保留为版本化 A/B 与回滚 preset
- 生产碰撞窄相仍使用 `cannon-default`；`projected-aabb-v1` 只保留为隔离 e2e 实验，因为桌面 A/B 达标而移动仅 3/5 seeds 改善、未达预注册标准
- 生产当前仅让基础质量 `tier=reduced` 的高像素视口在 rolling 降至 1x；`full` 档保持基础 DPR，static 一律恢复基础 1.0～1.5 DPR 与 350 万像素预算；阴影仍逐 rolling render 刷新
- 碰撞音频在合法投掷/重掷的用户手势内、throw 与首个物理步前调用 `prepare()` 预热 AudioContext/noise buffer，避免首次 collide 回调承担初始化成本
- 当前运行时场景只接入桌面、海碗和骰子；灯笼、月饼等摆件不在当前推进范围内
- 后续视觉方向优先是桌布方案与正式海碗纹样素材，而不是重做桌体或继续扩展桌面摆件

## 核心特性

- Three.js 命令式场景搭建，不使用 R3F
- cannon-es 固定时间步长物理模拟；生产 Engine 通过 `exact-cap6` accumulator 逐步推进，渲染循环与物理解耦
- Heightfield 连续碗底 + 竖直挡墙的碗碰撞体方案，不依赖 Trimesh
- 基于六面法线与世界 up 向量点积的稳定点数读取
- 可观测的 natural sleep、低速窗口、只读 pose-stable、历史 cluster-assist 与 timeout 停稳路径
- 投掷 layout/dynamics 使用独立可复现随机子流；普通运行由时间种子 mulberry32 驱动，不使用 `Math.random`
- 奖级规则数据驱动，支持状元子级优先级与带数规则
- React + Zustand DOM overlay UI，业务写入集中在 GameController
- 开发/e2e 使用 schema v9 post-render diagnostics，记录调度与碰撞 experiment、时间守恒、投掷计划、canonical 6-body 初末态、渲染质量/阴影、结构与逐步安全包络；隔离 bench 可显式启用 rolling CPU profile v2，按逐 rAF/逐 exact-step 与 airborne/impact/tail 阶段记录 CPU 诊断

## 技术栈

| 层面     | 选型                     |
| -------- | ------------------------ |
| 工程基座 | Vite + TypeScript        |
| UI       | React 19                 |
| 状态管理 | Zustand                  |
| 3D 渲染  | Three.js                 |
| 物理引擎 | cannon-es                |
| 测试     | Vitest + Playwright      |
| 样式     | 原生 CSS + CSS Variables |

## 快速开始

```bash
pnpm install
pnpm dev --host
```

默认开发地址通常是：

```text
http://127.0.0.1:5173
```

## 常用命令

| 命令                                      | 说明                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                                | 启动 Vite 开发服务器                                                   |
| `pnpm build`                              | TypeScript 构建 + 生产打包                                             |
| `pnpm preview`                            | 本地预览生产构建结果                                                   |
| `pnpm lint`                               | 运行 ESLint                                                            |
| `pnpm test`                               | 运行 Vitest 全量测试                                                   |
| `pnpm test:watch`                         | 以 watch 模式运行 Vitest                                               |
| `pnpm test:physics`                       | 运行固定 watch seeds 与快速物理回归                                    |
| `pnpm test:seed -- --seed=<seed>`         | 用统一 runner 复现单个 seed 并输出结构化诊断                           |
| `pnpm test:acceptance`                    | 运行默认 200-seed 物理预算门禁                                         |
| `pnpm test:physics:ab`                    | 交替运行命名 A/B preset、watch/batch cohort 与 natural continuation    |
| `pnpm test:physics:cadence`               | 运行 versioned headless cadence exact 等价、安全、守恒与 overload 门禁 |
| `pnpm test:e2e`                           | 运行 Playwright 桌面/移动端真实流程门禁                                |
| `pnpm test:e2e:soak`                      | 以生产默认 exact-cap6 在桌面/移动各连续 20 轮，门禁流程、安全与资源    |
| `pnpm test:e2e:soak:legacy`               | 显式使用 legacy-batched 回滚 preset 运行桌面/移动 20 轮对照            |
| `pnpm bench:browser`                      | 门禁渲染结构与 profile 完整性/substeps，毫秒仅写 JSON/截图 artifact    |
| `pnpm bench:browser:render-ab`            | 5 seeds × ABBA/BAAB 配对渲染 A/B，行为/安全硬门禁、毫秒仅观测          |
| `pnpm bench:browser:physics-scheduler-ab` | 配对比较 legacy-batched / exact-cap6 的行为、轨迹与同环境性能观测      |
| `pnpm bench:browser:collision-ab`         | 配对比较 cannon-default / projected-aabb-v1 的完整真值与 impact 窄相   |
| `pnpm sweep:parallel:core`                | 并发执行 sleep / timeout / tilt 三类核心 sweep                         |

## 文档索引

| 文档                                 | 用途                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| [AGENTS.md](./AGENTS.md)             | 项目目标、当前视觉方向、开发约束与工作流                |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构、数据流、状态机、碰撞体方案、测试与 sweep 策略 |
| [CHECKLIST.md](./CHECKLIST.md)       | 分阶段开发清单                                          |
| [UI-CHECKLIST.md](./UI-CHECKLIST.md) | UI 收敛项、移动端布局不变量、海碗与桌布素材待办         |

## 当前视觉路线

- 海碗：程序化青花已完成第一轮收口，以无缝云头/细折枝带替代大团花，并柔化瓷釉硬高光；后续仍替换正式素材
- 桌面：程序化木纹改为更细密的长向纹与少量淡年轮，降低既有圈层透明度；仍只使用一张 CanvasTexture
- UI：rolling 顶栏关闭大面积 blur、移除逐帧阴影 pulse，桌面侧栏/短视口结果卡/移动单行顶栏完成首轮压缩；结果卡角饰改为纯 CSS 细线纹，避免系统字符字形差异
- 桌体：当前不再推进“重做方形中式木桌”路线
- 桌面装饰：灯笼、月饼等 3D 摆件暂不推进
- 后续重点：补不同浏览器/真实 GPU 受控复核，再推进桌布方案、正式海碗纹样、图标和字体收口；本轮最终桌面/移动 settled 截图已由 schema v9 `bench:browser` 保存并人工复核

海碗正式素材的尺寸、比例、格式与无缝要求，见 [UI-CHECKLIST.md](./UI-CHECKLIST.md) 的“海碗素材规范”。

## 玩法流程

1. 点击“掷骰”后，6 颗骰子从碗上方投入
2. 引擎用 exact accumulator 逐固定步驱动物理、安全检测与停稳，再同步 mesh 和渲染
3. 若发生 timeout 或 timing-overload，进入显式 error：不读点、不判奖、不写记录，用户可同轮重新掷骰或重置
4. 可信停稳后读取每颗骰子朝上点数，并根据博饼规则计算最高优先级奖级
5. 若存在倾斜骰子，进入 tilt-confirm；否则直接提交结果
6. UI 展示当轮结果、累计奖级记录和最近 5 轮历史

## 测试与 sweep

`pnpm test` 覆盖的重点包括：

- 奖级判定与带数规则
- 点数读取与朝向扰动
- 停稳检测与回归种子
- 默认分层环形投掷、layout/dynamics 随机子流和历史 sampler 兼容
- 控制流、timeout/error 恢复、重复结算幂等、倾斜确认与提交后音效行为
- Web Audio 投掷前 prepare、静音、节流/并发、异常降级与 dispose/remount 生命周期
- 真实物理烟雾、逃逸防护、冻结一致性
- 接触簇辅助的历史显式 variant 与默认禁用契约
- Heightfield projected-AABB 候选的 step/justTest differential 与 200-seed 完整结果/canonical 严格等价

`test:acceptance` 当前输出 acceptance report schema v3 / roll diagnostics schema v4。`runRoll()` 与生产 `exact-cap6` Engine 复用 exact-step session，逐个执行 Cannon 固定步，并以 `simulationStep / simulationTime` 记录真实模拟进度；最终同时记录 canonical 6-body 完整 pose/线速度/角速度数组与 Float64 位级签名。默认预算要求 assist/fallback 均为 0、pose-stable 不超过 2%，并将 floor-relaunch tracker v1 不可用或命中事件设为硬失败。tracker 要求先建立 2 个真实 floor-contact 步与 6 个 clean-support 步，再对至少 2 步的二次离地同时检查 clearance 和 ordered world-Y rise 严格大于 5mm；sampler 要求碗底只有一个无 shape offset/orientation 的 Heightfield。当前 200 seeds 全部自然停稳；1200 颗骰子中 initial contact observed=1190、armed=1158，secondary episode=54、floor-only=2、event=0；最大 floor-only clearance/ordered rise=2.761mm/0，最大 pre-external clearance/ordered rise=7.795mm/0。coverage 与最大值只记录、不硬门禁，7.795mm clearance 单项超过阈值也不构成事件；两项必须同时超过 5mm。seed 25042 锁定为 step 460 / 7.6667s、骰面 `2,1,2,1,4,5`、final hash `ca710327c6d45df3`；旧 seed 171042、25042、146042 的无序高度极差仍属于误报回归。`test:physics:ab` 使用 report schema v4，将历史问题 seed 与批量 seed 分成 watch/batch cohort，对 runtime/continuation 同样门禁 tracker，并对每个非自然结算运行最多 20 秒的同 seed 自然延续对照。完整口径与当前逻辑基线见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

`bench:browser` 只在隔离 e2e URL 显式使用 `perfProfile=1&perfProfileVersion=2` 时启用固定容量的 rolling CPU profile v2。除 rAF、accumulator 和各帧 CPU 阶段外，v2 还保留逐 rAF simulation step/time、逐 exact-step 接触/摩擦方程与 awake 骰子数，以及 Cannon 内建 broadphase、narrowphase、make-contact-constraints、solve、integrate 计时，并派生 airborne、首次接触后 500ms impact 与结算前 500ms tail；impact/tail 可重叠。renderer 指标仅为同步 CPU submit，不代表 GPU；门禁只要求字段完整、数值有限、样本存在和生产 exact 每帧 substeps ≤ 6，毫秒数据只进入 artifact，不设置跨机器阈值。

`bench:browser:render-ab` 使用 render experiment v1 的预注册 `baseline / rolling-dpr-1x / shadow-alternate / shadow-frozen`，每侧先 warm-up，再对 5 个固定 seed 按 ABBA/BAAB 交替，每个 project/comparison 记录 20 个 measured rolls。投掷计划与 throw 后、首个物理步前的 6-body position/quaternion/velocity/angularVelocity 数组和 Float64 位级签名必须一致；稳定结果、物理安全、页面/context 错误和静态零帧也是硬门禁。render A/B artifact schema v2 同时记录完整 HEAD、工作树 dirty 状态、porcelain 哈希与 tracked diff 状态/SHA-256，并校验长跑前后 repo state 未变。repository-state schema v2 还会稳定哈希未跟踪普通文件内容与 symlink 目标，ignored artifact 不进入摘要；正式可归因证据仍必须从 clean worktree 开始，dirty 运行只作探索。rAF p95、wall time 和重复噪声只作同环境观测；durable artifact 位于 `artifacts/render-ab/<project>-<comparison>.json`。

历史 clean checkpoint `6901f4d90e7557f2bdcf2081abffb37952c2f6f5` 的 schema v6 / render artifact schema v2 SwiftShader A/B 4/4 通过流程/正确性硬门禁；这组旧数据保留作迁移前基线，不代表当前 schema。当前 clean checkpoint `e20d359fa18d0954394b23570da8315839e9448f` 的 schema v8 / render artifact schema v2 再次 4/4 通过且 start clean、end unchanged：桌面/移动 rolling DPR 的 rAF p95 比值中位数分别为 `0.7667725564854255` / `0.6964818128`，均 5/5 改善；桌面/移动 shadow upper-bound 分别为 `0.9700570342`（3/5）/ `1.0012427506`（2/5），均未达判据。所有毫秒与比值都只是同一 SwiftShader 环境的观测，不是通用 GPU 结论；生产继续只在 `reduced` 档 rolling 使用 1x，`full` 档保持基础 DPR，阴影保持 every-frame。

`bench:browser:collision-ab` 使用 collision experiment v1 对 `cannon-default / projected-aabb-v1` 运行固定 5 seeds、ABBA/BAAB、每端 20 measured rolls，并硬门禁投掷计划、canonical 初末态、点数/奖级/带数、结算路径/模拟进度、安全与渲染结构。当前探索性 artifact 从 dirty worktree 开始、运行前后 state unchanged：桌面 impact narrowphase p50/p95 中位比为 `0.720000000089407 / 0.8095238101995992`、4/5 seeds 改善，达到预注册判据；移动为 `0.7500000001940256 / 0.8749999995925464`、仅 3/5 改善，未达到至少 4/5 的标准。因此生产仍为 `cannon-default`，候选不自动推进；这不是 clean/durable production attribution，也不是不同浏览器或真实 GPU 结论。

`maxSubSteps` 从 8 裸降到 4 已被排除：慢帧下会丢弃更多积压模拟时间，seed 25042 暴露了 cadence 分叉风险。生产现已采用显式 accumulator，并在每个 Cannon 子步执行 guard、roll safety 与 settle 检测；`exact-cap4` 只保留为 overload 实验，不是生产性能开关。

headless cadence foundation 与 comparison/CLI v1 继续作为生产调度的确定性门禁：`reference-exact / exact-cap6 / exact-cap4` 共用唯一投掷 lifecycle 与 exact-step session，并覆盖 60/30Hz、确定性 jitter、单次/持续 100ms 与 visibility suspend。runner 对每帧及总量执行时间守恒门禁，中途结算 backlog 明确标为 abandoned；正常候选 exact 比较 initial-state、canonical final-state、完整 `RollRunResult`、`JudgeResult` 与安全事实，cap4 持续 100ms 则进入独立 `timing-overload` 且不生成正常 roll。

clean checkpoint `e20d359fa18d0954394b23570da8315839e9448f` 的 cadence artifact 为 `artifacts/cadence/head-e20d359-200-seeds.json`，start/end clean unchanged；200 seeds 完成 780/780 runs，normal 560/560、overload 20/20、failure=0。visibility cadence 的 5s hidden 时间全部归入 paused/discarded；持续 100ms/cap4 在第 6 帧、执行 20 步后以 `800/3ms` queue 返回 `timing-overload` 且 `roll=null`。这证明当前 exact 调度在该 headless 矩阵内的真值、安全与守恒，不是浏览器 FPS 结论，也不等同于真实操作系统 tab visibility 生命周期验收。

生产 Engine 默认 `exact-cap6`，使用 fixed-step accumulator v1 与共享 roll-step session 逐步推进；wall-time 分类、backlog/terminal-abandoned 守恒、逐步安全事实和姿态、pause/resume 与 250ms 高水位均发布到 schema v9。schema v9 还记录 collision experiment，生产无 query 时为 `explicit=false / cannon-default`。超过高水位或 timeout 时 Engine 与 controller 进入显式 `error`，不读面、不提交奖级；`legacy-batched` 与 `projected-aabb-v1` 仅为 e2e 版本化对照，生产构建忽略相关 URL 参数。

clean `e20d359` 的 schema v8 浏览器门禁已完成：`test:e2e` 8/8、`bench:browser` 2/2；生产默认 `test:e2e:soak` 桌面/移动各 20 轮均为 20 natural，耗时 72.794s / 53.628s，最大 terminal queue 86.8993ms / 56.2333ms，最大半径 `0.6571491133m`、最大接触穿透 `0.0548978013m`，boundary/wall/guard/non-finite/页面错误均为 0，WebGL 资源无增长。显式 `test:e2e:soak:legacy` 也 2/2 通过，只验证回滚可用性。scheduler A/B v2 的 5 seeds 在桌面/移动都保持结果、奖级、结算路径和安全等价，但 `trajectoryEquivalentSeedCount=0`；exact 在重复 cadence 下比 legacy 更稳定。桌面/移动 rAF p95 比值中位数为 `0.9865359286` / `0.9161676647`，wall 比值为 `0.9493557614` / `1.0074334792`，仅作同环境 observation，不宣称普适性能提升或轨迹等价。

当前自动化已经覆盖模拟 visibility cadence 和 DOM `visibilitychange` 生命周期/解绑。用户于 2026-08-14 另行确认此前列出的五个人工项可接受：真实 OS/tab 隐藏恢复、当前真实设备画面、连续 20 轮无异常弹跳、移动视觉与高频碰撞听感。这些是用户报告的操作/主观证据，不带浏览器、GPU/驱动、电源、DPR、音量或 trace 元数据；本轮最新 UI/程序化材质已有 schema v9 桌面/移动 settled 截图，仍需补不同浏览器与更多真实 GPU 的受控对比。

手工 Chrome 单轮补充核对了无 query 的 `explicit=false / exact-cap6`：seed 50000 以 `natural-sleep` 在 2.1333s / 128 steps 结算，可见 3D 骰面与 UI 均为 `1,5,6,6,4,4`，判定“二举，带18”，重置后回到第 1 轮并清空结果/历史。该单轮只补充视觉与交互证据，不替代批量门禁。

`sweep/` 目录下保留了长时间运行的参数扫描和诊断脚本，例如：

- `pnpm sweep:param`
- `pnpm sweep:sleep`
- `pnpm sweep:timeout`
- `pnpm sweep:jitter`
- `pnpm sweep:tilt`
- `pnpm sweep:bench`

这些脚本不属于日常 `pnpm test` 套件，主要用于参数调优、风险统计和问题复现。

## 项目结构概览

```text
src/
├── App.tsx                    # 入口 UI 组合：GameViewport + GameOverlay
├── config/                    # 物理、投掷、停稳、UI 常量
├── game/                      # engine / controller / store
├── scene/                     # 场景、桌面、海碗
├── physics/                   # world、碗碰撞体、接触材质
├── dice/                      # 骰子创建、投掷、停稳、读面、碰撞体
├── rules/                     # 奖级类型、规则表、判定逻辑
├── ui/                        # 组件与样式
├── audio/                     # 音效管理
└── __tests__/                 # 单元、集成、物理烟雾与回归测试
```

## 开发说明

- UI 是 DOM overlay，Three.js 和 cannon-es 维持命令式调用
- 不要把业务流程分散写进 UI 组件，写入统一走 GameController
- 可调参数优先放在 `src/config/` 下，不要散落在运行时代码里
- 视觉可先使用占位资源推进，但不要为占位视觉反向修改业务流或碰撞结构

## 后续计划

- 对本轮已保存的桌面/移动截图继续做不同浏览器与记录设备信息的真实 GPU 复核
- 在当前首轮布局收口基础上继续微调特殊短视口的层级和遮挡关系
- 完成海碗正式青花纹样接入
- 设计桌布方案并与当前圆桌占位整合
- 补齐图标、字体和其他最终素材
