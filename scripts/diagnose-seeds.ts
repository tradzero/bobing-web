import { createPhysicsWorld } from '../src/physics/world.ts'
import { createBowlBodies, ESCAPE_Y } from '../src/physics/bowl-body.ts'
import { setupContactMaterials, diceMaterial } from '../src/physics/materials.ts'
import { PHYSICS } from '../src/config/physics.ts'
import { SETTLE } from '../src/config/settle.ts'
import { reseed } from '../src/utils/random.ts'
import { throwDice } from '../src/dice/throw.ts'
import { readAllFacesDetailed } from '../src/dice/read-face.ts'
import * as CANNON from 'cannon-es'

for (const seed of [1776310976115, 1776311021115]) {
  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)
  createBowlBodies(world)
  const hs = PHYSICS.diceHalfSize
  const dicePairs = Array.from({ length: 6 }, () => {
    const body = new CANNON.Body({
      mass: PHYSICS.diceMass, material: diceMaterial,
      linearDamping: PHYSICS.diceLinearDamping, angularDamping: PHYSICS.diceAngularDamping,
      allowSleep: true, sleepSpeedLimit: PHYSICS.diceSleepSpeedLimit, sleepTimeLimit: PHYSICS.diceSleepTimeLimit,
    })
    body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))
    world.addBody(body)
    return { mesh: {} as any, body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map(p => p.body)
  const dt = PHYSICS.fixedTimeStep
  let t = 0
  let settled = false
  let settlePath = 'timeout'
  for (let i = 0; i < 800; i++) {
    step(dt); t += dt
    for (const { body } of dicePairs) {
      if (body.position.y > ESCAPE_Y && body.velocity.y > 0) body.velocity.y = -body.velocity.y * 0.3
    }
    if (bodies.every(b => b.sleepState === CANNON.Body.SLEEPING)) { settled = true; settlePath = 'sleep'; break }
    if (t >= SETTLE.timeout) { settlePath = 'timeout'; break }
  }
  const detailed = readAllFacesDetailed(bodies)
  console.log(`\nseed=${seed} path=${settlePath} time=${t.toFixed(2)}s`)
  for (let i = 0; i < 6; i++) {
    const d = detailed[i], b = bodies[i]
    const angle = Math.acos(Math.min(1, d.confidence)) * 180 / Math.PI
    const r = Math.sqrt(b.position.x ** 2 + b.position.z ** 2)
    const sleeping = b.sleepState === CANNON.Body.SLEEPING
    const v = b.velocity.length(), av = b.angularVelocity.length()
    const tilt = d.confidence < SETTLE.tiltThreshold ? ' ⚠TILT' : ''
    console.log(`  die${i + 1} val=${d.value} conf=${d.confidence.toFixed(3)} angle=${angle.toFixed(1)}° r=${r.toFixed(3)} y=${b.position.y.toFixed(3)} sleep=${sleeping} v=${v.toFixed(4)} av=${av.toFixed(4)}${tilt}`)
  }
  // pairwise 3D distances to find leaning pairs
  console.log('  pairwise close contacts:')
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const pi = bodies[i].position, pj = bodies[j].position
      const dist = Math.sqrt((pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2 + (pi.z - pj.z) ** 2)
      if (dist < 0.40) console.log(`    die${i + 1}-die${j + 1} dist=${dist.toFixed(4)}`)
    }
  }
  dispose()
}
