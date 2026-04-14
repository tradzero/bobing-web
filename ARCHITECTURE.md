# 博饼小游戏 - 技术架构

## 技术栈

| 层面 | 选型 | 版本策略 |
|------|------|----------|
| 工程基座 | Vite + TypeScript | latest stable |
| 包管理 | pnpm | latest stable |
| UI 层 | React | 19.x |
| 状态管理 | Zustand | 5.x |
| 3D 渲染 | Three.js（原生命令式，不使用 R3F） | latest stable |
| 物理引擎 | cannon-es（原生命令式） | latest stable |
| 测试 | Vitest | latest stable |
| CSS | CSS Modules + CSS Variables | — |

## 架构原则

1. **React 不侵入 3D 层**：Three.js 和 cannon-es 保持命令式调用，React 只负责 DOM UI overlay。Canvas 容器由 GameViewport 组件提供 ref，引擎实例的创建和销毁在该组件的 useEffect 中完成。GameViewport 接受 children，内部通过 GameControllerContext.Provider 包裹 canvas + children，overlay 组件作为 children 渲染在 Provider 内部，确保能通过 useGameController() 获取 controller 实例。
2. **Zustand 单向写入**：Store 的 actions 为纯状态设置器（只做 setState，无业务逻辑）。所有业务流程入口收归 GameController 一处，controller 内部调用 store 设置状态。UI 组件只通过 selector 读取 store，写入权限归 controller。
3. **单一时钟源**：game/engine.ts 拥有唯一 rAF 循环，每帧内顺序执行：物理 world.step → body→mesh 同步 → 停稳检测 → renderer.render。其他模块（world.ts、settle.ts）只暴露纯函数，不自持循环或轮询。
4. **配置集中管理**：所有可调参数（物理、投掷、停稳、UI 常量）集中在 `config/` 下，不散落在业务模块中。
5. **规则数据驱动**：奖级判定规则以可枚举的数据结构定义，按 priority 升序排列（数值越小优先级越高，排在前面），判定函数为纯函数，返回完整结果对象（奖级 + 带数 + 命中详情）。
6. **响应式归 CSS**：布局、按钮尺寸、面板排列等响应式适配交给 CSS 媒体查询。脚本层仅处理 canvas resize、DPR、camera aspect ratio。
7. **核心逻辑可测试**：奖级判定、点数读取、停稳检测为纯函数/可隔离逻辑，Vitest 重点覆盖。随机数源抽为可注入接口，测试时注入确定性种子。
8. **StrictMode 幂等**：引擎初始化和销毁必须幂等。React StrictMode 会在开发环境双调用 effect，GameViewport 的 cleanup 必须完整销毁引擎实例，重建时不产生残留。

## 项目结构

```
src/
├── main.tsx                    # 入口：仅 createRoot().render(<App />)
├── App.tsx                     # React 根组件：overlay 组件作为 GameViewport 的 children
│
├── config/
│   ├── physics.ts              # 物理参数：质量、阻尼、摩擦、弹性、步长、子步进
│   ├── throw.ts                # 投掷参数：速度范围、角速度范围、初始高度
│   ├── settle.ts               # 停稳参数：速度阈值、持续时间、超时上限
│   └── ui.ts                   # UI 常量：HISTORY_MAX_LENGTH、INITIAL_ROUND；触摸目标尺寸单一来源 CSS --touch-min
│
├── game/
│   ├── engine.ts               # 运行时：唯一 rAF 循环、物理步进、mesh 同步、停稳检测、渲染、dispose
│   ├── controller.ts           # 游戏编排层：状态机、轮次推进、结算触发、重置（唯一业务入口）
│   └── store.ts                # Zustand store：游戏状态 + 纯状态设置器
│
├── scene/
│   ├── setup.ts                # Three.js 场景、renderer、灯光、摄像机（不含 rAF 循环）
│   ├── table.ts                # 桌面模型与木纹材质
│   └── bowl.ts                 # 海碗可视模型
│
├── physics/
│   ├── world.ts                # cannon-es 世界初始化、暴露 world 实例和 step 函数（不自持循环）
│   ├── bowl-body.ts            # 碗碰撞体（Heightfield 连续碗底 + 竖直挡墙）
│   └── materials.ts            # 物理材质定义与接触材质配对
│
├── dice/
│   ├── create.ts               # 骰子 mesh + rigid body 创建（含红四贴图）
│   ├── throw.ts                # 投掷逻辑：随机位置、速度、角速度（随机数源可注入）
│   ├── settle.ts               # 停稳检测：纯函数，接受骰子状态返回是否停稳（不自持轮询）
│   └── read-face.ts            # 朝上面读取：六面法线与世界 up 向量点积
│
├── rules/
│   ├── types.ts                # 奖级枚举、JudgeResult 结果对象、规则数据结构类型
│   ├── prizes.ts               # 全部奖级规则表（按 priority 升序排列，数值小 = 优先级高）
│   └── judge.ts                # 判定函数：输入 6 个点数 → 输出 JudgeResult 完整结果对象
│
├── ui/
│   ├── components/
│   │   ├── GameViewport.tsx    # 3D 容器：持有 canvas ref、创建/销毁引擎实例（幂等）；接受 children，通过 Provider 包裹
│   │   ├── ThrowButton.tsx     # 掷骰按钮（掷骰中禁用 + 状态文案）
│   │   ├── ResetButton.tsx     # 重置按钮
│   │   ├── ResultPanel.tsx     # 当轮结果面板：点数组合 + 奖级 + 带数
│   │   ├── PrizeRecord.tsx     # 本局累计奖级记录（奖池/榜单面板）
│   │   ├── History.tsx         # 最近 5 轮历史记录
│   │   └── SoundToggle.tsx     # 音效开关
│   └── styles/                 # CSS Modules 样式文件
│
├── audio/
│   └── sound.ts                # 音效管理：碰撞声、中奖提示音、节流控制
│
├── utils/
│   └── random.ts               # 可注入随机数源（生产用 Math.random，测试用固定种子）
│
└── __tests__/
    ├── judge.test.ts           # 奖级判定：全部奖级示例 + 46656 种穷举校验
    ├── read-face.test.ts       # 点数读取：24 个合法朝向 + 近边界扰动样本
    ├── settle.test.ts          # 停稳检测：假时钟 + 快照序列、多种边界场景
    ├── controller.test.ts      # 编排层集成：phase 变化、重复点击、history 上限、reset、sound
    └── physics-smoke.test.ts   # 物理烟雾：真实世界 + 碗 + 骰子，固定种子跑 N 帧，无 NaN/不穿模
```

## 核心数据流

```
用户点击掷骰按钮
    │
    ▼
React UI ──调用──▶ GameController.throw()（唯一业务入口）
    │
    ▼
GameController:
    1. 拒绝非 idle/result 阶段的调用（防重复点击）
    2. store.setPhase('rolling')  ← UI 按钮禁用
    3. dice/throw.ts → 设置骰子初始位置、速度、角速度
    │
    ▼
Engine rAF 循环（game/engine.ts，唯一时钟源）：
    每帧顺序执行：
    ① physics/world.ts → world.step()
    ② body → mesh 位置/旋转同步
    ③ dice/settle.ts → checkSettled()（纯函数，返回 boolean）
    ④ scene/setup.ts → renderer.render()
    │
    ▼
settle 返回 true（全部 sleep 或速度持续低于阈值 或 超时兜底）
    │
    ▼
Engine 回调 → GameController.onSettled():
    4. dice/read-face.ts → 读取 6 颗骰子朝上点数
    5. rules/judge.ts → 判定奖级 → 返回 JudgeResult 完整对象
    6. store.setResult({ phase: 'result', diceValues, result, round++, history, record })
    │
    ▼
React UI 响应 store 变化：
    - ResultPanel 显示点数 + 奖级 + 带数
    - PrizeRecord 更新累计
    - History 追加记录
    - ThrowButton 恢复可用
```

## 游戏状态机

```
        throw()                        onSettled()
IDLE ──────────▶ ROLLING ──────────────────────────▶ RESULT
  ▲                                                    │
  │              reset() 或 下一轮 throw()              │
  └────────────────────────────────────────────────────┘
```

| Phase | UI 状态 | 引擎行为 |
|-------|---------|----------|
| `idle` | 掷骰按钮可用，等待操作 | 骰子静止在碗中或初始位置 |
| `rolling` | 按钮禁用，显示"骰子翻滚中" | 施加初速度 → 物理步进 → 停稳检测，全过程统一阶段 |
| `result` | 显示结果面板，按钮恢复为"再掷一次" | 骰子静止，等待下一轮或重置 |

说明：不再区分 throwing 和 settling。对 UI 来说两者表现完全一致（按钮禁用），合并为 rolling 减少边界管理复杂度。

## Zustand Store 结构（概要）

```typescript
// 判定结果完整对象
interface JudgeResult {
  prize: Prize              // 奖级枚举
  priority: number          // 优先级数值（越小越高）
  carryScore: number        // 带数（剩余骰子之和，无带数时为 0）
  matchedDice: number[]     // 命中规则的骰子点数
  remainDice: number[]      // 剩余骰子点数
  description: string       // 人类可读描述，如"状元 带7"
}

interface GameState {
  // 状态
  phase: 'idle' | 'rolling' | 'result'
  round: number
  diceValues: number[]              // 当轮 6 颗骰子点数
  currentResult: JudgeResult | null // 当轮完整判定结果
  history: HistoryEntry[]           // 最近 HISTORY_MAX_LENGTH 轮历史（默认 5，来自 config/ui.ts）
  prizeRecord: Record<Prize, number>  // 累计各奖级次数
  soundEnabled: boolean
  playerId: string | null           // 预留多人，当前默认 null

  // 纯状态设置器（仅由 GameController 调用，不对 UI 直接暴露业务语义）
  setPhase: (phase: GameState['phase']) => void
  setResult: (payload: {
    diceValues: number[]
    result: JudgeResult
  }) => void
  resetState: () => void
  toggleSound: () => void
}
```

注意：UI 组件只通过 selector 读取 store，所有业务操作（掷骰、重置）通过 GameController 实例方法调用，不直接调用 store 的 set 方法。

## 奖级优先级表（确认版）

| 优先级 | 奖级 | 判定条件 | 备注 |
|--------|------|----------|------|
| 1 | 状元插金花 | 4 个四 + 2 个一 | 最高奖 |
| 2 | 满堂红 | 6 个四 | |
| 3 | 遍地锦 | 6 个一 | |
| 4 | 六子 | 6 个相同（非四非一） | 按点数排序：6 最大，2 最小 |
| 5 | 五红 | 5 个四 | |
| 6 | 五子登科 | 5 个相同（非四） | |
| 7 | 状元 | 4 个四（不满足插金花） | |
| 8 | 对堂 | 1-2-3-4-5-6 各一 | |
| 9 | 三红 | 3 个四 | |
| 10 | 四进 | 4 个相同（非四） | |
| 11 | 二举 | 2 个四 | |
| 12 | 一秀 | 1 个四 | |
| 13 | 未中奖 | 无匹配 | |

**带数规则**：同一奖级下，除完全满足规则的骰子外，剩余骰子求和为“带数”，带数大者优先。所有存在剩余骰子的奖级均计算带数，具体包括：五红、五子登科、状元、三红、四进、二举、一秀。完全满足 6 颗的奖级（状元插金花、满堂红、遍地锦、六子、对堂）无剩余骰子，带数为 0。例如状元 [4,4,4,4,1,5] 带 6，[4,4,4,4,1,6] 带 7，后者胜出。

## 碗碰撞体方案

采用 Heightfield 连续曲面 + 竖直挡墙，不使用 Trimesh：

- **碗底**：1 个 Heightfield（51×51 网格），高度由共享曲线 `bowlInnerHeight` 生成，碗底中心零高度、边缘陡峭
- **挡墙**：16 个竖直薄 Box 环形排列于碗口内侧，底部埋入 Heightfield 保证过渡无缝隙，仅防逃出、不拟合曲面
- **逃逸防护**：引擎帧循环中，每帧检测骰子 Y > `ESCAPE_Y`（0.9m）且向上运动时，反射纵向速度并衰减 0.3 倍（`vy = -vy * 0.3`），替代物理盖碰撞体，避免盖子与投掷初始高度冲突
- **桌面**：1 个大平面作为兜底碰撞面，防止极端情况骰子穿出场景

碗内壁曲线（纯幂函数零偏移）定义在 `config/bowl.ts`，物理层和渲染层共用同一函数，消除几何分叉。

## 测试策略

| 层级 | 模块 | 测试重点 | 方法 |
|------|------|----------|------|
| 规则穷举 | `rules/judge.ts` | 46656 种有序结果全扫，每组只命中一个最高优先级，返回完整 JudgeResult | Vitest 参数化穷举 |
| 规则示例 | `rules/judge.ts` | 全部 13 种奖级的典型用例 + 带数计算正确性 | 纯函数单测 |
| 点数读取 | `dice/read-face.ts` | 24 个立方体合法朝向 + 近边界轻微扰动样本 | 构造已知四元数 |
| 停稳检测 | `dice/settle.ts` | 全 sleep 直接结算、低速窗口被中断重计时、单骰未停、超时兜底、阈值抖动不提前结算 | 假时钟 + 快照序列 |
| 编排集成 | `game/controller.ts` | phase 变化正确、rolling 中二次点击被拒、rolling 中 reset 被拒、history 只保留最近 HISTORY_MAX_LENGTH 轮、reset 清理当轮+累计、sound toggle 不影响主流程 | mock dice/judge/engine |
| 物理烟雾 | 物理层整体 | 真实 cannon-es 世界 + 碗碰撞体 + 6 骰子，固定种子跑若干帧，无 NaN、不掉出桌面、能在预期时间内结算或触发超时 | 固定种子 + 帧循环 |

**随机数可注入**：`utils/random.ts` 提供可替换的随机数源接口，生产环境使用 `Math.random`，测试时注入确定性种子生成器，确保投掷、物理烟雾和编排测试的稳定性。

## 实现优先级

1. **P0 — 核心可玩**：物理稳定、点数读取准确、奖级判定正确、流程不卡死
2. **P1 — UI 可用**：React UI 完整、操作反馈明确、移动端可用
3. **P2 — 氛围表现**：中秋装饰、音效、粒子、高级视觉反馈
