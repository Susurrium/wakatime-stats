import { makeBadge } from 'badge-maker'

export const statsUrl = 'https://api.wakatime.com/api/v1/users/current/stats/all_time'

function timestamp(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`WakaTime ${name} 必须是有效时间。`)
  }
  return new Date(value).toISOString()
}

export function makeSnapshot(payload, config, now = new Date()) {
  const data = payload?.data
  if (data?.range !== 'all_time' || data.is_up_to_date !== true) {
    throw new Error('WakaTime 累计统计尚未更新完成。')
  }
  if (!Array.isArray(data.editors) || !Array.isArray(data.categories)) {
    throw new Error('WakaTime 缺少编辑器或活动分类。')
  }
  for (const key of ['vscodeEditor', 'codexDesktopEditor']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) {
      throw new Error(`缺少统计来源配置：${key}`)
    }
  }
  if (config.vscodeEditor === config.codexDesktopEditor) {
    throw new Error('VS Code 与 Codex 的统计来源必须不同。')
  }
  function metric(editor) {
    const entries = data.editors.filter((entry) => entry.name === editor)
    if (entries.length !== 1) {
      throw new Error(`统计来源 ${editor} 应当恰好出现一次，实际为 ${entries.length} 次。`)
    }
    const seconds = entries[0].total_seconds
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`统计来源 ${editor} 的时间无效。`)
    }
    return { editor, seconds }
  }
  const metrics = {
    vscode: metric(config.vscodeEditor),
    codexAi: metric(config.codexDesktopEditor)
  }
  const ai = data.categories.filter((entry) => entry.name === 'AI Coding')
  if (ai.length !== 1 || !Number.isFinite(ai[0].total_seconds) ||
      ai[0].total_seconds < metrics.codexAi.seconds - 1) {
    throw new Error('Codex 来源时长与 AI Coding 分类不一致。')
  }
  const sourceUpdatedAt = timestamp(data.modified_at, 'modified_at')
  const fetchedAt = timestamp(now.toISOString(), 'fetchedAt')
  if (Date.parse(sourceUpdatedAt) > now.getTime() + 300_000) {
    throw new Error('WakaTime 更新时间超出当前时间。')
  }
  return { schemaVersion: 1, range: 'all_time', fetchedAt, sourceUpdatedAt, metrics }
}

export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours.toLocaleString('en-US')} hrs ${minutes % 60} mins` : `${minutes} mins`
}

export function renderBadges(snapshot) {
  const make = (label, message, color) => makeBadge({
    label, message, color, labelColor: '334155', style: 'flat'
  }) + '\n'
  const updated = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(snapshot.sourceUpdatedAt))
  return {
    'badges/vscode.svg': make('VS Code', formatDuration(snapshot.metrics.vscode.seconds), '0284c7'),
    'badges/codex-ai.svg': make('Codex AI', formatDuration(snapshot.metrics.codexAi.seconds), '059669'),
    'badges/updated.svg': make('Updated', `${updated} CST`, '64748b'),
    'stats.json': JSON.stringify(snapshot, null, 2) + '\n'
  }
}

export async function fetchStats(token, {
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  delays = [0, 5_000, 15_000, 30_000]
} = {}) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('缺少 WAKATIME_READ_TOKEN。')
  }
  let failure
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt])
    let response
    try {
      response = await fetchImpl(statsUrl, {
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
        redirect: 'error'
      })
    } catch (error) {
      failure = new Error(`WakaTime 连接失败：${error.name}`)
      continue
    }
    if ([202, 429, 500, 502, 503, 504].includes(response.status)) {
      failure = new Error(`WakaTime 暂时不可用（HTTP ${response.status}）。`)
      continue
    }
    if (!response.ok) throw new Error(`WakaTime 请求失败（HTTP ${response.status}）。`)
    const payload = await response.json()
    if (payload?.data?.is_up_to_date === false) {
      failure = new Error('WakaTime 累计统计仍在刷新。')
      continue
    }
    return payload
  }
  throw failure
}
