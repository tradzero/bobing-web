/**
 * 增量 NDJSON 日志写入器
 * 每条记录立即 appendFileSync 落盘，即使进程意外中断已完成的数据也不丢失
 */
import fs from 'node:fs'
import path from 'node:path'

const LOGS_DIR = path.resolve(process.cwd(), 'logs')

export interface Logger {
  /** 日志文件路径 */
  filePath: string
  /** 追加一条 JSON 记录（立即落盘） */
  append(record: Record<string, unknown>): void
  /** 写入汇总文本（与 NDJSON 同名 .summary.txt） */
  summary(text: string): void
  /** 追加一行纯文本到汇总文件 */
  appendSummary(line: string): void
}

/**
 * 创建日志写入器
 * @param name 脚本名称，用于生成文件名
 */
export function createLogger(name: string): Logger {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filePath = path.join(LOGS_DIR, `${name}-${ts}.ndjson`)
  const summaryPath = filePath.replace('.ndjson', '.summary.txt')

  return {
    filePath,
    append(record) {
      fs.appendFileSync(filePath, JSON.stringify(record) + '\n')
    },
    summary(text) {
      fs.writeFileSync(summaryPath, text)
    },
    appendSummary(line) {
      fs.appendFileSync(summaryPath, line + '\n')
    },
  }
}
