export interface LabelPrintPageStyleOptions {
  widthMm: number
  heightMm: number
  styleId?: string
}

export function updateLabelPrintPageStyle({ widthMm, heightMm, styleId = 'page-style' }: LabelPrintPageStyleOptions) {
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) return

  const resolvedStyleId = styleId || 'page-style'
  let styleEl = document.getElementById(resolvedStyleId)
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = resolvedStyleId
    document.head.appendChild(styleEl)
  }

  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
  // A two-length custom page size already encodes orientation. Adding an
  // orientation keyword makes Chromium ignore the rule and fall back to Letter.
  const pageRule = isSafari ? '' : `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`

  styleEl.innerHTML = `
    ${pageRule}
    @media print {
      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
      }

      .label-wrapper {
        width: ${widthMm}mm !important;
        height: ${heightMm}mm !important;
        min-width: ${widthMm}mm !important;
        min-height: ${heightMm}mm !important;
        max-width: ${widthMm}mm !important;
        max-height: ${heightMm}mm !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      .label-preview {
        width: ${widthMm}mm !important;
        height: ${heightMm}mm !important;
        min-width: ${widthMm}mm !important;
        min-height: ${heightMm}mm !important;
        max-width: ${widthMm}mm !important;
        max-height: ${heightMm}mm !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        zoom: 1 !important;
        transform: none !important;
        transform-origin: unset !important;
      }
    }
  `
}
