// 此文件只为隔离测试提供数据，正式更新只读取 WakaTime 接口。
export const config = {
  vscodeEditor: 'VS Code', codexDesktopEditor: 'Codex Vscode', timezone: 'Asia/Shanghai',
  historyDays: 30, durationDays: 7,
  dailyGoalSeconds: 10800, baseUrl: 'https://raw.githubusercontent.com/Susurrium/wakatime-stats/main/'
}

export function stats() {
  return {
    range: 'all_time', is_up_to_date: true, modified_at: '2026-11-14T16:30:00Z',
    start: '2026-11-01T00:00:00+08:00', end: '2026-11-15T23:59:59+08:00', is_including_today: true,
    timezone: 'Asia/Shanghai', timeout: 15, writes_only: false,
    categories: [{ name: 'Coding', total_seconds: 7200 }, { name: 'AI Coding', total_seconds: 18000 }],
    languages: [{ name: 'TypeScript', total_seconds: 16000 }, { name: 'Python', total_seconds: 9200 }],
    editors: [{ name: 'VS Code', total_seconds: 7200 }, { name: 'Codex Vscode', total_seconds: 15000 }, { name: 'Codex CLI', total_seconds: 3000 }],
    projects: [{ name: 'private-project', total_seconds: 10000 }, { name: 'not-public', total_seconds: 15200 }],
    operating_systems: [{ name: 'Windows', total_seconds: 25200 }],
    total_seconds_including_other_language: 25200, ai_additions: 240, ai_deletions: 40,
    human_additions: 120, human_deletions: 20, ai_input_tokens: 12000, ai_output_tokens: 2000,
    ai_sessions: 8, ai_prompt_events_total: 30, ai_prompt_length_avg: 240,
    ai_prompt_length_median_per_session: 200, ai_model_total_cost: 1.5,
    ai_model_breakdown: [{ name: 'Example Model', lines: 280, cost: 1.5,
      input_tokens: 12000, output_tokens: 2000, cached_input_tokens: 3000 }],
    entity: 'C:/private/file.ts', machine_name_id: 'private-machine'
  }
}

export function day(date) {
  const value = stats()
  return { ...value, grand_total: { ...value, total_seconds: 25200 },
    range: { date, timezone: config.timezone } }
}
