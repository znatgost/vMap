// Seeded PRNG (xmur3 hash + mulberry32) and 2D gradient noise, no external deps.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seedStr) {
  const seedFn = xmur3(String(seedStr));
  return mulberry32(seedFn());
}

class GradientNoise {
  constructor(seedStr) {
    const rng = createRng(seedStr);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    this.perm = new Uint8Array(512);
    this.gradX = new Float32Array(512);
    this.gradY = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = perm[i & 255];
      const angle = (this.perm[i] / 255) * Math.PI * 2;
      this.gradX[i] = Math.cos(angle);
      this.gradY[i] = Math.sin(angle);
    }
  }

  static fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  static lerp(a, b, t) {
    return a + t * (b - a);
  }

  noise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const idx00 = this.perm[X + this.perm[Y]];
    const idx10 = this.perm[X + 1 + this.perm[Y]];
    const idx01 = this.perm[X + this.perm[Y + 1]];
    const idx11 = this.perm[X + 1 + this.perm[Y + 1]];

    const dot = (idx, dx, dy) => this.gradX[idx] * dx + this.gradY[idx] * dy;

    const n00 = dot(idx00, xf, yf);
    const n10 = dot(idx10, xf - 1, yf);
    const n01 = dot(idx01, xf, yf - 1);
    const n11 = dot(idx11, xf - 1, yf - 1);

    const u = GradientNoise.fade(xf);
    const v = GradientNoise.fade(yf);

    const nx0 = GradientNoise.lerp(n00, n10, u);
    const nx1 = GradientNoise.lerp(n01, n11, u);
    return GradientNoise.lerp(nx0, nx1, v) * 1.4142;
  }

  fractal(x, y, { octaves = 5, persistence = 0.5, lacunarity = 2, scale = 1 } = {}) {
    let amplitude = 1;
    let frequency = scale;
    let sum = 0;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return sum / maxAmp; // -1..1
  }
}
