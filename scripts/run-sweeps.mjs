import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'

const TASKS = {
  param: 'sweep/param-sweep.ts',
  sleep: 'sweep/sleep-sweep.ts',
  timeout: 'sweep/timeout-risk.ts',
  jitter: 'sweep/jitter-diagnose.ts',
  tilt: 'sweep/tilt-stats.ts',
  bench: 'sweep/shape-bench.ts',
  contactEq: 'sweep/contact-equation-sweep.ts',
  contactGrid: 'sweep/contact-equation-grid.ts',
  contactValidate: 'sweep/contact-equation-validate.ts',
  solverAB: 'sweep/solver-ab.ts',
}

const DEFAULT_TASKS = ['sleep', 'timeout', 'tilt']
const RAW_ARGS = process.argv.slice(2)
while (RAW_ARGS[0] === '--') RAW_ARGS.shift()
const SEP_INDEX = RAW_ARGS.indexOf('--')
const cliArgs = SEP_INDEX >= 0 ? RAW_ARGS.slice(0, SEP_INDEX) : RAW_ARGS
const forwardedArgs = SEP_INDEX >= 0 ? RAW_ARGS.slice(SEP_INDEX + 1) : []

let jobs
let listOnly = false
const requestedTasks = []

for (const arg of cliArgs) {
  if (arg === '--list') {
    listOnly = true
    continue
  }

  if (arg.startsWith('--jobs=')) {
    jobs = Number(arg.slice('--jobs='.length))
    continue
  }

  requestedTasks.push(arg)
}

const selectedTasks = requestedTasks.length > 0 ? requestedTasks : DEFAULT_TASKS

if (listOnly) {
  console.log('可用任务:')
  for (const [name, script] of Object.entries(TASKS)) {
    console.log(`  ${name.padEnd(14)} ${script}`)
  }
  process.exit(0)
}

const unknownTasks = selectedTasks.filter((task) => !(task in TASKS))
if (unknownTasks.length > 0) {
  console.error(`未知任务: ${unknownTasks.join(', ')}`)
  console.error('使用 --list 查看可用任务。')
  process.exit(1)
}

const normalizedJobs = Math.max(
  1,
  Math.min(
    selectedTasks.length,
    Number.isFinite(jobs) ? Number(jobs) : Math.max(1, Math.min(availableParallelism() - 1, 4)),
  ),
)

console.log(
  `并发运行 ${selectedTasks.length} 个 sweep，jobs=${normalizedJobs}` +
    (forwardedArgs.length > 0 ? `，透传参数: ${forwardedArgs.join(' ')}` : ''),
)

function prefixStream(stream, prefix) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      console.log(`${prefix} ${line}`)
    }
  })
  stream.on('end', () => {
    if (buffer.length > 0) {
      console.log(`${prefix} ${buffer}`)
    }
  })
}

function runTask(taskName) {
  return new Promise((resolve) => {
    const prefix = `[${taskName}]`
    const child = spawn(
      'pnpm',
      ['exec', 'vite-node', '--mode', 'lab', TASKS[taskName], ...forwardedArgs],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    )

    prefixStream(child.stdout, prefix)
    prefixStream(child.stderr, prefix)

    child.on('error', (error) => {
      console.error(`${prefix} 启动失败: ${error.message}`)
      resolve({ taskName, code: 1 })
    })

    child.on('close', (code) => {
      console.log(`${prefix} 结束，exit=${code ?? 1}`)
      resolve({ taskName, code: code ?? 1 })
    })
  })
}

async function main() {
  const failures = []
  let nextIndex = 0
  let running = 0

  await new Promise((resolve) => {
    const schedule = () => {
      if (nextIndex >= selectedTasks.length && running === 0) {
        resolve()
        return
      }

      while (running < normalizedJobs && nextIndex < selectedTasks.length) {
        const taskName = selectedTasks[nextIndex++]
        running++
        runTask(taskName)
          .then((result) => {
            if (result.code !== 0) failures.push(result)
          })
          .finally(() => {
            running--
            schedule()
          })
      }
    }

    schedule()
  })

  if (failures.length > 0) {
    console.error(
      `\n失败任务: ${failures.map((item) => `${item.taskName}(exit=${item.code})`).join(', ')}`,
    )
    process.exit(1)
  }

  console.log('\n全部任务完成。')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
