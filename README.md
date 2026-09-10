# dsh-plugin-deepseek-balance

A DSH plugin that shows the DeepSeek official account balance as a frame-wide status pill.

## Shape

| Half | File | What it does |
| --- | --- | --- |
| Host | `lib/index.js` | Owns one resident `node` child, decodes the JSON lines it prints, serves the newest snapshot on `GET /deepseek-balance` |
| Client | `lib/client.js` | Registers a row in `sidebar.footer.action` and re-reads that route every 15s |

The child polls `https://api.deepseek.com/user/balance` with Node's own global `fetch` and
prints one JSON line per attempt:

```json
{"ok":true,"available":true,"balances":[{"currency":"USD","total":"1058.74","granted":"0.00","toppedUp":"1058.74"}],"fetchedAt":1789030516269}
```

Design notes:

- **No shell, no curl.** `argv` is an explicit `node -e`, resolved through
  `subprocess.resolveExecutable`, so nothing depends on the launching shell's `PATH`.
- **One process.** The child is spawned once per plugin lifetime and restarted only after it
  exits (5s backoff); it is terminated with the owning fiber.
- **The key stays on the host.** `DEEPSEEK_API_KEY` is resolved through the `credentials`
  service and passed to the child in its environment — never on the command line, never to
  the browser. The read route returns only balance figures.
- **Two cadences.** The child collects every 60s; the row re-reads the host's cached
  snapshot every 15s, so no polling happens from the browser.

## Why the client half overrides one slot anchor

`sidebar.footer.action` renders as a flex **row**, and its only shipped occupant — the
Cordis panel row — is `flex: none; width: 100%`, so a second entry in that row collapses to
zero width. The slot anchor itself renders with `display: contents`, which is what makes the
one-line fix safe:

```css
[data-slot="sidebar.footer.action"] { display: flex !important; flex-direction: column; }
```

The anchor becomes a real box, the two entries stack, and no shipped rule or row is touched.
The row itself reuses the shipped footer row's metrics (42px, 12px radius, right-aligned
status text in `--dsw-alias-label-tertiary`) so it reads as part of the sidebar foot; in the
56px rail it collapses to a 36px circle showing the primary currency symbol.

## Installing into a profile

The package must be resolvable from the profile that mounts it. With pnpm available that is
`dsh plugin --profile web add <spec>`; without pnpm a link plus one patch row is equivalent:

```sh
ln -s /path/to/dsh-plugin-deepseek-balance ~/.dsh/profiles/web/node_modules/dsh-plugin-deepseek-balance
```

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: deepseek-balance
      name: 'dsh-plugin-deepseek-balance'
```

`dsh.client` in `package.json` puts `lib/client.js` into the browser roster that
`@deepseek-ai/dsh-client-modules` composes into `window.__DSH_BOOT__`.

## Test

`test/host-smoke.mjs` drives `apply()` with a fake Cordis context whose subprocess provider
is a real `node:child_process`, then reads the registered route — covering spawn, stdout
lines, snapshot, and route JSON without a DSH process:

```sh
DEEPSEEK_API_KEY=... node test/host-smoke.mjs
```
