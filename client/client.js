// dsh-usage-balance — Client half(预构建 module-loader bundle,零构建)
//
// 注册到 sidebar.footer.action(设置按钮上方):
//   - 宽栏:⏱ 仪表盘图标 +「用量 | 余额」主色 13px 标签行(与设置/Cordis 行同风格);
//   - 悬停:右侧展开玻璃拟态详情卡(运行时长每秒跳动 / 输入未命中·缓存命中·输出 /
//     官方计价金额(按事件时间分层:基础价期|高峰|空闲) / 计价时段 / 官方余额),
//     零间距 + 220ms 关闭缓冲,视口防溢出自动翻转到左侧并保持 12px 边距;
//   - 卡底「门帘式」椭圆滑杆开关:深灰门帘从左向右拉满 = 详情常驻;
//   - 窄栏(rail):¥ 圆形徽标,悬停同样展开详情卡(与宽栏同一套悬停/定位逻辑);
//   - 与 Cordis 面板共存:精确 :has() 规则把脚部动作区改为纵向堆叠。
// 数据来自宿主半的 GET /dsh-usage-balance/state 路由,60 秒刷新;样式全部
// 使用 --dsw-* 主题变量,跟随全局亮/暗主题;文案跟随界面中英文。

window.__ModuleLoader__.load({
  id: 'dsh-usage-balance',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const e = React.createElement

    // ── 样式(经 style 标签注入,data 属性防重复) ─────────────────────────
    const TAG_ID = 'dsh-usage-balance/style'
    const CSS = [
      '.ubar{position:relative;box-sizing:border-box;flex:none;width:100%;display:flex;align-items:center;gap:8px;height:32px;min-width:0;padding:0 8px;border-radius:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:default;}',
      '.ubar:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.ubar-pinned{background:var(--dsw-alias-bg-layer-1);}',
      '.ubar-pinned:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.ubar-icon{flex:none;color:var(--dsw-alias-label-primary);}',
      '.ubar-label{flex:none;color:var(--dsw-alias-label-primary);font-weight:500;}',
      '.ubar-sep{flex:none;color:var(--dsw-alias-separator-primary);}',
      '.ubar-pop{position:fixed;z-index:35;display:flex;flex-direction:column;gap:6px;min-width:224px;max-width:320px;width:max-content;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-overlay);background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 82%,transparent);border:1px solid var(--dsw-alias-border-l1);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 60%,transparent);backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);box-shadow:var(--dsw-shadow-lv3);font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);opacity:0;transform:translateX(-8px);pointer-events:none;transition:opacity 140ms ease,transform 140ms ease;}',
      '.ubar-pop-open{opacity:1;transform:translateX(0);pointer-events:auto;}',
      '.ubar-pop-row{display:flex;align-items:baseline;justify-content:space-between;gap:14px;min-width:0;}',
      '.ubar-pop-k{flex:none;color:var(--dsw-alias-label-secondary);}',
      '.ubar-pop-v{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);text-align:right;white-space:nowrap;}',
      '.ubar-pop-v.ubar-pop-err{color:var(--dsw-alias-state-error-primary);}',
      '.ubar-pop-msg{font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary);word-break:break-all;padding-top:4px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 60%,transparent);}',
      '.ubar-pop-foot{display:flex;align-items:center;justify-content:flex-end;margin-top:2px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 60%,transparent);}',
      '.ubar-switch{position:relative;flex:none;width:60px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;cursor:pointer;overflow:hidden;font:inherit;transition:border-color 150ms ease,background 150ms ease;}',
      '.ubar-switch:hover{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover);}',
      '.ubar-switch-fill{position:absolute;left:1px;top:1px;bottom:1px;width:18px;border-radius:999px;background:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 75%,transparent);transition:width 200ms ease;pointer-events:none;}',
      '.ubar-switch-on .ubar-switch-fill{width:calc(100% - 2px);}',
      '.ubar-switch-label{position:absolute;top:0;bottom:0;display:flex;align-items:center;font-size:11px;line-height:20px;pointer-events:none;transition:opacity 140ms ease;}',
      '.ubar-switch-off-label{left:24px;right:8px;justify-content:flex-start;color:var(--dsw-alias-label-secondary);}',
      '.ubar-switch-on .ubar-switch-off-label{opacity:0;}',
      '.ubar-switch-on-label{left:0;right:0;justify-content:center;color:var(--dsw-alias-label-primary-inverted);opacity:0;}',
      '.ubar-switch-on .ubar-switch-on-label{opacity:1;}',
      '.ubar-rail{width:100%;height:32px;justify-content:center;gap:0;padding:0;border-radius:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;cursor:default;}',
      '.ubar-rail:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      'div:has(> .ubar),div:has(.ubar):has(+ div [aria-haspopup="dialog"]){flex-direction:column;}',
    ].join('\n')
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(TAG_ID) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-usage-balance'
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ── 工具函数 ─────────────────────────────────────────────────────────
    function pad2(n) {
      return n < 10 ? '0' + n : String(n)
    }

    function formatRuntime(ms) {
      const totalSec = Math.floor(ms / 1000)
      const s = totalSec % 60
      const m = Math.floor(totalSec / 60) % 60
      const h = Math.floor(totalSec / 3600)
      if (h > 0) return h + 'h' + pad2(m) + 'm' + pad2(s) + 's'
      if (m > 0) return m + 'm' + pad2(s) + 's'
      return s + 's'
    }

    function fmtTokens(n) {
      if (n < 1000) return String(n)
      if (n < 1000000) return String(Math.round(n / 100) / 10) + 'K'
      return String(Math.round(n / 100000) / 10) + 'M'
    }

    function currencySymbol(currency) {
      if (currency === 'CNY') return '¥'
      if (currency === 'USD') return '$'
      if (typeof currency === 'string' && currency.length > 0) return currency
      return '¥'
    }

    function balanceLabel(balance, t) {
      if (!balance) return t.pending
      if (balance.status === 'ok') return currencySymbol(balance.currency) + balance.totalBalance
      if (balance.status === 'unavailable') {
        return balance.reason === 'no-key' ? t.noKey : t.na
      }
      return t.fail
    }

    const SPEED_PATH = 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.28-10.43zM10.59 15.41a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z'

    // ── 文案(zh/en) ──────────────────────────────────────────────────────
    const TEXTS = {
      zh: {
        usage: '用量', balance: '余额', runtime: '运行时长', inMiss: '输入·未命中', cacheHit: '缓存命中',
        outTok: '输出', cost: '金额', tier: '计价时段', tierLegacy: '基础价', tierPeak: '高峰', tierOffpeak: '空闲',
        noSession: '无对话', pending: '…', noKey: '未配置 key', na: '不可用', fail: '获取失败',
        pinOn: '点击后始终显示详情', pinOff: '点击后仅悬停显示详情',
        modeHover: '悬停', modePinned: '固定',
      },
      en: {
        usage: 'Usage', balance: 'Balance', runtime: 'Runtime', inMiss: 'Input (miss)', cacheHit: 'Cache hit',
        outTok: 'Output', cost: 'Cost', tier: 'Billing tier', tierLegacy: 'Base', tierPeak: 'Peak', tierOffpeak: 'Off-peak',
        noSession: 'No session', pending: '…', noKey: 'No key', na: 'N/A', fail: 'Failed',
        pinOn: 'Click to always show details', pinOff: 'Click to show details on hover only',
        modeHover: 'Hover', modePinned: 'Pinned',
      },
    }

    // ── 侧边栏组件 ────────────────────────────────────────────────────────
    function UsageBalanceBar(props) {
      const wide = props.wide
      const useSessions = props.useSessions
      const timer = props.timer
      const locale = props.locale
      const sessionId = typeof useSessions === 'function'
        ? useSessions((s) => (s ? s.current : undefined))
        : null
      const isZh = () => {
        if (locale === undefined) return true
        try {
          const active = locale.getSnapshot().active
          return typeof active === 'string' && active.indexOf('zh') === 0
        } catch (error) {
          return true
        }
      }
      const [zh, setZh] = React.useState(isZh)
      const [snap, setSnap] = React.useState(null)
      const [now, setNow] = React.useState(() => Date.now())
      const [hovered, setHovered] = React.useState(false)
      const [pinned, setPinned] = React.useState(false)
      const [fly, setFly] = React.useState(null)
      const hoverTimer = React.useRef(null)

      const clearHoverTimer = () => {
        if (hoverTimer.current !== null) {
          hoverTimer.current()
          hoverTimer.current = null
        }
      }

      const measureFly = (rect) => {
        const margin = 12
        const estW = 264
        const estH = 264
        const vw = (typeof window !== 'undefined' && window.innerWidth > 0) ? window.innerWidth : 1280
        const vh = (typeof window !== 'undefined' && window.innerHeight > 0) ? window.innerHeight : 800
        let left = rect.right
        if (left + estW > vw - margin) left = rect.left - estW
        if (left < margin) left = margin
        if (left + estW > vw - margin) left = Math.max(margin, vw - estW - margin)
        let top = rect.top - 6
        if (top < margin) top = margin
        if (top + estH > vh - margin) top = Math.max(margin, vh - estH - margin)
        setFly({ top: Math.round(top), left: Math.round(left) })
      }

      React.useEffect(() => () => { clearHoverTimer() }, [])

      React.useEffect(() => {
        if (locale === undefined) return undefined
        return locale.subscribe(() => { setZh(isZh()) })
      }, [locale])

      React.useEffect(() => {
        if (timer === undefined) return undefined
        return timer.interval(() => { setNow(Date.now()) }, 1000)
      }, [timer])

      React.useEffect(() => {
        let cancelled = false
        const load = () => {
          const url = '/dsh-usage-balance/state'
            + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '')
          fetch(url)
            .then((res) => res.json())
            .then((res) => {
              if (!cancelled) setSnap(res)
            })
            .catch(() => {
              if (!cancelled) setSnap(null)
            })
        }
        load()
        let dispose = () => {}
        if (timer !== undefined) dispose = timer.interval(load, 60000)
        return () => { cancelled = true; dispose() }
      }, [sessionId, timer])

      const t = zh ? TEXTS.zh : TEXTS.en
      const usage = (snap && snap.usage) ? snap.usage : null
      const startedAt = (usage && typeof usage.startedAt === 'number') ? usage.startedAt : null
      const runtimeMs = startedAt != null ? Math.max(0, now - startedAt) : null
      const inTok = (usage && typeof usage.inputTokens === 'number') ? usage.inputTokens : 0
      const hitTok = (usage && typeof usage.cacheReadTokens === 'number') ? usage.cacheReadTokens : 0
      const outTok = (usage && typeof usage.outputTokens === 'number') ? usage.outputTokens : 0
      const cost = (usage && typeof usage.costCny === 'number') ? usage.costCny : null
      const tier = (usage && typeof usage.currentTier === 'string') ? usage.currentTier : null
      const breakdown = (usage && usage.costBreakdown && typeof usage.costBreakdown === 'object')
        ? usage.costBreakdown
        : null
      const bal = (snap && snap.balance) ? snap.balance : null

      const runtimeText = runtimeMs != null
        ? formatRuntime(runtimeMs)
        : (sessionId ? t.pending : t.noSession)
      const inMissText = (inTok > 0 || hitTok > 0 || outTok > 0) ? fmtTokens(inTok) : '—'
      const cacheHitText = (inTok > 0 || hitTok > 0 || outTok > 0) ? fmtTokens(hitTok) : '—'
      const outTokText = (inTok > 0 || hitTok > 0 || outTok > 0) ? fmtTokens(outTok) : '—'
      const costText = cost != null
        ? '≈¥' + (cost < 1 ? cost.toFixed(3) : cost.toFixed(2))
        : '—'
      let costTitle = null
      if (breakdown !== null) {
        const parts = []
        if (typeof breakdown.legacy === 'number' && breakdown.legacy > 0) {
          parts.push(t.tierLegacy + ' ≈¥' + breakdown.legacy.toFixed(2))
        }
        if (typeof breakdown.peak === 'number' && breakdown.peak > 0) {
          parts.push(t.tierPeak + ' ≈¥' + breakdown.peak.toFixed(2))
        }
        if (typeof breakdown.offpeak === 'number' && breakdown.offpeak > 0) {
          parts.push(t.tierOffpeak + ' ≈¥' + breakdown.offpeak.toFixed(2))
        }
        if (parts.length > 0) costTitle = parts.join(' · ')
      }
      const tierText = tier === 'legacy' ? t.tierLegacy
        : tier === 'peak' ? t.tierPeak
        : tier === 'offpeak' ? t.tierOffpeak
        : '—'
      const balText = balanceLabel(bal, t)
      const balError = (bal && bal.status === 'error' && bal.message) ? String(bal.message) : null
      const fullTitle = t.usage + ' ' + t.runtime + ' ' + runtimeText + ' · ' + t.inMiss + ' ' + inMissText
        + ' · ' + t.cacheHit + ' ' + cacheHitText + ' · ' + t.outTok + ' ' + outTokText
        + ' · ' + t.cost + ' ' + costText + ' | ' + t.balance + ' ' + balText

      const rows = []
      rows.push(e('div', { className: 'ubar-pop-row', key: 'runtime' },
        e('span', { className: 'ubar-pop-k' }, t.runtime),
        e('span', { className: 'ubar-pop-v' }, runtimeText)))
      rows.push(e('div', { className: 'ubar-pop-row', key: 'inMiss' },
        e('span', { className: 'ubar-pop-k' }, t.inMiss),
        e('span', { className: 'ubar-pop-v' }, inMissText)))
      rows.push(e('div', { className: 'ubar-pop-row', key: 'cacheHit' },
        e('span', { className: 'ubar-pop-k' }, t.cacheHit),
        e('span', { className: 'ubar-pop-v' }, cacheHitText)))
      rows.push(e('div', { className: 'ubar-pop-row', key: 'outTok' },
        e('span', { className: 'ubar-pop-k' }, t.outTok),
        e('span', { className: 'ubar-pop-v' }, outTokText)))
      rows.push(e('div', { className: 'ubar-pop-row', key: 'cost' },
        e('span', { className: 'ubar-pop-k' }, t.cost),
        e('span', { className: 'ubar-pop-v', title: costTitle !== null ? costTitle : undefined }, costText)))
      rows.push(e('div', { className: 'ubar-pop-row', key: 'tier' },
        e('span', { className: 'ubar-pop-k' }, t.tier),
        e('span', { className: 'ubar-pop-v' }, tierText)))
      rows.push(e('div', { className: 'ubar-pop-row', key: 'balance' },
        e('span', { className: 'ubar-pop-k' }, t.balance),
        e('span', {
          className: balError !== null ? 'ubar-pop-v ubar-pop-err' : 'ubar-pop-v',
          title: balError !== null ? balError : undefined,
        }, balText)))
      if (balError !== null) {
        rows.push(e('div', { className: 'ubar-pop-msg', key: 'err' }, balError))
      }
      rows.push(e('div', { className: 'ubar-pop-foot', key: 'foot' },
        e('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': pinned,
          className: pinned ? 'ubar-switch ubar-switch-on' : 'ubar-switch',
          title: pinned ? t.pinOff : t.pinOn,
          onClick: () => { setPinned((p) => !p) },
        },
          e('span', { className: 'ubar-switch-fill' }),
          e('span', { className: 'ubar-switch-label ubar-switch-off-label' }, t.modeHover),
          e('span', { className: 'ubar-switch-label ubar-switch-on-label' }, t.modePinned)
        )))

      const hoverHandlers = {
        onMouseEnter: (ev) => {
          clearHoverTimer()
          measureFly(ev.currentTarget.getBoundingClientRect())
          setHovered(true)
        },
        onMouseLeave: () => {
          clearHoverTimer()
          if (timer !== undefined) {
            hoverTimer.current = timer.timeout(() => {
              hoverTimer.current = null
              setHovered(false)
            }, 220)
          } else {
            setHovered(false)
          }
        },
      }
      const popNode = e('div', {
        className: (hovered || pinned) ? 'ubar-pop ubar-pop-open' : 'ubar-pop',
        style: {
          top: fly !== null ? fly.top : -9999,
          left: fly !== null ? fly.left : -9999,
        },
      }, rows)

      if (!wide) {
        return e('div', Object.assign({
          className: 'ubar ubar-rail',
          title: (hovered || pinned) ? undefined : fullTitle,
        }, hoverHandlers),
          (bal && bal.status === 'ok') ? currencySymbol(bal.currency) : '·',
          popNode)
      }

      return e('div', Object.assign({
        className: pinned ? 'ubar ubar-pinned' : 'ubar',
      }, hoverHandlers),
        e('svg', {
          className: 'ubar-icon',
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          'aria-hidden': true,
          fill: 'currentColor',
        }, e('path', { d: SPEED_PATH })),
        e('span', { className: 'ubar-label' }, t.usage),
        e('span', { className: 'ubar-sep' }, '|'),
        e('span', { className: 'ubar-label' }, t.balance),
        popNode)
    }

    // ── 插件主体 ─────────────────────────────────────────────────────────
    const inject = ['slots', 'timer']

    function apply(ctx) {
      const slots = ctx.get('slots')
      const timer = ctx.get('timer')
      const locale = ctx.get('locale')
      if (slots === undefined) return

      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'usage-balance', order: -100 },
        (props) => e(UsageBalanceBar, Object.assign({}, props, { timer, locale }))
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
