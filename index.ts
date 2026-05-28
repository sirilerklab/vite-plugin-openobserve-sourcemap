import fs from 'fs'
import path from 'path'
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
 *   import { openObserveSourceMapPlugin } from './plugins/vite-plugin-openobserve-sourcemap'
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

      // ── Upload ───────────────────────────────────────────────────
      const auth = Buffer.from(`${email}:${password}`).toString('base64')
      const uploadUrl = `${domain}/api/${org}/rum/v1/sourcemaps`

      console.log(`\n🚀 [OpenObserve] Uploading ${mapFiles.length} sourcemap(s) to ${uploadUrl}`)

      let success = 0
      let failed  = 0

      for (const filePath of mapFiles) {
        const fileName = path.basename(filePath)
        // Derive the public bundle path from the file location
        const relativePath = filePath.replace(outputDir, '').replace(/\\/g, '/')

        try {
          const fileBuffer = fs.readFileSync(filePath)
          const formData   = new FormData()

          formData.append('file',            new Blob([fileBuffer], { type: 'application/json' }), fileName)
          formData.append('version',         version)
          formData.append('service',         service)
          formData.append('env',             process.env.NODE_ENV ?? 'production')
          formData.append('bundle_filepath', relativePath)

          const res = await fetch(uploadUrl, {
            method:  'POST',
            headers: { Authorization: `Basic ${auth}` },
            body:    formData,
          })

          if (res.ok) {
            console.log(`   ✅ ${fileName}`)
            success++

            if (deleteAfterUpload) {
              fs.unlinkSync(filePath)
              console.log(`   🗑️  Deleted local: ${fileName}`)
            }
          } else {
            const body = await res.text()
            console.error(`   ❌ ${fileName} — HTTP ${res.status}: ${body}`)
            failed++
          }
        } catch (err) {
          console.error(`   ❌ ${fileName} — Error:`, err)
          failed++
        }
      }

      console.log(
        `\n🏁 [OpenObserve] Done — ${success} uploaded, ${failed} failed\n`
      )
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