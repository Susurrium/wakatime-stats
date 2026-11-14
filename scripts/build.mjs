import { mkdir, readFile, writeFile, copyFile, access, rename } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderLibrary } from './charts.mjs'
import { gallery } from './gallery.mjs'
import { validateConfig } from './data.mjs'

export const root = fileURLToPath(new URL('../', import.meta.url))

export async function build(library, config, destination = resolve(root, 'artifacts/site')) {
  validateConfig(config)
  const { files, manifest } = await renderLibrary(library, config)
  const batch = resolve(root, 'artifacts/batches', `${Date.now()}-${process.pid}`)
  const data = {
    ...files, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'data/library.json': JSON.stringify(library, null, 2) + '\n', 'index.html': gallery(manifest),
    'gallery.css': await readFile(resolve(root, 'site/gallery.css')),
    'gallery.js': await readFile(resolve(root, 'site/gallery.js')),
    '.nojekyll': ''
  }
  data['CATALOG.md'] = '# 图表目录\n\n所有主题、尺寸和成品状态见 [manifest.json](manifest.json)。\n\n' +
    manifest.entries.map((entry) => {
      const variant = entry.variants.find((variant) => variant.theme === 'light' && variant.size === 'wide') ?? entry.variants[0]
      const markdown = (value) => value.replace(/[\\`*_[\]<>#|]/g, '\\$&')
      return `## ${markdown(entry.title)}\n\n${markdown(entry.description)}\n\n状态 ${entry.status}，范围 ${entry.range}。\n\n![${markdown(entry.title)}](${variant.svg})\n\n[SVG](${variant.svg}) · [PNG](${variant.png})\n`
    }).join('\n')
  for (const [path, contents] of Object.entries(data)) {
    const target = resolve(batch, path)
    if (!target.startsWith(`${batch}${sep}`)) throw new Error('生成路径越界。')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents)
  }
  // 目录只在整批生成成功后交付，调用者通过独立 artifact 发布。
  await mkdir(dirname(destination), { recursive: true })
  await rename(batch, destination)
  return manifest
}

export async function publishFiles(source, paths) {
  for (const path of paths) {
    const target = resolve(root, path)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(resolve(source, path), target)
  }
}

export async function exists(path) {
  try { await access(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(await readFile(resolve(root, 'config.json'), 'utf8'))
  const library = JSON.parse(await readFile(resolve(root, 'data/library.json'), 'utf8'))
  const destination = resolve(root, 'artifacts/site', `${Date.now()}`)
  const manifest = await build(library, config, destination)
  console.log(`Built ${manifest.entries.length} charts in ${destination}`)
}
