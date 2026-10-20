// Runs the sync test under Electron's Node (the native SQLCipher module is built for Electron's ABI).
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const here = dirname(fileURLToPath(import.meta.url))
const r = spawnSync(electron, ['--experimental-strip-types', '--no-warnings', join(here, 'sync.test.mts')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})
process.exit(r.status ?? 1)
