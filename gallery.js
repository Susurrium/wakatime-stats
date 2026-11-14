const form = document.querySelector('form')
const feedback = document.querySelector('#feedback')
const entries = [...document.querySelectorAll('article')]
const manifest = await fetch('manifest.json').then((response) => {
  if (!response.ok) throw new Error(`图表清单读取失败：HTTP ${response.status}`)
  return response.json()
}).catch((error) => {
  feedback.textContent = error.message
  return null
})

function selectedVariant(article) {
  const variants = JSON.parse(article.querySelector('script').textContent)
  return variants.find((variant) => variant.theme === form.elements.theme.value && variant.size === form.elements.size.value)
    ?? variants.find((variant) => variant.theme === form.elements.theme.value)
    ?? variants[0]
}

function snippet(article, format) {
  const image = article.querySelector('img')
  const url = new URL(selectedVariant(article).svg, manifest.baseUrl).href
  const htmlAlt = image.alt.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  const markdownAlt = image.alt.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
  return format === 'html' ? `<img src="${url}" alt="${htmlAlt}">` : `![${markdownAlt}](${url})`
}

function update() {
  const query = form.elements.query.value.trim().toLowerCase()
  let count = 0
  for (const article of entries) {
    const matches = ['group', 'range', 'status'].every((key) => !form.elements[key].value ||
      form.elements[key].value === article.dataset[key])
    const text = `${article.querySelector('h2').textContent} ${article.querySelector('p').textContent}`.toLowerCase()
    article.hidden = !matches || !text.includes(query)
    if (!article.hidden) count++
    const variant = selectedVariant(article)
    const image = article.querySelector('img')
    image.src = variant.svg
    image.width = variant.width
    image.height = variant.height
    for (const link of article.querySelectorAll('[data-format]')) link.href = variant[link.dataset.format]
    if (manifest) article.querySelector('code').textContent = snippet(article, 'markdown')
  }
  document.querySelector('#result-count').textContent = `${count} 张图表`
  document.querySelector('#empty').hidden = count !== 0
}

form.addEventListener('input', update)
form.addEventListener('submit', (event) => event.preventDefault())
for (const article of entries) {
  for (const button of article.querySelectorAll('[data-copy]')) {
    button.disabled = !manifest
    button.addEventListener('click', async () => {
      const text = snippet(article, button.dataset.copy)
      article.querySelector('code').textContent = text
      try {
        await navigator.clipboard.writeText(text)
        feedback.textContent = `已复制 ${article.querySelector('h2').textContent} 的引用代码。`
      } catch {
        article.querySelector('details').open = true
        feedback.textContent = '无法访问剪贴板，请从展开的引用代码中复制。'
      }
    })
  }
}
for (const time of document.querySelectorAll('time')) {
  time.textContent = new Intl.DateTimeFormat('zh-CN', {
    timeZone: manifest?.timezone ?? 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(time.dateTime))
}
update()
