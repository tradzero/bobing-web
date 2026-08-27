import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadEnvFile } from 'node:process'

/**
 * 服务端命令统一从仓库工作目录加载可选的 .env。
 * Node 的 loadEnvFile 不会覆盖已经存在的进程环境变量，便于部署环境显式注入配置。
 */
export function loadProjectEnvFile(cwd = process.cwd()): boolean {
  const envPath = path.resolve(cwd, '.env')
  if (!existsSync(envPath)) return false
  loadEnvFile(envPath)
  return true
}
