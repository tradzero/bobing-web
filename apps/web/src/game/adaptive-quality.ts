import { ADAPTIVE_RENDER } from '@/config/render'

/** 只决定显示分辨率，不改变物理步长；同一场景保留学习结果，避免每轮重复卡顿。 */
export function createAdaptiveQuality() {
  let level = 0
  let slowFrames = 0
  let fastFrames = 0
  return {
    get pixelRatioCap() {
      return ADAPTIVE_RENDER.pixelRatioCaps[level]
    },
    resetWindow() {
      slowFrames = 0
      fastFrames = 0
    },
    observe(deltaMs: number): boolean {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return false
      slowFrames = deltaMs > ADAPTIVE_RENDER.slowFrameMs ? slowFrames + 1 : 0
      fastFrames = deltaMs < ADAPTIVE_RENDER.fastFrameMs ? fastFrames + 1 : 0
      if (
        slowFrames >= ADAPTIVE_RENDER.slowFrameCount &&
        level < ADAPTIVE_RENDER.pixelRatioCaps.length - 1
      ) {
        level++
        slowFrames = 0
        fastFrames = 0
        return true
      }
      if (fastFrames >= ADAPTIVE_RENDER.fastFrameCount && level > 0) {
        level--
        slowFrames = 0
        fastFrames = 0
        return true
      }
      return false
    },
  }
}
