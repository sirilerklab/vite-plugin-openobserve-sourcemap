# vite-plugin-openobserve-sourcemap

A Vite plugin that automatically uploads source maps to [OpenObserve RUM](https://openobserve.ai) after a production build, then deletes them from the output directory so they never ship to end users.

## How it works

1. Runs after the Vite bundle is closed (`closeBundle` hook, `enforce: 'post'`)
2. Recursively finds all `*.js.map` files in the output directory
3. Uploads each file to the OpenObserve RUM source maps API via `multipart/form-data`
4. Optionally deletes the `.map` files locally once uploaded (default: `true`)

## Installation

```bash
# npm
npm install -D vite-plugin-openobserve-sourcemap

# bun
bun add -d vite-plugin-openobserve-sourcemap

# pnpm
pnpm add -D vite-plugin-openobserve-sourcemap
```

## Usage

### Nuxt / app.config.ts

```ts
import { openObserveSourceMapPlugin } from 'vite-plugin-openobserve-sourcemap'

export default defineConfig({
  vite: {
    plugins: [openObserveSourceMapPlugin()],
    build: { sourcemap: 'hidden' },
  },
})
```

### Plain vite.config.ts

```ts
import { defineConfig } from 'vite'
import { openObserveSourceMapPlugin } from 'vite-plugin-openobserve-sourcemap'

export default defineConfig({
  plugins: [openObserveSourceMapPlugin()],
  build: { sourcemap: 'hidden' },
})
```

> Use `sourcemap: 'hidden'` so source maps are generated but not referenced by the browser — the plugin uploads them and then deletes them.

## Configuration

All options can be set via the plugin options object or environment variables. Environment variables are used as fallbacks when an option is not provided.

| Option              | Env var                  | Default      | Description                                              |
| ------------------- | ------------------------ | ------------ | -------------------------------------------------------- |
| `domain`            | `OPENOBSERVE_DOMAIN`     | —            | OpenObserve base URL, e.g. `https://api.openobserve.ai` |
| `org`               | `OPENOBSERVE_ORG`        | `default`    | Organization identifier                                  |
| `email`             | `OPENOBSERVE_EMAIL`      | —            | Basic auth email                                         |
| `password`          | `OPENOBSERVE_PASSWORD`   | —            | Basic auth password                                      |
| `version`           | `APP_VERSION`            | `1.0.0`      | App version — must match `version` in `openobserveRum.init()` |
| `service`           | `SERVICE_NAME`           | `app`        | Service name — must match `service` in `openobserveRum.init()` |
| `outputDir`         | —                        | `.output`    | Build output directory to scan for `.map` files         |
| `deleteAfterUpload` | —                        | `true`       | Delete `.map` files locally after a successful upload   |

### Example with explicit options

```ts
openObserveSourceMapPlugin({
  domain: 'https://api.openobserve.ai',
  org: 'my-org',
  email: 'admin@example.com',
  password: 'secret',
  version: process.env.npm_package_version,
  service: 'frontend',
  outputDir: 'dist',
  deleteAfterUpload: true,
})
```

### Example with environment variables (.env)

```env
OPENOBSERVE_DOMAIN=https://api.openobserve.ai
OPENOBSERVE_ORG=my-org
OPENOBSERVE_EMAIL=admin@example.com
OPENOBSERVE_PASSWORD=secret
APP_VERSION=1.2.3
SERVICE_NAME=frontend
```

## Requirements

- Vite 5+
- TypeScript 5+
- Node.js 18+ or [Bun](https://bun.sh)
