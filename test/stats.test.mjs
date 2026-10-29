import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchStats, makeSnapshot, renderBadges, formatDuration } from '../scripts/stats.mjs'

const config = { vscodeEditor: 'VS Code', codexDesktopEditor: 'Codex Vscode' }
const now = new Date('2026-10-30T02:00:00Z')
function payload() {
  return { data: {
    range: 'all_time', is_up_to_date: true, modified_at: '2026-10-30T01:00:00Z',
    editors: [
      { name: 'Codex CLI', total_seconds: 7200 },
      { name: 'VS Code', total_seconds: 497.292 },
      { name: 'Codex Vscode', total_seconds: 42670.009531 }
    ],
    categories: [{ name: 'AI Coding', total_seconds: 53002.933 }],
    projects: [{ name: 'private-project' }], secret: 'private-detail'
  } }
}

test('只发布精确匹配的两个来源，排除 CLI 与私密原始字段', () => {
  const snapshot = makeSnapshot(payload(), config, now)
  assert.equal(snapshot.metrics.codexAi.seconds, 42670.009531)
  assert.equal(snapshot.metrics.vscode.seconds, 497.292)
  const serialized = JSON.stringify(snapshot)
  for (const privateValue of ['private-project', 'private-detail', 'Codex CLI']) {
    assert.equal(serialized.includes(privateValue), false)
  }
})

test('缺少来源、重复来源、无效秒数、分类不一致和过期缓存均失败', () => {
  const changes = [
    (data) => { data.editors.pop() },
    (data) => { data.editors.push(data.editors[2]) },
    (data) => { data.editors[2].total_seconds = -1 },
    (data) => { data.categories[0].total_seconds = 1 },
    (data) => { data.is_up_to_date = false }
  ]
  for (const change of changes) {
    const input = payload()
    change(input.data)
    assert.throws(() => makeSnapshot(input, config, now))
  }
  assert.throws(() => makeSnapshot(payload(), { ...config, codexDesktopEditor: 'VS Code' }, now))
})

test('徽章使用真实指标和北京时间的源更新时间', () => {
  const badges = renderBadges(makeSnapshot(payload(), config, now))
  assert.match(badges['badges/vscode.svg'], /8 mins/)
  assert.match(badges['badges/codex-ai.svg'], /11 hrs 51 mins/)
  assert.match(badges['badges/updated.svg'], /2026-10-30 09:00 CST/)
  assert.equal(formatDuration(0), '0 mins')
})

test('处理中响应有界重试，随后读取新统计', async () => {
  let attempts = 0
  const result = await fetchStats('test-only-token', {
    delays: [0, 0], sleep: async () => {},
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-only-token')
      attempts++
      return attempts === 1 ? new Response('', { status: 202 }) : Response.json(payload())
    }
  })
  assert.equal(attempts, 2)
  assert.equal(result.data.range, 'all_time')
})

test('认证失败立即停止，服务持续失败耗尽次数后报错', async () => {
  let calls = 0
  await assert.rejects(fetchStats('test-only-token', {
    delays: [0, 0], fetchImpl: async () => {
      calls++
      return new Response('', { status: 401 })
    }
  }), /HTTP 401/)
  assert.equal(calls, 1)
  await assert.rejects(fetchStats('test-only-token', {
    delays: [0, 0], fetchImpl: async () => new Response('', { status: 503 })
  }), /HTTP 503/)
})
