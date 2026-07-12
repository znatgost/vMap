// Wires up UI controls, drives generation, handles export/save/load.

const MAP_SIZES = {
  small: { w: 100, h: 60 },
  medium: { w: 160, h: 96 },
  large: { w: 220, h: 132 },
};
const CELL_SIZE = 6;

const el = (id) => document.getElementById(id);

const layers = {
  terrain: { canvas: el("layerTerrain") },
  relief: { canvas: el("layerRelief") },
  rivers: { canvas: el("layerRivers") },
  grid: { canvas: el("layerGrid") },
  labels: { canvas: el("layerLabels") },
};
for (const key in layers) layers[key].ctx = layers[key].canvas.getContext("2d");

const overlayCanvas = el("layerOverlay");
const renderer = new Renderer(layers, CELL_SIZE);

const editor = new Editor({
  viewport: el("viewport"),
  stage: el("stage"),
  overlayCanvas,
  renderer,
  onChange: () => syncStatus(),
});

function currentState() {
  const sizeKey = el("mapSize").value;
  return {
    seed: el("seed").value || "seed",
    mapSize: sizeKey,
    width: MAP_SIZES[sizeKey].w,
    height: MAP_SIZES[sizeKey].h,
    islandCount: Number(el("islandCount").value),
    islandSize: Number(el("islandSize").value),
    roughness: Number(el("roughness").value),
    seaLevel: Number(el("seaLevel").value),
  };
}

function regenerate() {
  const state = currentState();
  renderer.resize(state.width, state.height);
  overlayCanvas.width = state.width * CELL_SIZE;
  overlayCanvas.height = state.height * CELL_SIZE;

  const gen = new MapGenerator(state);
  const data = gen.generate();
  renderer.setData(data);
  renderer.drawAll();
  syncStatus();
}

function syncStatus() {
  const state = currentState();
  el("statusSeed").textContent = `сид: ${state.seed}`;
  el("statusSize").textContent = `размер: ${state.width}×${state.height}`;
  if (renderer.data) {
    let landCells = 0;
    for (let i = 0; i < renderer.data.bands.length; i++) {
      if (renderer.bandAt(i) > BAND.SHALLOW_WATER) landCells++;
    }
    const pct = ((landCells / renderer.data.bands.length) * 100).toFixed(1);
    el("statusIslands").textContent = `суша: ${pct}% · земель: ${renderer.data.labels.length}`;
  }
}

// ---- range outputs ----
[
  ["islandCount", "islandCountOut", (v) => v],
  ["islandSize", "islandSizeOut", (v) => Number(v).toFixed(2)],
  ["roughness", "roughnessOut", (v) => Number(v).toFixed(2)],
  ["seaLevel", "seaLevelOut", (v) => Number(v).toFixed(2)],
].forEach(([inputId, outId, fmt]) => {
  const input = el(inputId);
  const out = el(outId);
  input.addEventListener("input", () => (out.textContent = fmt(input.value)));
});

// ---- generation controls ----
el("btnGenerate").addEventListener("click", regenerate);
el("compass").addEventListener("click", regenerate);
el("btnDice").addEventListener("click", () => {
  el("seed").value = Math.random().toString(36).slice(2, 10);
  regenerate();
});
["mapSize"].forEach((id) => el(id).addEventListener("change", regenerate));
["islandCount", "islandSize", "roughness", "seaLevel"].forEach((id) =>
  el(id).addEventListener("change", regenerate)
);
el("seed").addEventListener("keydown", (e) => {
  if (e.key === "Enter") regenerate();
});

// ---- palette ----
const paletteGrid = el("paletteGrid");
Object.entries(PALETTES).forEach(([key, p]) => {
  const row = document.createElement("div");
  row.className = "palette-swatch" + (key === renderer.paletteKey ? " active" : "");
  row.dataset.key = key;
  const dotsOrder = [BAND.DEEP_WATER, BAND.SAND, BAND.GRASS_MID, BAND.HILLS, BAND.MOUNTAIN, BAND.PEAK];
  row.innerHTML = `
    <div class="palette-dots">${dotsOrder
      .map((b) => `<span style="background:${p.colors[b]}"></span>`)
      .join("")}</div>
    <span>${p.label}</span>`;
  row.addEventListener("click", () => {
    renderer.setPalette(key);
    document.querySelectorAll(".palette-swatch").forEach((n) => n.classList.remove("active"));
    row.classList.add("active");
    if (renderer.data) renderer.drawAll();
  });
  paletteGrid.appendChild(row);
});

// ---- layer toggles ----
document.querySelectorAll('[data-layer]').forEach((input) => {
  input.addEventListener("change", () => {
    renderer.setLayerVisible(input.dataset.layer, input.checked);
  });
  renderer.setLayerVisible(input.dataset.layer, input.checked);
});

// ---- tools ----
document.querySelectorAll(".tool-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    editor.setMode(btn.dataset.tool);
    el("viewport").style.cursor = btn.dataset.tool === "pan" ? "grab" : "default";
    el("paintBandRow").style.display = btn.dataset.tool === "paint" ? "flex" : "none";
  });
});
el("paintBandRow").style.display = "none";

el("brushSize").addEventListener("input", (e) => editor.setBrushSize(Number(e.target.value)));
el("brushStrength").addEventListener("input", (e) => editor.setBrushStrength(Number(e.target.value)));
el("paintBand").addEventListener("change", (e) => editor.setPaintBand(Number(e.target.value)));
el("btnResetView").addEventListener("click", () => editor.resetView());
el("btnZoomIn").addEventListener("click", () => editor.zoomBy(1.25));
el("btnZoomOut").addEventListener("click", () => editor.zoomBy(1 / 1.25));

// ---- mobile drawer panels ----
const panelLeft = el("panelLeft");
const panelRight = el("panelRight");
const backdrop = el("drawerBackdrop");

function closeDrawers() {
  panelLeft.classList.remove("open");
  panelRight.classList.remove("open");
  backdrop.classList.remove("visible");
}
el("btnPanelLeft").addEventListener("click", () => {
  panelRight.classList.remove("open");
  panelLeft.classList.add("open");
  backdrop.classList.add("visible");
});
el("btnPanelRight").addEventListener("click", () => {
  panelLeft.classList.remove("open");
  panelRight.classList.add("open");
  backdrop.classList.add("visible");
});
backdrop.addEventListener("click", closeDrawers);
document.querySelectorAll("[data-close-panel]").forEach((btn) =>
  btn.addEventListener("click", closeDrawers)
);

// ---- export PNG ----
el("btnExportPng").addEventListener("click", () => {
  if (!renderer.data) return;
  const composite = renderer.exportComposite();
  const link = document.createElement("a");
  link.download = `map-${currentState().seed}.png`;
  link.href = composite.toDataURL("image/png");
  link.click();
});

// ---- save / load JSON ----
el("btnSave").addEventListener("click", () => {
  if (!renderer.data) return;
  const payload = {
    state: currentState(),
    paletteKey: renderer.paletteKey,
    elevation: Array.from(renderer.data.elevation),
    bands: Array.from(renderer.data.bands),
    overrides: Array.from(renderer.overrides),
    rivers: renderer.data.rivers,
    labels: renderer.data.labels,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const link = document.createElement("a");
  link.download = `map-${currentState().seed}.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
});

el("btnLoad").addEventListener("click", () => el("fileLoad").click());
el("fileLoad").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const payload = JSON.parse(reader.result);
    const s = payload.state;
    el("seed").value = s.seed;
    el("mapSize").value = s.mapSize;
    el("islandCount").value = s.islandCount;
    el("islandCountOut").textContent = s.islandCount;
    el("islandSize").value = s.islandSize;
    el("islandSizeOut").textContent = Number(s.islandSize).toFixed(2);
    el("roughness").value = s.roughness;
    el("roughnessOut").textContent = Number(s.roughness).toFixed(2);
    el("seaLevel").value = s.seaLevel;
    el("seaLevelOut").textContent = Number(s.seaLevel).toFixed(2);

    renderer.resize(s.width, s.height);
    overlayCanvas.width = s.width * CELL_SIZE;
    overlayCanvas.height = s.height * CELL_SIZE;

    renderer.setPalette(payload.paletteKey);
    document.querySelectorAll(".palette-swatch").forEach((n) =>
      n.classList.toggle("active", n.dataset.key === payload.paletteKey)
    );

    renderer.setData({
      width: s.width,
      height: s.height,
      seaLevel: s.seaLevel,
      elevation: Float32Array.from(payload.elevation),
      bands: Uint8Array.from(payload.bands),
      rivers: payload.rivers,
      labels: payload.labels,
    });
    renderer.overrides = Int16Array.from(payload.overrides);
    renderer.drawAll();
    syncStatus();
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ---- init ----
regenerate();
editor.applyTransform();
