export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character])
}

export function gallery(manifest) {
  const entries = manifest.entries.map((entry) => {
    const initial = entry.variants.find((variant) => variant.theme === 'light' && variant.size === 'wide') ?? entry.variants[0]
    const variants = JSON.stringify(entry.variants)
    return `<article data-group="${escapeHtml(entry.group)}" data-range="${escapeHtml(entry.range)}" data-status="${entry.status}">
      <header><h2>${escapeHtml(entry.title)}</h2><span class="state">${({ ready: '可用', partial: '部分数据', unavailable: '暂无有效数据' })[entry.status]}</span></header>
      <div class="preview"><img src="${initial.svg}" width="${initial.width}" height="${initial.height}" alt="${escapeHtml(entry.title)}" loading="lazy"></div>
      <p>${escapeHtml(entry.description)}</p><p class="metadata">${escapeHtml(entry.range)}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</p>
      <div class="actions"><a data-format="svg" href="${initial.svg}">SVG</a><a data-format="png" href="${initial.png}">PNG</a>
      <button type="button" data-copy="markdown">复制 Markdown</button><button type="button" data-copy="html">复制 HTML</button></div>
      <details><summary>引用代码</summary><pre tabindex="0"><code></code></pre></details>
      <script type="application/json">${variants.replaceAll('<', '\\u003c')}</script>
    </article>`
  }).join('\n')
  const rangeOptions = [...new Set(manifest.entries.map((entry) => entry.range))]
    .map((range) => `<option value="${escapeHtml(range)}">${escapeHtml(range)}</option>`).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WakaTime 图表目录 · Susurrium</title><link rel="stylesheet" href="gallery.css"><script type="module" src="gallery.js"></script></head>
<body><main><header class="page-heading"><a class="repository" href="https://github.com/Susurrium/wakatime-stats">Susurrium / wakatime-stats</a>
<h1>WakaTime 图表目录</h1><p>选择图表，复制到你的主页、博客或 README。</p>
<p class="metadata">累计统计更新于 <time datetime="${manifest.sourceUpdatedAt}">${escapeHtml(manifest.sourceUpdatedAt)}</time> · ${escapeHtml(manifest.timezone)}</p>
<nav><a href="manifest.json">图表清单</a><a href="data/library.json">公开数据</a><a href="https://github.com/Susurrium/wakatime-stats#统计口径">统计口径</a></nav></header>
<form class="filters" role="search"><label>查找图表<input type="search" name="query" placeholder="语言、AI、Coding…"></label>
<label>内容<select name="group" aria-label="内容"><option value="">全部内容</option><option value="badges">徽章</option><option value="activity">活动</option><option value="breakdown">分布</option><option value="ai">AI</option><option value="goals">目标</option></select></label>
<label>时间范围<select name="range" aria-label="时间范围"><option value="">全部范围</option>${rangeOptions}</select></label>
<label>主题<select name="theme" aria-label="主题"><option value="light">浅色</option><option value="dark">深色</option></select></label>
<label>尺寸<select name="size" aria-label="尺寸"><option value="wide">宽版</option><option value="compact">窄版</option></select></label>
<label>状态<select name="status" aria-label="状态"><option value="">全部状态</option><option value="ready">可用</option><option value="partial">部分数据</option><option value="unavailable">暂无有效数据</option></select></label></form>
<p id="result-count" class="metadata" aria-live="polite"></p><p id="feedback" role="status" aria-live="polite"></p>
<section class="catalog" aria-label="图表成品">${entries}</section><p id="empty" hidden>没有符合筛选条件的图表。</p>
<footer>时间采用 WakaTime 心跳合并规则。AI 费用为估算值。空白日期与缺失指标会保留数据状态。</footer>
</main></body></html>`
}
