// Palette definitions and layered canvas rendering.

const PALETTES = {
  classic: {
    label: "Классический атлас",
    colors: {
      [BAND.DEEP_WATER]: "#2f6690",
      [BAND.SHALLOW_WATER]: "#4f8fb8",
      [BAND.SAND]: "#e8dfb0",
      [BAND.GRASS_LIGHT]: "#c3d99a",
      [BAND.GRASS_MID]: "#9dc178",
      [BAND.GRASS_DARK]: "#799c5c",
      [BAND.HILLS]: "#b39a63",
      [BAND.MOUNTAIN]: "#8a6f4a",
      [BAND.PEAK]: "#a9a1a6",
    },
    river: "#3a7ca5",
    grid: "#0b1520",
    label: "#2c2416",
  },
  volcanic: {
    label: "Вулканический",
    colors: {
      [BAND.DEEP_WATER]: "#1c3d52",
      [BAND.SHALLOW_WATER]: "#2c5b73",
      [BAND.SAND]: "#8a7a5c",
      [BAND.GRASS_LIGHT]: "#6f7a4a",
      [BAND.GRASS_MID]: "#5a5c3c",
      [BAND.GRASS_DARK]: "#4a4230",
      [BAND.HILLS]: "#6b3f30",
      [BAND.MOUNTAIN]: "#4a2a22",
      [BAND.PEAK]: "#c9573f",
    },
    river: "#e8834a",
    grid: "#0b1013",
    label: "#f0e2d0",
  },
  arctic: {
    label: "Арктика",
    colors: {
      [BAND.DEEP_WATER]: "#3a6a8a",
      [BAND.SHALLOW_WATER]: "#6b9cb8",
      [BAND.SAND]: "#dce6e6",
      [BAND.GRASS_LIGHT]: "#c9d9d2",
      [BAND.GRASS_MID]: "#a9c2bc",
      [BAND.GRASS_DARK]: "#8aa89f",
      [BAND.HILLS]: "#c4c9cf",
      [BAND.MOUNTAIN]: "#a3aab3",
      [BAND.PEAK]: "#f2f5f7",
    },
    river: "#7fb3cf",
    grid: "#1a2a33",
    label: "#1e2a2e",
  },
  desert: {
    label: "Пустынные острова",
    colors: {
      [BAND.DEEP_WATER]: "#3d7a94",
      [BAND.SHALLOW_WATER]: "#5fa0b8",
      [BAND.SAND]: "#edd9a3",
      [BAND.GRASS_LIGHT]: "#e0c584",
      [BAND.GRASS_MID]: "#cbab63",
      [BAND.GRASS_DARK]: "#b08e4c",
      [BAND.HILLS]: "#9c6f42",
      [BAND.MOUNTAIN]: "#7a5236",
      [BAND.PEAK]: "#b3a394",
    },
    river: "#4f8fa8",
    grid: "#241a10",
    label: "#3a2a18",
  },
};

class Renderer {
  constructor(layers, cellSize) {
    this.layers = layers; // { terrain, relief, rivers, grid, labels }
    this.cellSize = cellSize;
    this.paletteKey = "classic";
    this.visible = { terrain: true, relief: true, rivers: true, grid: false, labels: true };
    this.data = null;
    this.overrides = null;
  }

  get palette() {
    return PALETTES[this.paletteKey];
  }

  setData(data) {
    this.data = data;
    this.overrides = new Int16Array(data.width * data.height).fill(-1);
  }

  setPalette(key) {
    this.paletteKey = key;
  }

  setLayerVisible(name, v) {
    this.visible[name] = v;
    this.layers[name].canvas.style.display = v ? "" : "none";
  }

  resize(gridW, gridH) {
    const px = gridW * this.cellSize;
    const py = gridH * this.cellSize;
    for (const key in this.layers) {
      const c = this.layers[key].canvas;
      c.width = px;
      c.height = py;
    }
  }

  bandAt(i) {
    if (this.overrides[i] >= 0) return this.overrides[i];
    return this.data.bands[i];
  }

  drawAll() {
    this.drawTerrain();
    this.drawRelief();
    this.drawRivers();
    this.drawGrid();
    this.drawLabels();
  }

  drawTerrain() {
    const { width, height } = this.data;
    const ctx = this.layers.terrain.ctx;
    const cs = this.cellSize;
    const colors = this.palette.colors;
    ctx.clearRect(0, 0, width * cs, height * cs);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        ctx.fillStyle = colors[this.bandAt(i)];
        ctx.fillRect(x * cs, y * cs, cs, cs);
      }
    }
  }

  drawRelief() {
    const { width, height, elevation, seaLevel } = this.data;
    const ctx = this.layers.relief.ctx;
    const cs = this.cellSize;
    ctx.clearRect(0, 0, width * cs, height * cs);
    ctx.strokeStyle = "rgba(40,30,20,0.35)";
    ctx.lineWidth = Math.max(1, cs * 0.15);
    const rng = createRng(this.paletteKey + "relief");
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const band = this.bandAt(i);
        if (band !== BAND.MOUNTAIN && band !== BAND.PEAK) continue;
        if (rng() > 0.55) continue;
        const cx = x * cs + cs / 2;
        const cy = y * cs + cs / 2;
        const len = cs * 0.6;
        ctx.beginPath();
        ctx.moveTo(cx - len / 2, cy + len / 2);
        ctx.lineTo(cx + len / 2, cy - len / 2);
        ctx.stroke();
      }
    }
  }

  drawRivers() {
    const { width, height, rivers } = this.data;
    const ctx = this.layers.rivers.ctx;
    const cs = this.cellSize;
    ctx.clearRect(0, 0, width * cs, height * cs);
    ctx.strokeStyle = this.palette.river;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of rivers) {
      if (path.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(path[0].x * cs + cs / 2, path[0].y * cs + cs / 2);
      for (let i = 1; i < path.length; i++) {
        const t = i / path.length;
        ctx.lineWidth = Math.max(1, cs * (0.25 + t * 0.5));
        ctx.lineTo(path[i].x * cs + cs / 2, path[i].y * cs + cs / 2);
      }
      ctx.stroke();
    }
  }

  drawGrid() {
    const { width, height } = this.data;
    const ctx = this.layers.grid.ctx;
    const cs = this.cellSize;
    ctx.clearRect(0, 0, width * cs, height * cs);
    ctx.strokeStyle = this.palette.grid;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    const step = Math.max(4, Math.round(width / 20));
    for (let x = 0; x <= width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x * cs, 0);
      ctx.lineTo(x * cs, height * cs);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y * cs);
      ctx.lineTo(width * cs, y * cs);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawLabels() {
    const { labels } = this.data;
    const ctx = this.layers.labels.ctx;
    const cs = this.cellSize;
    ctx.clearRect(0, 0, this.layers.labels.canvas.width, this.layers.labels.canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const l of labels) {
      const fontSize = Math.max(11, Math.min(20, Math.sqrt(l.size) * 0.9));
      ctx.font = `italic 600 ${fontSize}px 'Cormorant Garamond', serif`;
      const cx = l.x * cs;
      const cy = l.y * cs;
      ctx.lineWidth = Math.max(2, fontSize * 0.22);
      ctx.strokeStyle = "rgba(255,250,235,0.75)";
      ctx.strokeText(l.name, cx, cy);
      ctx.fillStyle = this.palette.label;
      ctx.fillText(l.name, cx, cy);
    }
  }

  exportComposite() {
    const { width, height } = this.data;
    const cs = this.cellSize;
    const out = document.createElement("canvas");
    out.width = width * cs;
    out.height = height * cs;
    const ctx = out.getContext("2d");
    const order = ["terrain", "relief", "rivers", "grid", "labels"];
    for (const key of order) {
      if (!this.visible[key]) continue;
      ctx.drawImage(this.layers[key].canvas, 0, 0);
    }
    return out;
  }
}
