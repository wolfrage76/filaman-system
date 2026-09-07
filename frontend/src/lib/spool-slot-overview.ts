/**
 * AMS / tray overview for a spool (v2 console). Port of the inline slot
 * overview on the classic spool page: same data sources (driver health +
 * DB slot assignments), same context-menu actions (assign spool to tray,
 * import tray settings to spool / spool + filament), same confirmation
 * polling. Only the rendering differs.
 */
import { t } from './i18n'
import { getAbortSignal, isAbortError } from './abort'
import { esc, csrf } from './v2'

export interface SlotOverviewOptions {
  container: HTMLElement
  getSpool: () => any
  /** Called after an import-to-params action so the page can refresh its params view. */
  onParamsChanged?: (printerId: number) => void
}

type Pending = { slotIndex: string; printerId: number; expectedColor: string }

export function initSlotOverview(opts: SlotOverviewOptions): { reload: () => Promise<void>; destroy: () => void } {
  const { container, getSpool } = opts
  let pending: Pending | null = null
  let pendingTimeout: number | null = null
  let pollTimer: number | null = null
  let reloadQueued: number | null = null
  let menu: HTMLElement | null = null

  const fetchJson = async (url: string, init?: RequestInit) => {
    const r = await fetch(url, { credentials: 'include', signal: getAbortSignal(), ...init })
    return r.ok ? r.json() : null
  }

  async function reload() {
    try {
      const data = await fetchJson('/api/v1/printers')
      const printers: any[] = data?.items || data || []
      if (!printers.length) { container.innerHTML = ''; return }
      const healthResults = await Promise.allSettled(printers.map(async p => {
        const h = await fetchJson(`/api/v1/printers/${p.id}/driver/health`)
        return h ? { printer: p, health: h } : null
      }))
      const online = healthResults
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value != null && r.value.health?.connected)
        .map(r => r.value)
      await Promise.allSettled(online.map(({ printer }) => fetchJson(`/api/v1/printers/${printer.id}/driver/health?refresh=1`).catch(() => null)))
      const dbSlotsByPrinter: Record<string, any[]> = {}
      await Promise.allSettled(online.map(async ({ printer }) => {
        const s = await fetchJson(`/api/v1/printers/${printer.id}/slots`).catch(() => null)
        if (s) dbSlotsByPrinter[printer.id] = s
      }))
      if (!online.length) { container.innerHTML = ''; return }

      let html = ''
      for (const { printer, health } of online) {
        const slots: any[] = health.slots || []
        if (!slots.length) continue
        const dbAssign: Record<string, any> = {}
        for (const s of dbSlotsByPrinter[printer.id] || []) {
          const idx = s?.custom_fields?.slot_index || `${Math.floor(s.slot_no / 4)}-${s.slot_no % 4}`
          if (s.assignment) dbAssign[idx] = s.assignment
        }
        for (const slot of slots) {
          const a = dbAssign[slot.slot_index] || null
          slot._assignment = a
          if (a) {
            if (!slot.tray_color) slot.tray_color = a.tray_color || a.color_hex || ''
            if (!slot.tray_type && a.tray_type) slot.tray_type = a.tray_type
            if (slot.present === false && a.present) slot.present = true
          }
        }
        const tools: any[] = [], external: any[] = [], ams: Record<number, any[]> = {}
        for (const slot of slots) {
          const kind = String(slot.slot_kind || '').toLowerCase()
          if (kind === 'toolhead' || kind === 'tool') { tools.push(slot); continue }
          const amsId = parseInt(String(slot.slot_index || '').split('-')[0])
          if (amsId === 255) external.push(slot)
          else (ams[amsId] ||= []).push(slot)
        }
        const group = (label: string, list: any[]) => `<div class="v2-row" style="gap: 5px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 8px;"><span class="v2-dim" style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;">${esc(label)}</span>${list.map(s => dot(s, printer.id)).join('')}</div>`
        const amsIds = Object.keys(ams).map(Number).sort((a, b) => a - b)
        html += `<div class="v2-row" style="gap: 10px; flex-wrap: wrap;">
          <div style="min-width: 70px;"><div style="font-weight: 600; font-size: 12.5px;">${esc(printer.name)}</div><div class="v2-dim" style="font-size: 10.5px;">${slots.length} ${esc(t('spools.slotGroupTrays') || 'slots')}</div></div>
          ${tools.length ? group(t('spools.slotGroupTools'), tools) : ''}
          ${external.length ? group(t('spools.slotGroupExternal'), external) : ''}
          ${amsIds.map(id => group(amsIds.length > 1 ? `${t('spools.slotGroupTrays')} ${id + 1}` : t('spools.slotGroupTrays'), ams[id])).join('')}
        </div>`
      }
      container.innerHTML = html
      container.querySelectorAll<HTMLElement>('.slot-dot[data-slot]').forEach(d => d.addEventListener('click', e => {
        e.stopPropagation()
        showMenu(d, JSON.parse(d.dataset.slot!), parseInt(d.dataset.printerId!))
      }))
    } catch (e) {
      if (isAbortError(e)) return
      console.error('Failed to load printer slot overview:', e)
    }
  }

  function tooltip(slot: any): string {
    const a = slot._assignment
    if (a) {
      const parts = [a.manufacturer_name, a.filament_name, a.spool_id ? `(#${a.spool_id})` : ''].filter(Boolean)
      if (parts.length) return parts.join(' - ')
    }
    return slot.tray_type || 'Empty'
  }

  function dot(slot: any, printerId: number): string {
    const a = slot._assignment || null
    let hex = slot.tray_color || a?.tray_color || a?.color_hex || ''
    if (hex && !hex.startsWith('#')) hex = '#' + hex
    if (hex.length === 9) hex = hex.slice(0, 7)
    const present = slot.present !== false || a?.present === true || Boolean(a?.spool_id)
    const mine = a?.spool_id && Number(a.spool_id) === Number(getSpool()?.id)
    const attrs = `class="slot-dot" data-slot="${JSON.stringify(slot).replace(/"/g, '&quot;')}" data-printer-id="${printerId}" title="${esc(tooltip(slot))}"`
    if (hex.length >= 7 && present) {
      return `<span ${attrs} style="display: inline-block; width: 16px; height: 16px; border-radius: 50%; background: ${esc(hex)}; border: 1px solid var(--border); cursor: pointer; ${mine ? 'outline: 2px solid var(--accent); outline-offset: 1px;' : ''}"></span>`
    }
    return `<span ${attrs} style="display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: #d1d5db; border: 1px solid var(--border); cursor: pointer; font-size: 11px; line-height: 1; color: #dc2626; font-weight: 900;">✕</span>`
  }

  function closeMenu() { menu?.remove(); menu = null }
  const onDocClick = () => closeMenu()
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)

  function showMenu(dotEl: HTMLElement, slot: any, printerId: number) {
    closeMenu()
    const m = document.createElement('div')
    m.className = 'v2-card'
    m.style.cssText = 'position: fixed; z-index: 9999; padding: 4px 0; min-width: 240px; font-size: 12.5px; box-shadow: var(--shadow-lg);'
    const rect = dotEl.getBoundingClientRect()
    m.style.top = (rect.bottom + 4) + 'px'
    m.style.left = rect.left + 'px'
    let label = String(slot.slot_name || slot.slot_index || '')
    label = label.replace(/AMS (\d+)/, (_: string, n: string) => `AMS ${parseInt(n) + 1}`)
    const item = (action: string, color: string, text: string) => `<button class="ctx-item" data-action="${action}" style="display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 12px; border: none; background: none; color: ${color}; cursor: pointer; font-size: 12.5px; font-family: var(--font-sans);">${esc(text)}</button>`
    m.innerHTML = `<div class="v2-dim" style="padding: 6px 12px; font-weight: 600; font-size: 11px; border-bottom: 1px solid var(--border);">${esc(label)}</div>`
      + item('assign', 'var(--success-text)', t('spools.slotAssignSpool'))
      + item('import-spool', 'var(--info-text)', t('spools.slotImportToSpool'))
      + item('import-both', 'var(--info-text)', t('spools.slotImportToSpoolAndFilament'))
    m.querySelectorAll<HTMLElement>('.ctx-item').forEach(b => {
      b.addEventListener('mouseenter', () => (b.style.background = 'var(--bg-soft)'))
      b.addEventListener('mouseleave', () => (b.style.background = 'none'))
    })
    m.querySelector('[data-action="assign"]')!.addEventListener('click', e => { e.stopPropagation(); closeMenu(); assign(slot, printerId) })
    m.querySelector('[data-action="import-spool"]')!.addEventListener('click', async e => {
      e.stopPropagation(); closeMenu()
      const ok = await saveTrayParams(slot, printerId, 'spool')
      if (ok) { (window as any).__fmSuccess?.(t('spools.slotImportSpoolSuccess')); opts.onParamsChanged?.(printerId) } else (window as any).__fmAlert?.(t('spools.slotImportError'))
    })
    m.querySelector('[data-action="import-both"]')!.addEventListener('click', async e => {
      e.stopPropagation(); closeMenu()
      const [a, b] = await Promise.all([saveTrayParams(slot, printerId, 'spool'), saveTrayParams(slot, printerId, 'filament')])
      if (a && b) { (window as any).__fmSuccess?.(t('spools.slotImportBothSuccess')); opts.onParamsChanged?.(printerId) } else (window as any).__fmAlert?.(t('spools.slotImportError'))
    })
    document.body.appendChild(m)
    const mr = m.getBoundingClientRect()
    if (mr.right > window.innerWidth) m.style.left = (window.innerWidth - mr.width - 8) + 'px'
    if (mr.bottom > window.innerHeight) m.style.top = (rect.top - mr.height - 4) + 'px'
    menu = m
  }

  function getDot(slotIndex: string, printerId: number): HTMLElement | null {
    return container.querySelector(`.slot-dot[data-printer-id="${printerId}"][data-slot*='"slot_index":"${slotIndex}"']`)
  }
  function ring(el: HTMLElement | null, state: '' | 'slot-sending' | 'slot-success' | 'slot-error') {
    if (!el) return
    el.classList.remove('slot-sending', 'slot-success', 'slot-error')
    if (state) el.classList.add(state)
  }
  function clearPending() {
    if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    pending = null
  }
  function resolve(status: 'success' | 'error') {
    if (!pending) return
    const { slotIndex, printerId } = pending
    clearPending()
    const d = getDot(slotIndex, printerId)
    if (!d) { reload(); return }
    if (status === 'success') { ring(d, 'slot-success'); setTimeout(() => { ring(d, ''); reload() }, 2000) }
    else ring(d, 'slot-error')
  }
  function startPolling() {
    if (!pending) return
    const { printerId, slotIndex, expectedColor } = pending
    let attempts = 0
    const poll = async () => {
      if (!pending || pending.slotIndex !== slotIndex || pending.printerId !== printerId) return
      attempts++
      try {
        const health = await fetchJson(`/api/v1/printers/${printerId}/driver/health`)
        const slot = (health?.slots || []).find((s: any) => s.slot_index === slotIndex)
        if (slot && (slot.tray_color || '').replace('#', '').slice(0, 6).toLowerCase() === expectedColor.toLowerCase()) { resolve('success'); return }
      } catch (e) { if (isAbortError(e)) return }
      if (attempts < 5 && pending) pollTimer = window.setTimeout(poll, 3000)
    }
    pollTimer = window.setTimeout(poll, 3000)
  }

  async function modelCoverage(printerId: number): Promise<{ model: string; status: string } | null> {
    const spool = getSpool()
    try {
      const [cm, cov] = await Promise.all([fetchJson(`/api/v1/printers/${printerId}/driver/connected-models`), fetchJson(`/api/v1/printers/${printerId}/driver/profile-coverage?spool_id=${spool.id}`)])
      if (!cm || !cov || cov.per_model_profiles_enabled === false) return null
      let model: string | null = null
      for (const m of cm.models || []) {
        if ((m.printer_ids || m.printerIds || []).map(Number).includes(Number(printerId))) { model = m.model; break }
      }
      if (!model) return null
      return { model, status: (cov.coverage || {})[model]?.status || 'not_set' }
    } catch (e) { if (isAbortError(e)) throw e; return null }
  }

  async function assign(slot: any, printerId: number) {
    const spool = getSpool()
    if (!spool) return
    const [amsId, trayId] = String(slot.slot_index || '').split('-').map(Number)
    const slotIndex = `${amsId}-${trayId}`
    try {
      const mc = await modelCoverage(printerId)
      if (mc && (mc.status === 'missing' || mc.status === 'not_set')) {
        const proceed = await ((window as any).__fmConfirm
          ? (window as any).__fmConfirm(`No Bambu slicer profile resolves for ${mc.model} on this printer (${mc.status}). The slot will be assigned with generic settings and may not match in Bambu Studio.`, { title: t('spools.slotAssignSpool'), okLabel: 'Assign anyway', isDanger: false })
          : Promise.resolve(window.confirm('No matching slicer profile. Assign anyway?')))
        if (!proceed) return
      }
    } catch (e) { if (isAbortError(e)) return }
    clearPending()
    const d = getDot(slotIndex, printerId)
    ring(d, 'slot-sending')
    let filamentData: Record<string, unknown>
    try {
      const [sp, fp] = await Promise.all([fetchJson(`/api/v1/spools/${spool.id}/printer-params?printer_id=${printerId}`), fetchJson(`/api/v1/filaments/${spool.filament_id}/printer-params?printer_id=${printerId}`)])
      const valMap: Record<string, string> = {}
      ;(fp || []).forEach((p: any) => { if (p.param_value) valMap[p.param_key] = p.param_value })
      ;(sp || []).forEach((p: any) => { if (p.param_value) valMap[p.param_key] = p.param_value })
      filamentData = {
        tray_info_idx: valMap['bambu_idx'] || valMap['bambu_tray_idx'] || 'GFL99',
        bambu_idx: valMap['bambu_idx'] || valMap['bambu_tray_idx'] || '',
        nozzle_temp_min: parseInt(valMap['bambu_nozzle_temp_min']) || 190,
        nozzle_temp_max: parseInt(valMap['bambu_nozzle_temp_max']) || 230,
        material_type: spool.filament?.material_type || 'PLA',
        color: (spool.filament?.colors?.[0]?.color?.hex_code || 'FFFFFF').replace('#', '').slice(0, 6),
      }
    } catch (e) {
      if (isAbortError(e)) return
      filamentData = { tray_info_idx: 'GFL99', bambu_idx: '', nozzle_temp_min: 190, nozzle_temp_max: 230, material_type: spool.filament?.material_type || 'PLA', color: (spool.filament?.colors?.[0]?.color?.hex_code || 'FFFFFF').replace('#', '').slice(0, 6) }
    }
    try {
      const res = await fetch(`/api/v1/printers/${printerId}/driver/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        credentials: 'include',
        signal: getAbortSignal(),
        body: JSON.stringify({ action: 'send_filament_to_tray', params: { ams_id: amsId, tray_id: trayId, filament_data: filamentData, spool_id: spool.id } }),
      })
      if (res.ok) {
        pending = { slotIndex, printerId, expectedColor: String(filamentData.color || 'FFFFFF').slice(0, 6) }
        pendingTimeout = window.setTimeout(() => resolve('error'), 15000)
        startPolling()
      } else {
        const err = await res.json().catch(() => null)
        ring(d, 'slot-error'); clearPending()
        ;(window as any).__fmAlert?.(err?.detail?.message || t('spools.slotAssignError'))
      }
    } catch (e) {
      if (isAbortError(e)) return
      ring(d, 'slot-error'); clearPending()
      ;(window as any).__fmAlert?.(t('spools.slotAssignError'))
    }
  }

  async function saveTrayParams(slot: any, printerId: number, entityType: 'spool' | 'filament'): Promise<boolean> {
    const spool = getSpool()
    const params: { param_key: string; param_value: string }[] = []
    if (slot.tray_info_idx) params.push({ param_key: 'bambu_tray_idx', param_value: String(slot.tray_info_idx) })
    if (slot.nozzle_temp_min != null) params.push({ param_key: 'bambu_nozzle_temp_min', param_value: String(slot.nozzle_temp_min) })
    if (slot.nozzle_temp_max != null) params.push({ param_key: 'bambu_nozzle_temp_max', param_value: String(slot.nozzle_temp_max) })
    if (!params.length) { (window as any).__fmAlert?.(t('spools.slotNoData')); return false }
    const entityId = entityType === 'spool' ? spool.id : spool.filament_id
    try {
      const res = await fetch(`/api/v1/${entityType === 'spool' ? 'spools' : 'filaments'}/${entityId}/printer-params/${printerId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, credentials: 'include', signal: getAbortSignal(), body: JSON.stringify({ params }),
      })
      return res.ok
    } catch (e) { if (isAbortError(e)) throw e; return false }
  }

  function queueReload() {
    if (reloadQueued != null) return
    reloadQueued = window.setTimeout(() => { reloadQueued = null; reload() }, 200)
  }
  const onSse = (e: Event) => {
    const data = (e as CustomEvent).detail
    if (data?.event === 'slots_update') {
      if (pending && data.printer_id === pending.printerId) resolve('success')
      else if (!pending) queueReload()
    } else if (data?.event === 'printer_update' && !pending) queueReload()
  }
  window.addEventListener('filaman:data-changed', onSse)
  const interval = window.setInterval(() => { if (!pending) queueReload() }, 15000)

  function destroy() {
    window.removeEventListener('filaman:data-changed', onSse)
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
    clearInterval(interval)
    clearPending()
    closeMenu()
  }
  return { reload, destroy }
}
