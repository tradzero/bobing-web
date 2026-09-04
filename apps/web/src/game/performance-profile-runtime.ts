export const ROLLING_CPU_PROFILE_VERSION = 2

/**
 * CPU 分段采样只属于隔离浏览器实验。生产入口保留明确失败函数，避免误把
 * profile query 当作线上能力，同时让实验实现退出生产静态依赖图。
 */
export function createRollingCpuProfileAccumulator(): never {
  throw new Error('rolling CPU profile is available only in the e2e lab build')
}
