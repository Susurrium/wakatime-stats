import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { DOMParser } from '@xmldom/xmldom'
import { number } from './data.mjs'

export async function check(root) {
  root = resolve(root)
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  const library = JSON.parse(await readFile(resolve(root, 'data/library.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || library.schemaVersion !== 2 ||
      manifest.generatedAt !== library.fetchedAt || manifest.sourceUpdatedAt !== library.sourceUpdatedAt) {
    throw new Error('清单与数据批次不一致。')
  }
  const ids = new Set()
  for (const entry of manifest.entries) {
    if (ids.has(entry.id) || !['ready', 'partial', 'unavailable'].includes(entry.status) || !entry.variants.length) {
      throw new Error('图表 ID、状态或变体无效。')
    }
    ids.add(entry.id)
    for (const variant of entry.variants) {
      for (const format of ['svg', 'png']) {
        const path = resolve(root, variant[format])
        if (!path.startsWith(`${root}${sep}`)) throw new Error('图表路径越界。')
        const bytes = await readFile(path)
        const metadata = await sharp(bytes).metadata()
        if (metadata.width !== variant.width * (format === 'png' ? 2 : 1) ||
            metadata.height !== variant.height * (format === 'png' ? 2 : 1)) {
          throw new Error(`图表尺寸与清单不一致：${variant[format]}`)
        }
        if (format === 'svg') {
          const document = new DOMParser({ onError: (level, message) => {
            if (level !== 'warning') throw new Error(message)
          } }).parseFromString(bytes.toString(), 'image/svg+xml')
          for (const element of document.getElementsByTagName('*')) {
            if (['script', 'foreignObject'].includes(element.localName)) throw new Error('图表包含活动内容。')
            for (const attribute of element.attributes) {
              if (attribute.name.startsWith('on') ||
                  (['href', 'xlink:href'].includes(attribute.name) && !attribute.value.startsWith('#'))) {
                throw new Error(`图表包含外部资源：${variant.svg}`)
              }
            }
          }
        }
      }
    }
  }
  for (const [key, entries] of Object.entries(library.allTime)) {
    if (['categories', 'editors', 'languages', 'projects', 'operatingSystems'].includes(key) && entries) {
      for (const entry of entries) number(entry.seconds, key)
    }
  }
  const serialized = JSON.stringify(library)
  if (/"(?:entity|machine_name_id|branch|ai_session|access_token|api_key|owner)"\s*:/.test(serialized)) {
    throw new Error('公开数据中出现不允许发布的原始字段。')
  }
  console.log(`Verified ${manifest.entries.length} charts, image dimensions and publication batch.`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await check(resolve(process.argv[2] ?? '.'))
