import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchStats, makeSnapshot, renderBadges } from './stats.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

try {
  const config = JSON.parse(await readFile(resolve(root, 'config.json'), 'utf8'))
  const payload = await fetchStats(process.env.WAKATIME_READ_TOKEN)
  const snapshot = makeSnapshot(payload, config)
  // 验证和生成全部成功后才写入；工作流仅提交成功执行的整批产物。
  const files = renderBadges(snapshot)
  const staging = resolve(root, 'artifacts/generated')
  await mkdir(staging, { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    const temporary = resolve(staging, name)
    const destination = resolve(root, name)
    await mkdir(dirname(temporary), { recursive: true })
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(temporary, contents, 'utf8')
    await rename(temporary, destination)
  }
  console.log(`Updated VS Code: ${snapshot.metrics.vscode.seconds}s; Codex Desktop: ${snapshot.metrics.codexAi.seconds}s; source: ${snapshot.sourceUpdatedAt}`)
} catch (error) {
  // 错误只输出诊断消息，不输出请求头和原始统计响应。
  const token = process.env.WAKATIME_READ_TOKEN
  console.error(token ? error.message.replaceAll(token, '[REDACTED]') : error.message)
  process.exitCode = 1
}
