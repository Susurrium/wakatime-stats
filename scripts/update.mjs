import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { collect } from './data.mjs'
import { makeSnapshot, renderBadges } from './stats.mjs'
import { build, exists, publishFiles, root } from './build.mjs'
import { check } from './check.mjs'

try {
  const config = JSON.parse(await readFile(resolve(root, 'config.json'), 'utf8'))
  const historyPath = resolve(root, 'data/library.json')
  const previous = await exists(historyPath) ? JSON.parse(await readFile(historyPath, 'utf8')) : null
  const { payload, library } = await collect(process.env.WAKATIME_READ_TOKEN, config, previous)
  const legacy = renderBadges(makeSnapshot(payload, config, new Date(library.fetchedAt)))
  const destination = resolve(root, 'artifacts/releases', `${Date.now()}-${process.pid}`)
  const manifest = await build(library, config, destination)
  for (const [path, content] of Object.entries(legacy)) await writeFile(resolve(destination, path), content)
  await check(destination)
  const paths = ['index.html', 'gallery.css', 'gallery.js', '.nojekyll', 'CATALOG.md', 'manifest.json', 'data/library.json',
    ...Object.keys(legacy), ...manifest.entries.flatMap((entry) => entry.variants.flatMap((variant) => [variant.svg, variant.png]))]
  await publishFiles(destination, paths)
  console.log(`Generated ${manifest.entries.length} charts; source updated ${library.sourceUpdatedAt}`)
} catch (error) {
  const token = process.env.WAKATIME_READ_TOKEN
  console.error(token ? error.message.replaceAll(token, '[REDACTED]') : error.message)
  process.exitCode = 1
}
