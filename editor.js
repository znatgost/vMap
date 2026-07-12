// Brush editing (raise / lower / paint / erase) plus pan & zoom of the map viewport.

class Editor {
  constructor({ viewport, stage, overlayCanvas, renderer, onChange }) {
    this.viewport = viewport;
    this.stage = stage;
    this.overlay = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d");
    this.renderer = renderer;
    this.onChange = onChange;

    this.mode = "pan";
    this.brushSize = 4;
    this.brushStrength = 0.06;
    this.paintBand = BAND.GRASS_MID;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    this.isPointerDown = false;
    this.isPanning = false;
    this.lastPointer = null;

    this.pointers = new Map();
    this.pinchStartDist = null;
    this.pinchStartZoom = null;
    this.pinchContentPoint = null;
    this.pinchStartPan = null;

    this.bindEvents();
  }

  setMode(mode) {
    this.mode = mode;
  }
  setBrushSize(v) {
    this.brushSize = v;
  }
  setBrushStrength(v) {
    this.brushStrength = v;
  }
  setPaintBand(band) {
    this.paintBand = band;
  }

  applyTransform() {
    this.stage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  zoomBy(factor) {
    const rect = this.viewport.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const prevZoom = this.zoom;
    this.zoom = Math.min(6, Math.max(0.3, this.zoom * factor));
    const ratio = this.zoom / prevZoom;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.applyTransform();
  }

  screenToGrid(clientX, clientY) {
    const rect = this.stage.getBoundingClientRect();
    const cs = this.renderer.cellSize;
    const sx = (clientX - rect.left) / this.zoom;
    const sy = (clientY - rect.top) / this.zoom;
    return { x: Math.floor(sx / cs), y: Math.floor(sy / cs) };
  }

  bindEvents() {
    const el = this.overlay;

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size >= 2) {
        this.isPointerDown = false;
        this.isPanning = false;
        this.startPinch();
        return;
      }

      this.isPointerDown = true;
      const panTrigger = this.mode === "pan" || e.button === 1 || e.shiftKey;
      if (panTrigger) {
        this.isPanning = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      } else {
        this.paintAt(e.clientX, e.clientY);
      }
    });

    el.addEventListener("pointermove", (e) => {
      if (this.pointers.has(e.pointerId)) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (this.pointers.size >= 2) {
        this.updatePinch();
        return;
      }

      if (!this.isPointerDown) {
        this.updateCursorPreview(e.clientX, e.clientY);
        return;
      }
      if (this.isPanning) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.panX += dx;
        this.panY += dy;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.applyTransform();
      } else {
        this.paintAt(e.clientX, e.clientY);
      }
      this.updateCursorPreview(e.clientX, e.clientY);
    });

    const endStroke = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) {
        this.pinchStartDist = null;
      }
      if (this.pointers.size === 0) {
        this.isPointerDown = false;
        this.isPanning = false;
        if (["raise", "lower", "paint", "erase"].includes(this.mode)) {
          this.onChange();
        }
      }
    };
    el.addEventListener("pointerup", endStroke);
    el.addEventListener("pointerleave", endStroke);
    el.addEventListener("pointercancel", endStroke);

    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = this.viewport.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const prevZoom = this.zoom;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoom = Math.min(6, Math.max(0.3, this.zoom * delta));
        const scaleRatio = this.zoom / prevZoom;
        this.panX = mx - (mx - this.panX) * scaleRatio;
        this.panY = my - (my - this.panY) * scaleRatio;
        this.applyTransform();
      },
      { passive: false }
    );
  }

  startPinch() {
    const pts = Array.from(this.pointers.values());
    const [a, b] = pts;
    this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.pinchStartZoom = this.zoom;
    this.pinchStartPan = { x: this.panX, y: this.panY };
    const rect = this.viewport.getBoundingClientRect();
    const cx = (a.x + b.x) / 2 - rect.left;
    const cy = (a.y + b.y) / 2 - rect.top;
    this.pinchContentPoint = {
      x: (cx - this.pinchStartPan.x) / this.pinchStartZoom,
      y: (cy - this.pinchStartPan.y) / this.pinchStartZoom,
    };
  }

  updatePinch() {
    if (!this.pinchStartDist) {
      this.startPinch();
      return;
    }
    const pts = Array.from(this.pointers.values());
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const scaleRatio = dist / this.pinchStartDist;
    this.zoom = Math.min(6, Math.max(0.3, this.pinchStartZoom * scaleRatio));

    const rect = this.viewport.getBoundingClientRect();
    const cx = (a.x + b.x) / 2 - rect.left;
    const cy = (a.y + b.y) / 2 - rect.top;
    this.panX = cx - this.pinchContentPoint.x * this.zoom;
    this.panY = cy - this.pinchContentPoint.y * this.zoom;
    this.applyTransform();
  }

  updateCursorPreview(clientX, clientY) {
    const cs = this.renderer.cellSize;
    const { x, y } = this.screenToGrid(clientX, clientY);
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.mode === "pan") return;
    const r = this.brushSize;
    ctx.strokeStyle = "rgba(201,163,92,0.9)";
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.beginPath();
    ctx.arc((x + 0.5) * cs, (y + 0.5) * cs, r * cs, 0, Math.PI * 2);
    ctx.stroke();
  }

  paintAt(clientX, clientY) {
    const data = this.renderer.data;
    if (!data) return;
    const { x: cx, y: cy } = this.screenToGrid(clientX, clientY);
    const r = this.brushSize;
    const r2 = r * r;
    const { width, height, elevation, seaLevel } = data;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const i = y * width + x;
        const falloff = 1 - Math.sqrt(dist2) / (r || 1);

        if (this.mode === "raise") {
          elevation[i] = Math.min(1.3, elevation[i] + this.brushStrength * falloff);
        } else if (this.mode === "lower") {
          elevation[i] = Math.max(0, elevation[i] - this.brushStrength * falloff);
        } else if (this.mode === "paint") {
          if (falloff > 0.3) this.renderer.overrides[i] = this.paintBand;
        } else if (this.mode === "erase") {
          if (falloff > 0.3) this.renderer.overrides[i] = -1;
        }
      }
    }

    if (this.mode === "raise" || this.mode === "lower") {
      this.reclassifyRegion(cx, cy, r + 1);
    }
    this.renderer.drawTerrain();
    this.renderer.drawRelief();
  }

  reclassifyRegion(cx, cy, r) {
    const data = this.renderer.data;
    const { width, height, elevation, seaLevel, bands } = data;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const i = y * width + x;
        const e = elevation[i];
        if (e <= seaLevel) {
          bands[i] = BAND.DEEP_WATER;
        } else {
          const t = Math.min(1, (e - seaLevel) / (1 - seaLevel));
          if (t < 0.08) bands[i] = BAND.SAND;
          else if (t < 0.28) bands[i] = BAND.GRASS_LIGHT;
          else if (t < 0.48) bands[i] = BAND.GRASS_MID;
          else if (t < 0.62) bands[i] = BAND.GRASS_DARK;
          else if (t < 0.76) bands[i] = BAND.HILLS;
          else if (t < 0.9) bands[i] = BAND.MOUNTAIN;
          else bands[i] = BAND.PEAK;
        }
      }
    }
  }
}
