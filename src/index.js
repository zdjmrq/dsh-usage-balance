// dsh-usage-balance — Host half(bundle 层挂载)
//
// 在侧边栏「用量/余额」标签行的背后提供 JSON 状态路由:
//   GET /dsh-usage-balance/state?sessionId=<当前会话>
// 返回:
//   usage:   startedAt / inputTokens / outputTokens / cacheReadTokens / costCny / model
//   balance: status(ok|unavailable|error) / currency / totalBalance / grantedBalance / toppedUpBalance / message
//
// 用量口径:tokenUsage 会话投影(与内置统计同源);金额按内置价格表估算(≈,可在本文件
// 顶部调整);余额调用官方 GET {baseURL}/user/balance,复用 llm-deepseek 配置的同一把 key。
//
// 重要:所有服务一律在请求时经 ctx.get 惰性获取,绝不在 apply 时捕获——bundle 行的
// apply 可能早于 credentials/settings 等服务的注册(启动时序),闭包捕获会把
// undefined 冻结进插件,导致永久 no-key。

export const name = 'usage-balance'

export const inject = ['webServer']

// 价格表:每百万 token 的人民币单价(近似值;如与实际不符请修改这里)
const PRICE_TABLE = {
  'deepseek-v4-flash': { input: 2, cacheRead: 0.5, output: 8 },
  'deepseek-v4-pro': { input: 4, cacheRead: 1, output: 16 },
  'deepseek-chat': { input: 2, cacheRead: 0.5, output: 8 },
  'deepseek-reasoner': { input: 4, cacheRead: 1, output: 16 },
}
const FALLBACK_PRICE = { input: 3, cacheRead: 0.75, output: 12 }
const BALANCE_CACHE_MS = 60000

function detectModel(events) {
  if (!events) return null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e && e.type === 'request/header' && e.data && e.data.header && e.data.header.config) {
      const model = e.data.header.config.model
      if (typeof model === 'string' && model.length > 0) return model
    }
  }
  return null
}

function estimateCost(usage, model) {
  if (!usage) return null
  const p = (model && PRICE_TABLE[model]) || FALLBACK_PRICE
  const input = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0)
  const cacheRead = usage.cacheReadTokens || 0
  const output = usage.outputTokens || 0
  return (input * p.input + cacheRead * p.cacheRead + output * p.output) / 1000000
}

// 去掉尾部斜杠与 /v1 之类版本路径,再拼 /user/balance(参考 dsh-cost-meter)
function balanceEndpoint(baseURL) {
  let base = (typeof baseURL === 'string' ? baseURL : '').trim().replace(/\/+$/, '')
  if (base.length === 0) base = 'https://api.deepseek.com'
  if (/\/v\d+$/i.test(base)) base = base.replace(/\/v\d+$/i, '')
  return base + '/user/balance'
}

export function apply(ctx) {
  let balanceCache = null
  let balanceAt = 0

  async function fetchBalance(cwdHint) {
    const now = Date.now()
    if (balanceCache !== null && now - balanceAt < BALANCE_CACHE_MS) return balanceCache
    // 惰性获取:每次请求都重新读服务,规避 apply 时序问题
    const settings = ctx.get('settings')
    const credentials = ctx.get('credentials')
    const subprocess = ctx.get('subprocess')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const launchEnvironment = ctx.get('launchEnvironment')

    let cfg
    try {
      cfg = settings !== undefined ? settings.get('llm-deepseek') : undefined
    } catch { cfg = undefined }
    const apiKeyEnv = (cfg && typeof cfg.apiKeyEnv === 'string' && cfg.apiKeyEnv.length > 0)
      ? cfg.apiKeyEnv
      : 'DEEPSEEK_API_KEY'
    const url = balanceEndpoint(cfg ? cfg.baseURL : undefined)

    let key = ''
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(apiKeyEnv)
        if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) key = hit.value
      } catch { /* 忽略 */ }
    }
    if (key === '' && typeof process !== 'undefined' && typeof process.env[apiKeyEnv] === 'string') {
      key = process.env[apiKeyEnv]
    }
    // 与 llm-deepseek 适配器同链的最后回退:启动环境快照(进程 env / 项目 .env / 用户 .env)
    if (key === '' && launchEnvironment !== undefined && typeof launchEnvironment.get === 'function') {
      try {
        const entry = launchEnvironment.get(apiKeyEnv)
        if (entry !== undefined && typeof entry.value === 'string' && entry.value.length > 0) key = entry.value
      } catch { /* 忽略 */ }
    }
    if (key === '') return { status: 'unavailable', reason: 'no-key' }

    const parseResponse = (text) => {
      const parsed = JSON.parse(text)
      const infos = (parsed && Array.isArray(parsed.balance_infos)) ? parsed.balance_infos : null
      const info = (infos && infos.length > 0) ? infos[0] : null
      if (info && typeof info.currency === 'string' && info.total_balance != null) {
        return {
          status: 'ok',
          currency: info.currency,
          totalBalance: String(info.total_balance),
          grantedBalance: info.granted_balance != null ? String(info.granted_balance) : null,
          toppedUpBalance: info.topped_up_balance != null ? String(info.topped_up_balance) : null,
        }
      }
      if (parsed && parsed.is_available === false) return { status: 'unavailable', reason: 'not-available' }
      return { status: 'error', message: (parsed && parsed.error && parsed.error.message) ? String(parsed.error.message) : 'bad-response' }
    }

    // 方案 1:Node fetch(真实宿主插件可直接使用)
    try {
      const response = await fetch(url, {
        headers: { authorization: 'Bearer ' + key },
        signal: AbortSignal.timeout(15000),
      })
      if (response.ok) {
        const value = parseResponse(await response.text())
        balanceCache = value
        balanceAt = now
        return value
      }
      return { status: 'error', message: 'HTTP ' + response.status }
    } catch (error) {
      // 落入方案 2
    }

    // 方案 2:subprocess + curl(绕开 Windows 上可能故障的 bash/WSL)
    if (subprocess !== undefined) {
      let curl = null
      for (const name of ['curl', 'curl.exe']) {
        try {
          const resolved = await subprocess.resolveExecutable(name)
          if (typeof resolved === 'string' && resolved.length > 0) { curl = resolved; break }
        } catch { /* 继续 */ }
      }
      if (curl !== null) {
        const cwd = (typeof cwdHint === 'string' && cwdHint.length > 0)
          ? cwdHint
          : ((sandboxPolicy !== undefined && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot.length > 0)
            ? sandboxPolicy.workspaceRoot
            : 'C:\\')
        try {
          const handle = subprocess.spawn({
            argv: [curl, '-sS', '--max-time', '15', '-H', 'Authorization: Bearer ' + key, url],
            cwd,
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: 65536 },
              stderr: { maxBytes: 16384 },
            },
            graceMs: 5000,
          })
          await handle.done
          const stdoutText = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0).text : ''
          const stderrText = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0).text : ''
          try {
            const value = parseResponse(stdoutText)
            balanceCache = value
            balanceAt = now
            return value
          } catch {
            const detail = stderrText.trim().slice(0, 200) || stdoutText.slice(0, 200)
            return { status: 'error', message: detail || 'empty-response' }
          }
        } catch (error) {
          return { status: 'error', message: 'spawn-failed: ' + ((error && error.message) ? error.message : 'unknown') }
        }
      }
    }

    return { status: 'error', message: 'balance-unreachable' }
  }

  function buildUsage(session) {
    const out = {
      hasSession: session !== undefined,
      startedAt: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costCny: null,
      model: null,
    }
    if (session === undefined) return out
    const created = (session.header && typeof session.header.createdAt === 'number')
      ? session.header.createdAt
      : null
    if (created !== null) out.startedAt = created
    const projections = ctx.get('sessionProjections') // 惰性获取
    if (projections !== undefined) {
      try {
        const snap = projections.snapshot(session)
        const usage = (snap && snap.values) ? snap.values.tokenUsage : undefined
        if (usage !== undefined && usage !== null) {
          out.inputTokens = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0)
          out.outputTokens = usage.outputTokens || 0
          out.cacheReadTokens = usage.cacheReadTokens || 0
          const model = detectModel(session.events)
          if (model !== null) out.model = model
          out.costCny = estimateCost(usage, model)
        }
      } catch { /* 投影读取失败时保持 0 */ }
    }
    return out
  }

  const json = (res, value) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-balance/state',
    handler: (req, res) => {
      const query = new URL(req.url ?? '/', 'http://dsh.local').searchParams
      const sessionId = query.get('sessionId')
      const sessions = ctx.get('sessions') // 惰性获取
      const session = (typeof sessionId === 'string' && sessionId !== '' && sessions !== undefined)
        ? sessions.get(sessionId)
        : undefined
      void Promise.resolve()
        .then(async () => {
          const usage = buildUsage(session)
          const balance = await fetchBalance(session !== undefined && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : undefined)
          return { usage, balance, now: Date.now() }
        })
        .then((value) => json(res, value))
        .catch((error) => json(res, { error: error instanceof Error ? error.message : String(error) }))
    },
  }), 'usage-balance: state route')
}
