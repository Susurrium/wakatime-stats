import { fetchStats } from './stats.mjs'
import { createHash } from 'node:crypto'

export const apiBase = 'https://api.wakatime.com/api/v1/users/current/'
export const aiFields = [
  'ai_additions', 'ai_deletions', 'human_additions', 'human_deletions',
  'ai_input_tokens', 'ai_output_tokens', 'ai_sessions', 'ai_prompt_events_total',
  'ai_prompt_length_avg', 'ai_prompt_length_avg_per_session',
  'ai_prompt_length_median_per_session', 'ai_prompt_events_avg_per_session',
  'ai_prompt_events_median_per_session', 'ai_model_total_cost'
]

export function number(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} 必须是非负有限数值。`)
  }
  return value
}

export function instant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('统计时间戳无效。')
  }
  return new Date(value).toISOString()
}

export function dateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error('统计日期无效。')
  }
  return value
}

export function localDate(value, timezone) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value))
}

export function addDays(date, offset) {
  const value = new Date(`${dateKey(date)}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

export function datesBetween(start, end) {
  const dates = []
  for (let date = dateKey(start); date <= dateKey(end); date = addDays(date, 1)) dates.push(date)
  return dates
}

function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f]/.test(value)) {
    throw new Error('统计名称无效。')
  }
  return value
}

function breakdown(entries, name, required = false) {
  if (entries == null && !required) return null
  if (!Array.isArray(entries)) throw new Error(`${name} 必须是数组。`)
  const seen = new Set()
  return entries.map((entry) => {
    const name = label(entry.name)
    if (seen.has(name)) throw new Error('统计条目名称重复。')
    seen.add(name)
    return { name, seconds: number(entry.total_seconds, '分类时长') }
  })
}

function aiMetrics(data) {
  const metrics = Object.fromEntries(aiFields.map((key) => [
    key, data[key] == null ? null : number(data[key], key)
  ]))
  if (data.ai_model_breakdown == null) return { ...metrics, models: null }
  if (!Array.isArray(data.ai_model_breakdown)) throw new Error('模型统计必须是数组。')
  const names = new Set()
  const models = data.ai_model_breakdown.map((model) => {
    const name = label(model.name)
    if (names.has(name)) throw new Error('模型统计名称重复。')
    names.add(name)
    return {
      name,
      ...Object.fromEntries(['lines', 'cost', 'input_tokens', 'output_tokens', 'cached_input_tokens']
        .map((key) => [key, model[key] == null ? null : number(model[key], key)]))
    }
  })
  return { ...metrics, models }
}

export function validateConfig(config) {
  if (typeof config.timezone !== 'string' || !config.timezone) throw new Error('缺少统计时区。')
  new Intl.DateTimeFormat('en', { timeZone: config.timezone }).format()
  for (const [key, limit] of [['historyDays', 3660], ['durationDays', 31]]) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > limit) {
      throw new Error(`${key} 超出允许范围。`)
    }
  }
  for (const key of ['publicProjects', 'publicGoals']) {
    if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) {
      throw new Error(`${key} 必须是来源与公开别名的映射。`)
    }
    const aliases = Object.values(config[key]).map(label)
    if (new Set(aliases).size !== aliases.length) throw new Error('公开别名必须唯一。')
  }
  const base = new URL(config.baseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) {
    throw new Error('baseUrl 必须是不含凭据的 HTTPS 目录地址。')
  }
}

export function sanitizeStats(data, config) {
  const projects = breakdown(data.projects, '项目')
  const allowedProjects = projects?.filter(({ name }) => Object.hasOwn(config.publicProjects, name))
    .map(({ name, seconds }) => ({ name: config.publicProjects[name], seconds })) ?? []
  return {
    categories: breakdown(data.categories, '活动分类', true),
    editors: breakdown(data.editors, '编辑器', true),
    languages: breakdown(data.languages, '语言', true),
    projects: allowedProjects,
    operatingSystems: breakdown(data.operating_systems, '操作系统'),
    totalSeconds: number(data.total_seconds_including_other_language, '全部活动时间'),
    ai: aiMetrics(data)
  }
}

export function sanitizeDays(payload, config, start, end, fetchedAt) {
  if (!Array.isArray(payload?.data)) throw new Error('每日汇总缺少 data 数组。')
  const seen = new Set()
  return payload.data.map((day) => {
    const date = dateKey(day.range?.date)
    if (date < start || date > end || seen.has(date)) throw new Error('每日汇总日期重复或越界。')
    if (day.range.timezone !== config.timezone) throw new Error('每日汇总时区不一致。')
    seen.add(date)
    return {
      date, fetchedAt,
      ...sanitizeStats({ ...day, ...day.grand_total,
        total_seconds_including_other_language: day.grand_total?.total_seconds }, config)
    }
  })
}

// 仅保存小时汇总，活动区间中的文件、项目和会话信息不进入公开数据。
export function sanitizeHours(payload, date, config) {
  if (!Array.isArray(payload?.data) || payload.timezone !== config.timezone) {
    throw new Error('活动区间数据或时区无效。')
  }
  const hours = Array(24).fill(0)
  for (const entry of payload.data) {
    let cursor = number(entry.time, '活动开始时间') * 1000
    const end = cursor + number(entry.duration, '活动持续时间') * 1000
    if (end - cursor > 172_800_000) throw new Error('单段活动超过两天。')
    while (cursor < end) {
      const next = Math.min(end, (Math.floor(cursor / 3_600_000) + 1) * 3_600_000)
      if (localDate(cursor, config.timezone) === date) {
        const hour = Number(new Intl.DateTimeFormat('en-GB', {
          timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23'
        }).format(new Date(cursor)))
        hours[hour] += (next - cursor) / 1000
      }
      cursor = next
    }
  }
  return { date, hours }
}

export function sanitizeGoals(payload, config) {
  if (!Array.isArray(payload?.data)) throw new Error('目标统计缺少 data 数组。')
  return payload.data.filter((goal) => goal.is_enabled && Object.hasOwn(config.publicGoals, goal.id)).map((goal) => {
    if (!Array.isArray(goal.chart_data)) throw new Error('目标缺少进度记录。')
    const latest = [...goal.chart_data].sort((a, b) => Date.parse(b.range.end) - Date.parse(a.range.end))[0]
    return {
      name: config.publicGoals[goal.id], targetSeconds: number(goal.seconds, '目标秒数'),
      period: label(goal.delta), status: label(goal.status),
      actualSeconds: latest ? number(latest.actual_seconds, '目标实际秒数') : null,
      periodTarget: latest ? number(latest.goal_seconds, '本期目标秒数') : null
    }
  })
}

export async function collect(token, config, previous, now = new Date(), request = fetchStats) {
  validateConfig(config)
  const fetchedAt = now.toISOString()
  const payload = await request(token)
  const data = payload?.data
  if (data?.range !== 'all_time' || data.is_up_to_date !== true || data.timezone !== config.timezone) {
    throw new Error('累计统计范围、时区或更新状态无效。')
  }
  const sourceUpdatedAt = instant(data.modified_at)
  if (Date.parse(sourceUpdatedAt) > now.getTime() + 300_000) throw new Error('源更新时间超出当前时间。')
  const today = localDate(now, config.timezone)
  const accountStart = localDate(instant(data.start), config.timezone)
  const sourceRange = { start: instant(data.start), end: instant(data.end),
    includingToday: typeof data.is_including_today === 'boolean' ? data.is_including_today : null }
  if (accountStart > today || typeof data.writes_only !== 'boolean') throw new Error('统计起点或读写过滤设置无效。')
  if (Date.parse(sourceRange.end) < Date.parse(sourceRange.start)) throw new Error('统计时间范围无效。')
  number(data.timeout, '活动合并间隔')
  const allTime = sanitizeStats(data, config)
  const privacyHash = createHash('sha256').update(JSON.stringify([config.publicProjects, config.publicGoals])).digest('hex')
  const start = [accountStart, addDays(today, 1 - config.historyDays)].sort().at(-1)
  const compatible = previous?.schemaVersion === 2 && previous.timezone === config.timezone &&
    previous.timeout === data.timeout && previous.writesOnly === data.writes_only && previous.privacyHash === privacyHash
  const history = new Map(compatible ? previous.days.map((day) => [day.date, day]) : [])
  const sources = {}
  async function optional(path, normalize) {
    try {
      return { status: 'ready', data: normalize(await request(token, { url: `${apiBase}${path}` })) }
    } catch (error) {
      if (![402, 403].includes(error.status)) throw error
      return { status: 'unavailable', reason: `HTTP ${error.status}，需要核对账号套餐或读取权限。`, data: null }
    }
  }
  // 首次补齐可访问历史，此后复核最近七天并重试未知日期。
  for (let to = today; to >= start; to = addDays(to, -7)) {
    const from = [start, addDays(to, -6)].sort().at(-1)
    const needsRefresh = datesBetween(from, to).some((date) => !history.has(date) || date >= addDays(today, -6))
    if (!needsRefresh) continue
    const query = new URLSearchParams({ start: from, end: to, timezone: config.timezone,
      timeout: String(number(data.timeout, '活动合并间隔')), writes_only: String(data.writes_only) })
    const response = await optional(`summaries?${query}`, (payload) => sanitizeDays(payload, config, from, to, fetchedAt))
    sources.summaries = { status: response.status, reason: response.reason ?? null }
    if (response.data) for (const day of response.data) history.set(day.date, day)
    if (response.status === 'unavailable') break
  }
  const hourly = []
  for (const date of datesBetween([start, addDays(today, 1 - config.durationDays)].sort().at(-1), today).reverse()) {
    const query = new URLSearchParams({ date, timezone: config.timezone, slice_by: 'category',
      timeout: String(data.timeout), writes_only: String(data.writes_only) })
    const response = await optional(`durations?${query}`, (payload) => sanitizeHours(payload, date, config))
    sources.durations = { status: response.status, reason: response.reason ?? null }
    if (response.data) hourly.push(response.data)
    if (response.status === 'unavailable') break
  }
  const goals = await optional('goals', (payload) => sanitizeGoals(payload, config))
  sources.goals = { status: goals.status, reason: goals.reason ?? null }
  return {
    payload,
    library: {
      schemaVersion: 2, timezone: config.timezone, timeout: data.timeout,
      writesOnly: data.writes_only, fetchedAt, sourceUpdatedAt,
      privacyHash, sourceRange, accountStart, start, end: today, allTime,
      days: [...history.values()].sort((a, b) => a.date.localeCompare(b.date)),
      hourly: hourly.sort((a, b) => a.date.localeCompare(b.date)), goals: goals.data, sources
    }
  }
}
