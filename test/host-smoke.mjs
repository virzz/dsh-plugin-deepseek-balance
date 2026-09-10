/**
 * Host-half smoke test: drives apply() with a fake Cordis context whose subprocess provider
 * is a real node child_process, then reads the registered route. It asserts the whole chain —
 * spawn, stdout lines, snapshot, route JSON — without needing the DSH process.
 *
 * Run: DEEPSEEK_API_KEY=... node test/host-smoke.mjs
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { apply } from '../lib/index.js'

const disposers = []
const seen = { route: undefined, carted: false }

function handleFor(child) {
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    done: new Promise((resolve) => {
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
    }),
    terminate: () => {
      child.kill('SIGTERM')
    },
  }
}

const services = {
  subprocess: {
    resolveExecutable: async (command) => command,
    spawn: (spec) => {
      seen.spawned = true
      const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return handleFor(child)
    },
  },
  credentials: { resolve: async () => ({ value: process.env.DEEPSEEK_API_KEY }) },
  shell: { resolve: () => ({ workdir: process.cwd() }) },
  webServer: {
    register: (route) => {
      seen.route = route
      return () => {
        seen.route = undefined
      }
    },
  },
}

const base = {
  get: (name) => services[name],
  effect(callback) {
    disposers.push(callback())
    return () => {}
  },
  timeout() {
    return () => {}
  },
  inject(_names, callback) {
    callback(carrier)
  },
}

/** Cordis' injected context exposes the named service as a property; mirror that here. */
const carrier = { ...base, webServer: services.webServer }

const ctx = base

function readRoute() {
  return new Promise((resolve) => {
    const chunks = []
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers) {
        this.status = status
        this.headers = headers ?? {}
      },
      end(chunk) {
        if (chunk !== undefined) chunks.push(String(chunk))
        resolve({ status: this.status, headers: this.headers, body: chunks.join('') })
      },
    }
    seen.route.handler({ method: 'GET', url: '/deepseek-balance' }, res)
  })
}

function teardown() {
  for (const dispose of disposers) {
    if (typeof dispose === 'function') dispose()
  }
}

apply(ctx)

if (seen.route === undefined) {
  console.error('FAIL: apply() registered no route')
  process.exit(1)
}
if (seen.route.kind !== 'exact' || seen.route.path !== '/deepseek-balance') {
  console.error('FAIL: unexpected route', seen.route.kind, seen.route.path)
  process.exit(1)
}
console.log('route registered:', seen.route.kind, seen.route.path)

// The child polls once immediately; give the spawn plus that first round trip room to land.
await new Promise((resolve) => setTimeout(resolve, 8000))

const response = await readRoute()
console.log('route status:', response.status)
console.log('route body:', response.body)
teardown()

let parsed
try {
  parsed = JSON.parse(response.body)
} catch (error) {
  console.error('FAIL: route body is not JSON —', error.message)
  process.exit(1)
}
if (response.status !== 200 || parsed.ok !== true) {
  console.error('FAIL: snapshot is not ok')
  process.exit(1)
}
if (!Array.isArray(parsed.balances) || parsed.balances.length === 0) {
  console.error('FAIL: no balances in snapshot')
  process.exit(1)
}
console.log('PASS: spawn -> stdout -> snapshot -> route served real balance data')
process.exit(0)
