// Dirt puffs: slides, dives, running on the infield dirt, ball bounces.
import * as THREE from 'three';

const MAX = 600;

export function onDirt(x, y) {
  if (Math.hypot(x, y) <= 11) return true; // home plate circle
  for (const [bx, by] of [[42.4, 42.4], [0, 84.85], [-42.4, 42.4]]) if (Math.hypot(x - bx, y - by) <= 7.5) return true;
  if (Math.hypot(x, y - 46) <= 6) return true; // mound
  const inArc = Math.hypot(x, y - 46) <= 50 && y > Math.abs(x) - 2;
  const inGrass = Math.abs(x) / 38.2 + Math.abs(y - 42.4) / 38.2 < 1;
  return inArc && !inGrass;
}

export class Dust {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.geo = geo;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color('#cfa477') } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; varying float vAlpha; uniform float uScale;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * (0.85 + 0.3 * (0.5 - d)), a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }

  emit(x, y, z, count = 6, { spread = 0.8, up = 1.5, size = 0.9, life = 0.9, speed = 2.5 } = {}) {
    for (let i = 0; i < count; i++) {
      let k = this.n < MAX ? this.n++ : Math.floor(Math.random() * MAX);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.pos[k * 3] = x + Math.cos(a) * r;
      this.pos[k * 3 + 1] = y + Math.sin(a) * r;
      this.pos[k * 3 + 2] = z + Math.random() * 0.3;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[k * 3] = Math.cos(a) * sp;
      this.vel[k * 3 + 1] = Math.sin(a) * sp;
      this.vel[k * 3 + 2] = up * (0.5 + Math.random());
      this.size[k] = size * (0.6 + Math.random() * 0.8);
      this.life[k] = this.max[k] = life * (0.7 + Math.random() * 0.6);
      this.alpha[k] = 0.8;
    }
  }

  update(dt) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const drag = Math.exp(-dt * 3.5);
      // compact live particles to the front
      if (w !== i) {
        for (let c = 0; c < 3; c++) { this.pos[w * 3 + c] = this.pos[i * 3 + c]; this.vel[w * 3 + c] = this.vel[i * 3 + c]; }
        this.size[w] = this.size[i]; this.life[w] = this.life[i]; this.max[w] = this.max[i];
      }
      this.vel[w * 3] *= drag;
      this.vel[w * 3 + 1] *= drag;
      this.vel[w * 3 + 2] = this.vel[w * 3 + 2] * drag - 1.2 * dt;
      this.pos[w * 3] += this.vel[w * 3] * dt;
      this.pos[w * 3 + 1] += this.vel[w * 3 + 1] * dt;
      this.pos[w * 3 + 2] = Math.max(0.05, this.pos[w * 3 + 2] + this.vel[w * 3 + 2] * dt);
      this.size[w] *= 1 + dt * 1.2;
      const k = this.life[w] / this.max[w];
      this.alpha[w] = Math.min(0.75, k * 1.4) * 0.8;
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  setView(heightPx, fovRad) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan(fovRad / 2));
  }
}
