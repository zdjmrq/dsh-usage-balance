// dsh-usage-balance — Host half(bundle 层挂载)
//
// 在侧边栏「用量/余额」标签行的背后提供 JSON 状态路由:
//   GET /dsh-usage-balance/state?sessionId=<当前会话>
// 返回:
//   usage:   startedAt / workMs(每轮实际工作时间之和,空闲不计) / running /
//            inputTokens / outputTokens / cacheReadTokens /
//            costCny / costBreakdown(基础价期|高峰|空闲) / currentTier / model
//   balance: status(ok|unavailable|error) / currency / totalBalance / grantedBalance / toppedUpBalance / message
//
// 金额计价:按官方定价表 + 事件时间戳精确分层计费(见 PRICE 区注释),
// 增量扫描会话事件日志,O(新增事件),不重算历史。
// 用量口径:tokenUsage 会话投影(与内置统计同源);余额调用官方
// GET {baseURL}/user/balance,复用 llm-deepseek 配置的同一把 key。
//
// 重要:所有服务一律在请求时经 ctx.get 惰性获取,绝不在 apply 时捕获——bundle 行的
// apply 可能早于 credentials/settings 等服务的注册(启动时序),闭包捕获会把
// undefined 冻结进插件,导致永久 no-key。

export const name = 'usage-balance'

export const inject = ['webServer']

// ── 官方价格表(元/百万 tokens)────────────────────────────────────────
// 来源:https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 旧价:2026-08-17 00:00(北京时间)之前生效。
// 新价:该时刻起采用峰谷定价——高峰时段为北京时间 9:00-12:00、14:00-18:00,
//       空闲时段价格 = 高峰的一半;其余时间为空闲时段。
const PRICE_SWITCH_MS = Date.UTC(2026, 7, 16, 16) // 2026-08-17T00:00 北京时间 = 前一日 16:00 UTC
const PRICE_TABLE = {
  legacy: {
    'deepseek-v4-flash': { hit: 0.02, miss: 1, output: 2 },
    'deepseek-v4-pro': { hit: 0.025, miss: 3, output: 6 },
  },
  offpeak: {
    'deepseek-v4-flash': { hit: 0.05, miss: 1.5, output: 4.5 },
    'deepseek-v4-pro': { hit: 0.15, miss: 4.5, output: 13.5 },
  },
  peak: {
    'deepseek-v4-flash': { hit: 0.1, miss: 3.0, output: 9.0 },
    'deepseek-v4-pro': { hit: 0.3, miss: 9.0, output: 27.0 },
  },
}
const FALLBACK_MODEL = 'deepseek-v4-pro'
const BALANCE_CACHE_MS = 60000

function beijingHour(ms) {
  // UTC+8 的小时数(0-23)
  return new Date(ms + 8 * 3600000).getUTCHours()
}

function priceTierAt(ms) {
  if (ms < PRICE_SWITCH_MS) return 'legacy'
  const h = beijingHour(ms)
  return (h >= 9 && h < 12) || (h >= 14 && h < 18) ? 'peak' : 'offpeak'
}

function priceFor(model, tier) {
  const table = PRICE_TABLE[tier] || PRICE_TABLE.legacy
  return table[model] || table[FALLBACK_MODEL]
}

// 事件时间的当前计价层(供客户端「计价时段」行展示;价格切换前恒为 legacy)
function currentTier() {
  return priceTierAt(Date.now())
}

// ── 会话级增量计价缓存 ────────────────────────────────────────────────
// sessionId -> { lastSeq, model, last, buckets, cost, turnStart, workMs }
// 事件日志 append-only 且 seq 连续;每次请求只处理 lastSeq 之后的新事件。
// 冷启动(或日志 seq 不连续)时从 0 全量重扫一次,毫秒级。
// workMs = 每轮对话实际工作时间之和(turn/start → turn/end),空闲等待不计。
const billing = new Map()

function emptyBuckets() {
  return {
    legacy: { miss: 0, hit: 0, out: 0, amount: 0 },
    peak: { miss: 0, hit: 0, out: 0, amount: 0 },
    offpeak: { miss: 0, hit: 0, out: 0, amount: 0 },
  }
}

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

// 增量扫描一个会话的事件日志,维护分层 token 桶与精确金额。
// usage 事件去重规则与内置 token-meter 投影一致:同一 turn/step 的后到
// 样本替换先到样本(usage chunk 之后跟 message 的完整 usage)。
function sweepBilling(session, now) {
  const events = session.events
  const id = session.id
  let b = billing.get(id)
  if (b === undefined) {
    b = { lastSeq: 0, model: null, last: null, buckets: emptyBuckets(), cost: 0, turnStart: new Map(), workMs: 0 }
    billing.set(id, b)
  }
  const total = Array.isArray(events) ? events.length : 0
  // 已处理 seq 越过当前日志长度(异常)或首个新事件 seq 不连续 → 全量重扫
  if (b.lastSeq > total || (b.lastSeq > 0 && b.lastSeq <= total
    && (!events[b.lastSeq - 1] || events[b.lastSeq - 1].seq !== b.lastSeq))) {
    b = { lastSeq: 0, model: null, last: null, buckets: emptyBuckets(), cost: 0, turnStart: new Map(), workMs: 0 }
    billing.set(id, b)
  }
  if (total === 0) return b

  for (let i = b.lastSeq; i < total; i++) {
    const ev = events[i]
    if (!ev || typeof ev !== 'object') continue
    const time = typeof ev.time === 'number' ? ev.time : now
    // 每轮实际工作时间:turn/start 记账,turn/end 累加区间;进行中的轮在
    // buildUsage 里补算到当前时刻。
    if (ev.type === 'turn/start' && ev.data && typeof ev.data.turn === 'number') {
      b.turnStart.set(ev.data.turn, time)
      continue
    }
    if (ev.type === 'turn/end' && ev.data && typeof ev.data.turn === 'number') {
      const start = b.turnStart.get(ev.data.turn)
      if (start !== undefined) {
        b.workMs += Math.max(0, time - start)
        b.turnStart.delete(ev.data.turn)
      }
      continue
    }
    if (ev.type === 'request/header' && ev.data && ev.data.header && ev.data.header.config) {
      const m = ev.data.header.config.model
      if (typeof m === 'string' && m.length > 0) b.model = m
      continue
    }
    let usage = null
    let turn = null
    let step = null
    if (ev.type === 'assistant/chunk' && ev.data && ev.data.chunk && ev.data.chunk.type === 'usage') {
      usage = ev.data.chunk.usage
      turn = ev.data.turn
      step = ev.data.step
    } else if (ev.type === 'assistant/message' && ev.data && ev.data.usage !== undefined) {
      usage = ev.data.usage
      turn = ev.data.turn
      step = ev.data.step
    }
    if (usage === null || usage === undefined) continue

    const tier = priceTierAt(time)
    const p = priceFor(b.model, tier)
    const miss = (usage.inputTokens || 0) + (usage.cacheWriteTokens || 0)
    const hit = usage.cacheReadTokens || 0
    const out = usage.outputTokens || 0
    const amount = (miss * p.miss + hit * p.hit + out * p.output) / 1000000

    // 同 turn/step 后到替换先到(与 token-meter 投影的 last-wins 一致)
    if (b.last !== null && b.last.turn === turn && b.last.step === step) {
      const prev = b.last
      const pb = b.buckets[prev.tier]
      pb.miss -= prev.miss
      pb.hit -= prev.hit
      pb.out -= prev.out
      pb.amount -= prev.amount
      b.cost -= prev.amount
    }
    const bucket = b.buckets[tier]
    bucket.miss += miss
    bucket.hit += hit
    bucket.out += out
    bucket.amount += amount
    b.cost += amount
    b.last = { turn, step, tier, miss, hit, out, amount }
  }
  b.lastSeq = total
  return b
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
      workMs: null,
      running: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costCny: null,
      costBreakdown: { legacy: 0, peak: 0, offpeak: 0 },
      currentTier: currentTier(),
      model: null,
    }
    if (session === undefined) return out
    const created = (session.header && typeof session.header.createdAt === 'number')
      ? session.header.createdAt
      : null
    if (created !== null) out.startedAt = created
    const now = Date.now()

    // 投影四桶(与内置统计同源,供 UI Token 行展示)
    const projections = ctx.get('sessionProjections') // 惰性获取
    if (projections !== undefined) {
      try {
        const snap = projections.snapshot(session)
        const usage = (snap && snap.values) ? snap.values.tokenUsage : undefined
        if (usage !== undefined && usage !== null) {
          out.inputTokens = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0)
          out.outputTokens = usage.outputTokens || 0
          out.cacheReadTokens = usage.cacheReadTokens || 0
        }
      } catch { /* 投影读取失败时保持 0 */ }
    }

    // 精确金额:增量扫描事件日志,按事件时间分层计价;顺带累计每轮实际工作时间
    try {
      const b = sweepBilling(session, now)
      const model = b.model !== null ? b.model : detectModel(session.events)
      if (model !== null) out.model = model
      out.costCny = b.cost
      out.costBreakdown = {
        legacy: b.buckets.legacy.amount,
        peak: b.buckets.peak.amount,
        offpeak: b.buckets.offpeak.amount,
      }
      // 已完成轮次之和 + 进行中的轮(有 turn/start 尚无 turn/end)补算到当前
      let work = b.workMs
      for (const start of b.turnStart.values()) work += Math.max(0, now - start)
      out.workMs = work
      out.running = b.turnStart.size > 0
    } catch { /* 计价失败时金额保持 null */ }

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
