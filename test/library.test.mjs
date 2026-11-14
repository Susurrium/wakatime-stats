import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { collect, sanitizeStats, sanitizeDays, sanitizeHours, datesBetween } from '../scripts/data.mjs'
import { chartSpecs } from '../scripts/charts.mjs'
import { build, root } from '../scripts/build.mjs'
import { check } from '../scripts/check.mjs'
import { config, stats, day } from './fixtures.mjs'

const now = new Date('2026-11-15T01:00:00Z')

async function service(_token, options) {
  if (!options?.url) return { data: stats() }
  const url = new URL(options.url)
  if (url.pathname.endsWith('/summaries')) {
    return { data: datesBetween(url.searchParams.get('start'), url.searchParams.get('end')).map(day) }
  }
  if (url.pathname.endsWith('/durations')) return { data: [], timezone: config.timezone }
  if (url.pathname.endsWith('/goals')) return { data: [] }
  throw new Error('测试请求未识别。')
}

test('公开数据通过明确字段构造，项目使用公开别名', () => {
  const data = sanitizeStats(stats(), config)
  const serialized = JSON.stringify(data)
  for (const privateValue of ['private-project', 'not-public', 'private-machine', 'C:/private']) {
    assert.equal(serialized.includes(privateValue), false)
  }
  assert.deepEqual(data.projects, [{ name: 'Public project', seconds: 10000 }])
  assert.equal(data.ai.ai_input_tokens, 12000)
  const missing = stats()
  delete missing.ai_input_tokens
  assert.equal(sanitizeStats(missing, config).ai.ai_input_tokens, null)
  assert.throws(() => sanitizeStats({ ...stats(), ai_input_tokens: -1 }, config))
})

test('每日记录拒绝重复日期、越界、时区错误和损坏数值', () => {
  const normalize = (data) => sanitizeDays({ data }, config, '2026-11-01', '2026-11-15', now.toISOString())
  assert.throws(() => normalize([day('2026-11-01'), day('2026-11-01')]))
  assert.throws(() => normalize([day('2026-12-01')]))
  assert.throws(() => normalize([{ ...day('2026-11-01'), range: { date: '2026-11-01', timezone: 'UTC' } }]))
  assert.equal(normalize([]).length, 0)
})

test('跨小时、跨午夜活动按上海时间正确分割', () => {
  const payload = { timezone: config.timezone, data: [
    { time: Date.parse('2026-11-01T23:30:00+08:00') / 1000, duration: 5400 }
  ] }
  assert.equal(sanitizeHours(payload, '2026-11-01', config).hours[23], 1800)
  assert.equal(sanitizeHours(payload, '2026-11-02', config).hours[0], 3600)
})

test('收集记录保留未知日期，权限缺失保留可核验状态', async () => {
  const result = await collect('test-token', config, null, now, service)
  assert.equal(result.library.days.length, 15)
  assert.equal(result.library.hourly.length, 7)
  const denied = async (token, options) => {
    if (!options?.url) return service(token, options)
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
  const empty = (await collect('test-token', config, null, now, denied)).library
  assert.equal(empty.days.length, 0)
  assert.equal(empty.sources.summaries.status, 'unavailable')
  const daily = chartSpecs(empty, config).find((entry) => entry.id === 'daily')
  assert.equal(daily.status, 'unavailable')
  assert.equal(daily.option.series[0].data.every((value) => value === null), true)
  await assert.rejects(collect('test-token', config, null, now, async () => {
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  }), /Unauthorized/)
})

test('历史窗口受限时保留已取得的最近日期', async () => {
  const limited = async (token, options) => {
    if (options?.url?.includes('/summaries?') && new URL(options.url).searchParams.get('start') < '2026-11-09') {
      throw Object.assign(new Error('History unavailable'), { status: 403 })
    }
    return service(token, options)
  }
  const { library } = await collect('test-token', config, null, now, limited)
  assert.equal(library.days.length, 7)
  assert.equal(library.days[0].date, '2026-11-09')
  assert.equal(library.sources.summaries.status, 'unavailable')
  assert.equal(chartSpecs(library, config).find((entry) => entry.id === 'daily').status, 'partial')
})

test('真实 SVG 与 PNG 渲染、图表清单和整批检查', async () => {
  const { library } = await collect('test-token', config, null, now, service)
  const destination = resolve(root, 'artifacts/test-site', `${Date.now()}`)
  const manifest = await build(library, config, destination)
  assert.ok(manifest.entries.length >= 20)
  assert.equal(manifest.entries.find((entry) => entry.id === 'badge-coding').status, 'ready')
  await check(destination)
  await check(`${destination}/`)
  const html = await readFile(resolve(destination, 'index.html'), 'utf8')
  assert.match(html, /复制 Markdown/)
  assert.match(html, /name="theme"/)
  assert.equal(html.includes('private-project'), false)
  await mkdir(resolve(root, 'artifacts'), { recursive: true })
  // 浏览器回归读取此路径；测试数据只保存在忽略目录。
  await writeFile(resolve(root, 'artifacts/test-site-path.txt'), destination)
})
