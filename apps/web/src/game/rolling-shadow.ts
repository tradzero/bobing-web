export const ROLLING_SHADOW_SCHEDULER_VERSION = 1

export const ROLLING_SHADOW_PRESETS = ['every-frame', 'alternate', 'frozen-after-first'] as const

export type RollingShadowPreset = (typeof ROLLING_SHADOW_PRESETS)[number]

export const DEFAULT_ROLLING_SHADOW_PRESET: RollingShadowPreset = 'every-frame'

export interface RollingShadowScheduleDiagnostics {
  version: typeof ROLLING_SHADOW_SCHEDULER_VERSION
  preset: RollingShadowPreset
  /** 本轮真正进入 renderer.render() 路径的 rolling 帧数。 */
  rollingRenderFrameCount: number
  /** 本轮由 rolling 策略显式请求刷新阴影贴图的次数，不表示 GPU 已完成。 */
  rollingShadowUpdateRequestCount: number
  /** 本轮连续未由 rolling 策略请求阴影刷新的最大 render 帧数。 */
  maxConsecutiveRollingFramesWithoutShadowUpdateRequest: number
}

export interface RollingShadowScheduler {
  /** 每个真正的 rolling render 前恰好调用一次；返回本帧是否请求阴影刷新。 */
  requestForRollingRender: () => boolean
  /** 新一轮开始或回到 idle 时清空逐轮计数。 */
  reset: () => void
  snapshot: () => RollingShadowScheduleDiagnostics
}

function shouldRequestUpdate(preset: RollingShadowPreset, frameIndex: number): boolean {
  // 所有 preset 的首个 rolling render 都刷新，避免沿用投掷前的静态阴影。
  if (frameIndex === 0) return true

  switch (preset) {
    case 'every-frame':
      return true
    case 'alternate':
      return frameIndex % 2 === 0
    case 'frozen-after-first':
      return false
  }
}

/**
 * 只负责 rolling render 的阴影刷新请求节奏，不读取时间或物理步数。
 * renderer 是否真正执行 shadow pass 仍由 Three.js、灯光与 WebGL 状态决定。
 */
export function createRollingShadowScheduler(
  preset: RollingShadowPreset = DEFAULT_ROLLING_SHADOW_PRESET,
): RollingShadowScheduler {
  let rollingRenderFrameCount = 0
  let rollingShadowUpdateRequestCount = 0
  let consecutiveFramesWithoutRequest = 0
  let maxConsecutiveFramesWithoutRequest = 0

  return {
    requestForRollingRender() {
      const requestUpdate = shouldRequestUpdate(preset, rollingRenderFrameCount)
      rollingRenderFrameCount++

      if (requestUpdate) {
        rollingShadowUpdateRequestCount++
        consecutiveFramesWithoutRequest = 0
      } else {
        consecutiveFramesWithoutRequest++
        maxConsecutiveFramesWithoutRequest = Math.max(
          maxConsecutiveFramesWithoutRequest,
          consecutiveFramesWithoutRequest,
        )
      }

      return requestUpdate
    },

    reset() {
      rollingRenderFrameCount = 0
      rollingShadowUpdateRequestCount = 0
      consecutiveFramesWithoutRequest = 0
      maxConsecutiveFramesWithoutRequest = 0
    },

    snapshot() {
      return {
        version: ROLLING_SHADOW_SCHEDULER_VERSION,
        preset,
        rollingRenderFrameCount,
        rollingShadowUpdateRequestCount,
        maxConsecutiveRollingFramesWithoutShadowUpdateRequest: maxConsecutiveFramesWithoutRequest,
      }
    },
  }
}
