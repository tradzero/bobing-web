# 博饼小游戏 - 技术架构

## 技术栈

| 层面     | 选型                               | 版本策略      |
| -------- | ---------------------------------- | ------------- |
| 工程基座 | Vite + TypeScript                  | latest stable |
| 包管理   | pnpm                               | latest stable |
| UI 层    | React                              | 19.x          |
| 状态管理 | Zustand                            | 5.x           |
| 3D 渲染  | Three.js（原生命令式，不使用 R3F） | latest stable |
| 物理引擎 | cannon-es（原生命令式）            | latest stable |
| 测试     | Vitest + Playwright                | latest stable |
| CSS      | 原生 CSS 文件 + CSS Variables      | —             |

## 架构原则

1. **React 不侵入 3D 层**：Three.js 和 cannon-es 保持命令式调用，React 只负责 DOM UI overlay。Canvas 容器由 GameViewport 组件提供 ref，引擎实例的创建和销毁在该组件的 useEffect 中完成。GameViewport 接受 children，内部通过 GameControllerContext.Provider 包裹 canvas + children，overlay 组件作为 children 渲染在 Provider 内部，确保能通过 useGameController() 获取 controller 实例。
2. **Zustand 单向写入**：Store 的 actions 为纯状态设置器（只做 setState，无业务逻辑）。所有业务流程入口收归 GameController 一处，controller 内部调用 store 设置状态。UI 组件只通过 selector 读取 store，写入权限归 controller。
3. **按需单一时钟源**：`game/engine.ts` 拥有唯一 rAF 调度器，并显式维护 `idle / rolling / settled / error / stopped`。只有 `rolling` 连续申请下一帧；`idle / settled / error` 仅在启动、结算或失效请求时渲染单帧，`stopped` 不再调度。其他模块（`world.ts`、`settle.ts`）不自持循环或轮询。
4. **配置集中管理**：所有可调参数（物理、投掷、停稳、渲染质量、UI 常量）集中在 `config/` 下，不散落在业务模块中。
5. **规则数据驱动**：奖级判定规则以可枚举的数据结构定义，按 priority 升序排列（数值越小优先级越高，排在前面），判定函数为纯函数，返回完整结果对象（奖级 + 带数 + 命中详情）。
6. **响应式归 CSS**：布局、按钮尺寸、面板排列等响应式适配交给 CSS 媒体查询。脚本层只处理 canvas resize、受预算约束的基础 DPR、按基础质量档选择的 rolling DPR、camera aspect ratio、阴影档位，并在有效 resize 后发出一次渲染失效请求。
7. **核心逻辑可测试**：奖级判定、点数读取、停稳检测为纯函数/可隔离逻辑，Vitest 重点覆盖。随机数源抽为可注入接口，测试时注入确定性种子。
8. **StrictMode 幂等且资源所有权明确**：引擎初始化和销毁必须幂等。React StrictMode 会在开发环境双调用 effect；每个 `DiceSet` 独占 instance buffer、geometry、material 和 texture，不跨挂载缓存，GameViewport cleanup 必须先将其移出 scene，再显式 `dispose()`，重建时不复用上一实例已释放的资源。
9. **移动端布局不引入额外 UI 状态**：移动端采用真实上下布局，结算卡仅通过 CSS 在上下分界线处做轻度侵入，不再维护 `peek / expanded / hidden` 之类的局部状态。store 只提供 `phase` 驱动 `ResultPanel / TiltWarning / RollErrorPanel` 的显隐，不影响 game/controller 的业务状态机。
10. **视觉占位先于正式素材**：当前允许用程序化木纹、程序化青花纹样等占位资源推进画面；后续替换正式素材时应通过贴图/样式替换完成，不反向改动业务流、物理结构和 UI 状态机。

## 项目结构

```text
src/
├── main.tsx                    # 入口：仅 createRoot().render(<App />)
├── App.tsx                     # React 根组件：GameViewport + GameOverlay（顶栏、结算区、内容 peek、侧栏）
│
├── config/
│   ├── physics.ts              # 物理参数：质量、阻尼、摩擦、弹性、步长、子步进
│   ├── throw.ts                # 投掷参数：默认 stratified-ring、速度/角速度/高度
│   ├── settle.ts               # 停稳参数：低速/只读姿态窗口、assist 默认开关、timeout/倾斜阈值
│   ├── physics-variants.ts     # 命名 A/B preset：投掷、assist 与 pose detector 的可复现组合
│   ├── physics-cadence.ts      # versioned wall cadence 与 reference/cap6/cap4 scheduler 定义
│   ├── render.ts               # 渲染质量：基础 DPR / rolling DPR / drawing-buffer 像素预算 / 阴影档位
│   └── ui.ts                   # UI 常量：HISTORY_MAX_LENGTH、INITIAL_ROUND；触摸目标尺寸单一来源 CSS --touch-min
│
├── game/
│   ├── engine.ts               # 生产 exact-cap6：按需 rAF、逐步 session、安全/停稳、visibility、error 与渲染
│   ├── fixed-step-accumulator.ts # 生产 fixed-step backlog 所有者：守恒、pause、跨帧追赶与 overload
│   ├── performance-profile.ts  # 隔离 e2e rolling CPU profile v2：逐帧/逐 exact-step 与阶段分布
│   ├── physics-scheduler-experiment.ts # exact-cap6 默认与 legacy/exact-cap4 版本化 e2e preset
│   ├── physics-collision-experiment.ts # cannon-default 默认与 projected-aabb-v1 版本化 e2e preset
│   ├── render-performance-experiment.ts # 版本化渲染 A/B preset 与生产默认选择
│   ├── rolling-shadow.ts       # rolling shadow 请求节奏与可观测计数
│   ├── controller.ts           # 游戏编排层：状态机、可信结算/异常分流、轮次推进、重置（唯一业务入口）
│   └── store.ts                # Zustand store：五态游戏状态、pending/error 数据 + 纯状态设置器
│
├── scene/
│   ├── setup.ts                # Three.js 场景、renderer、灯光、摄像机预设、resize 质量与失效通知（无 PMREM、无 rAF 循环）
│   ├── table.ts                # 圆桌占位模型 + 程序化木纹/圈层；后续可叠桌布
│   ├── bowl.ts                 # 海碗可视模型 + 单张青花贴图及程序化回退
│   └── decorations.ts          # 旧桌面装饰实验文件，当前未接入 GameViewport 运行时
│
├── physics/
│   ├── world.ts                # cannon-es 世界初始化、exact/legacy step 与命名 Heightfield 窄相模式
│   ├── bowl-body.ts            # 碗碰撞体（Heightfield 连续碗底 + 竖直挡墙）
│   ├── heightfield-projected-aabb-narrowphase.ts # 实验候选：投影凸包 AABB 收紧 Heightfield cell
│   ├── body-transform.ts       # Cannon raw/interpolated pose → Three 对象；teleport 插值状态同步
│   ├── escape-guard.ts         # 运行时逃逸保护与可观测介入计数
│   ├── roll-runner.ts          # 无渲染统一投掷 runner，复用运行时行为链
│   ├── roll-step-session.ts    # exact 单步安全/settle 顺序的共享唯一实现
│   ├── cadence-roll-runner.ts  # headless wall cadence/accumulator 驱动与时间守恒报告
│   ├── cadence-comparison.ts   # watch/batch exact 等价、安全、守恒与 overload comparison v1
│   ├── roll-comparison.ts      # 命名 variant A/B、watch/batch cohort 与 natural continuation
│   ├── roll-diagnostics.ts     # 逐帧物理极值与安全诊断
│   ├── floor-relaunch.ts       # 事件级碗底二次离地 tracker v1 与 Box/Heightfield 采样器
│   └── materials.ts            # 物理材质定义与接触材质配对
│
├── dice/
│   ├── create.ts               # DiceSet：单材质 atlas InstancedMesh + 6 个姿态代理/body + 显式资源释放
│   ├── dice-body.ts            # 骰子物理 body：box / chamfer 形状切换与 FACE_NORMALS
│   ├── throw.ts                # 投掷 v3：六槽分层环、layout/dynamics 子流、命名历史采样器
│   ├── canonical-body-state.ts # 6-body pose/速度的 Float64 位级数组与 FNV-1a 64 签名
│   ├── throw-initial-state.ts  # throw 后初始刚体 pose/速度 Float64 快照与 FNV-1a 64 签名
│   ├── rest.ts                 # 首屏/重置静态姿态：贴合碗底、同步插值历史并休眠
│   ├── settle.ts               # 停稳检测：返回结构化 SettleResult | null（不自持轮询）
│   ├── contact-cluster-assist.ts # 历史尾段接触簇冻结辅助；运行时默认关闭，仅 A/B 显式开启
│   └── read-face.ts            # 朝上面读取：六面法线与世界 up 向量点积
│
├── rules/
│   ├── types.ts                # 奖级枚举、JudgeResult 结果对象、规则数据结构类型
│   ├── prizes.ts               # 全部奖级规则表（按 priority 升序排列，数值小 = 优先级高）
│   └── judge.ts                # 判定函数：输入 6 个点数 → 输出 JudgeResult 完整结果对象
│
├── ui/
│   ├── components/
│   │   ├── GameViewport.tsx    # 3D 容器：装配/销毁 DiceSet 与引擎，绑定 resize 失效，开发态发布 diagnostics
│   │   ├── ThrowButton.tsx     # 掷骰按钮（rolling/tilt-confirm/error 禁用 + 状态文案）
│   │   ├── ResetButton.tsx     # 重置按钮
│   │   ├── TiltWarning.tsx     # 倾斜确认面板：显示倾斜骰子编号，提供「接受结果」「重掷」按钮
│   │   ├── RollErrorPanel.tsx  # timeout/timing-overload 异常面板：不展示结果，提供同轮重掷与重置
│   │   ├── ResultPanel.tsx     # 当轮结果面板：点数组合 + 奖级 + 带数（仅 result 显示）
│   │   ├── PrizeRecord.tsx     # 本局累计奖级记录（奖池/榜单面板）
│   │   ├── History.tsx         # 最近 5 轮历史记录
│   │   └── SoundToggle.tsx     # 音效开关
│   └── styles/                 # 原生 CSS 文件：global.css / variables.css / game.css
│
├── audio/
│   └── sound.ts                # Web Audio：投掷前 prepare、静音、碰撞/中奖合成音与完整 dispose/remount 复位
│
├── utils/
│   └── random.ts               # 时间种子 mulberry32、固定 seed 复现、稳定派生随机子流
│
└── __tests__/                  # 快速测试（pnpm test，全量 <30s）
    ├── judge.test.ts           # 奖级判定：全部奖级示例 + 46656 种穷举校验
    ├── read-face.test.ts       # 点数读取：24 个合法朝向 + 近边界扰动样本
    ├── chamfer.test.ts         # 倒角骰子几何验证：顶点/面数、对称性、尺寸
    ├── settle.test.ts          # 停稳检测：假时钟 + 快照序列、多种边界场景
    ├── settle-regression.test.ts # 停稳回归：已知问题种子的结算路径验证
    ├── controller.test.ts      # 编排层集成：phase、timeout、重复回调幂等、history、reset、sound
    ├── store.test.ts           # error 不提交结果与 reset 保留 soundEnabled
    ├── engine-timing.test.ts   # exact/legacy 引擎时序、守恒、visibility、overload 与最终 raw 帧
    ├── performance-profile.test.ts # profile v2 固定容量、逐步采样、阶段分段、分位数与 reset
    ├── physics-collision-experiment.test.ts # e2e-only 碰撞 preset 解析与 cannon-default 生产契约
    ├── heightfield-projected-aabb-narrowphase.test.ts # step/justTest differential 与 200-seed 严格等价
    ├── render-performance-experiment.test.ts # e2e-only preset 解析与生产默认契约
    ├── rolling-shadow.test.ts  # every-frame/alternate/frozen 请求序列
    ├── body-transform.test.ts  # raw/interpolated pose 复制与 teleport 状态同步
    ├── dice-instancing.test.ts # atlas 实例、代理矩阵同步、资源所有权与 dispose 幂等
    ├── rest.test.ts            # idle 静态姿态、运动状态清理与插值历史同步
    ├── render-config.test.ts   # DPR、drawing-buffer 像素预算与阴影档位
    ├── scene-setup.test.ts     # resize 去重、质量切档、渲染失效通知与不创建 PMREM
    ├── css-performance-contract.test.ts # 桌面视觉保留与移动/slow 合成降级、reduced-motion 动效契约
    ├── strict-mode.test.tsx    # 重挂载资源配对、无残留 canvas/rAF 与开发 diagnostics 口径
    ├── sound.test.ts           # 音频懒创建、静音、并发/节流、异常降级与 dispose/remount
    ├── tilt-flow.test.ts       # 倾斜确认流程：tilt-confirm 进入/pending 隔离/接受/重掷/throw 拒绝/reset/冻结/35° 不触发
    ├── physics-smoke.test.ts   # 物理烟雾：真实世界 + 碗 + 骰子，固定种子跑 N 帧，无 NaN/不穿模
    ├── floor-relaunch.test.ts  # 二次离地事件顺序、接触归因、阈值与 sampler 可用性
    ├── bowl-body.test.ts       # 碗碰撞体：Heightfield 几何、挡墙布局
    ├── dice-escape.test.ts     # 骰子逃逸防护：多种子验证反弹后不飞出
    ├── throw-geometry.test.ts  # 投掷几何：初始位置/速度分布验证
    ├── throw-invariants.test.ts # 投掷不变量：确定性种子结果一致性
    ├── fallback-rate.test.ts   # fallback 触发率统计
    ├── freeze-consistency.test.ts # 历史 Assist 截断 vs 默认自然终态反事实
    ├── contact-cluster-assist.test.ts # 历史接触簇能力与默认禁用契约
    ├── reproduce-seed.test.ts  # 关键种子复现：已知问题种子的详细诊断
    └── review-verify.test.ts   # 审查验证：高度分层、fallback 拓扑覆盖、关键种子复现

scripts/
├── physics-acceptance.ts       # 单 seed / 批量验收，结构化输出版本、配置与物理极值
└── physics-ab.ts               # 命名 preset 的 A/B、B/A 交替执行和结果门禁

e2e/
├── game.spec.ts                # 默认 exact 正常流程、timeout 恢复、cap4 overload、reset
├── soak.spec.ts                # production-default / legacy-rollback 各 20 轮状态、安全与资源断言
├── browser-bench.spec.ts       # 三阶段渲染结构、DPR/像素与静态零帧预算
├── render-performance-ab.spec.ts # 五 seed、双 warm-up、ABBA/BAAB 渲染配对 A/B
├── physics-scheduler-ab.spec.ts # legacy-batched / exact-cap6 结果、轨迹与观测性能配对 A/B
├── physics-collision-ab.spec.ts # cannon-default / projected-aabb-v1 真值与 impact 窄相配对 A/B
└── helpers/diagnostics.ts      # schema v9 类型、调度/碰撞实验/守恒/结构/profile 预算与读取 helper

sweep/                          # 独立长时间运行脚本（按需手动执行，不在 pnpm test 中）
├── lib/
│   ├── log.ts                  # NDJSON 增量日志器：appendFileSync 防崩溃丢失
│   └── run-trial.ts            # 共享试验运行器：物理世界→投掷→步进→停稳→读数
├── param-sweep.ts              # 摩擦/恢复系数参数扫描（pnpm sweep:param）
├── sleep-sweep.ts              # sleepTimeLimit 参数扫描（pnpm sweep:sleep）
├── timeout-risk.ts             # 超时风险统计（pnpm sweep:timeout）
├── jitter-diagnose.ts          # 抖动种子诊断（pnpm sweep:jitter）
└── tilt-stats.ts               # 倾斜统计（pnpm sweep:tilt）
```

## 当前视觉占位策略

- 运行时场景当前只接入桌面、海碗和 6 颗骰子；`scene/decorations.ts` 保留为旧实验文件，不在 `GameViewport` 中挂载。
- 海碗外壁当前使用 `src/assets/bowl-blue-white-seamless-v2.webp` 单张青花贴图；纹样先重排半幅并镜像拼接，使 LatheGeometry 的左右 UV 边界在颜色与切线方向上连续，同时把残余 WebP 压缩差旋转到固定相机背面的 `-Z` 后壁，避免落在左右可见内壁。wall material 从初始化起持有待上传的 WebP texture；解码并完成一次静态渲染前由不透明加载页遮住场景和交互，失败或 8 秒超时才把唯一 map 换成原 `2048×512 CanvasTexture` fallback。该流程仍保持 2 mesh / 2 material / 1 活动 texture，不会因异步替图新增 shader program，并沿用已收口的瓷釉 roughness / clearcoat 参数。
- 桌面仍只使用一张 `512×512 CanvasTexture`，当前以更细密的长向木纹、少量淡年轮和更低透明度的既有嵌饰圈压低“靶环感”。该轮改动不增加 mesh、material 或 texture；后续美术方向优先在现有桌体上叠加桌布，而不是继续扩展桌腿、桌裙板或独立摆件。
- 场景使用纯色背景、方向光、环境光和半球光，不生成 PMREM。旧路径在 `createScene()` 阶段生成环境贴图时，桌面、海碗和骰子尚未加入 scene，得到的环境信息有限；同时只保留 target texture 会丢失 render target 的所有权，无法由场景上下文可靠释放，因此已删除该路径并保持 `scene.environment = null`。
- 这类视觉占位的目标是先稳定构图与层次，不改变物理世界、碰撞体和游戏状态流；资源测试当前锁定海碗 `2 mesh / 2 material / 1 texture`、桌面 `5 mesh / 5 material / 1 texture`。

## 骰子渲染与资源生命周期

- 运行时通过 `createDiceSet()` 创建一个单材质 `InstancedMesh`，共享一份 `RoundedBoxGeometry`、一份 `MeshPhysicalMaterial` 与一张 3×2 骰面 atlas；6 颗骰子仍各自拥有独立 Cannon body。
- 每个 `DicePair.mesh` 在 DiceSet 路径中是一个不加入 scene 的轻量 `Object3D` 姿态代理。Engine 将 raw 或 interpolated body pose 写入代理，再调用 `syncVisual()` 通过 `setMatrixAt()` 更新对应的 instance matrix。`createDice()` 继续保留返回单颗独立 `Mesh + body` 的兼容接口。
- 创建资源时先按 RoundedBoxGeometry 原始 6 个连续面区间和 `FACE_MAP` 重映射 UV，再将 draw group 合并为一个单材质提交；测试直接锁定每个面区间的平均法线、点数与 atlas 格子三者一致。因此渲染结构是“一个实例对象、一个材质提交”，而不是为每颗或每面分别持有完整 Mesh/geometry/material。
- DiceSet 资源随 GameViewport 挂载生命周期存在，不在每次投掷时重建，也不跨 DiceSet/StrictMode 重挂载缓存。卸载时先从 scene 移除实例对象，再调用幂等的 `DiceSet.dispose()` 释放 instance buffer、geometry、material 和 texture，随后才执行场景通用资源遍历，避免重复释放。

## 投掷、停稳与可复现性

- 运行时投掷默认为 `stratified-ring`：6 个等角度槽位使用同一环形半径，每轮随机旋转整体布局，再随机打乱“骰子索引 → 槽位”分配。该路径是永远满足初始间距的构造式布局，不走 rejection/fallback。
- 投掷 v3 将随机计划版本化，用同一 seed 派生独立的 layout 和 dynamics 子流。因此更换位置 sampler 不会改变高度、四元数、线速度和角速度的单骰随机单位值。普通运行使用时间种子初始化 mulberry32；开发/e2e 可注入一次性 `nextSeed` 或带版本的 `nextSeeds` 队列，只有隔离 e2e 构建接受带版本的强制 timeout outcome。生产路径不使用这些 seam，也不使用 `Math.random` 驱动投掷。
- `legacy-v1` 保留旧共享随机流，`uniform-area-restarts` 保留面积均匀 rejection 与整组重试；二者不是运行时默认，只通过命名 A/B preset 作历史/布局对照。
- 停稳 v4 区分 `natural-sleep / stable-window / pose-stable-window / cluster-assist / timeout`。contact-cluster assist 运行时默认关闭，只有 historical variant 显式开启以复现旧冻结路径。
- `pose-stable-window` 在投掷 1.2s 后才可建立锚点，要求完整 0.75s 内每颗骰子相对锚点位移不超过 2mm、四元数角距不超过 0.015rad，且逐骰读面不变。它只读 body 姿态，不清速度、不 sleep、不改四元数，也不用瞬时线速度/角速度噪声预筛空间稳定。
- `timeout` 作为独立结算原因上报后，controller 只冻结异常画面并写入 `RollError`，不会调用读面、判奖或结果提交，也不会播放中奖音。UI 进入显式 `error`，允许同一轮重新掷骰或重置；这一异常出口与正常奖级流程严格分离。

### 统一 runner、命名 variant 与反事实

- `physics/roll-runner.ts` 的 `runRoll()` 无渲染执行完整投掷，复用正式的 `throwDice`、物理世界、escape guard、`checkSettled` 和读面实现。单轮 diagnostics schema v4 通过 `roll-step-session.ts` 逐个执行 exact `world.step(fixed)`，并在每一步按固定顺序记录未介入安全/contact、floor tracker、guard、settle、sleep 与可选稳定窗口诊断；`simulationStep / simulationTime` 明确表示真实模拟进度。最终还用 canonical body-state v1 捕获 6 颗骰子的完整 position/quaternion/velocity/angularVelocity 与 Float64 位级签名，避免聚合极值或骰面掩盖终态分叉。批量验收报告 schema 为 v3。生产浏览器 Engine 的 `exact-cap6` 路径复用同一 session；legacy-batched 仅保留作对照和回滚。
- variant schema v2 固定五组行为：`historical = legacy + assist on + pose off`、`placement-control = uniform + off + off`、`placement-candidate = stratified + off + off`、`natural-control = legacy + off + off`、`current = stratified + off + pose on`。
- `test:physics:ab` 按 seed 交替执行 A/B、B/A。固定历史问题 seed 归入 watch cohort；其他 seed 归入 batch cohort，仅 batch 承担分布和回退预算，避免 watch 过采样污染一般性结论。A/B 报告 schema v4 在 runtime 和 continuation 两侧都将 floor-relaunch tracker 不可用或命中事件列为硬失败。
- 两侧每个非 `natural-sleep` 结果都以相同 seed 和投掷算法另起一次关闭 assist/pose detector 的 `natural-continuation`，最多继续 20s。candidate 必须与对照的逐骰面值、倾斜分类和完整 `JudgeResult` 一致，且 continuation 不得出现 NaN、越墙或 escape-guard 介入。
- `test:physics:cadence` 使用 comparison report/execution plan v1，CLI 只允许选择 seed 范围与输出，不开放 cadence/scheduler 弱化入口。每个 seed 先执行一次 `steady60/reference-exact`，再让 candidate 通过同一 headless lifecycle 和 `roll-step-session` 比较 initial/final canonical state、完整 `RollRunResult`、`JudgeResult`、轨迹安全和 accumulator/session 时间守恒。watch 完整覆盖 5 个 normal cadence × cap6/cap4，并额外验证 sustained100ms/cap4 overload；batch 将 seed 均衡分配到 5 个 cadence，每个 seed 同时验证 cap6/cap4。该路径不经过浏览器 Engine，不能作为生产调度已经切换的证据。

## 核心数据流

```text
用户点击掷骰按钮
    │
    ▼
React UI ──调用──▶ GameController.throw()（唯一业务入口）
    │
    ▼
GameController:
    1. 拒绝非 idle/result 阶段的调用（防重复点击）
    2. store.setPhase('rolling')  ← UI 按钮禁用
    3. dice/throw.ts → 设置骰子初始位置、旋转、速度、角速度，并同步 teleport 后的 Cannon 插值状态
    4. engine.beginSettle() → 引擎进入 rolling，开始连续 rAF
    │
    ▼
Engine rolling 循环（game/engine.ts，唯一连续 rAF）：
    首帧只建立 timestamp 基准并显示投掷后的插值 pose；后续每帧：
    ① physics/world.ts → world.step(fixedTimeStep, dt, maxSubSteps)
    ② 应用逃逸保护
    ③ dice/settle.ts → checkSettled()（返回 SettleResult | null）
    ④ 未停稳：切换 rolling 渲染质量 → 请求本帧阴影 → Cannon interpolated pose
       → Object3D proxy → instanceMatrix → renderer.render() → 申请下一帧
    │
    ▼
settle 返回结构化结果（natural-sleep / stable-window / pose-stable-window / cluster-assist / timeout）
    │
    ▼
Engine 切换 settled，不再续排连续 rAF；回调 GameController.onSettled():
    timeout → 冻结异常画面，进入 error；不读面、不判奖、不播放中奖音、不推进 round/history/prizeRecord
    其余可信路径继续：
    5. dice/read-face.ts → readAllFacesDetailed() → 读取 6 颗骰子朝上点数 + 置信度
    6. rules/judge.ts → 判定奖级 → 返回 JudgeResult 完整对象
    7. 线速度/角速度清零并 sleep，确保后续姿态不漂移
    8. 检测倾斜骰子：confidence < tiltThreshold（0.75，≈41°）
    9. 回调返回后，Engine 先恢复 static 渲染质量，再用最终 raw body pose 渲染结算帧
    │
    ├── 无倾斜 → store.setResult()（applyResult：写入 diceValues、result、round++、history、prizeRecord）
    │                │
    │                ▼
    │          React UI 响应 → ResultPanel + PrizeRecord + History + ThrowButton 恢复
    │
    └── 有倾斜 → store.setPending({ diceValues, result, tiltedIndices })
                     │  写入 diceValues + currentResult 供 UI 预览
                     │  不写入 history / prizeRecord / round（隔离）
                     │
                     ▼
               TiltWarning 组件显示倾斜提示
                     │
                     ├── 用户点击「接受结果」→ controller.acceptTilted()
                     │     → store.commitPending()（调用 applyResult 提交）
                     │     → phase = 'result'
                     │
                     └── 用户点击「重掷」→ controller.rethrow()
                           → store.clearPending()（phase = 'rolling'）
                           → throwDice() + engine.beginSettle()

error 状态由 RollErrorPanel 明确说明“本轮未结算”，用户可在同一轮重新掷骰，或重置整局。`onSettled` 只接受 rolling 阶段的首个回调，重复或迟到回调不会重复提交或播放音效；倾斜结果也只有在用户接受、正式提交后才播放中奖音。
```

## 引擎渲染状态机

引擎状态与下文 Zustand/UI 的 `phase` 相互协作，但不是同一组状态：UI 使用 `idle / rolling / tilt-confirm / result / error` 表达业务流程；引擎只关心渲染和物理调度。

| Engine mode | 进入方式                            | 物理与渲染行为                                                                                            |
| ----------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `stopped`   | 初始状态，或调用 `stop()/dispose()` | 取消待执行 rAF，不推进物理，也不接受失效渲染                                                              |
| `idle`      | `start()` 将 stopped 切换为 idle    | 启动时渲染一帧 raw pose；之后不常驻 rAF，`invalidate()` 只合并调度一个静态帧                              |
| `rolling`   | `beginSettle()`                     | 唯一连续 rAF；生产 `exact-cap6` 逐固定步运行共享 session/安全/停稳，未停稳帧按 accumulator alpha 插值渲染 |
| `settled`   | 可信 `checkSettled()` 结果          | 调用 controller 完成读面/结果分流，再以 raw `position / quaternion` 渲染最终帧；之后按需单帧              |
| `error`     | timeout 或 timing-overload          | 冻结并渲染 raw 终态；不读面、不提交结果，等待用户同轮重掷或重置                                           |

`start()` / `invalidate()` 通过同一个 `rafId` 去重，因此连续的静态失效请求最多合并成一个待执行帧。`rolling` 已有连续循环，额外 `invalidate()` 是无操作。

### 渲染质量、阴影与 resize 失效

- `config/render.ts` 先计算基础 DPR：限制在 `1.0～1.5`，并以 `3,500,000` 个 drawing-buffer 像素为目标预算；预算 DPR 低于 1 时仍保持最低 1x，因此 CSS 视口自身已超过预算的极端场景允许超出目标值。生产使用 tier-aware 策略：仅当基础质量 `tier=reduced` 时在 rolling 将主画布有效 DPR 限为 1x，`full` 档 rolling 保持基础 DPR；idle/settled/error 一律恢复基础 DPR。
- 阴影档位只由基础质量决定：未触发像素预算限制时使用 `1024 × 1024`，触发限制时使用 `512 × 512`，切档时释放旧 shadow map 并请求重建。rolling DPR 不反向改变基础档位，避免 A/B 同时修改两个变量。
- 阴影 map 始终关闭 `autoUpdate`。生产 rolling preset 保持 `every-frame`，Engine 在每个真正进入 `renderer.render()` 的 rolling 帧显式请求一次 `needsUpdate`；idle/settled/error 静态帧也只请求一次。版本化实验另有 `alternate` 与 `frozen-after-first`，但不作为生产默认。
- `scene/setup.ts` 只在 CSS 尺寸或设备 DPR 实际变化时重算 renderer 尺寸、基础 DPR、camera preset/aspect 和阴影档位。Engine 紧邻真实渲染切换 static/rolling 有效 DPR，phase 切换本身不回调 invalidate，因此不产生额外静态帧；`GameViewport` 仍将 resize 失效回调绑定到 `engine.invalidate()`，cleanup 时解绑。
- 开发环境与隔离的 e2e 构建把 diagnostics 写入 canvas 的 `data-dice-diagnostics`；普通生产构建不发布该数据集。当前 schema v9 的每份快照带 `schemaVersion / revision / sampleKind: 'post-render'`，且只在一次真实 `renderer.render()` 后发布。它保留 schema v8 的 scheduler experiment/preset、accumulator 守恒、canonical 6-body 初末态和安全包络，并新增碰撞实验的 `version / explicit / variant`；普通生产无实验 query 时明确为 `explicit=false / cannon-default`。
- `mainPassCalls / mainPassTriangles` 明确表示 renderer 主 pass 的调用数和三角形数，不冒充包含 shadow pass 的总量；`geometries / textures` 来自 `renderer.info.memory`，并附带当前 `programs` 数量、CSS/drawing-buffer 尺寸、DPR 与 Engine 调度计数。投掷诊断同时记录实际 seed、投掷路径、停稳原因与模拟耗时；Engine 还逐物理步累计最大半径、保守/墙中心越界、最大接触穿透、非有限状态与 escape-guard 介入，避免飞出或穿透后落回被终态掩盖。
- Playwright 的 `test:e2e` 在桌面/移动项目执行生产默认 exact 正常流程、timeout 不提交/同轮恢复、reset、显式 exact preset、cap4 overload 和静态零帧验收；clean `e20d359` 的 8/8 结果保留为 schema v8 基线。`test:e2e:soak` 是无 query 的 production-default exact-cap6 门禁；`test:e2e:soak:legacy` 显式指定 legacy-batched，只证明回滚 preset 可用。两者都逐轮检查提交/历史、逐步安全、调度守恒、static DPR、静态零帧及 WebGL 资源，并写 schema v4 artifact。
- `bench:browser` 对三种引擎阶段锁定 8 个主 pass calls、41,288 个三角形、8 个 geometry、最多 6 个 texture、DPR/3.5MP drawing-buffer 预算和分平台 shader program 上限。它只在隔离 e2e URL 显式带上 `perfProfile=1&perfProfileVersion=2` 时创建 rolling CPU profile v2；普通生产与普通 e2e 不采样计时。v2 保留 rAF 原始/截断间隔、accumulator、world step、guard、安全、settle、transform sync、renderer submit、diagnostics publish 与 tick total，并以最多 600 条原始样本记录逐 rAF 的 simulation step/time 和逐 exact-step 的接触/摩擦方程、awake 骰子数、settlement，以及 Cannon 内建 broadphase、narrowphase、make-contact-constraints、solve、integrate 五段 CPU 计时。它还派生 airborne、首次接触后 500ms impact-window 和结算前 500ms tail；impact 与 tail 可以重叠，不能相加为整轮成本。`rendererSubmitCpuMs` 是 `renderer.render()` 同步 CPU submit 时间，不是 GPU 时间；当前帧在 post-render 发布之后才完成记录，因此快照明确标记不含发布中的当前帧。
- browser bench 对 profile 只硬门禁字段完整、数值有限、样本数大于 0 和生产 exact 每帧 `cannonStepnumberDelta.max <= 6`；毫秒分布与独立 rAF 观测只写 JSON artifact 供同环境 A/B，不设跨机器硬阈值。失败时保留 JSON、页面截图、video 与 trace。
- clean `e20d359` 的 schema v8 `bench:browser` 桌面/移动 2/2 结果保留为 profile v1 历史基线。桌面 `reduced` idle/settled 为 3,498,014 pixels、DPR `1.445028`，rolling 为 1,676,160 pixels、DPR 1；移动 `full` 保持 1.5 DPR。当前实现已迁移到 schema v9/profile v2；clean `1060095` 的 production-default soak 桌面/移动各 20/20 natural，start/end clean unchanged，最大 terminal queue 为 97.3ms / 59.7667ms，安全错误为 0，资源保持 `1/8/6/10`。任何新毫秒值仍只作同环境记录，不构成真实 GPU 或跨机器结论。

### 渲染性能实验与当前结论

- render experiment v1 只在隔离 e2e 构建读取版本化 URL 参数，并只允许 `baseline / rolling-dpr-1x / shadow-alternate / shadow-frozen` 四个注册 variant。其中实验 `rolling-dpr-1x` 仍无条件在 rolling 限为 1x，用于保持 durable A/B 可复现；它不等同于生产的 tier-aware 策略。生产构建忽略参数，只在基础质量 `reduced` 档应用 rolling 1x，`full` 档保持基础 DPR，static 一律恢复基础 DPR，阴影保持 `every-frame`。
- `bench:browser:render-ab` 使用 5 个固定 seed。每个候选与 baseline 先各自 warm-up 一轮，再按 seed 交替执行 ABBA 或 BAAB，每个 project/comparison 共 20 个 measured rolls；同 seed 两侧必须保持投掷计划字段以及真实初始 6-body pose/线速度/角速度签名与数组完全一致，同时门禁可稳定复现的最终点数/奖级、轨迹安全、context、页面错误和静态零帧。render A/B artifact schema v2 还记录完整 HEAD、`worktreeDirty`、porcelain 状态哈希与 HEAD-relative tracked diff 状态/SHA-256，并要求一次长跑前后 repository state 不变。repository-state schema v2 还会按原始路径稳定哈希未跟踪普通文件内容与 symlink 目标，ignored artifact 不进入摘要；正式可归因证据仍从 clean worktree 开始，dirty 运行只作探索。rAF p95、settlement wall time 与重复噪声只记录为观测。持久化结果位于 `artifacts/render-ab/<project>-<comparison>.json`。
- `6901f4d...` 的 schema v6 / render artifact schema v2 结果保留为历史 checkpoint，不冒充当前 schema。clean `e20d359` 的 schema v8 / render artifact schema v2 四组 start clean、end unchanged，流程/正确性硬门禁 4/4 通过。rolling DPR 的桌面/移动 rAF p95 比值中位数为 `0.7667725564854255` / `0.6964818127608844`，均 5/5 改善并达当前判据；shadow upper-bound 为 `0.970057034220532`（3/5）/ `1.0012427506213761`（2/5），均未达判据。该 SwiftShader 观测继续支持 tier-aware DPR 选择，但不是通用 GPU 结论；阴影仍不推进 alternate。
- 交互 Chrome 的补充单 seed 观察约为 candidate 17.6ms、baseline 33ms，并人工核对了 rolling 画面和 settled 后基础 DPR 恢复。这支持继续保留候选，但不是系统 GPU timer、不是多 seed 样本，也不能外推为通用 GPU 性能结论。
- 将 Cannon `maxSubSteps` 从 8 直接降到 4 的尝试已排除：慢帧会丢弃更多待模拟时间，seed 25042 已显示 cadence 分叉风险。生产改为显式 accumulator，每个 exact 固定步依次运行 world、未介入安全采样、floor tracker、escape guard 与 settle；cap6 是单帧追赶上限，超过 250ms 高水位会锁存 `timing-overload`。
- Engine 通过 `document.visibilitychange` 把隐藏时间归为 paused/discarded，不纳入 backlog；resume 从新的 monotonic timestamp 继续。timeout/overload 都进入独立 `error` 并冻结 raw 终态，不读取或提交奖级。生产构建始终使用编译时 `exact-cap6`；只有隔离 e2e 才解析版本化 `legacy-batched / exact-cap6 / exact-cap4` query。
- clean `e20d359` 的 cadence artifact `artifacts/cadence/head-e20d359-200-seeds.json` start/end clean unchanged：200 seeds、780/780 runs、normal 560/560、overload 20/20、failure=0。它锁定 exact 候选在 5 cadence 中的 initial/final state、完整结果、安全和守恒；5s visibility suspend 全部归为 paused/discarded，持续 100ms/cap4 在 frame 6、step 20、queue `800/3ms` 时返回 `timing-overload`、`roll=null`。这是模拟 cadence 证据；用户于 2026-08-14 已另行报告真实 OS/tab 隐藏恢复可用，但该主观确认不补充浏览器、设备、电源、DPR 或 trace 元数据。
- scheduler A/B artifact schema v2 对 5 seeds 每侧重复两次。桌面/移动的结果、奖级、结算路径与安全均等价，exact 重复终态稳定；但 `trajectoryEquivalentSeedCount=0`，不宣称两种调度轨迹等价。exact/legacy 的 rAF p95 中位比为 `0.986535928581883` / `0.9161676646706578`，settlement wall 比为 `0.94935576135633` / `1.0074334792048256`，结论固定为 observation-only，生产切换依据是逐步真值、可复现性和异常语义，而非普适性能提升。

### Heightfield 碰撞窄相实验与当前结论

- 生产碰撞实现仍为 cannon-es 0.20.0 原生 `Narrowphase`，版本化 collision experiment v1 只在隔离 e2e 构建接受 `cannon-default / projected-aabb-v1`；生产构建忽略 query，`DEFAULT_RUNTIME_PHYSICS_COLLISION_VARIANT_ID` 固定为 `cannon-default`。
- `projected-aabb-v1` 只改 Heightfield cell 候选范围：把凸包真实顶点变换到 Heightfield 局部空间，按其 XY 投影 AABB 加向外 epsilon 后收紧索引，再保持上游 pillar、SAT、contact、friction、`justTest` 和循环顺序。它不修改世界步长、求解器、材质、轨迹兜底或结算阈值。
- differential 测试覆盖 160 组 step 和 200 组 `justTest` 随机姿态/边界场景；统一 runner 对 200 seeds（含 watch seed 25042）的完整 `RollRunResult` 与 canonical 终态逐项严格等价。浏览器 collision A/B 再对固定 5 seeds 按 ABBA/BAAB 每端执行 20 measured rolls，投掷计划、初末 canonical state、点数/奖级/带数、结算原因/时间、simulation step/time、安全与渲染结构全部硬门禁等价。
- dirty-worktree SwiftShader artifact 中，桌面 impact narrowphase p50/p95 中位比为 `0.720000000089407 / 0.8095238101995992`，4/5 seeds 改善并达到预注册判据；移动为 `0.7500000001940256 / 0.8749999995925464`，只有 3/5 seeds 改善，未达到至少 4/5 的判据。两端收益均超过各自 repeat-noise 中位数，但移动 criterion 为 false，因此结论是“不推进生产”。这些 artifact 只证明该 dirty 工作树一次运行期间 repository state unchanged，不是 clean checkpoint，也不是不同浏览器或真实 GPU 证据。

### UI 收口与低动态环境的 CSS 合成降级

- 桌面 idle/settled 仍保留面板玻璃质感；所有视口进入 rolling 后，顶栏通过 `.game-overlay.phase-rolling` 关闭大面积 `backdrop-filter`，改用近似实色红棕渐变，避免持续采样 WebGL 背景。滚动按钮不再运行会逐帧重绘 box-shadow 的 `buttonPulse`，只保留基于 `transform / opacity` 的 ornament 动效。
- 桌面侧栏由 352px 收窄至 324px、上沿由 126px 提至 112px，并压缩卡片边框/阴影/间距；结果卡设置 460px 上限及短视口压缩规则，减少与碗区争抢。ResultPanel 原有系统“云/兔”字符已替换为纯 CSS 细线角纹，避免平台字形差异且零图片/纹理增量。移动顶栏改为 `82px + safe-area` 的单行布局、图标按钮保持 44px；结果骰子保持单行，统计/历史继续位于真实文档流。
- `max-width: 768px` 仍关闭 `.top-bar / .tilt-warning / .roll-error / .result-panel / .panel-card` 等大面积区域的 `backdrop-filter`，以高不透明度实色背景补偿，小面积 `.btn-icon` 保留原样。`(update: slow)` 额外关闭 rolling ornament、倾斜/异常提示和结果面板动画；`prefers-reduced-motion: reduce` 只关闭动画、按钮过渡和 hover 位移，不额外牺牲桌面静态 blur。

## 游戏状态机

```text
        throw()                    可信 onSettled()
IDLE ──────────▶ ROLLING ──────────────────────────▶ RESULT
  ▲                                       │            │
  │                                       │ 有倾斜     │
  │              reset() 或               ▼            │
  │              下一轮 throw()     TILT-CONFIRM       │
  │                                   │       │        │
  │                              accept()  rethrow()   │
  │                                   │       │        │
  │                                   ▼       ▼        │
  │                                RESULT   ROLLING    │
  │                                   │                │
  └───────────────────────────────────┴────────────────┘

ROLLING ── timeout / timing-overload ──▶ ERROR ── rethrow ──▶ ROLLING
                                           └──── reset ─────▶ IDLE
```

| Phase          | UI 状态                                 | 引擎行为                                                            |
| -------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `idle`         | 掷骰按钮可用，等待操作                  | Engine idle；骰子静止，只有启动/resize 等失效请求触发静态单帧       |
| `rolling`      | 按钮禁用，显示"骰子翻滚中"              | Engine rolling；施加初速度 → 连续 rAF 物理步进与插值渲染 → 停稳检测 |
| `tilt-confirm` | 按钮禁用，TiltWarning 显示（接受/重掷） | Engine settled；骰子已冻结，无常驻 rAF，等待用户决策                |
| `result`       | 显示结果面板，按钮恢复为"再掷一次"      | Engine settled；骰子静止，无常驻 rAF，等待下一轮、重置或失效单帧    |
| `error`        | 显示本轮未结算（重新掷骰/重置）         | Engine error；异常画面已冻结，不读取或提交点数                      |

说明：不再区分 throwing 和 settling。对 UI 来说两者表现完全一致（按钮禁用），合并为 rolling 减少边界管理复杂度。tilt-confirm 为倾斜确认态，骰子物理体已冻结，结果数据预写入 store 供 UI 预览但不提交至历史记录，等待用户选择接受或重掷。error 不含点数或奖级，只保留可观测的异常原因与逻辑耗时。

## Zustand Store 结构（概要）

```ts
// 判定结果完整对象
interface JudgeResult {
  prize: Prize // 奖级枚举
  priority: number // 优先级数值（越小越高）
  carryScore: number // 带数（剩余骰子之和，无带数时为 0）
  matchedDice: number[] // 命中规则的骰子点数
  remainDice: number[] // 剩余骰子点数
  description: string // 人类可读描述，如"状元 带7"
}

// 倾斜骰子待提交数据
interface PendingSettlement {
  diceValues: number[]
  result: JudgeResult
  tiltedIndices: number[] // 倾斜骰子下标（0-based）
}

interface RollError {
  reason: 'timeout'
  elapsed: number
}

interface GameState {
  // 状态
  phase: 'idle' | 'rolling' | 'tilt-confirm' | 'result' | 'error'
  round: number
  diceValues: number[] // 当轮 6 颗骰子点数
  currentResult: JudgeResult | null // 当轮完整判定结果
  history: HistoryEntry[] // 最近 HISTORY_MAX_LENGTH 轮历史（默认 5，来自 config/ui.ts）
  prizeRecord: Record<Prize, number> // 累计各奖级次数
  pendingSettlement: PendingSettlement | null // 倾斜确认期间暂存
  rollError: RollError | null // 不可信结算原因，不包含业务结果
  soundEnabled: boolean
  playerId: string | null // 预留多人，当前默认 null

  // 纯状态设置器（仅由 GameController 调用，不对 UI 直接暴露业务语义）
  setPhase: (phase: GameState['phase']) => void
  setResult: (payload: { diceValues: number[]; result: JudgeResult }) => void // 无倾斜时直接结算（内部调用 applyResult）
  setPending: (p: PendingSettlement) => void // 有倾斜：预写 diceValues/currentResult，不提交历史
  commitPending: () => void // 用户接受倾斜结果：调用 applyResult 提交
  clearPending: () => void // 用户选择重掷：清空 pending，phase → rolling
  setRollError: (error: RollError) => void // 不推进轮次/历史/奖级
  clearRollError: () => void // 同一轮重掷
  resetState: () => void // 清空游戏数据，但保留 soundEnabled 用户偏好
  toggleSound: () => void
}

// applyResult 为 setResult 和 commitPending 共用的内部辅助函数，
// 负责 round++、追加 history（限 HISTORY_MAX_LENGTH）、更新 prizeRecord、设置 phase='result'。
```

注意：UI 组件只通过 selector 读取 store，所有业务操作（掷骰、重置）通过 GameController 实例方法调用，不直接调用 store 的 set 方法。

### 音效生命周期

- `soundManager` 仍是单例；每次合法投掷或专用重掷在当前用户手势栈内先调用 `prepare()`，同步创建 AudioContext、触发必要的异步恢复并生成该 context 的碰撞 noise buffer，然后才执行 `throwDice()` 与 `engine.beginSettle()`。这保持首次交互前零音频资源，同时避免第一次 collide 回调把上下文/buffer 初始化成本计入 `world.step()`。
- `prepare()` 幂等，muted 状态下不创建或恢复 context；非法 phase、rolling 重复点击及未装配 engine 的路径不会调用。Web Audio 不可用、closed context 或 buffer 创建失败时静默降级，后续播放路径仍可重试。
- `suspend / resume / close` 的同步异常和 Promise rejection 都降级为静默，不形成页面级 unhandled rejection。`dispose()` 会复位 context、muted、节流时间、并发计数和碰撞 noise buffer，保证 StrictMode/remount 后 store 默认状态与音频管理器一致。
- 碰撞白噪声 buffer 在同一 AudioContext 内复用；每次碰撞仍创建独立 source、滤波与包络。中奖音只在业务结果正式提交后播放，tilt-confirm、rethrow、reset 和 timeout 均不会提前触发。

## 移动端布局不变量

- 移动端采用真实上下布局：上方为游戏舞台，下方为文档流中的内容区；内容增长时依赖页面整体滚动，而不是固定底部浮层。
- `ResultPanel / TiltWarning / RollErrorPanel` 位于下方内容区顶部，可通过负外边距轻度侵入上下分界线，制造悬浮感，但 DOM 仍属于内容区。
- `ThrowButton` 始终位于结算卡之后，仍是移动端唯一主操作入口。
- `PrizeRecord / History` 位于按钮之后，不再使用独立内部滚动容器抢占视口；内容变多时直接推动页面向下滚动。
- 初始态下方内容区默认不整块展开，只保留一条轻提示边提醒用户下方存在记录区；一旦出现结算、累计或历史内容，再切回真实内容区。
- 该移动端布局只改变展示层的文档流与层级，不改变掷骰、结算、重掷、重置等业务流程。

## 奖级优先级表（确认版）

| 优先级 | 奖级       | 判定条件               | 备注                       |
| ------ | ---------- | ---------------------- | -------------------------- |
| 1      | 状元插金花 | 4 个四 + 2 个一        | 最高奖                     |
| 2      | 满堂红     | 6 个四                 |                            |
| 3      | 遍地锦     | 6 个一                 |                            |
| 4      | 六子       | 6 个相同（非四非一）   | 按点数排序：6 最大，2 最小 |
| 5      | 五红       | 5 个四                 |                            |
| 6      | 五子登科   | 5 个相同（非四）       |                            |
| 7      | 状元       | 4 个四（不满足插金花） |                            |
| 8      | 对堂       | 1-2-3-4-5-6 各一       |                            |
| 9      | 三红       | 3 个四                 |                            |
| 10     | 四进       | 4 个相同（非四）       |                            |
| 11     | 二举       | 2 个四                 |                            |
| 12     | 一秀       | 1 个四                 |                            |
| 13     | 未中奖     | 无匹配                 |                            |

**带数规则**：同一奖级下，除完全满足规则的骰子外，剩余骰子求和为“带数”，带数大者优先。所有存在剩余骰子的奖级均计算带数，具体包括：五红、五子登科、状元、三红、四进、二举、一秀。完全满足 6 颗的奖级（状元插金花、满堂红、遍地锦、六子、对堂）无剩余骰子，带数为 0。例如状元 [4,4,4,4,1,5] 带 6，[4,4,4,4,1,6] 带 7，后者胜出。

## 碗碰撞体方案

采用 Heightfield 连续曲面 + 竖直挡墙，不使用 Trimesh：

- **碗底**：1 个 Heightfield（51×51 网格），高度由共享曲线 `bowlInnerHeight` 生成，碗底中心零高度、边缘陡峭
- **挡墙**：16 个竖直薄 Box 环形排列于碗口内侧，底部埋入 Heightfield 保证过渡无缝隙，仅防逃出、不拟合曲面
- **逃逸防护**：引擎帧循环中，每帧检测骰子 Y > `ESCAPE_Y`（0.9m）且向上运动时，反射纵向速度并衰减 0.3 倍（`vy = -vy * 0.3`），替代物理盖碰撞体，避免盖子与投掷初始高度冲突
- **桌面**：1 个大平面作为兜底碰撞面，防止极端情况骰子穿出场景

碗内壁曲线（纯幂函数零偏移）定义在 `config/bowl.ts`，物理层和渲染层共用同一函数，消除几何分叉。

Heightfield 与骰子凸包的窄相生产默认仍由 cannon-es 原生 `Narrowphase` 完成。`physics/heightfield-projected-aabb-narrowphase.ts` 只是命名实验：它只按凸包顶点的局部 XY 投影收紧候选 cell，保持上游 pillar/SAT/contact/friction 语义；由于移动浏览器 A/B 未达到预注册的 4/5 seeds 改善标准，未切换生产默认。

### 骰子碰撞体

当前运行时明确采用 Box 物理碰撞体（8v/6f），视觉层独立采用 `RoundedBoxGeometry` 保留圆润外观。两者职责分离，不要求视觉圆角与物理碰撞几何同构：

- **运行时物理**：`PHYSICS.diceChamferRatio = 0`，`createDiceBody()` 默认创建 `CANNON.Box`；`shapeMode: 'box' | 'chamfer'` 仍允许诊断工具显式选择形状
- **运行时视觉**：`RoundedBoxGeometry` 的 radius 由独立的 `PHYSICS.diceVisualChamferRatio` 控制，不与物理 `diceChamferRatio` 对齐
- **历史 chamfer 能力**：`dice/chamfer.ts` 的 `createChamferedCubeHull(halfSize, chamfer)` 生成 24 顶点 / 14 面的 `ConvexPolyhedron`（8 个三角形面 + 6 个八边形面），仅保留用于 sweep / 对照
- **历史实验结论**：旧 chamfer 路线曾在对应样本中将 tilt 从 2 降至 0、timeout 率从 18% 降至 8%，但 `world.step()` 成本约为 Box 的 3.2 倍，并出现与离散 Heightfield 接触相关的弹跳风险；这些数据只描述历史候选，不代表当前运行时效果
- **当前阻尼**：`linearDamping` / `angularDamping` 保持 0.35；该数值沿用至 Box 运行时，但不再表述为当前 chamfer 的补偿参数

### 碗底二次离地门禁

`physics/floor-relaunch.ts` 的 tracker v1 由统一 `runRoll()` 在每个 Cannon 物理步采样，检测“已经在碗底稳定支撑后，又在没有骰子、墙或桌面碰撞归因时异常弹起”的事件，而不是对一段轨迹做无序高度极差：

- 每颗骰子先建立至少 2 个连续步骤的真实碗底 contact，排除尚未首次落碗的空中段；
- 随后至少 6 个连续步骤无外部接触地受碗底支撑。除实际 contact 外，顶点到 Heightfield 的 clearance 不超过 0.5mm 也视为支撑，以吸收 sleeping broadphase 与数值误差；
- 支撑后的二次离地至少持续 2 个步骤，并且峰值 floor-only clearance 与从 episode 最低点开始按时间顺序计算的 world-Y rise 都严格大于 5mm，才锁存为 relaunch；
- 资格必须在首次外部接触前满足，一旦满足即锁存，之后发生接触也不能把事件抹掉。sampler 要求每颗骰子是单一、无 shape offset/orientation 的 Box；碗底也必须只有一个 Heightfield shape，且该 shape 的 offset 为零、orientation 为单位四元数。任一前提不满足时返回 unavailable，而不是静默跳过。

验收和 A/B 都把 tracker unavailable 或 relaunch event 作为硬失败。diagnostics 另外记录 `initialContactObservedDiceCount`、`armedDiceCount`，以及 secondary episode 的 `maxFloorOnly*` / `maxPreExternal*`，但 coverage 仅用于解释检测覆盖，不设比例硬门禁；因此 0 事件不能被解读为每颗骰子都已观察到初始 contact 并进入 armed 状态。

当前 200 个固定 seed（1200 颗骰子）的验收样本中，1190 颗观察到所需的真实初始 contact、1158 颗 armed；记录 54 个 secondary episode，其中 2 个全程 floor-only，relaunch event 为 0。最大 floor-only secondary clearance / ordered world-Y rise 为 2.761mm / 0，最大 pre-external secondary clearance / ordered world-Y rise 为 7.795mm / 0。即使 pre-external clearance 单项超过 5mm，只要 ordered rise 没有同时严格超过 5mm，仍不构成事件。历史 seed 171042、25042、146042 曾因 `post100 maxY-minY` 没有时间顺序和接触归因而被误报；该 legacy range 只保留为诊断对照，不再单独触发门禁。

## 测试策略

| 层级                   | 模块                                                               | 测试重点                                                                                                                                                                        | 方法                                                             |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 规则穷举               | `rules/judge.ts`                                                   | 46656 种有序结果全扫，每组只命中一个最高优先级，返回完整 JudgeResult                                                                                                            | Vitest 参数化穷举                                                |
| 规则示例               | `rules/judge.ts`                                                   | 全部 13 种奖级的典型用例 + 带数计算正确性                                                                                                                                       | 纯函数单测                                                       |
| 点数读取               | `dice/read-face.ts`                                                | 24 个立方体合法朝向 + 近边界轻微扰动样本                                                                                                                                        | 构造已知四元数                                                   |
| 停稳检测               | `dice/settle.ts`                                                   | natural/low-speed/pose-stable/timeout 路径；pose 开关、位移/角距/读面窗口与刚体不变性                                                                                           | 假时钟 + 快照序列                                                |
| 接触簇辅助             | `dice/contact-cluster-assist.ts`                                   | 默认禁用；历史 variant 的 activationDelay、簇大小、簇外活跃骰子和介入诊断                                                                                                       | node 环境纯逻辑单测                                              |
| 投掷与随机计划         | `dice/throw.ts` + `utils/random.ts`                                | 6 槽几何、整体旋转/槽位打乱、layout/dynamics 子流隔离、算法/计划版本                                                                                                            | 固定 seed + 随机单位值快照                                       |
| 物理 A/B               | `physics/roll-runner.ts` + `physics/roll-comparison.ts`            | 命名 preset、A/B-B/A 交替、watch/batch cohort、非自然结算 20s continuation 真值与安全性；schema v4 同时门禁 runtime/continuation floor-relaunch tracker                         | 统一 runner + 固定 seed + 结构化汇总                             |
| cadence 调度 A/B       | `physics/cadence-roll-runner.ts` + `physics/cadence-comparison.ts` | 5 种 normal cadence 的 reference/cap6/cap4 exact 等价、canonical 初末态、完整结果/判奖、安全与时间守恒；sustained cap4 overload 精确语义                                        | 20 watch 完整矩阵 + 180 batch 均衡矩阵 + versioned JSON artifact |
| Heightfield 窄相候选   | `physics/heightfield-projected-aabb-narrowphase.ts`                | 上游 0.20.0 顺序锁定；step/justTest differential、200-seed 完整结果/canonical 等价，生产默认仍为 cannon-default                                                                 | 随机边界场景 + 统一 runner + 严格逐项比较                        |
| 碗底二次离地           | `physics/floor-relaunch.ts`                                        | tracker v1 的 coverage、连续支撑、floor-only/pre-external 离地、ordered rise、双阈值、事件锁存与严格 shape sampler unavailable                                                  | 纯状态序列 + Box/Heightfield 采样器                              |
| 引擎调度与姿态         | `game/engine.ts` + `physics/body-transform.ts`                     | exact-cap6 默认、逐步 session/守恒、visibility pause/resume、overload error、rolling 插值、终态 raw pose、legacy rollback                                                       | mock rAF/renderer + 真实 Cannon Body                             |
| 骰子实例与资源生命周期 | `dice/create.ts` + `GameViewport.tsx`                              | 单材质 atlas InstancedMesh、6 个 body/proxy、矩阵索引同步、dispose 幂等、StrictMode 重挂载不复用已释放贴图                                                                      | Three 对象断言 + dispose spy + React StrictMode 重挂载           |
| 渲染质量与 resize      | `config/render.ts` + `scene/setup.ts`                              | 基础 DPR 1.5 上限/350 万像素预算、仅 reduced 档 rolling 1x、full 档保持基础 DPR、static 恢复、1024/512 阴影档位、重复 resize 去重、phase 切换无额外失效、不创建 PMREM           | 纯质量函数 + mock WebGLRenderer/ResizeObserver/PMREMGenerator    |
| 阴影调度               | `game/rolling-shadow.ts` + `game/engine.ts`                        | every-frame/alternate/frozen 的逐真实 render 请求序列、首帧刷新、跨轮 reset、外部 needsUpdate 不被 skip 清除                                                                    | 纯 scheduler + mock renderer.shadowMap                           |
| 开发态渲染诊断         | `GameViewport.tsx` + `game/performance-profile.ts`                 | schema v9 post-render；初末 canonical state、scheduler/collision experiment、timing/守恒、质量/阴影、结构、安全与可选 profile v2                                                | mock renderer.info/dataset/时钟 + 固定容量逐帧/逐步聚合断言      |
| 浏览器渲染 A/B         | `e2e/render-performance-ab.spec.ts`                                | 5 seeds、warm-up、ABBA/BAAB；投掷计划、初始 6-body 状态、repo provenance、结果与安全硬门禁；毫秒仅观测                                                                          | Playwright 桌面/移动项目 + JSON/video/trace artifact             |
| CSS 合成降级契约       | `ui/styles/game.css`                                               | rolling 顶栏关闭 blur、移除 shadow pulse；移动/slow 对大面积面板关闭 blur/动画；reduced-motion 单独关闭运动且保留静态视觉                                                       | 读取 CSS 文本并限定 phase/媒体查询块断言                         |
| 编排与异常状态         | `game/controller.ts` + `store.ts`                                  | 仅 rolling 首个结算回调生效；timeout/timing-overload 不读面/提交/播放/推进，error 同轮重掷或重置；history 上限、reset 保留 soundEnabled                                         | mock dice/engine/sound + 直接 store 断言                         |
| 倾斜确认流程           | `game/controller.ts` + `store.ts`                                  | onSettled 倾斜检测→tilt-confirm、35° 靠壁正常姿态不触发、pending 隔离（不写 history/prizeRecord/round）、acceptTilted 提交完整内容并播放一次、rethrow/reset 不播放 pending 结果 | 构造已知四元数 mock DicePair，settleWithoutThrow 跳过随机投掷    |
| 音频生命周期           | `audio/sound.ts`                                                   | 合法投掷前 prepare、静音不创建/恢复 context、碰撞节流/并发、noise buffer 复用、异常静默降级、dispose/remount 完整复位                                                           | AudioContext mock + controller 调用顺序 + Promise 断言           |
| 浏览器流程与 soak      | `e2e/game.spec.ts` + `e2e/soak.spec.ts`                            | 默认 exact/cannon、timeout/overload、固定队列逐轮提交、调度守恒、安全、static DPR/零帧、资源不增长；legacy 显式回滚；schema v9/v4 artifact                                      | Playwright 桌面/移动项目 + JSON artifact                         |
| 浏览器调度 A/B         | `e2e/physics-scheduler-ab.spec.ts`                                 | 5 seeds 双侧重复；投掷/初态、结果/奖级/路径、安全与重复稳定性硬门禁，终态轨迹分开分类，毫秒 observation-only                                                                    | Playwright 桌面/移动项目 + artifact schema v2                    |
| 浏览器碰撞 A/B         | `e2e/physics-collision-ab.spec.ts`                                 | 5 seeds、ABBA/BAAB；完整初末物理真值/结果/安全/渲染硬门禁，impact narrowphase p50/p95 与 repeat noise 按预注册判据                                                              | Playwright 桌面/移动项目 + artifact schema v1                    |
| 物理烟雾               | 物理层整体                                                         | 真实 cannon-es 世界 + 碗碰撞体 + 6 骰子，固定种子跑若干帧，无 NaN、不掉出桌面、能在预期时间内结算或触发超时                                                                     | 固定种子 + 帧循环                                                |

**随机数可复现**：`utils/random.ts` 默认以时间种子初始化 mulberry32，也支持固定 seed、测试随机源注入和带 salt 的独立子流。投掷 v3 在诊断中同时记录 seed、位置算法和 random-plan 版本，不把单一裸 seed 当作跨版本复现保证。

### 统一物理门禁与当前基线

| 命令                              | 用途                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `pnpm test:physics`               | watch seeds 与物理/停稳回归的快速提交前门禁                       |
| `pnpm test:seed -- --seed=<seed>` | 单 seed 结构化复现                                                |
| `pnpm test:acceptance`            | 默认 200 seeds；assist/fallback 预算均为 0，pose-stable 不超过 2% |
| `pnpm test:physics:ab`            | 命名 variant 的 watch/batch A/B 与 natural continuation 门禁      |
| `pnpm test:physics:cadence`       | versioned cadence exact 等价、安全、时间守恒与 overload 门禁      |

当前 `stratified-ring + assist off + pose on` 用统一 runner 执行的本机 2000 个固定逻辑 seed 样本中，`natural-sleep=1990`、`pose-stable-window=10`，timeout / NaN / wall crossing / escape-guard / assist / fallback 均为 0；结算时间 p95=3.3s、p99=4.8s、max=8.2s，`maxContactPenetration=0.081546`。10 个 pose-stable 样本均追加了 20s natural continuation：逐骰面值、倾斜分类、完整奖级与轨迹安全无差异；其中 seed 1673000 在 20s 预算内仍未被 Cannon 标记为 sleep，作为 exhausted 参考显式保留。聚合 12000 颗终态骰子的六面计数为 `[1984, 2046, 2009, 1984, 1973, 2004]`，按骰位计数也写入验收报告，仅作为扩大公平性研究前的观察值。以上是固定时间步的 Node 逻辑样本，用于当前算法回退对照，不是浏览器 FPS、wall-clock 性能或跨机器普适结论。

最新默认 200-seed 物理验收使用 acceptance report schema v3、roll diagnostics schema v4：200/200 为 `natural-sleep`，timeout、NaN、越墙、guard、assist、fallback 与 floor-relaunch event 均为 0。floor-relaunch tracker v1 全部 available；1200 颗骰子中 1190 颗观察到真实初始 contact、1158 颗 armed，secondary episode 54 个、floor-only 2 个；最大 floor-only clearance / ordered rise 为 2.761mm / 0，最大 pre-external clearance / ordered rise 为 7.795mm / 0。coverage 和这些最大值只记录、不设比例或单项阈值门禁；事件仍要求 clearance 与 ordered rise 同时严格超过 5mm。seed 25042 锁定为 exact step 460 / 7.6667s 自然停稳、骰面 `2,1,2,1,4,5`，canonical final-state hash 为 `ca710327c6d45df3`。该结果是当前固定逻辑样本的回退基线，不等同于真实浏览器连续投掷的目视验收。

最新 clean cadence comparison v1 证据对应 commit `e20d359fa18d0954394b23570da8315839e9448f`，artifact 为 `artifacts/cadence/head-e20d359-200-seeds.json`。它完成 780/780 headless runs、560/560 normal comparisons 与 20/20 overload checks，failure=0；repository start/end clean unchanged。该矩阵的 20 watch seeds 包含 25042，并完整覆盖 5 cadence × 2 cap；180 batch seeds 按每 cadence 36 个均衡分配，并对每个 seed 比较 cap6/cap4。它门禁生产 exact 算法的 cadence 真值，本身不包含真实 OS/tab visibility 或真实 GPU；相关用户人工确认另行记录，不能反向提升这份 artifact 的证据等级。

默认 `historical → current` A/B 共 200 个 seed，其中 19 个历史问题 seed 单列为 watch、181 个普通 seed 用于 batch 回退预算。当前实现通过门禁：batch 的 fallback 从 56.35% 降为 0，assist 从 34 轮降为 0，最大接触穿透从 0.083572 降为 0.066890；逻辑结算 p95 减少 0.1167s、p99 增加 0.25s，均在预先设定的回退预算内。watch seed 只承担真实性与安全回归，不混入这些分布预算。

### 浏览器渲染门禁与 A/B

| 命令                                      | 用途                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm test:e2e`                           | 桌面/移动正常流程、异常恢复、static/rolling DPR 和静态调度门禁                     |
| `pnpm test:e2e:soak`                      | 生产默认 exact-cap6 桌面/移动各 20 轮，门禁结果、调度守恒、安全与资源              |
| `pnpm test:e2e:soak:legacy`               | 显式 legacy-batched 回滚 preset 的桌面/移动 20 轮门禁                              |
| `pnpm bench:browser`                      | 三阶段结构、质量/profile 字段与 substeps 灾难性回退门禁；毫秒只记录                |
| `pnpm bench:browser:render-ab`            | 5 seeds × ABBA/BAAB 的 baseline/candidate 配对实验，行为与安全硬门禁、性能只作观测 |
| `pnpm bench:browser:physics-scheduler-ab` | legacy/exact 配对调度 A/B；行为/安全硬门禁，轨迹分类与毫秒仅观测                   |
| `pnpm bench:browser:collision-ab`         | cannon/projected-AABB 配对 A/B；完整真值硬门禁，impact 窄相按预注册判据评估        |

用户于 2026-08-14 明确确认了此前列出的五个人工项：真实 OS/tab 隐藏恢复、当前真实设备画面、连续 20 轮无碗底异常弹跳、移动端视觉回归以及高频碰撞听感。它们只记录为用户报告的操作/主观验收，不等价于受控的真实 GPU 基准。本轮 UI/CSS 和程序化材质已由 schema v9 `bench:browser` 保存并人工复核桌面/移动 settled 截图；不同浏览器与更多记录 GPU/驱动的真实设备仍需单独留证。

### 独立 sweep 脚本

长时间运行的参数扫描、统计类测试已从 vitest 套件中拆出，放在 `sweep/` 目录下作为独立 `vite-node` 脚本运行。**不要将这些脚本重新写回 `src/__tests__/` 或注册为 vitest 测试。**

| 命令                                                 | 脚本                                 | 用途                                           | 典型耗时       | CLI 参数                       |
| ---------------------------------------------------- | ------------------------------------ | ---------------------------------------------- | -------------- | ------------------------------ |
| `pnpm sweep:param`                                   | `sweep/param-sweep.ts`               | box vs chamfer 多摩擦/恢复系数组合对比         | 5-30min        | `--seeds=N --variant=0,1`      |
| `pnpm sweep:sleep`                                   | `sweep/sleep-sweep.ts`               | sleepTimeLimit 值对停稳路径的影响              | 2-5min         | `--seeds=N --values=0.32,0.28` |
| `pnpm sweep:timeout`                                 | `sweep/timeout-risk.ts`              | 大批量种子的超时率统计                         | 3-10min        | `--seeds=N`（默认 500）        |
| `pnpm sweep:jitter`                                  | `sweep/jitter-diagnose.ts`           | 特定种子的抖动峰值角诊断                       | 2-5min         | `--seeds=... --variant=0,1`    |
| `pnpm sweep:tilt`                                    | `sweep/tilt-stats.ts`                | 倾斜骰子概率分布统计                           | 1-3min         | `--trials=N`（默认 200）       |
| `pnpm sweep:bench`                                   | `sweep/shape-bench.ts`               | box / chamfer 形状性能对比基准                 | 1-3min         | `--steps=N --variant=0,1`      |
| `pnpm sweep:contact-eq`                              | `sweep/contact-equation-sweep.ts`    | 接触方程参数扫描                               | 3-10min        | `--seeds=N --values=...`       |
| `pnpm sweep:contact-grid`                            | `sweep/contact-equation-grid.ts`     | 接触方程参数网格搜索                           | 5-20min        | `--seeds=N`                    |
| `pnpm sweep:contact-validate`                        | `sweep/contact-equation-validate.ts` | 对候选接触方程参数做复验                       | 3-10min        | `--seeds=N --preset=...`       |
| `pnpm sweep:solver-ab`                               | `sweep/solver-ab.ts`                 | solver 相关参数 A/B 对比                       | 3-10min        | `--seeds=N --variant=...`      |
| `pnpm sweep:parallel -- --jobs=2 sleep timeout tilt` | `scripts/run-sweeps.mjs`             | 多进程并发执行多个独立 sweep 脚本              | 取决于最长脚本 | `--jobs=N` + 任务名列表        |
| `pnpm sweep:parallel:core`                           | `scripts/run-sweeps.mjs`             | 并发执行 sleep / timeout / tilt 三类核心 sweep | 取决于最长脚本 | 预设任务组合                   |

**共享基础设施**（`sweep/lib/`）：

- `log.ts`：`createLogger(name)` → 返回 `Logger`，日志写入 `logs/<name>-<timestamp>.ndjson`，使用 `appendFileSync` 逐条追加防崩溃丢失，同时生成 `.summary.txt`
- `run-trial.ts`：`runTrial(config)` 完整执行一次投掷试验（创建世界→投掷→步进→停稳→读数→销毁），返回 `TrialResult`（seed、settlePath、settleTime、tiltCount、faces 等）；`parseArgs()` 解析 `--key=value` CLI 参数

日志输出到 `logs/` 目录（已在 `.gitignore` 中），`vitest.config.ts` 的 `exclude` 已包含 `sweep/**`。`sweep/` 目录下还存在 `bounce-baseline.ts`、`box-tilt-200seed.ts`、`combo-sweep.ts` 等一次性或历史诊断脚本，这些文件不视为稳定命令接口。

## 实现优先级

1. **P0 — 核心可玩**：物理稳定、点数读取准确、奖级判定正确、流程不卡死
2. **P1 — UI 可用**：React UI 完整、操作反馈明确、移动端可用
3. **P2 — 氛围表现**：中秋装饰、音效、粒子、高级视觉反馈
