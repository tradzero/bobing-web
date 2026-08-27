import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createBowl, disposeBowlPatternLoad } from '@/scene/bowl'
import { createTable } from '@/scene/table'

function createCanvasContextStub(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() }
  return {
    beginPath: vi.fn(),
    bezierCurveTo: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    ellipse: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

function collectResources(root: THREE.Object3D): {
  meshes: THREE.Mesh[]
  materials: Set<THREE.Material>
  textures: Set<THREE.Texture>
} {
  const meshes: THREE.Mesh[] = []
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    meshes.push(object)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of objectMaterials) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
    }
  })

  return { meshes, materials, textures }
}

function disposeResources(root: THREE.Object3D): void {
  if (root instanceof THREE.Group) disposeBowlPatternLoad(root)
  const { meshes, materials, textures } = collectResources(root)
  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
  for (const mesh of meshes) mesh.geometry.dispose()
}

describe('场景美术资源预算', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => createCanvasContextStub() as never,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('海碗保持两个 mesh、两个材质和单张青花纹理', () => {
    const bowl = createBowl()
    const { meshes, materials, textures } = collectResources(bowl)
    const [wall, cap] = meshes
    const wallMaterial = wall.material as THREE.MeshPhysicalMaterial
    const capMaterial = cap.material as THREE.MeshPhysicalMaterial

    expect(meshes).toHaveLength(2)
    expect(materials.size).toBe(2)
    expect(textures.size).toBe(1)
    expect(wallMaterial.map).toBe([...textures][0])
    expect(capMaterial.map).toBeNull()
    expect(wallMaterial.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(wallMaterial.map?.wrapS).toBe(THREE.RepeatWrapping)
    expect(wall.rotation.y).toBeCloseTo(Math.PI)

    expect(wallMaterial.roughness).toBeGreaterThanOrEqual(0.24)
    expect(wallMaterial.roughness).toBeLessThanOrEqual(0.34)
    expect(wallMaterial.clearcoat).toBeGreaterThanOrEqual(0.5)
    expect(wallMaterial.clearcoat).toBeLessThanOrEqual(0.7)
    expect(wallMaterial.clearcoatRoughness).toBeGreaterThanOrEqual(0.12)
    expect(capMaterial.roughness).toBeGreaterThanOrEqual(0.2)
    expect(capMaterial.clearcoat).toBeGreaterThanOrEqual(0.5)
    expect(capMaterial.clearcoat).toBeLessThanOrEqual(0.7)

    disposeResources(bowl)
  })

  it('首屏持有待上传纹理，资产完成后直接上传解码图片并请求静态补帧', () => {
    const image = { width: 1774, height: 887 } as HTMLImageElement
    let finishLoad: ((image: HTMLImageElement) => void) | undefined
    vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
      finishLoad = onLoad
      return image
    })
    const onPatternReady = vi.fn()

    const bowl = createBowl({ onPatternReady })
    const wall = bowl.children[0] as THREE.Mesh
    const wallMaterial = wall.material as THREE.MeshPhysicalMaterial
    const pattern = wallMaterial.map
    const patternVersion = pattern!.version

    expect(pattern).toBeInstanceOf(THREE.Texture)
    expect(pattern).not.toBeInstanceOf(THREE.CanvasTexture)
    expect(onPatternReady).not.toHaveBeenCalled()

    finishLoad?.(image)

    expect(wallMaterial.map).toBe(pattern)
    expect(pattern!.version).toBe(patternVersion + 1)
    expect(pattern!.image).toBe(image)
    expect(onPatternReady).toHaveBeenCalledOnce()

    disposeResources(bowl)
  })

  it('青花资产失败时换成程序化纹样并结束加载门禁', () => {
    let failLoad: (() => void) | undefined
    vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation(
      (_url, _onLoad, _onProgress, onError) => {
        failLoad = () => onError?.(new Error('asset unavailable'))
        return {} as HTMLImageElement
      },
    )
    const onPatternReady = vi.fn()
    const bowl = createBowl({ onPatternReady })
    const wall = bowl.children[0] as THREE.Mesh
    const pendingPattern = (wall.material as THREE.MeshPhysicalMaterial).map
    const disposePendingPattern = vi.spyOn(pendingPattern!, 'dispose')

    failLoad?.()

    const fallback = (wall.material as THREE.MeshPhysicalMaterial).map
    expect(fallback).toBeInstanceOf(THREE.CanvasTexture)
    expect(fallback).not.toBe(pendingPattern)
    expect(disposePendingPattern).toHaveBeenCalledOnce()
    expect(onPatternReady).toHaveBeenCalledOnce()
    disposeResources(bowl)
  })

  it('圆桌保持五个 mesh、五个材质且仅桌面主体复用一张程序化纹理', () => {
    const table = createTable()
    const { meshes, materials, textures } = collectResources(table)
    const topMaterial = meshes[0].material as THREE.MeshStandardMaterial

    expect(meshes).toHaveLength(5)
    expect(materials.size).toBe(5)
    expect(textures.size).toBe(1)
    expect(topMaterial.map).toBe([...textures][0])
    for (const mesh of meshes.slice(1)) {
      expect((mesh.material as THREE.MeshStandardMaterial).map).toBeNull()
    }

    disposeResources(table)
  })
})
