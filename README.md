# 闽南博饼 Web 小游戏

一个使用 Three.js + cannon-es 实现的中秋博饼小游戏。

项目当前优先级是先把核心玩法、物理稳定性、结算可靠性和移动端可用性做扎实，再逐步补齐最终视觉素材。

## 当前状态

- 已完成 6 颗骰子的投掷、碰撞、停稳检测、点数读取与博饼奖级判定
- 已完成当轮结果、累计奖级记录、最近 5 轮历史记录、音效开关与重置流程
- 已完成移动端真实上下布局，不再使用可拖拽底部浮层
- 已完成桌面程序化木纹占位与海碗程序化青花占位
- 当前运行时场景只接入桌面、海碗和骰子；灯笼、月饼等摆件不在当前推进范围内
- 后续视觉方向优先是桌布方案与正式海碗纹样素材，而不是重做桌体或继续扩展桌面摆件

## 核心特性

- Three.js 命令式场景搭建，不使用 R3F
- cannon-es 固定时间步长物理模拟，渲染循环与物理解耦
- Heightfield 连续碗底 + 竖直挡墙的碗碰撞体方案，不依赖 Trimesh
- 基于六面法线与世界 up 向量点积的稳定点数读取
- sleep、低速窗口、超时兜底、接触簇辅助共同组成的停稳链路
- 奖级规则数据驱动，支持状元子级优先级与带数规则
- React + Zustand DOM overlay UI，业务写入集中在 GameController

## 技术栈

| 层面 | 选型 |
| ---- | ---- |
| 工程基座 | Vite + TypeScript |
| UI | React 19 |
| 状态管理 | Zustand |
| 3D 渲染 | Three.js |
| 物理引擎 | cannon-es |
| 测试 | Vitest |
| 样式 | 原生 CSS + CSS Variables |

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

| 命令 | 说明 |
| ---- | ---- |
| `pnpm dev` | 启动 Vite 开发服务器 |
| `pnpm build` | TypeScript 构建 + 生产打包 |
| `pnpm preview` | 本地预览生产构建结果 |
| `pnpm lint` | 运行 ESLint |
| `pnpm test` | 运行 Vitest 全量测试 |
| `pnpm test:watch` | 以 watch 模式运行 Vitest |
| `pnpm sweep:parallel:core` | 并发执行 sleep / timeout / tilt 三类核心 sweep |

## 文档索引

| 文档 | 用途 |
| ---- | ---- |
| [AGENTS.md](./AGENTS.md) | 项目目标、当前视觉方向、开发约束与工作流 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构、数据流、状态机、碰撞体方案、测试与 sweep 策略 |
| [CHECKLIST.md](./CHECKLIST.md) | 分阶段开发清单 |
| [UI-CHECKLIST.md](./UI-CHECKLIST.md) | UI 收敛项、移动端布局不变量、海碗与桌布素材待办 |

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
3. 停稳后读取每颗骰子朝上点数
4. 根据博饼规则计算最高优先级奖级
5. 若存在倾斜骰子，进入 tilt-confirm；否则直接提交结果
6. UI 展示当轮结果、累计奖级记录和最近 5 轮历史

## 测试与 sweep

`pnpm test` 覆盖的重点包括：

- 奖级判定与带数规则
- 点数读取与朝向扰动
- 停稳检测与回归种子
- 控制流、倾斜确认流程与 UI 行为
- 真实物理烟雾、逃逸防护、冻结一致性
- 接触簇辅助逻辑

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
