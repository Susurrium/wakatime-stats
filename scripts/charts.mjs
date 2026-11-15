import * as echarts from 'echarts'
import sharp from 'sharp'
import { makeBadge } from 'badge-maker'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { addDays, datesBetween, localDate, number } from './data.mjs'
import { formatDuration } from './stats.mjs'

const themes = {
  light: { background: '#ffffff', text: '#17212b', muted: '#536170', grid: '#e5e9ed',
    colors: ['#0284c7', '#059669', '#b45309', '#7c3aed', '#be185d', '#475569'] },
  dark: { background: '#111820', text: '#edf2f7', muted: '#a6b3c1', grid: '#344251',
    colors: ['#38bdf8', '#34d399', '#fbbf24', '#c4b5fd', '#f9a8d4', '#cbd5e1'] }
}

function category(data, name) {
  return data.categories.find((entry) => entry.name === name)?.seconds ?? 0
}

function ranking(entries, metric = 'seconds', limit = 10) {
  return [...(entries ?? [])].filter((entry) => entry[metric] != null)
    .sort((a, b) => b[metric] - a[metric]).slice(0, limit)
}

function bars(entries, metric = 'seconds', divisor = 3600, limit = 10) {
  const sorted = ranking(entries, metric, limit).reverse()
  return {
    xAxis: { type: 'value', name: divisor === 3600 ? 'hours' : metric },
    yAxis: { type: 'category', data: sorted.map((entry) => entry.name), axisLabel: { width: 130, overflow: 'truncate' } },
    series: [{ type: 'bar', barMaxWidth: 24, data: sorted.map((entry) => entry[metric] / divisor) }]
  }
}

function lines(days, fields) {
  return {
    legend: { top: 56 },
    xAxis: { type: 'category', data: days.map(({ date }) => date.slice(5)), boundaryGap: false },
    yAxis: { type: 'value', name: 'hours' },
    series: fields.map(([name, read]) => ({ name, type: 'line', showSymbol: false, connectNulls: false,
      data: days.map((day) => day.unknown ? null : read(day)), lineStyle: { width: 2 } }))
  }
}

export function chartSpecs(library, config) {
  if (library.schemaVersion !== 2) throw new Error('图表需要版本 2 数据。')
  const windowStart = [library.accountStart, addDays(library.end, -29)].sort().at(-1)
  const stored = new Map(library.days.map((day) => [day.date, day]))
  const days = datesBetween(windowStart, library.end).map((date) => stored.get(date) ?? { date, unknown: true })
  const known = days.filter((day) => !day.unknown)
  const coverage = `${known.length}/${days.length} days available; ${library.timezone}`
  const dailyStatus = known.length === 0 ? 'unavailable' : known.length < days.length ? 'partial' : 'ready'
  const dailyReason = library.sources.summaries?.reason ?? 'Daily data has not been collected.'
  const all = library.allTime
  const specs = []
  function add(id, title, description, group, range, option, available = true, reason = 'No data reported.') {
    specs.push({ id, title, description, group, range, option,
      status: available ? 'ready' : 'unavailable', reason: available ? null : reason,
      subtitle: range === 'all-time' ? `Through ${localDate(library.sourceRange.end, library.timezone)}; ${library.timezone}` : coverage })
  }
  function daily(id, title, description, fields) {
    const hasMetric = known.some((day) => fields.some(([, read]) => read(day) != null))
    add(id, title, description, 'activity', 'last-30-days', lines(days, fields), hasMetric,
      known.length ? 'Required metrics were not reported.' : dailyReason)
    if (hasMetric) {
      const incomplete = days.some((day) => day.unknown || fields.some(([, read]) => read(day) == null))
      specs.at(-1).status = incomplete ? 'partial' : 'ready'
    }
  }

  add('overview', 'Activity overview', '累计全部活动、Coding 与 AI Coding 分类时长。', 'activity', 'all-time', {
    xAxis: { type: 'value', name: 'hours' },
    yAxis: { type: 'category', data: ['AI Coding', 'Coding', 'All activity'] },
    series: [{ type: 'bar', barMaxWidth: 26, data: [category(all, 'AI Coding') / 3600,
      category(all, 'Coding') / 3600, all.totalSeconds / 3600] }]
  })
  const totalHours = known.reduce((sum, day) => sum + day.totalSeconds / 3600, 0)
  const best = [...known].sort((a, b) => b.totalSeconds - a.totalSeconds)[0]
  add('summary', 'Recent activity summary', '最近 30 天已取得记录的总活动、按记录天数计算的日均、活跃天数和最高活动日。', 'activity', 'last-30-days', {
    graphic: [
      ['Activity hours', totalHours.toFixed(1)],
      ['Daily average hours', known.length ? (totalHours / known.length).toFixed(1) : 'Unknown'],
      ['Active days', String(known.filter((day) => day.totalSeconds > 0).length)],
      ['Best day', best ? `${best.date}\n${formatDuration(best.totalSeconds)}` : 'Unknown']
    ].map(([name, value], index) => ({ type: 'group', left: index % 2 ? '54%' : '8%', top: index < 2 ? 110 : 210,
      children: [
        { type: 'text', style: { text: name, fontSize: 12 } },
        { type: 'text', top: 26, style: { text: value, fontSize: 19, lineHeight: 24 } }
      ] }))
  }, known.length > 0, dailyReason)
  if (known.length) specs.at(-1).status = dailyStatus
  for (const [id, title, entries] of [
    ['languages', 'Languages', all.languages], ['editors', 'Editors', all.editors],
    ['categories', 'Activity categories', all.categories], ['projects', 'All projects', all.projects],
    ['operating-systems', 'Operating systems', all.operatingSystems]
  ]) {
    const projects = id === 'projects'
    add(id, title, projects ? '按累计活动小时排列，展示 WakaTime 返回的全部项目。' : '按累计活动小时排列，显示前十项。',
      'breakdown', 'all-time', bars(entries, 'seconds', 3600, projects ? Infinity : 10),
      Boolean(entries?.length), 'No breakdown reported.')
  }
  daily('daily', 'Daily activity', '每日全部活动小时；缺失日期保留间隔。', [['All activity', (day) => day.totalSeconds / 3600]])
  daily('coding-trend', 'Coding and AI Coding', '每日 Coding 与 AI Coding 分类小时。', [
    ['Coding', (day) => category(day, 'Coding') / 3600], ['AI Coding', (day) => category(day, 'AI Coding') / 3600]
  ])
  const weekday = Array(7).fill(0)
  const counts = Array(7).fill(0)
  for (const day of known) {
    const index = (new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7
    weekday[index] += day.totalSeconds / 3600
    counts[index]++
  }
  add('weekdays', 'Activity by weekday', '最近 30 天各星期的平均活动小时，分母仅含已取得数据的日期。', 'activity', 'last-30-days', {
    xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
    yAxis: { type: 'value', name: 'hours / observed day' },
    series: [{ type: 'bar', data: weekday.map((hours, index) => counts[index] ? hours / counts[index] : null) }]
  }, known.length > 0, dailyReason)
  if (known.length) specs.at(-1).status = dailyStatus

  const year = library.end.slice(0, 4)
  const calendarDays = library.days.filter((day) => day.date.startsWith(year))
  add('calendar', `${year} activity calendar`, '每天的全部活动小时，空白表示尚无已验证记录。', 'activity', year, {
    calendar: { range: year, top: 110, left: 55, right: 30, cellSize: ['auto', 22],
      yearLabel: { show: false }, dayLabel: { firstDay: 1 }, itemStyle: { borderWidth: 2 } },
    visualMap: { min: 0, max: Math.max(1, ...calendarDays.map((day) => day.totalSeconds / 3600)),
      calculable: false, orient: 'horizontal', left: 'center', bottom: 16 },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar',
      data: calendarDays.map((day) => [day.date, day.totalSeconds / 3600]) }]
  }, calendarDays.length > 0, dailyReason)
  const expected = datesBetween([library.accountStart, `${year}-01-01`].sort().at(-1), library.end).length
  specs.at(-1).subtitle = `${calendarDays.length}/${expected} days available; ${library.timezone}`
  if (calendarDays.length && calendarDays.length < expected) specs.at(-1).status = 'partial'

  const hourCells = new Map()
  for (const day of library.hourly) {
    const weekdayIndex = (new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7
    day.hours.forEach((seconds, hour) => {
      const key = `${hour}-${weekdayIndex}`
      const previous = hourCells.get(key)?.[2] ?? 0
      hourCells.set(key, [hour, weekdayIndex, previous + number(seconds, '小时活动') / 3600])
    })
  }
  const hourlyData = [...hourCells.values()]
  add('hours', 'Activity by hour', '已取得的日内活动区间按本地小时切分；重叠区间沿用来源统计口径。', 'activity', 'recent-hours', {
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, hour) => String(hour)) },
    yAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
    visualMap: { min: 0, max: Math.max(1, ...hourlyData.map((entry) => entry[2])), orient: 'horizontal',
      left: 'center', bottom: 10, calculable: false },
    series: [{ type: 'heatmap', data: hourlyData }]
  }, library.hourly.length > 0, library.sources.durations?.reason ?? 'No hourly data reported.')
  specs.at(-1).subtitle = `${library.hourly[0]?.date ?? 'Unknown'} to ${library.hourly.at(-1)?.date ?? 'Unknown'}; ${library.timezone}`

  const ai = all.ai
  add('code-changes', 'Code additions and deletions', '来源报告的 AI 与人工代码新增、删除行数。', 'ai', 'all-time', {
    legend: { top: 56 }, xAxis: { type: 'category', data: ['AI', 'Human'] },
    yAxis: { type: 'value', name: 'lines' },
    series: [['Added', 'additions'], ['Deleted', 'deletions']].map(([name, suffix]) => ({
      name, type: 'bar', data: [ai[`ai_${suffix}`], ai[`human_${suffix}`]]
    }))
  }, ['ai_additions', 'ai_deletions', 'human_additions', 'human_deletions'].every((key) => ai[key] != null))
  for (const [id, title, metric, divisor] of [
    ['models', 'AI model code changes', 'lines', 1], ['model-costs', 'Estimated AI model cost', 'cost', 1]
  ]) {
    add(id, title, metric === 'cost' ? '按来源 Token 价格估算的美元费用。' : '按模型报告的指标排行。', 'ai', 'all-time',
      bars(ai.models, metric, divisor), Boolean(ai.models?.some((model) => model[metric] != null)))
  }
  for (const [id, title, metric] of [
    ['model-input-tokens', 'AI model input tokens', 'input_tokens'],
    ['model-output-tokens', 'AI model output tokens', 'output_tokens']
  ]) {
    const totals = new Map()
    for (const day of known) {
      for (const model of day.ai.models ?? []) {
        if (model[metric] != null) totals.set(model.name, (totals.get(model.name) ?? 0) + model[metric])
      }
    }
    const models = [...totals].map(([name, value]) => ({ name, [metric]: value }))
    add(id, title, '最近 30 天每日汇总中可用的模型 Token 累计量。', 'ai', 'last-30-days', bars(models, metric, 1), models.length > 0)
    if (models.length && days.some((day) => day.unknown || day.ai.models == null ||
        day.ai.models.some((model) => model[metric] == null))) specs.at(-1).status = 'partial'
  }
  daily('token-trend', 'AI tokens per day', '每日输入与输出 Token，缺失字段保留空白。', [
    ['Input', (day) => day.ai.ai_input_tokens], ['Output', (day) => day.ai.ai_output_tokens]
  ])
  specs.at(-1).option.yAxis.name = 'tokens'
  specs.at(-1).group = 'ai'
  daily('sessions', 'AI sessions and prompts', '每日会话数与提示次数；跨日会话分别按当天来源统计。', [
    ['Sessions', (day) => day.ai.ai_sessions], ['Prompts', (day) => day.ai.ai_prompt_events_total]
  ])
  specs.at(-1).option.yAxis.name = 'count'
  specs.at(-1).group = 'ai'
  daily('prompt-length', 'AI prompt length', '每日提示平均字符数及按会话汇总的中位数。', [
    ['Average', (day) => day.ai.ai_prompt_length_avg],
    ['Session median', (day) => day.ai.ai_prompt_length_median_per_session]
  ])
  specs.at(-1).option.yAxis.name = 'characters'
  specs.at(-1).group = 'ai'
  const goals = library.goals?.filter((goal) => goal.actualSeconds != null && goal.periodTarget != null) ?? []
  add('goals', 'Daily programming goal', 'WakaTime 中实际启用的每日 3 小时目标，范围包含全部项目、语言和编辑器及每天。', 'goals', 'current-period', {
    legend: { top: 56 }, xAxis: { type: 'value', name: 'hours' },
    yAxis: { type: 'category', data: goals.map((goal) => goal.name) },
    series: [['Actual', 'actualSeconds'], ['Target', 'periodTarget']].map(([name, key]) => ({
      name, type: 'bar', data: goals.map((goal) => goal[key] / 3600)
    }))
  }, goals.length > 0, library.sources.goals?.reason ?? 'No matching daily goal with activity data was reported by WakaTime.')
  return specs
}

function renderChart(spec, themeName, width, height) {
  const theme = themes[themeName]
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    const unavailable = spec.status === 'unavailable'
    const option = {
      animation: false, backgroundColor: theme.background, color: theme.colors,
      textStyle: { color: theme.text, fontFamily: 'Arial, Noto Sans CJK SC, Microsoft YaHei, sans-serif' },
      title: { text: spec.title, subtext: unavailable ? 'Unavailable' : spec.subtitle,
        left: 22, top: 16, textStyle: { color: theme.text, fontSize: width < 500 ? 16 : 19 },
        subtextStyle: { color: theme.muted, fontSize: 11, width: width - 44, overflow: 'break' } },
      grid: { left: width < 500 ? 110 : 155, right: 30, top: 100, bottom: 55 },
      ...(!unavailable ? spec.option : { graphic: [{ type: 'text', left: 24, top: 'middle',
        style: { text: spec.reason, fill: theme.muted, width: width - 48, overflow: 'break', fontSize: 12 } }] })
    }
    for (const axis of ['xAxis', 'yAxis']) {
      if (option[axis]) option[axis] = { ...option[axis], nameTextStyle: { color: theme.muted },
        axisLabel: { ...option[axis].axisLabel, color: theme.muted }, axisLine: { lineStyle: { color: theme.grid } },
        splitLine: { lineStyle: { color: theme.grid } } }
    }
    if (option.legend) option.legend.textStyle = { color: theme.text, fontSize: 11 }
    if (spec.id === 'projects' && !unavailable) {
      const labelWidth = width < 500 ? 160 : 240
      option.grid.left = labelWidth + 24
      option.yAxis.axisLabel = { color: theme.muted, width: labelWidth, overflow: 'break', fontSize: 11, lineHeight: 14 }
    }
    if (option.visualMap) {
      option.visualMap.inRange = { color: [theme.grid, theme.colors[0]] }
      option.visualMap.textStyle = { color: theme.muted }
    }
    if (option.calendar) {
      if (width < 500) {
        const values = option.series[0].data
        option.calendar = Array.from({ length: 4 }, (_, quarter) => {
          const start = `${spec.range}-${String(quarter * 3 + 1).padStart(2, '0')}-01`
          const end = new Date(Date.UTC(Number(spec.range), quarter * 3 + 3, 0)).toISOString().slice(0, 10)
          return { range: [start, end], top: 120 + quarter * 180, left: 50, right: 20,
            cellSize: ['auto', 19], yearLabel: { show: false }, dayLabel: { firstDay: 1 } }
        })
        option.series = option.calendar.map((calendar, index) => ({ type: 'heatmap',
          coordinateSystem: 'calendar', calendarIndex: index,
          data: values.filter(([date]) => date >= calendar.range[0] && date <= calendar.range[1]) }))
      }
      for (const calendar of Array.isArray(option.calendar) ? option.calendar : [option.calendar]) {
        calendar.itemStyle = { color: theme.grid, borderColor: theme.background, borderWidth: 2 }
        calendar.dayLabel.color = theme.muted
        calendar.monthLabel = { color: theme.muted }
      }
    }
    if (option.graphic && !unavailable) {
      for (const group of option.graphic) {
        for (const child of group.children ?? []) child.style.fill = theme.text
      }
    }
    chart.setOption(option)
    const document = new DOMParser().parseFromString(chart.renderToSVGString(), 'image/svg+xml')
    const svg = document.documentElement
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-labelledby', `${spec.id}-title ${spec.id}-description`)
    for (const [tag, id, text] of [
      ['title', `${spec.id}-title`, spec.title],
      ['desc', `${spec.id}-description`, `${spec.description} ${spec.subtitle} ${spec.reason ?? ''}`]
    ]) {
      const element = document.createElementNS(svg.namespaceURI, tag)
      element.setAttribute('id', id)
      element.appendChild(document.createTextNode(text))
      svg.appendChild(element)
    }
    return new XMLSerializer().serializeToString(document)
  } finally {
    chart.dispose()
  }
}

export async function renderLibrary(library, config) {
  const files = {}
  const entries = []
  async function asset(spec, path, svg, theme, size) {
    const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer()
    const metadata = await sharp(Buffer.from(svg)).metadata()
    files[`${path}.svg`] = svg
    files[`${path}.png`] = png
    const variant = { theme, size, width: metadata.width, height: metadata.height,
      svg: `${path}.svg`, png: `${path}.png` }
    spec.variants.push(variant)
  }
  for (const [id, name, seconds, color] of [
    ['coding', 'Code Time', category(library.allTime, 'Coding'), '0284c7'],
    ['ai-coding', 'AI Code Time', category(library.allTime, 'AI Coding'), '059669'],
    ['total-activity', 'Total Activity', library.allTime.totalSeconds, '475569'],
    ...library.allTime.editors.map((editor) => [
      `editors/${Buffer.from(editor.name).toString('base64url')}`, editor.name, editor.seconds, '475569'
    ])
  ]) {
    const spec = { id: `badge-${id}`, title: name, description: id.startsWith('editors/') ? `编辑器来源 ${name} 的累计时长。` :
      `${name} 累计时长，${id === 'total-activity' ? '包含所有活动分类与 Other 语言' : `对应 ${id === 'coding' ? 'Coding' : 'AI Coding'} 分类`}。`,
      group: 'badges', range: 'all-time', status: 'ready', reason: null, variants: [] }
    const svg = makeBadge({ label: name, message: formatDuration(seconds), color, labelColor: '334155', style: 'flat' })
    await asset(spec, `badges/${id}/all-time`, svg, 'neutral', 'badge')
    entries.push(spec)
  }
  for (const spec of chartSpecs(library, config)) {
    const entry = { ...spec, variants: [] }
    delete entry.option
    for (const theme of Object.keys(themes)) {
      for (const [size, width, height] of [['wide', 800, 360], ['compact', 400, 300]]) {
        const labelWidth = width < 500 ? 160 : 240
        const projectRowHeight = Math.max(30, ...library.allTime.projects.map(({ name }) =>
          Math.ceil(echarts.format.getTextRect(name, '11px Arial').width / labelWidth) * 14 + 12))
        const imageHeight = spec.id === 'calendar' && size === 'compact' ? 860 :
          spec.id === 'projects' ? Math.max(height, library.allTime.projects.length * projectRowHeight + 150) : height
        await asset(entry, `charts/${spec.id}/${spec.range}.${theme}.${size}`,
          renderChart(spec, theme, width, imageHeight), theme, size)
      }
    }
    entries.push(entry)
  }
  return { files, manifest: {
    schemaVersion: 1, generatedAt: library.fetchedAt, sourceUpdatedAt: library.sourceUpdatedAt,
    timezone: library.timezone, timeout: library.timeout, writesOnly: library.writesOnly,
    sourceRange: library.sourceRange, sources: library.sources,
    baseUrl: config.baseUrl, entries
  } }
}
