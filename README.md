# @virzz/dsh-plugin-deepseek-balance

A [DSH](https://github.com/deepseek-ai/deepseek-harness) plugin that shows the DeepSeek
official account balance as a row in the sidebar footer, above **Settings**.

```
◆  Cordis Plugin                    0 running
▤  DeepSeek 余额              $1058.69 · ¥-0.01
⚙  设置
```

## Shape

| Half | File | What it does |
| --- | --- | --- |
| Host | `lib/index.js` | Owns one resident `node` child, decodes the JSON lines it prints, serves the newest snapshot on `GET /deepseek-balance` |
| Client | `lib/client.js` | Registers a row in `sidebar.footer.action` and re-reads that route every 15s |

The child polls `https://api.deepseek.com/user/balance` with Node's own global `fetch` and
prints one JSON line per attempt:

```json
{"ok":true,"available":true,"balances":[{"currency":"USD","total":"1058.69","granted":"0.00","toppedUp":"1058.69"}],"fetchedAt":1789030816379}
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

## Install into DSH

A DSH plugin is a package plus a row. The package has to be resolvable **from the profile
that mounts it**, and the row has to name it — the browser half only reaches the page as part
of that profile's client roster, which is composed at boot.

### 1. Add the package to the profile

```sh
dsh plugin --profile web add @virzz/dsh-plugin-deepseek-balance
```

`dsh plugin` forwards everything after `--profile <name>` to pnpm **in the profile
directory**, so this is an ordinary `pnpm add` in `$DSH_HOME/profiles/web` — which is exactly
the `node_modules` tree the loader resolves row names from.

To leave the shipped `web` profile untouched, derive your own from it and install there:

```sh
dsh --profile balance --from-default-profile web
dsh plugin --profile balance add @virzz/dsh-plugin-deepseek-balance
```

The package is published to npmjs and to GitHub Packages. The command above resolves from
npmjs by default; to install from GitHub Packages, point the scope at it first:

```sh
npm config set @virzz:registry https://npm.pkg.github.com
```

<details>
<summary>Without pnpm</summary>

`dsh plugin add` does two things; both can be done by hand — put the package where the
profile can resolve it, and name it in the profile's own patch layer.

```sh
mkdir -p ~/.dsh/profiles/web/node_modules/@virzz
ln -s /path/to/dsh-plugin-deepseek-balance \
      ~/.dsh/profiles/web/node_modules/@virzz/dsh-plugin-deepseek-balance
```

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml — applied after every bundle layer
- insert:
    - id: deepseek-balance
      name: '@virzz/dsh-plugin-deepseek-balance'
```
</details>

### 2. Provide the DeepSeek API key

The host half re-resolves the credential reference `DEEPSEEK_API_KEY` on every collector
start. Either of these works:

- **Settings → Models**, on the DeepSeek provider card — stored in `$DSH_HOME/.credentials.yaml`; or
- export it where DSH boots: `export DEEPSEEK_API_KEY=sk-...`

Nothing else needs it. The key never reaches the browser and never appears on a command
line: the collector receives it in its environment, and the read route exposes balance
figures only.

### 3. Boot

```sh
dsh --profile web        # or: dsh web
```

The row appears in the sidebar footer, directly above **Settings**:

```
◆  Cordis Plugin                    0 running
▤  DeepSeek 余额              $1058.69 · ¥-0.01
⚙  设置
```

Hover it for the per-currency breakdown (total, granted, topped up) and the collection time;
click it to re-read the host's cache immediately.

### 4. Verify without opening the UI

```sh
dsh --profile web --dump-config | grep -A2 deepseek-balance   # is the row composed?
curl -s http://127.0.0.1:8021/deepseek-balance                # does the host half answer?
```

The launcher prints its URL on boot; adjust the port if yours differs. A healthy answer:

```json
{"ok":true,"available":true,"balances":[{"currency":"USD","total":"1058.69","granted":"0.00","toppedUp":"1058.69"}],"fetchedAt":1789030816379}
```

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Row reads `未配置密钥` | `DEEPSEEK_API_KEY` is not resolvable — set it in Settings → Models, or in the environment that boots DSH |
| Row reads `不可用` | Hover it: the tooltip carries the exact cause (`http-401`, `request-failed`, `poller-exited`, …) |
| Row reads `不可用`, tooltip says `subprocess 服务不可用` | The row activated before the subprocess service. It declares that as a hard dependency *and* retries every 5s, so it clears itself |
| No row at all | The client roster is composed at boot — restart the profile. `--dump-config` above shows whether the row is composed at all |
| Row only visible when the sidebar is expanded | Expected: in the 56px rail it collapses to a 36px circle showing the primary currency symbol |

### Uninstall

```sh
dsh plugin --profile web remove @virzz/dsh-plugin-deepseek-balance
```

Or delete the row from `cordis.patch.yml` plus the `node_modules` entry, then restart.

`dsh.client` in `package.json` puts `lib/client.js` into the browser roster that
`@deepseek-ai/dsh-client-modules` composes into `window.__DSH_BOOT__`. The module id inside
`lib/client.js` must equal the package name — the workflow checks that before publishing.

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

## Publish

`.github/workflows/publish.yml` runs on a published release, on a `v*` tag push, or by hand
via **Run workflow**. It has three jobs: a `check` gate, then one publish job per registry.

| Registry | Credential | Notes |
| --- | --- | --- |
| npmjs | **OIDC trusted publishing** — no token at all | the job carries `id-token: write` and the npm CLI exchanges that for a short-lived publish credential; provenance is generated automatically because the repo is public |
| GitHub Packages | the workflow's own `GITHUB_TOKEN` | needs `packages: write`; nothing to configure |

They are separate jobs on purpose: the two use different credentials, and one being
unconfigured never blocks the other. `publishConfig.registry` is deliberately **not** set —
it would override each job's `--registry`, and the `check` job fails if it comes back.

### Trusted publishing setup

Trusted publishing needs npm CLI >= 11.5.1 on Node >= 22.14, so the jobs run Node 24 and the
npmjs job upgrades npm before publishing. On npmjs.com, at
**Packages → @virzz/dsh-plugin-deepseek-balance → Settings → Trusted publishing**, add a
GitHub Actions publisher with these exact, case-sensitive values:

| Field | Value |
| --- | --- |
| Organization or user | `virzz` |
| Repository | `dsh-plugin-deepseek-balance` |
| Workflow filename | `publish.yml` |
| Allowed actions | `npm publish` |

**First publish is the exception.** A package that does not exist yet has no settings page to
attach a trusted publisher to, so version `1.0.0` has to be published once the ordinary way —
either `npm login && npm publish --access public` from a checkout, or run the workflow with a
temporary `NPM_TOKEN` secret. Configure the trusted publisher immediately afterwards; every
later release then publishes with no token, and you can set the package to
*Require two-factor authentication and disallow tokens*.

Bump `version` before releasing: both registries reject a duplicate version.

## Test

`test/host-smoke.mjs` drives `apply()` with a fake Cordis context whose subprocess provider
is a real `node:child_process`, then reads the registered route — covering spawn, stdout
lines, snapshot, and route JSON without a DSH process:

```sh
DEEPSEEK_API_KEY=... node test/host-smoke.mjs
```
