/**
 * DeepSeek balance pill — host half.
 *
 * One resident `node` child polls the DeepSeek balance API with Node's own global `fetch`
 * and prints one JSON line per attempt on stdout; this half only decodes those lines and
 * serves the newest snapshot to the browser half over a local read route.
 *
 * No shell and no curl are involved: `argv` is an explicit `node -e`, and the API key
 * reaches the child through its environment, never through the command line. The key never
 * leaves this process either — the read route returns only the balance figures.
 *
 * @module dsh-plugin-deepseek-balance
 */

/** Polling cadence of the resident child. */
const COLLECT_MS = 60000

/** Read route the browser half polls. Must match ROUTE in lib/client.js. */
const ROUTE_PATH = '/deepseek-balance'

/**
 * The one long-lived child program. It polls the balance API itself and prints one JSON
 * line per attempt, which is the whole contract with this half: `{ ok: true, available,
 * balances, fetchedAt }` or `{ ok: false, code, error }`.
 *
 * All inner quotes are single, so this literal needs no escaping.
 */
const POLLER = "const KEY = process.env.DEEPSEEK_API_KEY; const URL_BALANCE = 'https://api.deepseek.com/user/balance'; function emit(value) { console.log(JSON.stringify(value)) } async function tick() { try { const response = await fetch(URL_BALANCE, { headers: { Authorization: 'Bearer ' + KEY, Accept: 'application/json' } }); const body = await response.text(); if (!response.ok) { emit({ ok: false, code: 'http-' + response.status, error: 'HTTP ' + response.status + ': ' + body.slice(0, 200) }); return } const payload = JSON.parse(body); const raw = Array.isArray(payload.balance_infos) ? payload.balance_infos : []; const balances = []; for (const entry of raw) { if (entry === null || typeof entry !== 'object') continue; balances.push({ currency: String(entry.currency || ''), total: String(entry.total_balance || ''), granted: String(entry.granted_balance || ''), toppedUp: String(entry.topped_up_balance || '') }) } if (balances.length === 0) { emit({ ok: false, code: 'bad-response', error: '响应中没有余额信息' }); return } emit({ ok: true, available: payload.is_available === true, balances: balances, fetchedAt: Date.now() }) } catch (error) { emit({ ok: false, code: 'request-failed', error: String((error && error.message) || error) }) } } tick(); setInterval(tick, EVERY_MS_PLACEHOLDER)"

/** One-line description of any thrown value. */
function describe(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  return String(error)
}

/**
 * The shell implementation's own default working directory, so the child inherits a real
 * cwd without this plugin guessing a path.
 *
 * @param ctx - host context.
 * @returns an existing directory path.
 */
function workingDirectory(ctx) {
  try {
    const shell = ctx.get('shell')
    if (shell !== undefined && typeof shell.resolve === 'function') {
      const spec = shell.resolve({ command: 'true' })
      if (spec !== null && typeof spec === 'object' && typeof spec.workdir === 'string' && spec.workdir !== '') {
        return spec.workdir
      }
    }
  } catch {
    // Fall through to the neutral root.
  }
  return '/'
}

/**
 * Own the resident collector: one child, restarted only after it exits.
 *
 * @param ctx - host context.
 * @returns the lifecycle hooks the plugin effect drives.
 */
function createCollector(ctx) {
  const program = POLLER.replace('EVERY_MS_PLACEHOLDER', String(COLLECT_MS))
  const state = {
    latest: undefined,
    failure: undefined,
    buffer: '',
    stderr: '',
    disposed: false,
    handle: undefined,
    restart: undefined,
  }

  /** The wire shape the browser half renders. */
  function snapshot() {
    if (state.latest !== undefined) {
      const value = state.latest
      if (value.ok === true) {
        return {
          ok: true,
          available: value.available === true,
          balances: Array.isArray(value.balances) ? value.balances : [],
          fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : 0,
        }
      }
      return {
        ok: false,
        code: typeof value.code === 'string' ? value.code : 'failed',
        error: typeof value.error === 'string' ? value.error : '未知错误',
      }
    }
    if (state.failure !== undefined) return { ok: false, code: state.failure.code, error: state.failure.error }
    return { ok: false, code: 'starting', error: '正在启动 node 采集进程…' }
  }

  function onStdout(chunk) {
    state.buffer += chunk.toString('utf8')
    let index = state.buffer.indexOf('\n')
    while (index >= 0) {
      const line = state.buffer.slice(0, index).trim()
      state.buffer = state.buffer.slice(index + 1)
      if (line !== '') {
        try {
          const value = JSON.parse(line)
          if (value !== null && typeof value === 'object') {
            state.latest = value
            state.failure = undefined
          }
        } catch {
          // A partial or foreign line is ignored; the next one carries the payload.
        }
      }
      index = state.buffer.indexOf('\n')
    }
    if (state.buffer.length > 65536) state.buffer = state.buffer.slice(-4096)
  }

  /**
   * Resolve the node executable in the provider's own execution world, so the child never
   * depends on the launching shell's PATH. A provider that cannot answer falls back to the
   * bare name, which spawn resolves exactly as before.
   */
  async function nodeCommand(subprocess) {
    try {
      const resolved = await subprocess.resolveExecutable('node')
      if (typeof resolved === 'string' && resolved !== '') return resolved
    } catch {
      // No resolver answer: let spawn resolve the bare name.
    }
    return 'node'
  }

  async function start() {
    if (state.disposed === true) return
    try {
      const subprocess = ctx.get('subprocess')
      const credentials = ctx.get('credentials')
      if (subprocess === undefined || credentials === undefined) {
        // Belt and braces: `inject` normally guarantees these, but a row that activates
        // before them still recovers instead of latching a failure for its whole lifetime.
        state.failure = {
          code: 'unavailable',
          error: '等待 ' + (subprocess === undefined ? 'subprocess' : 'credentials') + ' 服务，5 秒后重试',
        }
        state.restart = ctx.timeout(() => { start() }, 5000)
        return
      }
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
      if (state.disposed === true) return
      if (resolved === undefined || typeof resolved.value !== 'string' || resolved.value === '') {
        state.failure = { code: 'missing-key', error: '未配置 DEEPSEEK_API_KEY' }
        return
      }

      const command = await nodeCommand(subprocess)
      if (state.disposed === true) return

      let handle
      try {
        handle = subprocess.spawn({
          argv: [command, '-e', program],
          cwd: workingDirectory(ctx),
          stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
          graceMs: 3000,
          env: { DEEPSEEK_API_KEY: resolved.value },
        })
      } catch (error) {
        state.failure = { code: 'spawn-failed', error: '启动 node 失败：' + describe(error) }
        return
      }

      state.handle = handle
      handle.stdout?.on('data', onStdout)
      handle.stderr?.on('data', (chunk) => {
        state.stderr = (state.stderr + chunk.toString('utf8')).slice(-600)
      })
      handle.done.then(() => {
        if (state.disposed === true) return
        const tail = state.stderr.trim()
        state.failure = {
          code: 'poller-exited',
          error: 'node 采集进程已退出，5 秒后重启' + (tail === '' ? '' : '：' + tail.slice(0, 300)),
        }
        state.restart = ctx.timeout(() => { start() }, 5000)
      }, (error) => {
        if (state.disposed === true) return
        state.failure = { code: 'poller-failed', error: 'node 采集进程失败：' + describe(error) }
        state.restart = ctx.timeout(() => { start() }, 5000)
      })
    } catch (error) {
      state.failure = { code: 'unavailable', error: '启动采集进程出错：' + describe(error) }
    }
  }

  function stop() {
    state.disposed = true
    if (state.restart !== undefined) state.restart()
    try {
      state.handle?.terminate()
    } catch {
      // The child is already gone; nothing to terminate.
    }
  }

  return { start, stop, snapshot }
}

export const name = 'deepseek-balance'

/**
 * Hard dependencies, declared so `apply` cannot run before they exist. `subprocess` and
 * `credentials` are provided by other rows and are not guaranteed to be up when this row
 * activates; reading them only through `ctx.get` at activation time can observe them absent
 * and latch a failure that never clears. `shell` stays optional — it only supplies a default
 * working directory — and `timer` backs the restart backoff.
 */
export const inject = ['timer', 'subprocess', 'credentials']

/**
 * Plugin body: own the resident collector and publish its snapshot on one exact read route.
 *
 * @param ctx - host root context.
 */
export function apply(ctx) {
  const collector = createCollector(ctx)

  ctx.effect(() => {
    collector.start()
    return collector.stop
  }, 'deepseek-balance: resident collector')

  const registerRoute = (carrier) => {
    // Read the service through the context rather than through an injected property:
    // `webServer` is deliberately not a hard dependency of this plugin.
    const webServer = carrier.get('webServer')
    if (webServer === undefined) return
    carrier.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        const body = JSON.stringify(collector.snapshot())
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'cache-control': 'no-store',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    }), 'deepseek-balance: read route')
  }

  if (ctx.get('webServer') === undefined) ctx.inject(['webServer'], registerRoute)
  else registerRoute(ctx)
}
