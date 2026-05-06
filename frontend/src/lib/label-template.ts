/**
 * Label template parser for the Advanced Label Designer.
 *
 * Template syntax:
 *   {token}                — simple dot-path substitution; resolves to "?" if missing
 *   {prefix{token}suffix}  — optional block: rendered as prefix+value+suffix if token is not "?"
 *                            omitted entirely when token resolves to "?"
 *   **bold**               — <strong> text
 *   *italic*               — <em> text (single asterisk, not part of **)
 *   ==inverse==            — inverted text (black bg, white text)
 *   [size=120]text[/size]  — inline relative size in percent (50..300)
 *   [size=120%]text[/size] — same as above; percent sign is optional
 *   \n                     — line-break (<br>)
 *
 * SpoolData is a flat object passed from the print page; the "extra" key holds
 * extra-field values keyed by field key.
 */

export interface SpoolData {
  id: string | number
  'filament.name': string
  'filament.material': string
  'filament.color': string
  'filament.color_hex': string
  'filament.manufacturer': string
  'filament.extruder_temp': string | number
  'filament.bed_temp': string | number
  'filament.weight': string | number
  extra?: Record<string, string>
  [key: string]: unknown
}

/** Resolve a dot-path token against the spool data object. */
function resolveToken(token: string, data: SpoolData): string {
  if (token.startsWith('extra.')) {
    const key = token.slice(6)
    const val = data.extra?.[key]
    return val !== undefined && val !== '' ? String(val) : '?'
  }
  const val = (data as Record<string, unknown>)[token]
  if (val === undefined || val === null || val === '') return '?'
  return String(val)
}

/** Expand {token} and {prefix{token}suffix} placeholders to plain text. */
export function renderTemplateText(template: string, data: SpoolData): string {
  // Match both optional-block {{inner}} style and simple {token}
  // Process longest matches first (optional blocks) before simple tokens.
  return template.replace(
    /{(?:[^{}]|{[^{}]*})*}/g,
    (match) => {
      // Optional block: {prefix{token}suffix}
      const optional = match.match(/^\{(.*?)\{([^{}]+)\}(.*?)\}$/)
      if (optional) {
        const [, prefix, token, suffix] = optional
        const resolved = resolveToken(token, data)
        return resolved === '?' ? '' : prefix + resolved + suffix
      }
      // Simple token: {token}
      const token = match.slice(1, -1)
      const resolved = resolveToken(token, data)
      return resolved === '?' ? '' : resolved
    }
  )
}

/** Apply **bold**, *italic*, ==inverse== and [size=..] inline markup. */
function applyMarkup(text: string, frag: DocumentFragment | HTMLElement): void {
  // Regex: match [size=NNN]...[/size] or [size=NNN%]...[/size], bold (**…**), italic (*…*), inverse (==…==)
  const regex = /(\[size=\d{1,3}%?\][\s\S]*?\[\/size\]|\*\*[\s\S]*?\*\*|\*(?!\*)([\s\S]*?)\*(?!\*)|==[\s\S]*?==)/g
  let last = 0

  const appendPlainText = (raw: string, container: DocumentFragment | HTMLElement) => {
    // Split on newlines and insert <br>
    const lines = raw.split('\n')
    lines.forEach((line, i) => {
      if (line) container.appendChild(document.createTextNode(line))
      if (i < lines.length - 1) container.appendChild(document.createElement('br'))
    })
  }

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    // Text before this match
    if (match.index > last) {
      appendPlainText(text.slice(last, match.index), frag)
    }

    const part = match[0]

    if (part.startsWith('[size=') && part.endsWith('[/size]')) {
      const sized = part.match(/^\[size=(\d{1,3})%?\]([\s\S]*?)\[\/size\]$/)
      if (sized) {
        const [, rawPct, inner] = sized
        const pct = Math.max(50, Math.min(300, Number(rawPct)))
        const el = document.createElement('span')
        el.style.fontSize = `${pct}%`
        applyMarkup(inner, el)
        frag.appendChild(el)
      } else {
        appendPlainText(part, frag)
      }
    } else if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2)
      const el = document.createElement('strong')
      applyMarkup(inner, el)
      frag.appendChild(el)
    } else if (part.startsWith('==') && part.endsWith('==')) {
      const inner = part.slice(2, -2)
      const el = document.createElement('span')
      el.style.backgroundColor = '#000'
      el.style.color = '#fff'
      el.style.padding = '0 0.6mm'
      el.style.display = 'inline-block'
      applyMarkup(inner, el)
      frag.appendChild(el)
    } else if (part.startsWith('*') && part.endsWith('*')) {
      const inner = part.slice(1, -1)
      const el = document.createElement('em')
      applyMarkup(inner, el)
      frag.appendChild(el)
    }

    last = match.index + part.length
  }

  // Remaining text after last match
  if (last < text.length) {
    appendPlainText(text.slice(last), frag)
  }
}

/**
 * Parse a template string with spool data and return a DocumentFragment
 * ready to append into the DOM.
 */
export function parseTemplate(template: string, data: SpoolData): DocumentFragment {
  const plainText = renderTemplateText(template, data)
  const frag = document.createDocumentFragment()
  applyMarkup(plainText, frag)
  return frag
}
