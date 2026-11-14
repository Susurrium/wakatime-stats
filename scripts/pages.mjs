import { mkdir, copyFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { root } from './build.mjs'
import { check } from './check.mjs'

const manifest = await check(root)
const destination = resolve(root, 'artifacts/pages')
const paths = ['index.html', 'gallery.css', 'gallery.js', '.nojekyll', 'manifest.json', 'data/library.json',
  ...manifest.entries.flatMap((entry) => entry.variants.flatMap((variant) => [variant.svg, variant.png]))]
for (const path of paths) {
  await mkdir(dirname(resolve(destination, path)), { recursive: true })
  await copyFile(resolve(root, path), resolve(destination, path))
}
console.log(`Staged ${paths.length} public files in ${destination}`)
