# 闽南博饼 Web 小游戏

一个使用 Three.js + cannon-es 实现的中秋博饼小游戏。

项目当前优先级是先把核心玩法、物理稳定性、结算可靠性和移动端可用性做扎实，再逐步补齐最终视觉素材。

## 当前状态

- 已完成 6 颗骰子的投掷、碰撞、停稳检测、点数读取与博饼奖级判定
- 已完成当轮结果、累计奖级记录、最近 5 轮历史、音效生命周期、timeout 异常恢复与重置流程
- 已完成移动端真实上下布局，不再使用可拖拽底部浮层
- 已完成桌面程序化木纹占位与海碗程序化青花占位
- 当前 THROW v3 默认投掷为 `stratified-ring`（六槽、随机整体旋转与槽位分配）；SETTLE v4 中 contact-cluster assist 默认关闭
- 已落地统一物理 runner、命名 variant A/B、单 seed 复现、200-seed 验收、floor-relaunch 事件门禁、浏览器结构/CPU profile 门禁与连续 20 轮 soak
- 生产当前仅让基础质量 `tier=reduced` 的高像素视口在 rolling 降至 1x；`full` 档保持基础 DPR，static 一律恢复基础 1.0～1.5 DPR 与 350 万像素预算；阴影仍逐 rolling render 刷新
- 当前运行时场景只接入桌面、海碗和骰子；灯笼、月饼等摆件不在当前推进范围内
- 后续视觉方向优先是桌布方案与正式海碗纹样素材，而不是重做桌体或继续扩展桌面摆件

## 核心特性

- Three.js 命令式场景搭建，不使用 R3F
- cannon-es 固定时间步长物理模拟，渲染循环与物理解耦
- Heightfield 连续碗底 + 竖直挡墙的碗碰撞体方案，不依赖 Trimesh
- 基于六面法线与世界 up 向量点积的稳定点数读取
- 可观测的 natural sleep、低速窗口、只读 pose-stable、历史 cluster-assist 与 timeout 停稳路径
- 投掷 layout/dynamics 使用独立可复现随机子流；普通运行由时间种子 mulberry32 驱动，不使用 `Math.random`
- 奖级规则数据驱动，支持状元子级优先级与带数规则
- React + Zustand DOM overlay UI，业务写入集中在 GameController
- 开发/e2e 使用 schema v6 post-render diagnostics，记录引擎调度、投掷计划、throw 后 6-body 初始 pose/速度的 Float64 位级签名、渲染实验/质量/阴影、结构与逐步物理安全包络；隔离 bench 可显式启用 rolling CPU profile v1

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

| 命令                              | 说明                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                        | 启动 Vite 开发服务器                                                |
| `pnpm build`                      | TypeScript 构建 + 生产打包                                          |
| `pnpm preview`                    | 本地预览生产构建结果                                                |
| `pnpm lint`                       | 运行 ESLint                                                         |
| `pnpm test`                       | 运行 Vitest 全量测试                                                |
| `pnpm test:watch`                 | 以 watch 模式运行 Vitest                                            |
| `pnpm test:physics`               | 运行固定 watch seeds 与快速物理回归                                 |
| `pnpm test:seed -- --seed=<seed>` | 用统一 runner 复现单个 seed 并输出结构化诊断                        |
| `pnpm test:acceptance`            | 运行默认 200-seed 物理预算门禁                                      |
| `pnpm test:physics:ab`            | 交替运行命名 A/B preset、watch/batch cohort 与 natural continuation |
| `pnpm test:e2e`                   | 运行 Playwright 桌面/移动端真实流程门禁                             |
| `pnpm test:e2e:soak`              | 桌面/移动各连续 20 轮，检查安全包络、状态提交与 WebGL 资源稳定      |
| `pnpm bench:browser`              | 门禁渲染结构与 profile 完整性/substeps，毫秒仅写 JSON/截图 artifact |
| `pnpm bench:browser:render-ab`    | 5 seeds × ABBA/BAAB 配对渲染 A/B，行为/安全硬门禁、毫秒仅观测       |
| `pnpm sweep:parallel:core`        | 并发执行 sleep / timeout / tilt 三类核心 sweep                      |

## 文档索引

| 文档                                 | 用途                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| [AGENTS.md](./AGENTS.md)             | 项目目标、当前视觉方向、开发约束与工作流                |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构、数据流、状态机、碰撞体方案、测试与 sweep 策略 |
| [CHECKLIST.md](./CHECKLIST.md)       | 分阶段开发清单                                          |
| [UI-CHECKLIST.md](./UI-CHECKLIST.md) | UI 收敛项、移动端布局不变量、海碗与桌布素材待办         |

## 当前视觉路线

- 海碗：当前使用程序化青花纹样占位，后续替换正式素材
- 桌面：当前保留程序化木纹与圈层，占位即可
- 桌体：当前不再推进“重做方形中式木桌”路线
- 桌面装饰：灯笼、月饼等 3D 摆件暂不推进
- 后续重点：桌布方案、正式海碗纹样、图标和字体收口

海碗正式素材的尺寸、比例、格式与无缝要求，见 [UI-CHECKLIST.md](./UI-CHECKLIST.md) 的“海碗素材规范”。

## 玩法流程

1. 点击“掷骰”后，6 颗骰子从碗上方投入
2. 引擎统一驱动物理步进、mesh 同步、停稳检测和渲染
3. 若发生 timeout，进入显式 error：不读点、不判奖、不写记录，用户可同轮重新掷骰或重置
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
- Web Audio 懒创建、静音、节流/并发、异常降级与 dispose/remount 生命周期
- 真实物理烟雾、逃逸防护、冻结一致性
- 接触簇辅助的历史显式 variant 与默认禁用契约

`test:acceptance` 当前输出 acceptance report schema v3 / roll diagnostics schema v3。`runRoll()` 通过共享 exact-step session 逐个执行 Cannon 固定步，并以 `simulationStep / simulationTime` 记录真实模拟进度；浏览器 Engine 仍使用旧 batched 调度。默认预算要求 assist/fallback 均为 0、pose-stable 不超过 2%，并将 floor-relaunch tracker v1 不可用或命中事件设为硬失败。tracker 要求先建立 2 个真实 floor-contact 步与 6 个 clean-support 步，再对至少 2 步的二次离地同时检查 clearance 和 ordered world-Y rise 严格大于 5mm；sampler 要求碗底只有一个无 shape offset/orientation 的 Heightfield。当前 200 seeds 全部自然停稳；1200 颗骰子中 initial contact observed=1190、armed=1158，secondary episode=54、floor-only=2、event=0；最大 floor-only clearance/ordered rise=2.761mm/0，最大 pre-external clearance/ordered rise=7.795mm/0。coverage 与最大值只记录、不硬门禁，7.795mm clearance 单项超过阈值也不构成事件；两项必须同时超过 5mm。seed 25042 锁定为 step 460 / 7.6667s、骰面 `2,1,2,1,4,5`；旧 seed 171042、25042、146042 的无序高度极差仍属于误报回归。`test:physics:ab` 使用 report schema v4，将历史问题 seed 与批量 seed 分成 watch/batch cohort，对 runtime/continuation 同样门禁 tracker，并对每个非自然结算运行最多 20 秒的同 seed 自然延续对照。完整口径与当前逻辑基线见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

`bench:browser` 只在隔离 e2e URL 显式使用 `perfProfile=1&perfProfileVersion=1` 时启用固定容量的 rolling CPU profile v1，记录 rAF 原始/截断间隔、Cannon 实际 substep，以及 world step、guard、roll safety、settle、transform sync、renderer submit、diagnostics publish 和 tick total 的 count/p50/p95/max。renderer 指标仅为同步 CPU submit，不代表 GPU；门禁只要求字段完整、数值有限、样本存在和每帧 substeps ≤ 8，毫秒数据只进入 artifact，不设置跨机器阈值。

`bench:browser:render-ab` 使用 render experiment v1 的预注册 `baseline / rolling-dpr-1x / shadow-alternate / shadow-frozen`，每侧先 warm-up，再对 5 个固定 seed 按 ABBA/BAAB 交替，每个 project/comparison 记录 20 个 measured rolls。投掷计划与 throw 后、首个物理步前的 6-body position/quaternion/velocity/angularVelocity 数组和 Float64 位级签名必须一致；稳定结果、物理安全、页面/context 错误和静态零帧也是硬门禁。render A/B artifact schema v2 同时记录完整 HEAD、工作树 dirty 状态、porcelain 哈希与 tracked diff 状态/SHA-256，并校验长跑前后 repo state 未变。repository-state schema v2 还会稳定哈希未跟踪普通文件内容与 symlink 目标，ignored artifact 不进入摘要；正式可归因证据仍必须从 clean worktree 开始，dirty 运行只作探索。rAF p95、wall time 和重复噪声只作同环境观测；durable artifact 位于 `artifacts/render-ab/<project>-<comparison>.json`。

clean checkpoint `6901f4d90e7557f2bdcf2081abffb37952c2f6f5` 的 schema v6 / render artifact schema v2 SwiftShader A/B 4/4 通过流程/正确性硬门禁；四组均从 clean worktree 开始、结束时 repository state unchanged，并且 `behaviorViolation=0`、`schedulerSensitive=0`。这不表示四组性能都达标。桌面 rolling DPR 的 rAF p95 比值中位数为 `0.7864364941630467`，5/5 改善，repeat noise `0.06133911408891464`，达到预设判据；移动为 `0.6095156450921579`，5/5 改善，noise `0.14689147459021826`，也达到预设判据。`shadow-upper-bound` 桌面为 `1.0494708050897847`、1/5 改善、noise `0.07463589364039669`，移动为 `0.8414403032217315`、4/5 改善、noise `0.419728670053531`，两端都未达判据。生产仍只在基础质量 `reduced` 档应用 rolling 1x，`full` 档 rolling 保持基础 DPR，static 一律恢复基础 DPR；阴影保持 every-frame，不推进 alternate。实验 v1 的 `rolling-dpr-1x` 仍是无条件 1x 候选，不能把它与 tier-aware 生产策略混为一谈。交互 Chrome 单 seed 的 17.6ms vs 33ms 与视觉/static 恢复核对只是补充观察，不是通用 GPU 结论。

`maxSubSteps` 从 8 裸降到 4 已被排除：慢帧下会丢弃更多积压模拟时间，seed 25042 暴露了 cadence 分叉风险。后续物理追帧优化应改为显式 accumulator，并在每个 Cannon 子步执行 guard、roll safety 与 settle 检测，再以固定 seed 的多种帧调度序列验收。

当前已落地未接生产的 headless cadence foundation v1：`reference-exact / exact-cap6 / exact-cap4` 共用唯一投掷 lifecycle 与 exact-step session，并覆盖 60/30Hz、确定性 jitter、单次/持续 100ms 与 visibility suspend。runner 对每帧及总量执行时间守恒门禁，中途结算 backlog 明确标为 abandoned；cap4 持续 100ms 会在 250ms 高水位进入独立 `timing-overload` 且不生成正常 roll。现阶段只有直接测试中的 4 个 watch seed 等价证据；200-seed comparison/CLI、canonical final-body state 与浏览器 timing experiment 仍未落地，因此生产 Engine 继续使用旧 batched 调度。

仓库已加入未接入生产的 fixed-step accumulator v1 纯状态机，用单元测试锁定 wall-time 分类、backlog 守恒、cap4 跨帧追赶、early-stop、pause、插值余量和显式 overload。当前运行时仍使用原 Engine/Cannon 批处理链路；只有 exact-step cap6/cap4 的多 cadence A/B、异常流程和浏览器门禁全部通过后，才会考虑切换生产默认。

最终 tier-aware 策略的 schema v5 浏览器门禁已重跑：`test:e2e` 4/4、`bench:browser` 桌面/移动 2/2 通过。桌面 `reduced` 档从 idle/settled 的 3,498,014 pixels、DPR `1.445028` 降至 rolling 的 1,676,160 pixels、DPR 1；移动 `full` 档 idle/rolling 均为 562,185 pixels、DPR 1.5，settled 仅因 CSS 布局变化为 414,765 pixels，DPR 仍为 1.5。rolling shadow 请求与真实渲染帧一致，桌面 17/17、移动 19/19。`test:e2e:soak` 桌面/移动各 20 轮 2/2 通过：桌面 77.181s、17 natural / 3 stable、最长 8.346s、最大半径/穿透 0.6567970953m/0.0548978013m；移动 55.144s、20 natural、最长 3.299s、最大半径/穿透 0.6555080668m/0.0536350029m。两端 boundary/wall/guard/non-finite/页面错误均为 0，资源每轮稳定为 `1/8/6/10`。wall time 只作本次环境观察；此前全视口 rolling 1x 与 schema v4 数据仅为历史 checkpoint。

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

- 继续收敛桌面端与移动端的间距、层级和遮挡关系
- 完成海碗正式青花纹样接入
- 设计桌布方案并与当前圆桌占位整合
- 补齐图标、字体和其他最终素材
