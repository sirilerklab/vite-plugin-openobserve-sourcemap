import fs from 'fs'
import path from 'path'
import { zipSync } from 'fflate'
import { type Plugin } from 'vite'

interface OpenObserveSourceMapOptions {
  /** OpenObserve domain e.g. https://api.openobserve.ai */
  domain?: string
  /** Organization identifier */
  org?: string
  /** Basic auth email */
  email?: string
  /** Basic auth password */
  password?: string
  /** App version — should match version in openobserveRum.init() */
  version?: string
  /** Service name — should match service in openobserveRum.init() */
  service?: string
  /** Build output directory (default: .output) */
  outputDir?: string
  /** Delete .map files after upload so they don't ship to production (default: true) */
  deleteAfterUpload?: boolean
}

/**
 * Vite plugin for uploading hidden source maps to OpenObserve RUM
 * after build completes, then deleting them from the output.
 *
 * Usage in app.config.ts:
 *
 *   import { openObserveSourceMapPlugin } from 'vite-plugin-openobserve-sourcemap'
 *
 *   export default defineConfig({
 *     vite: {
 *       plugins: [openObserveSourceMapPlugin()],
 *       build: { sourcemap: 'hidden' },
 *     },
 *   })
 */
export function openObserveSourceMapPlugin(opts: OpenObserveSourceMapOptions = {}): Plugin {
  return {
    name: 'openobserve-upload-sourcemaps',
    apply: 'build',
    enforce: 'post',

    async closeBundle() {
      const domain   = opts.domain   ?? process.env.OPENOBSERVE_DOMAIN   ?? ''
      const org      = opts.org      ?? process.env.OPENOBSERVE_ORG       ?? 'default'
      const email    = opts.email    ?? process.env.OPENOBSERVE_EMAIL     ?? ''
      const password = opts.password ?? process.env.OPENOBSERVE_PASSWORD  ?? ''
      const version  = opts.version  ?? process.env.APP_VERSION           ?? '1.0.0'
      const service  = opts.service  ?? process.env.SERVICE_NAME          ?? 'app'
      const deleteAfterUpload = opts.deleteAfterUpload ?? true

      // ── Validation ──────────────────────────────────────────────
      if (!domain) {
        console.warn('\n⚠️  [OpenObserve] OPENOBSERVE_DOMAIN not set — skipping sourcemap upload')
        return
      }
      if (!email || !password) {
        console.warn('\n⚠️  [OpenObserve] OPENOBSERVE_EMAIL or OPENOBSERVE_PASSWORD not set — skipping')
        return
      }

      // ── Find .map files ─────────────────────────────────────────
      const outputDir = path.resolve(process.cwd(), opts.outputDir ?? '.output')

      if (!fs.existsSync(outputDir)) {
        console.warn(`\n⚠️  [OpenObserve] Output dir not found: ${outputDir}`)
        return
      }

      const mapFiles = findMapFiles(outputDir)

      if (mapFiles.length === 0) {
        console.log('\n⚠️  [OpenObserve] No .map files found — skipping upload')
        return
      }

      // ── Zip all .map files ───────────────────────────────────────
      const zipEntries: Record<string, Uint8Array> = {}

      for (const filePath of mapFiles) {
        const entryName = filePath
          .slice(outputDir.length)
          .replace(/\\/g, '/')
          .replace(/^\//, '')
        zipEntries[entryName] = new Uint8Array(fs.readFileSync(filePath))
      }

      const zipBuffer = zipSync(zipEntries)
      const zipKB     = (zipBuffer.length / 1024).toFixed(1)

      // OpenObserve hard limit: 5MB (SOURCEMAP_FILE_MAX_SIZE = 1024 * 1024 * 5)
      const MAX_SIZE = 5 * 1024 * 1024
      if (zipBuffer.length > MAX_SIZE) {
        console.error(`\n❌ [OpenObserve] ZIP size (${zipKB}KB) exceeds OpenObserve 5MB limit — upload skipped`)
        console.warn(`   💡 Try enabling code splitting or reducing bundle size to shrink sourcemaps`)
        return
      }

      // ── Upload ───────────────────────────────────────────────────
      const auth      = Buffer.from(`${email}:${password}`).toString('base64')
      const uploadUrl = `${domain}/api/${org}/sourcemaps`

      console.log(`\n🚀 [OpenObserve] Uploading ${mapFiles.length} sourcemap(s) as single ZIP (${zipKB}KB) to ${uploadUrl}`)

      try {
        const formData = new FormData()
        formData.append('file',    new Blob([zipBuffer], { type: 'application/zip' }), 'sourcemaps.zip')
        formData.append('version', version)
        formData.append('service', service)
        formData.append('env',     process.env.NODE_ENV ?? 'production')

        const res = await fetch(uploadUrl, {
          method:  'POST',
          headers: { Authorization: `Basic ${auth}` },
          body:    formData,
        })

        if (res.ok) {
          console.log(`   ✅ sourcemaps.zip (${mapFiles.length} files, ${zipKB}KB)`)

          if (deleteAfterUpload) {
            for (const filePath of mapFiles) {
              fs.unlinkSync(filePath)
            }
            console.log(`   🗑️  Deleted ${mapFiles.length} local .map file(s)`)
          }

          console.log(`\n🏁 [OpenObserve] Done\n`)
        } else {
          const body = await res.text()
          console.error(`   ❌ Upload failed — HTTP ${res.status}: ${body}`)
          console.log(`\n🏁 [OpenObserve] Done — upload failed\n`)
        }
      } catch (err) {
        console.error(`   ❌ Upload error:`, err)
        console.log(`\n🏁 [OpenObserve] Done — upload failed\n`)
      }
    },
  }
}

/** Recursively find all *.js.map files under a directory */
function findMapFiles(dir: string): string[] {
  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findMapFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.js.map')) {
      results.push(fullPath)
    }
  }

  return results
}