const symbols = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']
const total = symbols.length * 3
const size = 128
const $ = id => document.getElementById(id)
const pad = $('pad')
const context = pad.getContext('2d')
const preferences = ['ink', 'background', 'width', 'pencil', 'theme']
const defaults = { ink: '#171923', background: '#ffffff', width: 7, pencil: false, theme: 'system' }
const samples = new Map()
const previews = new Map()
let db
let state
let strokes = []
let background = defaults.background
let active
let busy = false
let dirty = false

const sampleKey = index => `${symbols[Math.floor(index / 3)]}/${index % 3 + 1}`
const newDataset = settings => ({ uuid: crypto.randomUUID(), index: 0, settings, revision: 0 })

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('handwritten-dataset', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('dataset')
      request.result.createObjectStore('samples')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transaction(mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['dataset', 'samples'], mode)
    const dataset = tx.objectStore('dataset')
    const images = tx.objectStore('samples')
    let result
    let failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure || tx.error)
    run(dataset, images, value => { result = value }, error => {
      failure = error
      tx.abort()
    })
  })
}

function loadDataset() {
  return transaction('readwrite', (dataset, images, done) => {
    const request = dataset.get('current')
    const all = images.getAll()
    request.onsuccess = () => {
      const current = request.result || newDataset({ ...defaults })
      if (!request.result) dataset.put(current, 'current')
      all.onsuccess = () => done({ current, records: all.result })
    }
  })
}

async function commit(update, image, reset = false) {
  const next = { ...state, ...update, revision: state.revision + 1 }
  await transaction('readwrite', (dataset, images, _, abort) => {
    const request = dataset.get('current')
    request.onsuccess = () => {
      const latest = request.result
      if (latest?.uuid !== state.uuid || latest.revision !== state.revision) {
        abort(new Error('Выборка изменилась в другой вкладке. Обновите страницу.'))
        return
      }
      if (reset) images.clear()
      if (image) images.put(image, image.key)
      dataset.put(next, 'current')
    }
  })
  state = next
}

function report(error) {
  console.error(error)
  $('error').textContent = error.message || 'Не удалось завершить операцию.'
  $('error').hidden = false
}

async function run(action) {
  if (busy || active || !state) return
  busy = true
  $('error').hidden = true
  refresh()
  try {
    await action()
  } catch (error) {
    report(error)
  } finally {
    busy = false
    refresh()
  }
}

const announce = text => { $('announcement').textContent = text }

function refresh() {
  $('workspace').inert = busy || !state
  $('gallery').inert = busy || !state
  $('draw-tab').disabled = $('gallery-tab').disabled = busy || !state
  $('count').textContent = `${samples.size} / ${total}`
  $('progress').value = samples.size
  $('backup').disabled = busy || !samples.size
  $('final').disabled = busy || samples.size !== total
  $('undo').disabled = $('clear').disabled = busy || !!active || !strokes.length
  const key = state && sampleKey(state.index)
  const saved = samples.has(key)
  $('save').disabled = busy || !!active || !strokes.length
  $('previous').disabled = busy || !state?.index
  if (!state) return
  const [symbol, variant] = key.split('/')
  $('symbol').textContent = symbol
  $('variant').textContent = `Вариант ${variant} / 3`
  $('sample-state').textContent = dirty ? 'Несохранённые изменения' : saved ? 'Сохранённый образ' : 'Новый образ'
}

function syncSettings() {
  const settings = state.settings
  for (const key of preferences) {
    if (key === 'pencil') $(key).checked = settings[key]
    else $(key).value = settings[key]
  }
  $('background').value = background
  $('width-value').value = settings.width
  document.documentElement.dataset.theme = settings.theme
}

function fill() {
  context.fillStyle = background
  context.fillRect(0, 0, pad.width, pad.height)
}

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function drawDot(stroke) {
  const [point] = stroke.points
  context.beginPath()
  context.fillStyle = stroke.color
  context.arc(point.x, point.y, stroke.width / 2, 0, 2 * Math.PI)
  context.fill()
}

function drawSegment(stroke, index, tail = false) {
  const points = stroke.points
  const previous = points[index - 1]
  const current = points[index]
  const start = index === 1 ? previous : midpoint(points[index - 2], previous)
  const end = midpoint(previous, current)
  context.beginPath()
  context.lineWidth = stroke.width
  context.lineCap = 'round'
  context.strokeStyle = stroke.color
  context.moveTo(tail ? end.x : start.x, tail ? end.y : start.y)
  if (tail) context.lineTo(current.x, current.y)
  else context.quadraticCurveTo(previous.x, previous.y, end.x, end.y)
  context.stroke()
}

function redraw() {
  fill()
  for (const stroke of strokes) {
    drawDot(stroke)
    for (let i = 1; i < stroke.points.length; i++) drawSegment(stroke, i)
    if (stroke.points.length > 1) drawSegment(stroke, stroke.points.length - 1, true)
  }
}

function point(event, rect) {
  return {
    x: (event.clientX - rect.left) * pad.width / rect.width,
    y: (event.clientY - rect.top) * pad.height / rect.height
  }
}

pad.addEventListener('pointerdown', event => {
  if (busy || active || event.button !== 0 || (state.settings.pencil && event.pointerType !== 'pen')) return
  event.preventDefault()
  pad.setPointerCapture(event.pointerId)
  const stroke = {
    color: state.settings.ink,
    width: state.settings.width * pad.width / size,
    points: [point(event, pad.getBoundingClientRect())]
  }
  active = { id: event.pointerId, stroke }
  strokes.push(stroke)
  dirty = true
  drawDot(stroke)
  refresh()
})

function append(event) {
  const rect = pad.getBoundingClientRect()
  const { stroke } = active
  const events = event.getCoalescedEvents?.()
  for (const sample of events?.length ? events : [event]) {
    const next = point(sample, rect)
    const last = stroke.points.at(-1)
    if (last.x === next.x && last.y === next.y) continue
    stroke.points.push(next)
    drawSegment(stroke, stroke.points.length - 1)
  }
}

pad.addEventListener('pointermove', event => {
  if (active?.id === event.pointerId) append(event)
})

function finishStroke(event) {
  if (active?.id !== event.pointerId) return
  if (event.type === 'pointerup') append(event)
  const { stroke } = active
  if (stroke.points.length > 1) drawSegment(stroke, stroke.points.length - 1, true)
  active = undefined
  if (pad.hasPointerCapture(event.pointerId)) pad.releasePointerCapture(event.pointerId)
  refresh()
}

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  pad.addEventListener(type, finishStroke)
}
for (const type of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'dblclick', 'contextmenu']) {
  pad.addEventListener(type, event => event.preventDefault(), { passive: false })
}

function selectSample() {
  const image = samples.get(sampleKey(state.index))
  background = image?.background ?? state.settings.background
  strokes = structuredClone(image?.strokes ?? [])
  dirty = false
  syncSettings()
  redraw()
}

function discardDraft() {
  return !dirty || confirm('Перейти без сохранения изменений текущего образа?')
}

async function navigate(index) {
  if (active || !discardDraft()) return
  if (index !== state.index) await commit({ index })
  selectSample()
  showGallery(false)
}

function showGallery(show) {
  $('workspace').hidden = show
  $('gallery').hidden = !show
  $('draw-tab').toggleAttribute('aria-current', !show)
  $('gallery-tab').toggleAttribute('aria-current', show)
  $(show ? 'gallery-tab' : 'draw-tab').setAttribute('aria-current', 'page')
  if (show) renderGallery()
}

function renderGallery() {
  const cards = symbols.map((symbol, symbolIndex) => {
    const card = document.createElement('article')
    card.className = 'card'
    const header = document.createElement('header')
    const title = document.createElement('h2')
    title.textContent = symbol
    const count = document.createElement('span')
    header.append(title, count)
    const thumbs = document.createElement('div')
    thumbs.className = 'thumbs'
    let completed = 0
    for (let variant = 1; variant <= 3; variant++) {
      const index = symbolIndex * 3 + variant - 1
      const key = sampleKey(index)
      const image = samples.get(key)
      const button = document.createElement('button')
      button.className = 'thumb'
      button.setAttribute('aria-label', `${image ? 'Редактировать' : 'Нарисовать'} ${symbol}, вариант ${variant}`)
      button.onclick = () => run(() => navigate(index))
      if (image) {
        completed++
        if (!previews.has(key)) previews.set(key, URL.createObjectURL(image.png))
        const img = new Image()
        img.alt = ''
        img.loading = 'lazy'
        img.src = previews.get(key)
        button.append(img)
      } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'empty'
        placeholder.setAttribute('aria-hidden', 'true')
        placeholder.textContent = '+'
        button.append(placeholder)
      }
      button.append(String(variant))
      thumbs.append(button)
    }
    count.textContent = `${completed} / 3`
    card.append(header, thumbs)
    return card
  })
  $('grid').replaceChildren(...cards)
}

function forgetPreview(key) {
  if (!previews.has(key)) return
  URL.revokeObjectURL(previews.get(key))
  previews.delete(key)
}

function hasVisibleInk(imageContext, color) {
  const pixels = imageContext.getImageData(0, 0, size, size).data
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16))
  let visible = false
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] !== 255) return false
    if (pixels[i] !== rgb[0] || pixels[i + 1] !== rgb[1] || pixels[i + 2] !== rgb[2]) visible = true
  }
  return visible
}

function outputCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  return canvas
}

async function save() {
  const output = outputCanvas()
  const scaled = output.getContext('2d', { willReadFrequently: true })
  scaled.imageSmoothingQuality = 'high'
  scaled.drawImage(pad, 0, 0, size, size)
  if (!hasVisibleInk(scaled, background)) {
    throw new Error('На холсте нет видимого рисунка. Нарисуйте символ цветом, отличным от фона.')
  }
  const png = await new Promise(resolve => output.toBlob(resolve, 'image/png'))
  if (!png) throw new Error('Не удалось создать PNG.')
  const index = state.index
  const key = sampleKey(index)
  const image = { key, png, strokes, background }
  const later = index + 1
  let next = later < total ? later : index
  const complete = samples.size + Number(!samples.has(key)) === total
  if (later === total && !complete) {
    next = Array.from({ length: total }, (_, i) => i).find(i => i !== index && !samples.has(sampleKey(i)))
  }
  await commit({ index: next }, image)
  forgetPreview(key)
  samples.set(key, image)
  selectSample()
  if (complete && later === total) showGallery(true)
  announce(`Образ ${key} сохранён. Готово ${samples.size} из ${total}.`)
}

async function validatePng(image, checkContext) {
  const signature = new Uint8Array(await image.png.slice(0, 8).arrayBuffer())
  if (signature.join(',') !== '137,80,78,71,13,10,26,10') {
    throw new Error(`Файл ${image.key} не является PNG.`)
  }
  const url = URL.createObjectURL(image.png)
  try {
    const png = new Image()
    const ready = new Promise((resolve, reject) => {
      png.onload = resolve
      png.onerror = () => reject(new Error(`Не удалось прочитать ${image.key}.png.`))
    })
    png.src = url
    await ready
    if (image.png.type !== 'image/png' || png.naturalWidth !== size || png.naturalHeight !== size) {
      throw new Error(`Файл ${image.key}.png должен быть PNG размером 128 × 128.`)
    }
    checkContext.clearRect(0, 0, size, size)
    checkContext.drawImage(png, 0, 0)
    if (!hasVisibleInk(checkContext, image.background)) {
      throw new Error(`Образ ${image.key} пуст или содержит прозрачность.`)
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function exportZip(final) {
  if (!window.JSZip) throw new Error('Библиотека JSZip не загрузилась. Обновите страницу.')
  const zip = new window.JSZip()
  const root = zip.folder(state.uuid)
  const checkContext = outputCanvas().getContext('2d', { willReadFrequently: true })
  for (const symbol of symbols) {
    if (final) root.folder(symbol)
    for (let variant = 1; variant <= 3; variant++) {
      const key = `${symbol}/${variant}`
      const image = samples.get(key)
      if (!image) {
        if (final) throw new Error(`Отсутствует образ ${key}.`)
        continue
      }
      await validatePng(image, checkContext)
      root.file(`${key}.png`, image.png)
    }
  }
  const archive = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(archive)
  const link = document.createElement('a')
  link.href = url
  link.download = final ? `${state.uuid}.zip` : `${state.uuid}-backup.zip`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  announce('ZIP подготовлен к скачиванию.')
}

$('gallery-tab').onclick = () => { if (!active) showGallery(true) }
$('draw-tab').onclick = () => showGallery(false)
$('previous').onclick = () => run(() => navigate(state.index - 1))
$('save').onclick = () => run(save)
$('undo').onclick = () => {
  strokes.pop()
  dirty = true
  redraw()
  refresh()
}
$('clear').onclick = () => {
  strokes = []
  dirty = true
  redraw()
  refresh()
}
$('width').oninput = () => { $('width-value').value = $('width').value }
for (const key of preferences) {
  $(key).onchange = () => run(async () => {
    const input = $(key)
    const value = key === 'pencil' ? input.checked : key === 'width' ? input.valueAsNumber : input.value
    try {
      await commit({ settings: { ...state.settings, [key]: value } })
      if (key === 'background') {
        background = value
        dirty = dirty || strokes.length > 0
        redraw()
      }
    } finally {
      syncSettings()
    }
  })
}
$('backup').onclick = () => run(() => exportZip(false))
$('final').onclick = () => run(() => exportZip(true))
$('reset').onclick = () => run(async () => {
  if (!confirm('Удалить все образы и начать выборку с новым UUID?')) return
  const fresh = newDataset(state.settings)
  await commit(fresh, null, true)
  for (const key of previews.keys()) forgetPreview(key)
  samples.clear()
  selectSample()
  showGallery(false)
  announce('Создана новая выборка.')
})

refresh()
try {
  db = await openDatabase()
  const { current, records } = await loadDataset()
  state = current
  for (const image of records) samples.set(image.key, image)
  selectSample()
  refresh()
} catch (error) {
  report(error)
}
