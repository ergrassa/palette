import './style.css'

type PaletteItem = {
  id: string
  name: string
  index: number
  hex: string
}

type PaletteFileV1 = {
  kind: 'palette.v1'
  items: Array<{ name: string; index: number; hex: string }>
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

function slugify(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function normalizeHex(hex: string) {
  const h = hex.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toUpperCase()
  return '#000000'
}

function hexToRgb(hex: string) {
  const h = normalizeHex(hex).slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return { r, g, b }
}

function srgbToLin(c: number) {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function getContrastText(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  const rl = srgbToLin(r)
  const gl = srgbToLin(g)
  const bl = srgbToLin(b)
  const lum = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
  return lum > 0.5 ? '#111111' : '#FFFFFF'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function toGpl(items: PaletteItem[]) {
  const lines: string[] = []
  lines.push('GIMP Palette')
  lines.push('Name: Palette')
  lines.push('#')
  for (const it of items.slice().sort((a, b) => a.index - b.index)) {
    const { r, g, b } = hexToRgb(it.hex)
    const name = it.name.replace(/\s+/g, ' ').trim()
    lines.push(`${r.toString().padStart(3, ' ')} ${g.toString().padStart(3, ' ')} ${b.toString().padStart(3, ' ')}\t${name}`)
  }
  return lines.join('\n') + '\n'
}

function parseGpl(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: Array<{ name: string; index: number; hex: string }> = []
  let idx = 0

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('GIMP Palette')) continue
    if (line.startsWith('Name:')) continue
    if (line.startsWith('Columns:')) continue

    const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/)
    if (!m) continue
    const r = clamp(parseInt(m[1], 10) || 0, 0, 255)
    const g = clamp(parseInt(m[2], 10) || 0, 0, 255)
    const b = clamp(parseInt(m[3], 10) || 0, 0, 255)
    const name = (m[4] || `Color ${idx}`).trim() || `Color ${idx}`
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
    out.push({ name, index: idx, hex })
    idx += 1
  }
  return out
}


function renderPng(
  items: PaletteItem[],
  rowLen: number,
  swW: number,
  swH: number,
  gapH: number,
  gapV: number,
  fontFace: string,
  fontSizePx: number
) {
  const cols = Math.max(1, rowLen)
  const rows = Math.max(1, Math.ceil(items.length / cols))

  const canvas = document.createElement('canvas')
  canvas.width = cols * swW + Math.max(0, cols - 1) * gapH
  canvas.height = rows * swH + Math.max(0, rows - 1) * gapV

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not available')

  ctx.textBaseline = 'middle'
  ctx.font = `${clamp(fontSizePx, 6, Math.max(6, swH))}px ${fontFace}, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]
    const x = (i % cols) * (swW + gapH)
    const y = Math.floor(i / cols) * (swH + gapV)

    ctx.fillStyle = it.hex
    ctx.fillRect(x, y, swW, swH)

    const text = it.name
    ctx.fillStyle = getContrastText(it.hex)
    const pad = 2
    const tx = x + pad
    const ty = y + Math.floor(swH / 2)

    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, swW, swH)
    ctx.clip()
    ctx.fillText(text, tx, ty)
    ctx.restore()
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to create PNG blob'))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}

function makeId() {
  return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16)
}

const app = $('#app')

app.innerHTML = `
  <div class="layout">
    <div class="panel">
      <h2>Controls</h2>

      <div class="controls-grid">
        <label class="span-3">
          Color Name
          <input id="in-name" type="text" placeholder="Enter color name" />
        </label>

        <label class="span-1">
          Index
          <input id="in-index" type="number" inputmode="numeric" min="0" step="1" value="0" />
        </label>

        <label class="span-2">
          Color
          <input id="in-color" type="color" value="#808080" />
        </label>

        <div class="span-2" style="display:flex;align-items:end;">
          <button id="btn-add" style="width:100%;">Add / Update</button>
        </div>
      </div>

      <hr />

      <div class="controls-grid">
        <label class="span-4">
          Row Length (swatches in row)
          <input id="in-rowlen" type="number" inputmode="numeric" min="1" step="1" value="8" />
        </label>

        <label class="span-2">
          Swatch H
          <input id="in-swh" type="number" inputmode="numeric" min="8" step="1" value="62" />
        </label>

        <label class="span-2">
          Swatch W
          <input id="in-sww" type="number" inputmode="numeric" min="8" step="1" value="94" />
        </label>

        <label class="span-2">
          Gap H
          <input id="in-gap-h" type="number" inputmode="numeric" min="0" step="1" value="2" />
        </label>

        <label class="span-2">
          Gap V
          <input id="in-gap-v" type="number" inputmode="numeric" min="0" step="1" value="2" />
        </label>

        <div class="row-1 span-4">
          <div class="small" id="status-geom">Swatch Block Size is <b>$sww+$gap-h</b> x <b>$swh+$gap-v</b></div>
        </div>
        
        <label class="span-3">
          Font Name
          <select id="in-font-face">
            <option value="ui-sans-serif">ui-sans-serif</option>
          </select>
        </label>
        <label class="span-1">
          Font Size
          <input id="in-font-size" type="number" inputmode="numeric" min="1" step="1" value="12" />
        </label>
      </div>

      <hr />

      <div class="controls-grid">
        <button id="btn-load" class="span-2">Load Palette</button>
        <button id="btn-reset" class="span-2 btn-reset">Reset</button>

        <label class="span-4">
          Palette Format
          <select id="in-format">
            <option value="json">JSON (palette.v1)</option>
            <option value="gpl">GPL (GIMP)</option>
          </select>
        </label>

        <button id="btn-save" class="span-4">Save Palette</button>
      </div>

      <hr />

      <div class="controls-grid">
        <label class="span-4">
          Render Scale
          <input id="in-rscale" type="number" inputmode="numeric" min="1" step="1" value="1" />
        </label>

        <button id="btn-png" class="span-4">Render to PNG</button>
      </div>

      <div class="row-1">
        <div class="small" id="status-msg">Ready.</div>
      </div>

      <input id="file" type="file" accept=".json,.gpl,application/json,text/plain" style="display:none" />
    </div>

    <div class="panel">
      <h2>Palette</h2>
      <div id="palette" class="palette" style="--row-len: 8; --sw-w: 96px; --sw-h: 64px;"></div>
    </div>
  </div>
`

const inName = $('#in-name') as HTMLInputElement
const inIndex = $('#in-index') as HTMLInputElement
const inColor = $('#in-color') as HTMLInputElement
const inFormat = $('#in-format') as HTMLSelectElement
const inRowLen = $('#in-rowlen') as HTMLInputElement
const inSwW = $('#in-sww') as HTMLInputElement
const inSwH = $('#in-swh') as HTMLInputElement
const inGapH = $('#in-gap-h') as HTMLInputElement
const inGapV = $('#in-gap-v') as HTMLInputElement
const inFontFace = $('#in-font-face') as HTMLSelectElement
const inFontSize = $('#in-font-size') as HTMLInputElement
populateFontFaces(inFontFace)

const btnAdd = $('#btn-add') as HTMLButtonElement
const btnLoad = $('#btn-load') as HTMLButtonElement
const btnSave = $('#btn-save') as HTMLButtonElement
const btnPng = $('#btn-png') as HTMLButtonElement
const btnReset = $('#btn-reset') as HTMLButtonElement
const inRScale = $('#in-rscale') as HTMLInputElement

const fileInput = $('#file') as HTMLInputElement
const paletteEl = $('#palette') as HTMLDivElement
const statusGeomEl = $('#status-geom') as HTMLDivElement
const statusMsgEl = $('#status-msg') as HTMLDivElement

let items: PaletteItem[] = []

function setStatus(s: string) {
  statusMsgEl.textContent = s
}

function applyGridVars() {
  const rowLen = clamp(parseInt(inRowLen.value || '8', 10) || 8, 1, 256)
  const swW = clamp(parseInt(inSwW.value || '96', 10) || 96, 8, 1024)
  const swH = clamp(parseInt(inSwH.value || '64', 10) || 64, 8, 1024)
  const gapH = clamp(parseInt(inGapH.value || '0', 10) || 0, 0, 1024)
  const gapV = clamp(parseInt(inGapV.value || '0', 10) || 0, 0, 1024)

  paletteEl.style.setProperty('--row-len', String(rowLen))
  paletteEl.style.setProperty('--sw-w', `${swW}px`)
  paletteEl.style.setProperty('--sw-h', `${swH}px`)
  paletteEl.style.setProperty('--gap-h', `${gapH}px`)
  paletteEl.style.setProperty('--gap-v', `${gapV}px`)

  updateStatusBlock(swW, swH, gapH, gapV)
}

function updateStatusBlock(swW: number, swH: number, gapH: number, gapV: number) {
  const bw = swW + gapH
  const bh = swH + gapV
  statusGeomEl.innerHTML = `Swatch Block Size is <b>${bw}</b> x <b>${bh}</b>`
}

function render() {
  applyGridVars()
  paletteEl.innerHTML = ''

  for (const it of items) {
    const sw = document.createElement('div')
    const slug = slugify(it.name) || 'color'
    sw.className = `swatch c-${slug}`
    sw.style.background = it.hex
    sw.dataset.id = it.id

    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = it.name
    name.style.color = getContrastText(it.hex)
    name.style.fontFamily = `${inFontFace.value}, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`
    name.style.fontSize = `${clamp(parseInt(inFontSize.value || '12', 10) || 12, 6, 48)}px`

    const del = document.createElement('button')
    del.className = 'del'
    del.type = 'button'
    del.textContent = '×'
    del.title = 'Remove'

    del.addEventListener('click', (e) => {
      e.stopPropagation()
      items = items.filter((x) => x.id !== it.id)
      render()
    })

    sw.addEventListener('click', () => {
      inName.value = it.name
      inIndex.value = String(it.index)
      inColor.value = it.hex
      setStatus(`Loaded "${it.name}"`)
    })

    sw.appendChild(name)
    sw.appendChild(del)
    paletteEl.appendChild(sw)
  }
}

function addOrUpdate() {
  const name = inName.value.trim() || ''
  const index = clamp(parseInt(inIndex.value || '0', 10) || 0, 0, 999999)
  const hex = normalizeHex(inColor.value)

  const existing = items.find((x) => x.index === index)
  if (existing) {
    existing.name = name
    existing.hex = hex
    setStatus(`Updated index ${index}`)
  } else {
    items.push({ id: makeId(), name, index, hex })
    setStatus(`Added index ${index}`)
  }

  render()

  inIndex.value = String(items.length)
}

type FontOption = { label: string; css: string }

function populateFontFaces(select: HTMLSelectElement) {
  const fonts: FontOption[] = [
    { label: 'ui-sans-serif', css: 'ui-sans-serif' },
    { label: 'system-ui', css: 'system-ui' },
    { label: 'monospace', css: 'monospace' },

    { label: 'Jersey 10', css: '"Jersey 10"' },
    { label: 'Pixelify Sans', css: '"Pixelify Sans"' },
    { label: 'Tiny5', css: '"Tiny5"' },
  ]

  select.innerHTML = ''
  for (const f of fonts) {
    const opt = document.createElement('option')
    opt.value = f.css
    opt.textContent = f.label
    select.appendChild(opt)
  }

  select.value = fonts[0].css
}

btnAdd.addEventListener('click', () => addOrUpdate())

inRowLen.addEventListener('input', () => applyGridVars())
inSwW.addEventListener('input', () => applyGridVars())
inSwH.addEventListener('input', () => applyGridVars())
inGapH.addEventListener('input', () => applyGridVars())
inGapV.addEventListener('input', () => applyGridVars())
inFontFace.addEventListener('change', () => render())
inFontSize.addEventListener('input', () => render())

btnSave.addEventListener('click', async () => {
  const fmt = inFormat.value

  if (fmt === 'gpl') {
    const text = toGpl(items)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    downloadBlob(blob, 'palette.gpl')
    setStatus('Saved palette.gpl')
    return
  }

  const payload: PaletteFileV1 = {
    kind: 'palette.v1',
    items: items
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((x) => ({ name: x.name, index: x.index, hex: x.hex })),
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  downloadBlob(blob, 'palette.json')
  setStatus('Saved palette.json')
})

btnLoad.addEventListener('click', () => {
  fileInput.value = ''
  fileInput.click()
})

fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0]
  if (!f) return

  const text = await f.text()
  const name = f.name.toLowerCase()

  try {
    if (name.endsWith('.gpl')) {
      const parsed = parseGpl(text)
      items = parsed.map((x) => ({ id: makeId(), name: x.name, index: x.index, hex: normalizeHex(x.hex) }))
      render()
      setStatus(`Loaded ${items.length} colors from GPL`)
      return
    }

    const data = JSON.parse(text) as PaletteFileV1
    if (data && data.kind === 'palette.v1' && Array.isArray(data.items)) {
      items = data.items.map((x) => ({
        id: makeId(),
        name: String(x.name || ''),
        index: clamp(Number(x.index) || 0, 0, 999999),
        hex: normalizeHex(String(x.hex || '#000000')),
      }))
      render()
      setStatus(`Loaded ${items.length} colors from JSON`)
      return
    }

    throw new Error('Unknown JSON format')
  } catch (e) {
    setStatus(`Load error: ${(e as Error).message}`)
  }
})

btnPng.addEventListener('click', async () => {
  try {
    const rowLen = clamp(parseInt(inRowLen.value || '8', 10) || 8, 1, 256)
    const swW = clamp(parseInt(inSwW.value || '96', 10) || 96, 8, 1024)
    const swH = clamp(parseInt(inSwH.value || '64', 10) || 64, 8, 1024)
    const gapH = clamp(parseInt(inGapH.value || '0', 10) || 0, 0, 1024)
    const gapV = clamp(parseInt(inGapV.value || '0', 10) || 0, 0, 1024)
    const scale = clamp(parseInt(inRScale.value || '1', 10) || 1, 1, 16)

    const fontFace = inFontFace.value || 'ui-sans-serif'
    const fontSize = clamp(parseInt(inFontSize.value || '12', 10) || 12, 6, 256)

    await document.fonts.ready

    const blob = await renderPng(
      items.slice().sort((a, b) => a.index - b.index),
      rowLen,
      swW * scale,
      swH * scale,
      gapH * scale,
      gapV * scale,
      fontFace,
      fontSize * scale
    )

    downloadBlob(blob, 'palette.png')
    setStatus('Rendered palette.png')
  } catch (e) {
    setStatus(`PNG error: ${(e as Error).message}`)
  }
})

btnReset.addEventListener('click', () => {
  items = []
  render()
  inIndex.value = '1'
  setStatus('Reset.')
})

applyGridVars()
render()
