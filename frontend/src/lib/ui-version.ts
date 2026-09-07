/**
 * UI version switch (classic "v1" vs console redesign "v2").
 *
 * The chosen version is an app-wide admin setting exposed on
 * GET /api/v1/app-settings/public-info. It is mirrored into
 * localStorage["fm_ui"] so the inline head script can apply the
 * `ui-v2` html class and redirect before the page paints.
 */
export type UiVersion = 'v1' | 'v2'

export const UI_STORAGE_KEY = 'fm_ui'

export function cachedUiVersion(): UiVersion {
  try {
    return localStorage.getItem(UI_STORAGE_KEY) === 'v2' ? 'v2' : 'v1'
  } catch {
    return 'v1'
  }
}

export function cacheUiVersion(v: UiVersion): void {
  try {
    localStorage.setItem(UI_STORAGE_KEY, v)
  } catch { /* storage unavailable */ }
}

export async function fetchUiVersion(signal?: AbortSignal): Promise<UiVersion | null> {
  try {
    const resp = await fetch('/api/v1/app-settings/public-info', { credentials: 'include', signal })
    if (!resp.ok) return null
    const data = await resp.json()
    return data?.ui_version === 'v2' ? 'v2' : 'v1'
  } catch {
    return null
  }
}

/** v1 path -> v2 equivalent, or null when the page has no redesign. */
export function v2PathFor(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/' || p === '/index.html') return '/v2/'
  if (p === '/spools') return '/v2/spools/'
  let m = p.match(/^\/spools\/(\d+)$/)
  if (m) return `/v2/spools/${m[1]}`
  m = p.match(/^\/printers\/(\d+)$/)
  if (m) return `/v2/printers/${m[1]}`
  return null
}

/** v2 path -> v1 equivalent, or null when not a v2 path. */
export function v1PathFor(pathname: string): string | null {
  if (!/^\/v2(\/|$)/.test(pathname)) return null
  const rest = pathname.replace(/^\/v2/, '')
  return rest === '' || rest === '/' ? '/' : rest
}

/** Where a link should go for the active version (used to rewrite nav hrefs). */
export function hrefForVersion(href: string, version: UiVersion): string {
  if (version === 'v2') return v2PathFor(href) ?? href
  return v1PathFor(href) ?? href
}

/**
 * Apply a version to the document: html class, cache, and redirect when the
 * current URL belongs to the other version. Returns true when a redirect
 * was issued.
 */
export function applyUiVersion(version: UiVersion): boolean {
  cacheUiVersion(version)
  document.documentElement.classList.toggle('ui-v2', version === 'v2')
  const target = version === 'v2' ? v2PathFor(location.pathname) : v1PathFor(location.pathname)
  if (target && target !== location.pathname && target !== location.pathname + '/') {
    location.replace(target + location.search)
    return true
  }
  return false
}
