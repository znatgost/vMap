// Procedural terrain generation: island mask + fractal noise -> elevation grid,
// biome classification, coastal fringing, rivers, landmass naming.

const BAND = {
  DEEP_WATER: 0,
  SHALLOW_WATER: 1,
  SAND: 2,
  GRASS_LIGHT: 3,
  GRASS_MID: 4,
  GRASS_DARK: 5,
  HILLS: 6,
  MOUNTAIN: 7,
  PEAK: 8,
};

const NAME_SYLLABLES = {
  pre: ["Ar", "El", "Vor", "Tha", "Kel", "Bran", "Os", "Nal", "Dor", "Sil", "Mor", "Fen", "Al", "Wyn"],
  mid: ["a", "en", "or", "ith", "ar", "on", "in", "al", "es", "an"],
  post: ["mar", "dale", "wick", "hollow", "moor", "reach", "haven", "shore", "fen", "crag", "vale"],
};

function makeGrid(w, h, fill = 0) {
  const g = new Float32Array(w * h);
  if (fill) g.fill(fill);
  return g;
}

class MapGenerator {
  constructor(opts) {
    this.w = opts.width;
    this.h = opts.height;
    this.seed = opts.seed;
    this.islandCount = opts.islandCount;
    this.islandSize = opts.islandSize; // 0..1
    this.roughness = opts.roughness; // 0..1
    this.seaLevel = opts.seaLevel; // 0..1
    this.rng = createRng(this.seed + "::gen");
    this.noise = new GradientNoise(this.seed);
  }

  idx(x, y) {
    return y * this.w + x;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  generate() {
    const { w, h } = this;
    const height = makeGrid(w, h);
    const minDim = Math.min(w, h);

    const centers = [];
    const mainCount = Math.max(1, this.islandCount);
    for (let i = 0; i < mainCount; i++) {
      const cx = minDim * 0.15 + this.rng() * (w - minDim * 0.3) * (w / minDim === w / minDim ? 1 : 1);
      const cyBase = this.rng() * h;
      const px = 0.1 * w + this.rng() * 0.8 * w;
      const py = 0.1 * h + this.rng() * 0.8 * h;
      const radius = minDim * (0.12 + this.islandSize * 0.22) * (0.7 + this.rng() * 0.6);
      centers.push({ x: px, y: py, r: radius });

      const satellites = Math.floor(this.rng() * 3);
      for (let s = 0; s < satellites; s++) {
        const ang = this.rng() * Math.PI * 2;
        const dist = radius * (0.9 + this.rng() * 1.1);
        const sr = radius * (0.2 + this.rng() * 0.35);
        centers.push({
          x: px + Math.cos(ang) * dist,
          y: py + Math.sin(ang) * dist,
          r: sr,
        });
      }
    }

    const noiseScale = 0.015 + this.roughness * 0.03;
    const octaves = 3 + Math.round(this.roughness * 3);

    let maxH = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let mask = 0;
        for (const c of centers) {
          const dx = (x - c.x) / c.r;
          const dy = (y - c.y) / c.r;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 1) {
            const contrib = Math.pow(1 - d * d, 2);
            if (contrib > mask) mask = contrib;
          }
        }
        const n = this.noise.fractal(x, y, {
          octaves,
          persistence: 0.5,
          lacunarity: 2.1,
          scale: noiseScale,
        });
        const nNorm = (n + 1) / 2;
        let elev = mask * (0.6 + 0.4 * nNorm) + nNorm * 0.18 * this.roughness;
        elev = Math.max(0, elev);
        height[this.idx(x, y)] = elev;
        if (elev > maxH) maxH = elev;
      }
    }
    if (maxH <= 0) maxH = 1;
    for (let i = 0; i < height.length; i++) height[i] /= maxH;

    this.height = height;
    this.classify();
    this.traceRivers();
    this.nameLandmasses();
    return {
      width: w,
      height: h,
      seaLevel: this.seaLevel,
      elevation: this.height,
      bands: this.bands,
      rivers: this.rivers,
      labels: this.labels,
    };
  }

  classify() {
    const { w, h, height, seaLevel } = this;
    const bands = new Uint8Array(w * h);
    const isLand = (x, y) => height[this.idx(x, y)] > seaLevel;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = height[this.idx(x, y)];
        if (e <= seaLevel) {
          bands[this.idx(x, y)] = BAND.DEEP_WATER;
        } else {
          const t = Math.min(1, (e - seaLevel) / (1 - seaLevel));
          if (t < 0.08) bands[this.idx(x, y)] = BAND.SAND;
          else if (t < 0.28) bands[this.idx(x, y)] = BAND.GRASS_LIGHT;
          else if (t < 0.48) bands[this.idx(x, y)] = BAND.GRASS_MID;
          else if (t < 0.62) bands[this.idx(x, y)] = BAND.GRASS_DARK;
          else if (t < 0.76) bands[this.idx(x, y)] = BAND.HILLS;
          else if (t < 0.9) bands[this.idx(x, y)] = BAND.MOUNTAIN;
          else bands[this.idx(x, y)] = BAND.PEAK;
        }
      }
    }

    // coastal sand fringe: low land cells touching water
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.idx(x, y);
        if (bands[i] !== BAND.GRASS_LIGHT && bands[i] !== BAND.GRASS_MID) continue;
        let touchesWater = false;
        for (let dy = -1; dy <= 1 && !touchesWater; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (!this.inBounds(nx, ny)) continue;
            if (!isLand(nx, ny)) { touchesWater = true; break; }
          }
        }
        if (touchesWater && bands[i] === BAND.GRASS_LIGHT) bands[i] = BAND.SAND;
      }
    }

    // shallow water ring
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.idx(x, y);
        if (bands[i] !== BAND.DEEP_WATER) continue;
        let nearLand = false;
        for (let dy = -2; dy <= 2 && !nearLand; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (!this.inBounds(nx, ny)) continue;
            if (isLand(nx, ny)) { nearLand = true; break; }
          }
        }
        if (nearLand) bands[i] = BAND.SHALLOW_WATER;
      }
    }

    this.bands = bands;
  }

  traceRivers() {
    const { w, h, height, seaLevel, bands } = this;
    const candidates = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = height[this.idx(x, y)];
        if (e > seaLevel && (e - seaLevel) / (1 - seaLevel) > 0.55) {
          candidates.push({ x, y, e });
        }
      }
    }
    candidates.sort((a, b) => b.e - a.e);

    const chosen = [];
    const minDist = Math.min(w, h) * 0.12;
    for (const c of candidates) {
      if (chosen.length >= 5) break;
      let ok = true;
      for (const s of chosen) {
        const dx = c.x - s.x, dy = c.y - s.y;
        if (Math.sqrt(dx * dx + dy * dy) < minDist) { ok = false; break; }
      }
      if (ok) chosen.push(c);
    }

    const rivers = [];
    for (const start of chosen) {
      const path = [{ x: start.x, y: start.y }];
      let cx = start.x, cy = start.y;
      let steps = 0;
      const maxSteps = w + h;
      while (steps++ < maxSteps) {
        const curE = height[this.idx(cx, cy)];
        let bestX = cx, bestY = cy, bestE = curE;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (!this.inBounds(nx, ny)) continue;
            const ne = height[this.idx(nx, ny)];
            if (ne < bestE) { bestE = ne; bestX = nx; bestY = ny; }
          }
        }
        if (bestX === cx && bestY === cy) break;
        cx = bestX; cy = bestY;
        path.push({ x: cx, y: cy });
        if (bands[this.idx(cx, cy)] <= BAND.SHALLOW_WATER) break;
      }
      if (path.length > Math.min(w, h) * 0.06) rivers.push(path);
    }
    this.rivers = rivers;
  }

  nameLandmasses() {
    const { w, h, bands } = this;
    const visited = new Uint8Array(w * h);
    const labels = [];
    const rng = this.rng;

    const genName = () => {
      const pre = NAME_SYLLABLES.pre[Math.floor(rng() * NAME_SYLLABLES.pre.length)];
      const mid = NAME_SYLLABLES.mid[Math.floor(rng() * NAME_SYLLABLES.mid.length)];
      const post = NAME_SYLLABLES.post[Math.floor(rng() * NAME_SYLLABLES.post.length)];
      return pre + mid + post;
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.idx(x, y);
        if (visited[i] || bands[i] <= BAND.SHALLOW_WATER) continue;
        // BFS flood fill
        const stack = [[x, y]];
        visited[i] = 1;
        let sumX = 0, sumY = 0, count = 0;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          sumX += cx; sumY += cy; count++;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx, ny = cy + dy;
              if (!this.inBounds(nx, ny)) continue;
              const ni = this.idx(nx, ny);
              if (visited[ni] || bands[ni] <= BAND.SHALLOW_WATER) continue;
              visited[ni] = 1;
              stack.push([nx, ny]);
            }
          }
        }
        if (count < Math.max(6, (w * h) * 0.0008)) continue;
        labels.push({
          x: Math.round(sumX / count),
          y: Math.round(sumY / count),
          name: genName(),
          size: count,
        });
      }
    }
    this.labels = labels;
  }
}
