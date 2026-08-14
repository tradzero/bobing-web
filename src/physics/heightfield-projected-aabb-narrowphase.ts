import * as CANNON from 'cannon-es'

/** 当前复制并收紧 cell 窗口的上游实现版本；升级 cannon-es 时必须重新 differential。 */
export const PROJECTED_AABB_NARROWPHASE_UPSTREAM_VERSION = '0.20.0'

/** cell 边界上的浮点扩张，只会多保留相邻 cell，不能缩小真实投影包络。 */
const CELL_BOUNDARY_EPSILON_RATIO = 1e-12

/**
 * 使用 convex 在 Heightfield local XY 平面的真实投影 AABB 收紧候选 cell。
 *
 * 除 cell 范围外，以下代码固定复刻 cannon-es 0.20.0 `convexHeightfield`：
 * 局部高度窗口、i/j 顺序、lower/upper pillar 顺序、bounding-sphere distance、
 * `convexConvex` 参数、justTest 早退，以及 contact/friction 生成路径均保持不变。
 * 升级 cannon-es 时必须对照上游方法逐行复审，并重跑随机接触 differential 与 seed 等价门禁。
 */
export class HeightfieldProjectedAabbNarrowphase extends CANNON.Narrowphase {
  private readonly localConvexPosition = new CANNON.Vec3()
  private readonly worldVertex = new CANNON.Vec3()
  private readonly localVertex = new CANNON.Vec3()
  private readonly worldPillarOffset = new CANNON.Vec3()
  private readonly minMax: number[] = [0, 0]
  private readonly faceList = [0]

  override convexHeightfield(
    convexShape: CANNON.ConvexPolyhedron,
    heightfieldShape: CANNON.Heightfield,
    convexPosition: CANNON.Vec3,
    heightfieldPosition: CANNON.Vec3,
    convexQuaternion: CANNON.Quaternion,
    heightfieldQuaternion: CANNON.Quaternion,
    convexBody: CANNON.Body,
    heightfieldBody: CANNON.Body,
    _convexOverrideShape?: CANNON.Shape | null,
    _heightfieldOverrideShape?: CANNON.Shape | null,
    justTest?: boolean,
  ): true | void {
    const data = heightfieldShape.data
    const elementSize = heightfieldShape.elementSize
    if (
      convexShape.vertices.length === 0 ||
      data.length < 2 ||
      data[0].length < 2 ||
      !Number.isFinite(elementSize) ||
      elementSize <= 0
    ) {
      return super.convexHeightfield(
        convexShape,
        heightfieldShape,
        convexPosition,
        heightfieldPosition,
        convexQuaternion,
        heightfieldQuaternion,
        convexBody,
        heightfieldBody,
        _convexOverrideShape,
        _heightfieldOverrideShape,
        justTest,
      )
    }

    CANNON.Transform.pointToLocalFrame(
      heightfieldPosition,
      heightfieldQuaternion,
      convexPosition,
      this.localConvexPosition,
    )

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const vertex of convexShape.vertices) {
      convexQuaternion.vmult(vertex, this.worldVertex)
      this.worldVertex.vadd(convexPosition, this.worldVertex)
      CANNON.Transform.pointToLocalFrame(
        heightfieldPosition,
        heightfieldQuaternion,
        this.worldVertex,
        this.localVertex,
      )
      minX = Math.min(minX, this.localVertex.x)
      maxX = Math.max(maxX, this.localVertex.x)
      minY = Math.min(minY, this.localVertex.y)
      maxY = Math.max(maxY, this.localVertex.y)
    }

    const epsilon = elementSize * CELL_BOUNDARY_EPSILON_RATIO
    let iMinX = Math.ceil((minX - epsilon) / elementSize) - 1
    let iMaxX = Math.floor((maxX + epsilon) / elementSize) + 1
    let iMinY = Math.ceil((minY - epsilon) / elementSize) - 1
    let iMaxY = Math.floor((maxY + epsilon) / elementSize) + 1
    const maxCellXExclusive = data.length - 1
    const maxCellYExclusive = data[0].length - 1

    if (iMaxX <= 0 || iMaxY <= 0 || iMinX >= maxCellXExclusive || iMinY >= maxCellYExclusive) {
      return
    }

    iMinX = Math.max(0, Math.min(maxCellXExclusive, iMinX))
    iMaxX = Math.max(0, Math.min(maxCellXExclusive, iMaxX))
    iMinY = Math.max(0, Math.min(maxCellYExclusive, iMinY))
    iMaxY = Math.max(0, Math.min(maxCellYExclusive, iMaxY))

    heightfieldShape.getRectMinMax(iMinX, iMinY, iMaxX, iMaxY, this.minMax)
    const radius = convexShape.boundingSphereRadius
    if (
      this.localConvexPosition.z - radius > this.minMax[1] ||
      this.localConvexPosition.z + radius < this.minMax[0]
    ) {
      return
    }

    // 以下循环顺序和调用参数固定复刻 cannon-es 0.20.0；不得顺手合并或去重 contact。
    for (let i = iMinX; i < iMaxX; i++) {
      for (let j = iMinY; j < iMaxY; j++) {
        let intersecting: boolean | void = false

        heightfieldShape.getConvexTrianglePillar(i, j, false)
        CANNON.Transform.pointToWorldFrame(
          heightfieldPosition,
          heightfieldQuaternion,
          heightfieldShape.pillarOffset,
          this.worldPillarOffset,
        )
        if (
          convexPosition.distanceTo(this.worldPillarOffset) <
          heightfieldShape.pillarConvex.boundingSphereRadius + radius
        ) {
          intersecting = this.convexConvex(
            convexShape,
            heightfieldShape.pillarConvex,
            convexPosition,
            this.worldPillarOffset,
            convexQuaternion,
            heightfieldQuaternion,
            convexBody,
            heightfieldBody,
            null,
            null,
            justTest,
            this.faceList,
            null,
          )
        }
        if (justTest && intersecting) return true

        heightfieldShape.getConvexTrianglePillar(i, j, true)
        CANNON.Transform.pointToWorldFrame(
          heightfieldPosition,
          heightfieldQuaternion,
          heightfieldShape.pillarOffset,
          this.worldPillarOffset,
        )
        if (
          convexPosition.distanceTo(this.worldPillarOffset) <
          heightfieldShape.pillarConvex.boundingSphereRadius + radius
        ) {
          intersecting = this.convexConvex(
            convexShape,
            heightfieldShape.pillarConvex,
            convexPosition,
            this.worldPillarOffset,
            convexQuaternion,
            heightfieldQuaternion,
            convexBody,
            heightfieldBody,
            null,
            null,
            justTest,
            this.faceList,
            null,
          )
        }
        if (justTest && intersecting) return true
      }
    }
  }
}
