'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const context = canvas.getContext('2d');
const assets = new Map();
let chosenAsset = 'default';
let nextAssetId = 1;
const pointers = new Map();
let base = null;
let layers = [];
let selected = null;
let nextId = 1;
let zoom = 1;
let gesture = null;
let history = [];
let historyIndex = -1;
let importVersion = 0;
let resultUrl = null;
let resultFile = null;
let toastTimer;

function registerAsset(id, image, name, clean = false) {
  const surface = document.createElement('canvas');
  surface.width = image.naturalWidth || image.width;
  surface.height = image.naturalHeight || image.height;
  const target = surface.getContext('2d');
  target.drawImage(image, 0, 0);
  if (clean) {
    const pixels = target.getImageData(0, 0, surface.width, surface.height);
    for (let i = 3; i < pixels.data.length; i += 4) {
      if (pixels.data[i] >= 240) pixels.data[i] = 255;
      else if (pixels.data[i] <= 8) pixels.data[i] = 0;
    }
    target.putImageData(pixels, 0, 0);
  }
  assets.set(id, { image: surface, width: surface.width, height: surface.height, name });
}

const assetsReady = Promise.allSettled(['default', 'character'].map(async (id) => {
  const image = new Image();
  image.src = `assets/${id}.png`;
  await image.decode();
  registerAsset(id, image, id === 'default' ? '粉发搭子' : '糯米天师', true);
})).then((results) => {
  if (results.some((result) => result.status === 'rejected')) notify('部分贴纸加载失败，请刷新页面重试。');
  sync();
  draw();
});

function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3400);
}

function active() { return layers.find((layer) => layer.id === selected); }
function touchDevice() { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(max-width: 720px)').matches); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function angle(value) { return ((value + 180) % 360 + 360) % 360 - 180; }
function dimensions(layer) { const asset = assets.get(layer.assetId); return { width: layer.width, height: layer.width * asset.height / asset.width }; }
function snapshot() { return JSON.stringify({ layers, selected }); }

function commit() {
  if (history[historyIndex] === snapshot()) return;
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  if (history.length > 80) history.shift();
  historyIndex = history.length - 1;
  sync();
}

function restore(offset) {
  if (gesture || historyIndex + offset < 0 || historyIndex + offset >= history.length) return;
  historyIndex += offset;
  const state = JSON.parse(history[historyIndex]);
  layers = state.layers;
  selected = state.selected;
  sync();
  draw();
}

function sync() {
  const layer = active();
  if (layer) chosenAsset = layer.assetId;
  $('controls').disabled = !layer;
  $('export').disabled = !base;
  $('add').disabled = !base || !assets.has(chosenAsset);
  for (const option of $('asset-list').querySelectorAll('[data-asset]')) {
    option.setAttribute('aria-pressed', String(option.dataset.asset === chosenAsset));
    option.disabled = !assets.has(option.dataset.asset);
  }
  $('undo').disabled = historyIndex <= 0;
  $('redo').disabled = historyIndex >= history.length - 1;
  $('selection-note').textContent = !base ? '先选一张图片，就可以开始贴贴。' : layer ? `已选中贴纸 · 共 ${layers.length} 张` : '点击贴纸选中，或再添加一张。';
  if (layer) {
    const size = layer.width / base.width * 100;
    $('size').value = size;
    $('size-value').textContent = `${Math.round(size)}%`;
    $('rotation').value = angle(layer.rotation);
    $('rotation-value').textContent = `${Math.round(angle(layer.rotation))}°`;
  }
}

function drawLayer(target, layer) {
  const { width, height } = dimensions(layer);
  target.save();
  target.translate(layer.x, layer.y);
  target.rotate(layer.rotation * Math.PI / 180);
  target.scale(layer.flip ? -1 : 1, 1);
  target.drawImage(assets.get(layer.assetId).image, -width / 2, -height / 2, width, height);
  target.restore();
}

function render(target) {
  target.drawImage(base, 0, 0, base.width, base.height);
  for (const layer of layers) drawLayer(target, layer);
}

function draw() {
  if (!base) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const ratio = canvas.width / base.width;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  render(context);
  const layer = active();
  if (!layer) return;
  const { width, height } = dimensions(layer);
  const unit = 1 / zoom;
  context.save();
  context.translate(layer.x, layer.y);
  context.rotate(layer.rotation * Math.PI / 180);
  context.strokeStyle = '#496d3f';
  context.fillStyle = '#fffef9';
  context.lineWidth = 1.5 * unit;
  context.setLineDash([5 * unit, 4 * unit]);
  context.strokeRect(-width / 2, -height / 2, width, height);
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(0, -height / 2);
  context.lineTo(0, -height / 2 - 28 * unit);
  context.stroke();
  for (const [x, y] of [[0, -height / 2 - 28 * unit], [width / 2, height / 2]]) {
    context.beginPath();
    context.arc(x, y, 9 * unit, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.font = `${12 * unit}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#496d3f';
  context.fillText('↻', 0, -height / 2 - 28 * unit);
  context.fillText('↗', width / 2, height / 2);
  context.restore();
}

function fit() {
  if (!base) return;
  const stage = $('stage');
  const padding = innerWidth <= 720 ? 28 : 44;
  zoom = Math.min((stage.clientWidth - padding) / base.width, (stage.clientHeight - padding) / base.height);
  const width = Math.max(1, base.width * zoom);
  const height = Math.max(1, base.height * zoom);
  const dpi = Math.min(devicePixelRatio || 1, 2);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpi);
  canvas.height = Math.round(height * dpi);
  draw();
}

function addLayer(source) {
  const asset = assets.get(chosenAsset);
  if (!base || !asset) return;
  const width = Math.min(base.width * .4, base.height * .55 * asset.width / asset.height);
  const layer = source ? { ...source, id: nextId++, x: clamp(source.x + 20 / zoom, 0, base.width), y: clamp(source.y + 20 / zoom, 0, base.height) } : { id: nextId++, assetId: chosenAsset, x: base.width / 2, y: base.height / 2, width, rotation: 0, flip: false };
  layers.push(layer);
  selected = layer.id;
  commit();
  draw();
}

async function readImage(file) {
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(file.name)) throw new Error('请选择一张图片文件。');
  if (file.size > 80 * 1024 * 1024) throw new Error('图片超过 80 MB，请先缩小文件再试。');
  let image;
  try {
    image = await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    image = new Image();
    try { image.src = url; await image.decode(); } catch { image = null; }
    URL.revokeObjectURL(url);
  }
  if (!image) throw new Error('这张图片无法读取。HEIC 图片请先转换为 JPG 或 PNG。');
  if (image.width * image.height > 64000000 || Math.max(image.width, image.height) > 16384) {
    image.close?.();
    throw new Error('图片尺寸过大，请先调整到 6400 万像素以内、单边不超过 16384 像素。');
  }
  return image;
}

async function loadFile(file) {
  if (!file) return;
  const version = ++importVersion;
  let image;
  try { image = await readImage(file); } catch (error) { if (version === importVersion) notify(error.message); return; }
  if (version !== importVersion) { image.close?.(); return; }
  base?.close?.();
  base = image;
  layers = [];
  selected = null;
  pointers.clear();
  gesture = null;
  history = [];
  historyIndex = -1;
  $('empty').hidden = true;
  canvas.hidden = false;
  $('replace').hidden = false;
  $('image-info').textContent = `${base.width} × ${base.height} · ${file.name}`;
  $('image-info').title = file.name;
  $('gesture-tip').textContent = touchDevice() ? '单指拖动 · 双指缩放 / 旋转' : '拖动贴纸 · 圆点旋转 · 右下角缩放';
  await assetsReady;
  if (version !== importVersion) return;
  fit();
  commit();
  addLayer();
  sync();
  notify('贴纸已放好，拖到想遮盖的位置吧。');
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * base.width / rect.width, y: (event.clientY - rect.top) * base.height / rect.height };
}

function localPoint(layer, point) {
  const radians = -layer.rotation * Math.PI / 180;
  const x = point.x - layer.x, y = point.y - layer.y;
  return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) };
}

function handleAt(layer, pos) {
  const p = localPoint(layer, pos);
  const { width, height } = dimensions(layer);
  const hitRadius = 20 / zoom;
  if (Math.hypot(p.x, p.y + height / 2 + 28 / zoom) < hitRadius) return 'rotate';
  if (Math.hypot(p.x - width / 2, p.y - height / 2) < hitRadius) return 'scale';
  return null;
}

function pair() {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), radians: Math.atan2(b.y - a.y, b.x - a.x) };
}

canvas.addEventListener('pointerdown', (event) => {
  if (!base || event.button > 0 || pointers.size >= 2) return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  const pos = point(event);
  if (pointers.size === 1 && active()) {
    pointers.set(event.pointerId, pos);
    canvas.setPointerCapture(event.pointerId);
    gesture = { mode: 'pinch', origin: { ...active() }, pair: pair() };
    return;
  }
  let layer = active();
  let mode = layer && handleAt(layer, pos);
  if (!mode) {
    layer = [...layers].reverse().find((item) => {
      const p = localPoint(item, pos);
      const { width, height } = dimensions(item);
      return Math.abs(p.x) <= width / 2 && Math.abs(p.y) <= height / 2;
    });
    mode = 'drag';
  }
  selected = layer?.id ?? null;
  if (layer) {
    layers = layers.filter((item) => item !== layer);
    layers.push(layer);
    pointers.set(event.pointerId, pos);
    canvas.setPointerCapture(event.pointerId);
    gesture = { mode, origin: { ...layer }, start: pos };
    canvas.style.cursor = 'grabbing';
  }
  sync();
  draw();
});

canvas.addEventListener('pointermove', (event) => {
  if (!gesture || !pointers.has(event.pointerId)) return;
  const pos = point(event);
  pointers.set(event.pointerId, pos);
  const layer = active(), { origin, start, mode } = gesture;
  if (!layer) return;
  if (mode === 'pinch' && pointers.size === 2) {
    const current = pair(), initial = gesture.pair;
    layer.x = origin.x + current.x - initial.x;
    layer.y = origin.y + current.y - initial.y;
    layer.width = origin.width * current.distance / initial.distance;
    layer.rotation = angle(origin.rotation + (current.radians - initial.radians) * 180 / Math.PI);
  } else if (mode === 'drag') {
    layer.x = origin.x + pos.x - start.x;
    layer.y = origin.y + pos.y - start.y;
  } else if (mode === 'rotate') {
    layer.rotation = angle(origin.rotation + (Math.atan2(pos.y - origin.y, pos.x - origin.x) - Math.atan2(start.y - origin.y, start.x - origin.x)) * 180 / Math.PI);
  } else if (mode === 'scale') {
    layer.width = origin.width * Math.hypot(pos.x - origin.x, pos.y - origin.y) / Math.max(1, Math.hypot(start.x - origin.x, start.y - origin.y));
  }
  layer.x = clamp(layer.x, 0, base.width);
  layer.y = clamp(layer.y, 0, base.height);
  layer.width = clamp(layer.width, base.width * .02, base.width * 2);
  sync();
  draw();
});

function endPointer(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId);
  if (pointers.size && active()) gesture = { mode: 'drag', origin: { ...active() }, start: [...pointers.values()][0] };
  else { gesture = null; canvas.style.cursor = 'grab'; commit(); }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);

for (const id of ['size', 'rotation']) {
  $(id).addEventListener('input', () => {
    const layer = active();
    if (!layer) return;
    if (id === 'size') layer.width = base.width * Number($(id).value) / 100;
    else layer.rotation = Number($(id).value);
    sync();
    draw();
  });
  $(id).addEventListener('change', commit);
}

function modify(operation) {
  if (!active() || gesture) return;
  operation(active());
  commit();
  sync();
  draw();
}

function chooseAsset(id) {
  if (gesture || !assets.has(id)) return;
  chosenAsset = id;
  if (active()) modify((layer) => { layer.assetId = id; });
  else sync();
}

$('asset-list').addEventListener('click', (event) => {
  const option = event.target.closest('[data-asset]');
  if (option) chooseAsset(option.dataset.asset);
});
$('upload-sticker').onclick = () => $('sticker-file').click();
$('sticker-file').onchange = async () => {
  const file = $('sticker-file').files[0];
  $('sticker-file').value = '';
  if (!file) return;
  $('upload-sticker').disabled = true;
  let image;
  try {
    image = await readImage(file);
    const id = `custom-${nextAssetId++}`;
    registerAsset(id, image, file.name);
    const option = document.createElement('button');
    option.className = 'asset-option';
    option.dataset.asset = id;
    option.setAttribute('aria-pressed', 'false');
    const preview = document.createElement('img');
    preview.src = URL.createObjectURL(file);
    preview.alt = file.name;
    preview.draggable = false;
    const label = document.createElement('strong');
    label.textContent = file.name;
    label.title = file.name;
    const caption = document.createElement('small');
    caption.textContent = '自定义贴纸';
    option.append(preview, label, caption);
    $('asset-list').append(option);
    chooseAsset(id);
    if (base && !active()) addLayer();
    notify('自定义贴纸已选好。上传素材的透明区域会保留。');
  } catch (error) { notify(error.message); }
  finally { image?.close?.(); $('upload-sticker').disabled = false; }
};

$('flip').onclick = () => modify((layer) => { layer.flip = !layer.flip; });
$('center').onclick = () => modify((layer) => { layer.x = base.width / 2; layer.y = base.height / 2; });
$('delete').onclick = () => modify(() => { layers = layers.filter((layer) => layer.id !== selected); selected = layers.at(-1)?.id ?? null; });
$('duplicate').onclick = () => { if (!gesture && active()) addLayer(active()); };
$('add').onclick = () => { if (!gesture) addLayer(); };
$('undo').onclick = () => restore(-1);
$('redo').onclick = () => restore(1);
$('upload').onclick = $('replace').onclick = () => $('file').click();
$('file').onchange = () => { loadFile($('file').files[0]); $('file').value = ''; };

let dragDepth = 0;
document.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
$('stage').addEventListener('dragenter', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  $('stage').classList.add('dragover');
});
$('stage').addEventListener('dragleave', () => { if (--dragDepth <= 0) $('stage').classList.remove('dragover'); });
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  $('stage').classList.remove('dragover');
  if (event.dataTransfer.files.length) loadFile(event.dataTransfer.files[0]);
});
document.addEventListener('paste', (event) => {
  const file = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'))?.getAsFile();
  if (file) { event.preventDefault(); loadFile(file); }
});

document.addEventListener('keydown', (event) => {
  if ($('result').open || gesture) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    restore(event.shiftKey ? 1 : -1);
    return;
  }
  if (event.target !== canvas || !active()) return;
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); $('delete').click(); }
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (directions[event.key]) {
    event.preventDefault();
    const [dx, dy] = directions[event.key], step = (event.shiftKey ? 10 : 1) / zoom;
    modify((layer) => { layer.x = clamp(layer.x + dx * step, 0, base.width); layer.y = clamp(layer.y + dy * step, 0, base.height); });
  }
});

$('export').onclick = async () => {
  if (!base || gesture) return;
  $('export').disabled = true;
  $('export').firstElementChild.textContent = '正在合成…';
  let output;
  try {
    output = document.createElement('canvas');
    output.width = base.width;
    output.height = base.height;
    const target = output.getContext('2d');
    if (!target) throw new Error('Canvas unavailable');
    render(target);
    const blob = await new Promise((resolve, reject) => output.toBlob((data) => data ? resolve(data) : reject(new Error('PNG encoding failed')), 'image/png'));
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    resultFile = new File([blob], 'nuomi-sticker.png', { type: 'image/png' });
    $('result-image').src = resultUrl;
    $('download').href = resultUrl;
    $('result-info').textContent = `${output.width} × ${output.height} 像素 · PNG · ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    $('share').hidden = !navigator.canShare?.({ files: [resultFile] });
    $('result').showModal();
    if (!touchDevice()) $('download').click();
  } catch {
    notify('图片生成失败，可能是设备内存不足。请换一张尺寸更小的图片再试。');
  } finally {
    if (output) { output.width = 1; output.height = 1; }
    $('export').firstElementChild.textContent = '保存图片';
    sync();
  }
};
$('share').onclick = async () => {
  try { await navigator.share({ files: [resultFile] }); }
  catch (error) { if (error.name !== 'AbortError') notify('分享未成功，可以点击下载或长按图片保存。'); }
};
$('close-result').onclick = () => $('result').close();
$('result').addEventListener('click', (event) => { if (event.target === $('result')) { const r = $('result').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('result').close(); } });
new ResizeObserver(fit).observe($('stage'));
