// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import {
  DICE_COUNT,
  DICE_ATLAS,
  FACE_NORMALS,
  canvasTextureSource,
  createDice,
  createDiceSet,
  setTextureSource,
  type DicePair,
} from '@/dice/create'
import { copyBodyTransformToObject } from '@/physics/body-transform'

const FACE_MATERIAL_ORDER = [2, 5, 1, 6, 3, 4]

function averageFaceNormal(geometry: THREE.BufferGeometry, groupIndex: number): THREE.Vector3 {
  const normals = geometry.getAttribute('normal')
  const average = new THREE.Vector3()
  const verticesPerFace = geometry.getAttribute('position').count / 6
  const start = groupIndex * verticesPerFace

  for (let vertexIndex = start; vertexIndex < start + verticesPerFace; vertexIndex++) {
    average.x += normals.getX(vertexIndex)
    average.y += normals.getY(vertexIndex)
    average.z += normals.getZ(vertexIndex)
  }

  return average.normalize()
}

function makeAtlasTexture(): THREE.Texture {
  return Object.assign(new THREE.Texture(), { name: 'dice-atlas' })
}

function disposeStandaloneDice(pair: DicePair): void {
  const mesh = pair.mesh as THREE.Mesh<THREE.BufferGeometry, THREE.Material>
  const textures = new Set<THREE.Texture>()
  for (const value of Object.values(mesh.material)) {
    if (value instanceof THREE.Texture) textures.add(value)
  }
  for (const texture of textures) texture.dispose()
  mesh.material.dispose()
  mesh.geometry.dispose()
}

function faceUvBounds(geometry: THREE.BufferGeometry, groupIndex: number) {
  const uv = geometry.getAttribute('uv')
  const verticesPerFace = geometry.getAttribute('position').count / 6
  const start = groupIndex * verticesPerFace
  const bounds = { minU: 1, maxU: 0, minV: 1, maxV: 0 }

  for (let vertexIndex = start; vertexIndex < start + verticesPerFace; vertexIndex++) {
    const u = uv.getX(vertexIndex)
    const v = uv.getY(vertexIndex)
    bounds.minU = Math.min(bounds.minU, u)
    bounds.maxU = Math.max(bounds.maxU, u)
    bounds.minV = Math.min(bounds.minV, v)
    bounds.maxV = Math.max(bounds.maxV, v)
  }

  return bounds
}

describe('Dice GPU instancing', () => {
  beforeEach(() => {
    setTextureSource({ createAtlas: () => ({ map: makeAtlasTexture() }) })
  })

  afterEach(() => {
    setTextureSource(canvasTextureSource)
  })

  it('六颗骰子只有 1 geometry、1 material、1 atlas、6 instances，且保持骰面顺序', () => {
    const diceSet = createDiceSet()
    const instancedMesh = diceSet.object3d
    const material = instancedMesh.material

    expect(instancedMesh).toBeInstanceOf(THREE.InstancedMesh)
    expect(instancedMesh.count).toBe(DICE_COUNT)
    expect(diceSet.pairs).toHaveLength(DICE_COUNT)
    expect(instancedMesh.geometry).toBeInstanceOf(THREE.BufferGeometry)
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(material.map?.name).toBe('dice-atlas')
    expect(instancedMesh.geometry.groups).toEqual([
      {
        start: 0,
        count:
          instancedMesh.geometry.index?.count ??
          instancedMesh.geometry.getAttribute('position').count,
        materialIndex: 0,
      },
    ])

    // UV atlas 格子、RoundedBox 面顺序和物理 FACE_NORMALS 必须三者一致。
    FACE_MATERIAL_ORDER.forEach((faceValue, groupIndex) => {
      const expectedFace = FACE_NORMALS.find((face) => face.value === faceValue)
      const normal = averageFaceNormal(instancedMesh.geometry, groupIndex)
      expect(expectedFace).toBeDefined()
      expect(normal.x).toBeCloseTo(expectedFace!.normal.x, 6)
      expect(normal.y).toBeCloseTo(expectedFace!.normal.y, 6)
      expect(normal.z).toBeCloseTo(expectedFace!.normal.z, 6)

      const { columns, rows, faceSize, gutter } = DICE_ATLAS
      const cellSize = faceSize + gutter * 2
      const column = (faceValue - 1) % columns
      const row = Math.floor((faceValue - 1) / columns)
      const expected = {
        minU: (column * cellSize + gutter) / (columns * cellSize),
        maxU: (column * cellSize + gutter + faceSize) / (columns * cellSize),
        minV: 1 - (row * cellSize + gutter + faceSize) / (rows * cellSize),
        maxV: 1 - (row * cellSize + gutter) / (rows * cellSize),
      }
      const actual = faceUvBounds(instancedMesh.geometry, groupIndex)
      expect(actual.minU).toBeCloseTo(expected.minU, 6)
      expect(actual.maxU).toBeCloseTo(expected.maxU, 6)
      expect(actual.minV).toBeCloseTo(expected.minV, 6)
      expect(actual.maxV).toBeCloseTo(expected.maxV, 6)
    })

    // pair.mesh 只是姿态代理，不再暗中持有额外 geometry/material。
    for (const pair of diceSet.pairs) {
      expect(pair.mesh).toBeInstanceOf(THREE.Object3D)
      expect(pair.mesh).not.toBeInstanceOf(THREE.Mesh)
      expect(pair.syncVisual).toBeTypeOf('function')
    }

    expect(instancedMesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage)
    expect(instancedMesh.instanceMatrix.version).toBeGreaterThan(0)
    expect(instancedMesh.castShadow).toBe(true)
    expect(instancedMesh.receiveShadow).toBe(true)
    expect(instancedMesh.frustumCulled).toBe(false)

    diceSet.dispose()
  })

  it('syncVisual 将 body 同步后的代理姿态写入正确 instance matrix', () => {
    const diceSet = createDiceSet()
    const pair = diceSet.pairs[3]
    pair.body.position.set(0.75, 1.25, -0.5)
    pair.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 3)

    copyBodyTransformToObject(pair.body, pair.mesh, 'raw')
    const versionBefore = diceSet.object3d.instanceMatrix.version
    pair.syncVisual?.()

    const actual = new THREE.Matrix4()
    const expected = new THREE.Matrix4().compose(
      new THREE.Vector3(0.75, 1.25, -0.5),
      new THREE.Quaternion(
        pair.body.quaternion.x,
        pair.body.quaternion.y,
        pair.body.quaternion.z,
        pair.body.quaternion.w,
      ),
      new THREE.Vector3(1, 1, 1),
    )
    diceSet.object3d.getMatrixAt(3, actual)

    actual.elements.forEach((value, index) => {
      expect(value).toBeCloseTo(expected.elements[index], 6)
    })
    expect(diceSet.object3d.instanceMatrix.version).toBeGreaterThan(versionBefore)

    diceSet.dispose()
  })

  it('dispose 幂等释放 instance buffer 及共享资源，新 DiceSet 不复用已释放贴图', () => {
    const first = createDiceSet()
    const firstMaterial = first.object3d.material
    const firstMap = firstMaterial.map!
    const instanceDispose = vi.spyOn(first.object3d, 'dispose')
    const geometryDispose = vi.spyOn(first.object3d.geometry, 'dispose')
    const materialDispose = vi.spyOn(firstMaterial, 'dispose')
    const textureDispose = vi.spyOn(firstMap, 'dispose')

    first.dispose()
    first.dispose()

    expect(instanceDispose).toHaveBeenCalledOnce()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(textureDispose).toHaveBeenCalledOnce()

    const second = createDiceSet()
    expect(second.object3d.material.map).not.toBe(firstMap)
    second.dispose()
  })

  it('自定义 bump/roughness 贴图会接入材质并随 DiceSet 释放', () => {
    const assets = {
      map: Object.assign(new THREE.Texture(), { name: 'map-atlas' }),
      bumpMap: Object.assign(new THREE.Texture(), { name: 'bump-atlas' }),
      roughnessMap: Object.assign(new THREE.Texture(), { name: 'roughness-atlas' }),
    }
    setTextureSource({ createAtlas: () => assets })
    const disposes = [assets.map, assets.bumpMap, assets.roughnessMap].map((texture) =>
      vi.spyOn(texture, 'dispose'),
    )

    const diceSet = createDiceSet()
    const material = diceSet.object3d.material
    expect(material.map).toBe(assets.map)
    expect(material.bumpMap).toBe(assets.bumpMap)
    expect(material.roughnessMap).toBe(assets.roughnessMap)

    diceSet.dispose()
    for (const dispose of disposes) expect(dispose).toHaveBeenCalledOnce()
  })

  it('createDice 仍返回可独立渲染的单颗 Mesh API', () => {
    const pair = createDice()
    expect(pair.mesh).toBeInstanceOf(THREE.Mesh)
    expect(pair.mesh).not.toBeInstanceOf(THREE.InstancedMesh)
    expect((pair.mesh as THREE.Mesh).castShadow).toBe(true)
    expect((pair.mesh as THREE.Mesh).receiveShadow).toBe(true)
    expect((pair.mesh as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material).toBeInstanceOf(
      THREE.MeshPhysicalMaterial,
    )
    expect(pair.syncVisual).toBeUndefined()
    expect(pair.body.shapes).toHaveLength(1)

    disposeStandaloneDice(pair)
  })
})
