/**
 * Spool workflows shared by the v2 console pages. These mirror the classic
 * spool detail page (src/pages/spools/[id]/index.astro) field for field and
 * call the same endpoints, so behaviour is identical — only the chrome differs.
 */
import { t } from './i18n'
import { getAbortSignal, isAbortError } from './abort'
import { assignableLocations } from './driver-managed-locations'
import { esc, csrf } from './v2'

type Spool = any

export interface SpoolActionContext {
  spool: Spool
  statuses: any[]
  locations: any[]
  onDone: () => void
}

function dialog(title: string, bodyHtml: string, footerHtml: string, maxWidth = 420): { overlay: HTMLElement; close: () => void } {
  const overlay = document.createElement('div')
  overlay.className = 'v2-dialog-overlay open'
  overlay.innerHTML = `
    <div class="v2-dialog" style="max-width: ${maxWidth}px;">
      <div class="v2-dialog-h"><span>${esc(title)}</span><button type="button" class="v2-btn ghost sm" data-close>Esc</button></div>
      <div class="v2-dialog-b">${bodyHtml}</div>
      <div class="v2-dialog-f">${footerHtml}</div>
    </div>`
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close))
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
  return { overlay, close }
}

const field = (label: string, control: string) => `<div><label class="fm-label">${esc(label)}</label>${control}</div>`
const input = (id: string, type: string, extra = '') => `<input type="${type}" id="${id}" class="fm-input" ${extra}>`

/* ── Record weight / Adjust / Change status / Move ─────────────────── */

export function openSpoolActionModal(type: 'measurement' | 'adjustment' | 'status' | 'move', ctx: SpoolActionContext): void {
  const { spool, statuses, locations, onDone } = ctx
  const titles = {
    measurement: t('spools.modalRecordWeight'),
    adjustment: t('spools.modalAdjust'),
    status: t('spools.modalChangeStatus'),
    move: t('spools.modalMove'),
  }
  let fields = ''
  if (type === 'measurement') {
    fields = field(t('spools.measuredWeight'), input('field-weight', 'number', 'step="0.1" required')) + field(t('common.note'), input('field-note', 'text'))
  } else if (type === 'adjustment') {
    fields = field(t('spools.adjustmentType'), `<select id="field-adjustment-type" required class="fm-select"><option value="relative">${esc(t('spools.adjustRelative'))}</option><option value="absolute">${esc(t('spools.adjustSetRemaining'))}</option></select>`)
      + `<div id="field-delta-container">${field(t('spools.deltaWeight'), input('field-delta', 'number', 'step="0.1"'))}</div>`
      + `<div id="field-measured-container" class="hidden">${field(t('spools.measuredWeightLabel'), input('field-measured', 'number', 'step="0.1"'))}</div>`
      + field(t('common.note'), input('field-note', 'text'))
  } else if (type === 'status') {
    fields = field(t('spools.newStatus'), `<select id="field-status" required class="fm-select">${statuses.map(s => {
      const label = t(`spools.status${s.key.charAt(0).toUpperCase() + s.key.slice(1)}`) || s.label
      return `<option value="${esc(s.key)}">${esc(label)}</option>`
    }).join('')}</select>`) + field(t('common.note'), input('field-note', 'text'))
  } else {
    fields = field(t('spools.newLocation'), `<select id="field-location" class="fm-select"><option value="">${esc(t('spools.noLocation'))}</option>${assignableLocations(locations).map((l: any) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>`)
      + field(t('common.note'), input('field-note', 'text'))
  }
  const { overlay, close } = dialog(titles[type],
    `<form id="spool-action-form" style="display: grid; gap: 12px;">${fields}<div id="modal-error" class="fm-alert-error hidden"></div></form>`,
    `<span style="margin-left: auto;"></span><button type="button" class="v2-btn ghost" data-close>${esc(t('common.cancel'))}</button><button type="submit" form="spool-action-form" class="v2-btn primary" id="modal-submit">${esc(t('common.submit'))}</button>`)

  const q = <T extends HTMLElement>(id: string) => overlay.querySelector<T>(`#${id}`)!
  q<HTMLSelectElement>('field-adjustment-type')?.addEventListener('change', e => {
    const val = (e.target as HTMLSelectElement).value
    q('field-delta-container').classList.toggle('hidden', val !== 'relative')
    q('field-measured-container').classList.toggle('hidden', val === 'relative')
  })
  setTimeout(() => (overlay.querySelector('input, select') as HTMLElement | null)?.focus(), 30)

  q<HTMLFormElement>('spool-action-form').addEventListener('submit', async e => {
    e.preventDefault()
    const error = q('modal-error')
    const submitBtn = q<HTMLButtonElement>('modal-submit')
    let url = ''
    const body: Record<string, unknown> = {}
    const note = () => q<HTMLInputElement>('field-note').value || null
    if (type === 'measurement') {
      url = `/api/v1/spools/${spool.id}/measurements`
      body.measured_weight_g = parseFloat(q<HTMLInputElement>('field-weight').value)
      body.note = note()
    } else if (type === 'adjustment') {
      url = `/api/v1/spools/${spool.id}/adjustments`
      const adjType = q<HTMLSelectElement>('field-adjustment-type').value
      body.adjustment_type = adjType
      body.note = note()
      if (adjType === 'relative') body.delta_weight_g = parseFloat(q<HTMLInputElement>('field-delta').value) || null
      else body.measured_weight_g = parseFloat(q<HTMLInputElement>('field-measured').value) || null
    } else if (type === 'status') {
      url = `/api/v1/spools/${spool.id}/status`
      body.status = q<HTMLSelectElement>('field-status').value
      body.note = note()
    } else {
      url = `/api/v1/spools/${spool.id}/move`
      const locId = q<HTMLSelectElement>('field-location').value
      body.location_id = locId ? parseInt(locId) : null
      body.note = note()
    }
    error.classList.add('hidden')
    submitBtn.disabled = true
    submitBtn.textContent = t('common.submitting')
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        credentials: 'include',
        signal: getAbortSignal(),
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message || data.detail?.message || t('spools.failedSubmit'))
      }
      close()
      onDone()
    } catch (err) {
      if (isAbortError(err)) return
      error.textContent = (err instanceof Error ? err.message : null) || t('spools.failedSubmit')
      error.classList.remove('hidden')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = t('common.submit')
    }
  })
}

/* ── Write RFID tag ────────────────────────────────────────────────── */

export async function loadActiveDevices(): Promise<any[]> {
  try {
    const r = await fetch('/api/v1/devices/active', { credentials: 'include', signal: getAbortSignal() })
    return r.ok ? await r.json() : []
  } catch { return [] }
}

export function openWriteTagModal(ctx: SpoolActionContext, activeDevices: any[]): void {
  const { spool, onDone } = ctx
  if (activeDevices.length === 0) { (window as any).__fmAlert?.(t('rfid.noDeviceOnline')); return }

  let warning = ''
  if (spool.rfid_uid && spool.rfid_uid_2) warning = t('rfid.bothTagsExistWarning')
  else if (spool.rfid_uid) warning = t('rfid.secondTagWillBeAdded')
  const slotChoice = spool.rfid_uid && spool.rfid_uid_2 ? `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 0.9rem; font-weight: 600;">${esc(t('rfid.replaceWhichTag'))}</div>
      <label style="display: flex; gap: 8px; align-items: center; cursor: pointer;"><input type="radio" name="rfid-replace-slot" value="1"> <span>${esc(t('rfid.replaceTagN', { n: 1, uid: spool.rfid_uid }))}</span></label>
      <label style="display: flex; gap: 8px; align-items: center; cursor: pointer;"><input type="radio" name="rfid-replace-slot" value="2" checked> <span>${esc(t('rfid.replaceTagN', { n: 2, uid: spool.rfid_uid_2 }))}</span></label>
    </div>` : ''
  const single = activeDevices.length === 1
  const text = single ? t('rfid.confirmWrite', { device: activeDevices[0].name }) : t('rfid.selectDeviceToWrite')
  const deviceSel = single ? '' : field(t('rfid.selectDevice'), `<select id="rfid-device-select" class="fm-select">${activeDevices.map(d => `<option value="${d.id}">${esc(d.name)} (${esc(d.ip_address)})</option>`).join('')}</select>`)

  const { overlay, close } = dialog(t('rfid.writeTag'),
    `<p style="margin: 0;">${esc(text)}</p>${deviceSel}${warning ? `<div class="fm-alert fm-alert-warning">${esc(warning)}</div>` : ''}${slotChoice}<div id="rfid-status" class="fm-alert hidden"></div>`,
    `<span style="margin-left: auto;"></span><button type="button" class="v2-btn ghost" id="rfid-cancel">${esc(t('common.cancel'))}</button><button type="button" class="v2-btn primary" id="rfid-confirm">${esc(t('common.confirm'))}</button>`, 460)

  const confirmBtn = overlay.querySelector<HTMLButtonElement>('#rfid-confirm')!
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('#rfid-cancel')!
  const status = overlay.querySelector<HTMLElement>('#rfid-status')!
  let isPolling = false
  cancelBtn.addEventListener('click', () => { isPolling = false; close() })

  confirmBtn.addEventListener('click', async () => {
    const deviceId = single ? activeDevices[0].id : overlay.querySelector<HTMLSelectElement>('#rfid-device-select')!.value
    confirmBtn.disabled = true
    const maxWaitSeconds = 120
    status.className = 'fm-alert fm-alert-info rfid-write-progress'
    status.innerHTML = `
      <div class="message-row"><span class="spinner"></span><span>${esc(t('rfid.writeStarted'))}</span></div>
      <div class="countdown-bar"><div class="countdown-fill green" id="countdown-fill" style="width: 100%"></div></div>
      <span class="countdown-text" id="countdown-text">${maxWaitSeconds}s</span>`
    isPolling = true
    try {
      const response = await fetch(`/api/v1/devices/${deviceId}/write-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        credentials: 'include',
        signal: getAbortSignal(),
        body: JSON.stringify({
          spool_id: spool.id,
          replace_slot: Number((overlay.querySelector('input[name="rfid-replace-slot"]:checked') as HTMLInputElement | null)?.value) || null,
        }),
      })
      const result = await response.json()
      if (!(response.ok && result.success)) {
        status.className = 'fm-alert fm-alert-error'
        status.innerHTML = `<strong>${esc(t('rfid.writeError'))}</strong><br>${esc(result.message || result.detail?.message || '')}`
        confirmBtn.disabled = false
        return
      }
      const maxAttempts = 60
      let attempts = 0
      const poll = async () => {
        if (!isPolling) return
        attempts++
        const remainingSeconds = 120 - attempts * 2
        const percentage = Math.max(0, (remainingSeconds / 120) * 100)
        const fill = overlay.querySelector<HTMLElement>('#countdown-fill')
        const txt = overlay.querySelector<HTMLElement>('#countdown-text')
        if (fill && txt) {
          fill.style.width = percentage + '%'
          txt.textContent = Math.max(0, remainingSeconds) + 's'
          fill.className = 'countdown-fill ' + (percentage > 66 ? 'green' : percentage > 33 ? 'yellow' : 'orange')
        }
        try {
          const statusRes = await fetch(`/api/v1/devices/${deviceId}/write-status`, { credentials: 'include', signal: getAbortSignal() })
          const statusData = await statusRes.json()
          if (statusData.status === 'success') {
            isPolling = false
            status.className = 'fm-alert fm-alert-success'
            status.innerHTML = `<strong>${esc(t('rfid.writeSuccess'))}</strong>${statusData.removed_from ? `<br><small>${esc(t('rfid.removedFrom', { item: statusData.removed_from }))}</small>` : ''}`
            cancelBtn.textContent = t('common.close')
            setTimeout(() => { close(); onDone() }, 2000)
            return
          }
          if (statusData.status === 'error') {
            isPolling = false
            status.className = 'fm-alert fm-alert-error'
            status.innerHTML = `<strong>${esc(t('rfid.writeError'))}</strong><br>${esc(statusData.error_message || '')}`
            confirmBtn.disabled = false
            return
          }
        } catch (e) {
          if (isAbortError(e)) return
        }
        if (isPolling && attempts < maxAttempts) setTimeout(poll, 2000)
        else if (isPolling) {
          isPolling = false
          status.className = 'fm-alert fm-alert-warning'
          status.innerHTML = `<strong>${esc(t('rfid.writeTimeout'))}</strong>`
          confirmBtn.disabled = false
        }
      }
      setTimeout(poll, 2000)
    } catch (error) {
      if (isAbortError(error)) return
      status.className = 'fm-alert fm-alert-error'
      status.innerHTML = `<strong>${esc(t('rfid.writeError'))}</strong><br>${esc(String(error))}`
      confirmBtn.disabled = false
    }
  })
}

/** Remove one RFID tag (slot 1 or 2). The backend shifts tag 2 into slot 1 when slot 1 is cleared. */
export async function removeRfidTag(spool: Spool, slot: number, uid: string, onDone: () => void): Promise<void> {
  const msg = t('rfid.confirmRemoveTag', { uid })
  const ok = (window as any).__fmConfirm ? await (window as any).__fmConfirm(msg) : confirm(msg)
  if (!ok) return
  const res = await fetch(`/api/v1/spools/${spool.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
    credentials: 'include',
    body: JSON.stringify(slot === 1 ? { rfid_uid: null } : { rfid_uid_2: null }),
  })
  if (!res.ok) { (window as any).__fmAlert?.(t('rfid.removeTagError')); return }
  onDone()
}

/* ── Duplicate / Delete ────────────────────────────────────────────── */

export function duplicateSpool(spool: Spool): void {
  // Copy physical/product fields only (same exclusions as the classic page).
  const dupData = { ...spool }
  for (const key of ['id', 'rfid_uid', 'external_id', 'location_id', 'location', 'status_id', 'status', 'remaining_weight_g', 'last_used_at', 'stocked_in_at', 'created_at', 'updated_at', 'printer_params', 'events']) {
    delete dupData[key]
  }
  sessionStorage.setItem('filaman_duplicate_spool', JSON.stringify(dupData))
  window.location.href = '/spools/new'
}

export function openDeleteModal(spool: Spool, afterDeleteHref = '/spools'): void {
  const { overlay, close } = dialog(t('spools.archiveSpool'),
    `<p style="margin: 0; color: var(--text-muted);">${esc(t('spools.confirmDelete'))}</p>
     <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;"><input type="checkbox" id="delete-permanent-checkbox" style="width: 18px; height: 18px; margin-top: 2px; accent-color: var(--accent);"><span>${esc(t('spools.permanentDeleteLabel'))}</span></label>
     <p id="delete-permanent-warning" class="hidden" style="margin: 0; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; font-size: 0.85rem; color: var(--error-text);">${esc(t('spools.permanentDeleteWarning'))}</p>`,
    `<span style="margin-left: auto;"></span><button type="button" class="v2-btn ghost" data-close>${esc(t('common.cancel'))}</button><button type="button" class="v2-btn danger" id="btn-delete-confirm">${esc(t('spools.archiveSpool'))}</button>`)
  const cb = overlay.querySelector<HTMLInputElement>('#delete-permanent-checkbox')!
  const warn = overlay.querySelector<HTMLElement>('#delete-permanent-warning')!
  const btn = overlay.querySelector<HTMLButtonElement>('#btn-delete-confirm')!
  const title = overlay.querySelector<HTMLElement>('.v2-dialog-h span')!
  cb.addEventListener('change', () => {
    warn.classList.toggle('hidden', !cb.checked)
    btn.textContent = cb.checked ? t('spools.deleteSpool') : t('spools.archiveSpool')
    title.textContent = btn.textContent
  })
  btn.addEventListener('click', async () => {
    const url = cb.checked ? `/api/v1/spools/${spool.id}/permanent` : `/api/v1/spools/${spool.id}`
    try {
      const response = await fetch(url, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf() }, credentials: 'include', signal: getAbortSignal() })
      if (response.ok) { close(); window.location.href = afterDeleteHref }
      else await (window as any).__fmAlert?.(t('spools.failedDelete'))
    } catch {
      await (window as any).__fmAlert?.(t('spools.failedDelete'))
    }
  })
}
