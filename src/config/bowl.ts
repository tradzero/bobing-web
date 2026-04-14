/**
 * 碗几何参数与内壁曲线 —— 物理层和渲染层的单一真源
 *
 * 不依赖 cannon-es 或 three.js，纯数据 + 纯函数
 */

/** 碗半径 (m) */
export const BOWL_RADIUS = 1.3
/** 碗高度 (m) */
export const BOWL_HEIGHT = 0.7
/** 碗壁厚度 (m) */
export const BOWL_THICKNESS = 0.06
/** 碗内壁最大半径 (m) */
export const BOWL_INNER_RADIUS = BOWL_RADIUS - BOWL_THICKNESS
/** 碗内壁曲线幂次 */
const BOWL_EXPONENT = 3.5

/**
 * 根据到碗中心的水平距离计算碗内壁高度
 * 纯幂函数零偏移曲线：h = BOWL_HEIGHT * (d / BOWL_INNER_RADIUS) ^ 3.5
 * - r=0 处坡度 0°（平坦碗底），中段平缓，边缘陡峭
 */
export function bowlInnerHeight(d: number): number {
  const clamped = Math.max(0, Math.min(d, BOWL_INNER_RADIUS))
  return BOWL_HEIGHT * Math.pow(clamped / BOWL_INNER_RADIUS, BOWL_EXPONENT)
}

/**
 * 按等分段数采样碗内壁轮廓点（从碗底中心到碗口）
 * 返回 { r, y } 数组，r 为水平半径，y 为高度
 */
export function sampleBowlInnerProfile(segments: number): { r: number; y: number }[] {
  const points: { r: number; y: number }[] = []
  for (let i = 0; i <= segments; i++) {
    const r = (i / segments) * BOWL_INNER_RADIUS
    points.push({ r, y: bowlInnerHeight(r) })
  }
  return points
}
