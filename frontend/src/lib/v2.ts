/**
 * Shared helpers for the v2 console pages (src/pages/v2).
 * Pure functions + small fetch wrappers; no DOM side effects except `el()`.
 */
import { toCssColor } from './colors'
import { getAbortSignal } from './abort'

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

export function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export async function getJson<T = any>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: 'include', signal: getAbortSignal() })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

export async function sendJson<T = any>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | null; error: string }> {
  try {
    const r = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: getAbortSignal(),
    })
    let data: any = null
    try { data = await r.json() } catch { /* no body */ }
    const error = r.ok ? '' : (data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : '') || data?.message || (Array.isArray(data?.detail) ? data.detail[0]?.msg : '') || `HTTP ${r.status}`)
    return { ok: r.ok, status: r.status, data, error }
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e?.message || 'Network error' }
  }
}

/* ── Domain helpers ─────────────────────────────────────────────── */

export interface FilamentLike {
  designation?: string | null
  material_type?: string | null
  manufacturer_color_name?: string | null
  manufacturer?: { name?: string | null } | null
  colors?: { position?: number; color?: { hex_code?: string | null; name?: string | null } | null }[] | null
  color_mode?: string | null
}

export interface SpoolLike {
  id: number
  remaining_weight_g?: number | null
  initial_total_weight_g?: number | null
  empty_spool_weight_g?: number | null
  spool_core_weight_g?: number | null
  low_weight_threshold_g?: number | null
  status_id?: number | null
  filament?: FilamentLike | null
}

/** CSS background for a filament's colour(s). Multi-colour becomes a hard-stop gradient. */
export function swatchBackground(f?: FilamentLike | null): string {
  const hexes = (f?.colors || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(c => c.color?.hex_code)
    .filter((h): h is string => !!h)
    .map(h => toCssColor(h, 'transparent'))
  const checker = 'conic-gradient(#D1D5DB 25%, #FFFFFF 0 50%, #D1D5DB 0 75%, #FFFFFF 0) 0 / 8px 8px'
  if (!hexes.length) return `linear-gradient(var(--bg-soft), var(--bg-soft)), ${checker}`
  if (hexes.length === 1) return `linear-gradient(${hexes[0]}, ${hexes[0]}), ${checker}`
  const step = 100 / hexes.length
  const stops = hexes.map((h, i) => `${h} ${i * step}% ${(i + 1) * step}%`).join(', ')
  return `linear-gradient(135deg, ${stops}), ${checker}`
}

export function filamentName(f?: FilamentLike | null): string {
  if (!f) return '—'
  const d = (f.designation || '').trim()
  const c = (f.manufacturer_color_name || '').trim()
  const dup = !c || !d || d.toLowerCase() === c.toLowerCase() || d.toLowerCase().includes(c.toLowerCase())
  const parts = dup ? [d || c] : [d, c]
  return parts.filter(Boolean).join(' · ') || f.material_type || '—'
}

export function colorName(f?: FilamentLike | null): string {
  return f?.manufacturer_color_name || f?.colors?.[0]?.color?.name || ''
}

/** Net filament capacity of a spool (initial minus spool/core weight) or null. */
export function spoolCapacity(s: SpoolLike): number | null {
  const init = s.initial_total_weight_g
  if (init == null || init <= 0) return null
  const empty = (s.empty_spool_weight_g ?? 0) + (s.spool_core_weight_g ?? 0)
  const cap = init - empty
  return cap > 0 ? cap : init
}

export type Level = 'full' | 'normal' | 'low' | 'crit' | 'empty' | 'unknown'

/** Mirrors the backend dashboard buckets: crit ≤ ½ threshold, low ≤ threshold, full > 75 %. */
export function remainingLevel(s: SpoolLike): Level {
  const rem = s.remaining_weight_g
  if (rem == null) return 'unknown'
  if (rem <= 0) return 'empty'
  const thr = s.low_weight_threshold_g ?? 0
  if (thr > 0 && rem <= thr / 2) return 'crit'
  if (thr > 0 && rem <= thr) return 'low'
  const cap = spoolCapacity(s)
  if (cap && rem / cap > 0.75) return 'full'
  return 'normal'
}

export function remainingPercent(s: SpoolLike): number | null {
  const rem = s.remaining_weight_g
  const cap = spoolCapacity(s)
  if (rem == null || !cap) return null
  return Math.max(0, Math.min(100, Math.round((rem / cap) * 100)))
}

export function barClass(level: Level): string {
  return level === 'crit' ? 'crit' : level === 'low' ? 'low' : level === 'empty' ? 'neutral' : ''
}

export function levelColorVar(level: Level): string {
  return level === 'crit' ? 'var(--error-text)' : level === 'low' ? 'var(--accent-3)' : level === 'empty' ? 'var(--text-dim)' : 'var(--text)'
}

/** Remaining cell: bar + grams (+ capacity). */
export function remainingHtml(s: SpoolLike, opts: { withCapacity?: boolean } = {}): string {
  const rem = s.remaining_weight_g
  if (rem == null) return '<span class="v2-dim">—</span>'
  const level = remainingLevel(s)
  const pct = remainingPercent(s)
  const cap = spoolCapacity(s)
  const bar = pct == null
    ? ''
    : `<div class="v2-bar ${barClass(level)}"><i style="width: ${pct}%;"></i></div>`
  const capTxt = opts.withCapacity && cap ? `<span class="v2-dim v2-num" style="font-size: 11px;">/ ${fmtG(cap)}</span>` : ''
  return `<div class="v2-row">${bar}<span class="v2-num" style="color: ${levelColorVar(level)};">${fmtG(rem)}</span>${capTxt}</div>`
}

export function fmtG(g: number | null | undefined, digits = 0): string {
  if (g == null || Number.isNaN(g)) return '—'
  const n = Number(g)
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)} kg`
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits })} g`
}

export function fmtKg(g: number | null | undefined): string {
  if (g == null) return '—'
  return `${(Number(g) / 1000).toFixed(1)} kg`
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function relTime(iso?: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  if (days < 7) return `${days} d ago`
  const w = Math.round(days / 7)
  if (w < 8) return `${w} w ago`
  return fmtDate(iso)
}

export function statusPill(key: string | undefined, label: string): string {
  const k = (key || '').toLowerCase()
  const cls = k === 'opened' ? 'ok' : k === 'empty' ? 'bad' : k === 'archived' ? 'neutral' : k === 'new' ? 'info' : 'neutral'
  return `<span class="v2-pill ${cls}">${esc(label)}</span>`
}

export const ICON = {
  rfid: '<svg class="v2-ico" viewBox="0 0 24 24" style="width: 14px; height: 14px; color: var(--accent);"><path d="M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0"></path><circle cx="12" cy="12" r="1"></circle></svg>',
  printer: '<svg class="v2-ico" viewBox="0 0 24 24" style="width: 11px; height: 11px;"><path d="M6 9V3h12v6"></path><rect x="3" y="9" width="18" height="8" rx="2"></rect></svg>',
  scan: '<svg viewBox="0 0 24 24"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"></path><path d="M8 12h8"></path></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
  warn: '<svg class="v2-ico" viewBox="0 0 24 24" style="color: var(--accent-3); width: 15px; height: 15px;"><path d="M12 9v4M12 17h.01"></path><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 3v6h-6"></path></svg>',
}

/* ── Display API → "where is this spool" map ─────────────────────── */

export interface SlotLocation { printerId: number; printerName: string; amsLabel: string; slotLabel: string; active: boolean }

/** spool_id → slot location, from GET /display?fields=slots. */
export async function loadSlotMap(): Promise<Map<number, SlotLocation>> {
  const map = new Map<number, SlotLocation>()
  const d = await getJson<any>('/api/v1/display?fields=slots')
  for (const p of d?.printers || []) {
    for (const u of p.ams || []) {
      for (const sl of u.slots || []) {
        if (sl.spool_id != null && !sl.empty) {
          map.set(sl.spool_id, { printerId: p.id, printerName: p.name, amsLabel: u.label, slotLabel: sl.label, active: !!sl.active })
        }
      }
    }
  }
  return map
}

export function whereHtml(loc: SlotLocation | undefined, locationName?: string | null): string {
  if (loc) {
    return `<a class="v2-pill info" href="/v2/printers/${loc.printerId}" style="text-decoration: none;">${ICON.printer}${esc(loc.printerName)} · ${esc(loc.amsLabel)} ${esc(loc.slotLabel)}${loc.active ? ' · feeding' : ''}</a>`
  }
  if (locationName) return `<span>${esc(locationName)}</span>`
  return '<span class="v2-dim">—</span>'
}

/* ── Small state helpers ────────────────────────────────────────── */

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: number | null = null
  return ((...args: any[]) => {
    if (t) clearTimeout(t)
    t = window.setTimeout(() => fn(...args), ms)
  }) as T
}

export function toast(message: string, kind: 'ok' | 'bad' = 'ok'): void {
  let host = document.getElementById('v2-toast-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'v2-toast-host'
    host.style.cssText = 'position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 1200;'
    document.body.appendChild(host)
  }
  const n = document.createElement('div')
  n.className = `v2-notice ${kind === 'ok' ? 'info' : 'bad'}`
  n.style.cssText = 'background: var(--bg-elevated); box-shadow: var(--shadow-md); max-width: 360px;'
  n.textContent = message
  host.appendChild(n)
  setTimeout(() => n.remove(), 3500)
}

/* ── Minimal prompt dialog (select or number input) ─────────────── */

export interface AskOptions {
  title: string
  hint?: string
  options?: { value: string; label: string }[]
  input?: { type: 'number' | 'text'; placeholder?: string; value?: string; step?: string }
  okLabel?: string
  danger?: boolean
}

/** Resolves with the chosen value, or null when cancelled. */
export function ask(opts: AskOptions): Promise<string | null> {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'v2-dialog-overlay open'
    overlay.innerHTML = `
      <div class="v2-dialog" style="max-width: 420px;">
        <div class="v2-dialog-h"><span>${esc(opts.title)}</span><button type="button" class="v2-btn ghost sm" data-x>Esc</button></div>
        <div class="v2-dialog-b">
          ${opts.hint ? `<div class="v2-muted" style="font-size: 12.5px;">${esc(opts.hint)}</div>` : ''}
          ${opts.options ? `<label class="v2-input" style="height: 36px;"><select data-field>${opts.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>` : ''}
          ${opts.input ? `<label class="v2-input" style="height: 36px;"><input data-field type="${opts.input.type}" placeholder="${esc(opts.input.placeholder || '')}" value="${esc(opts.input.value || '')}" ${opts.input.step ? `step="${esc(opts.input.step)}"` : ''} /></label>` : ''}
        </div>
        <div class="v2-dialog-f"><span style="margin-left: auto;"></span><button type="button" class="v2-btn ghost" data-x>Cancel</button><button type="button" class="v2-btn ${opts.danger ? 'danger' : 'primary'}" data-ok>${esc(opts.okLabel || 'OK')}</button></div>
      </div>`
    const field = overlay.querySelector<HTMLInputElement | HTMLSelectElement>('[data-field]')
    const done = (v: string | null) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && field && field.tagName === 'INPUT') done(field.value) }
    overlay.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => done(null)))
    overlay.querySelector('[data-ok]')!.addEventListener('click', () => done(field ? field.value : ''))
    overlay.addEventListener('click', e => { if (e.target === overlay) done(null) })
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)
    setTimeout(() => field?.focus(), 30)
  })
}
