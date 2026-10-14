// WebGL engine: renderer, lights, sky, and camera syncing with our game Camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final "broadcast" grade: saturation, contrast, vignette, a little film grain.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.1 }, con: { value: 1.05 }, vig: { value: 0.24 }, grain: { value: 0.022 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float sat; uniform float con; uniform float vig; uniform float grain; uniform float time;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, sat);
      col = (col - 0.5) * con + 0.5;
      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * vig * 2.0;
      float n = fract(sin(dot(vUv * (time + 1.7), vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * grain;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export const TOON_STEPS = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 165, 165, 165, 255, 230, 230, 230, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const SKY_VS = `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SKY_FS = `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 bottom;
uniform vec3 sunDir;
uniform float sunAmt;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.z;
  vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(horizon, bottom, pow(clamp(-h, 0.0, 1.0), 0.35));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 3.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08) * sunAmt;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = true;
    this.renderer = renderer;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new THREE.Scene();
    this.scene = scene;
    this.fogColor = new THREE.Color('#cfe4f5');
    scene.fog = new THREE.Fog(this.fogColor, 420, 1500);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.25, 4000);
    camera.up.set(0, 0, 1);
    this.camera = camera;
    this.inset = new THREE.PerspectiveCamera(30, 1, 0.25, 4000);
    this.inset.up.set(0, 0, 1);

    // Lights: sky fill + a warm afternoon sun with shadows
    this.hemi = new THREE.HemisphereLight('#d7ecff', '#5d7d43', 1.25);
    this.hemi.position.set(0, 0, 1);
    scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(-0.42, -0.5, 0.76).normalize();
    const sun = new THREE.DirectionalLight('#fff1d9', 2.6);
    sun.position.copy(this.sunDir).multiplyScalar(400).add(new THREE.Vector3(0, 60, 0));
    sun.target.position.set(0, 60, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 50; sc.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Sky dome
    this.skyUniforms = {
      top: { value: new THREE.Color('#2f7fd6') },
      horizon: { value: new THREE.Color('#cfe4f5') },
      bottom: { value: new THREE.Color('#9fb7a0') },
      sunDir: { value: this.sunDir.clone() },
      sunAmt: { value: 1 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(2500, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    this.sky = sky;

    // Inset (UMP CAM) pixelation helpers
    this.rt = null;
    this.blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blitMat = new THREE.MeshBasicMaterial({ map: null, toneMapped: false });
    this.blitScene = new THREE.Scene();
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat));
    this.cssW = 1;
    this.cssH = 1;
    this.quality = 'high';
  }

  _makeComposer() {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    const comp = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    comp.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.45, 0.96);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    comp.addPass(this.grade);
    this.composer = comp;
    this._sizeComposer();
  }
  _sizeComposer() {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.cssW, this.cssH);
  }

  // 'high' | 'medium' | 'low'
  setQuality(q) {
    this.quality = q;
    if (q === 'high' && !this.composer) {
      try { this._makeComposer(); } catch (e) { console.warn('post-processing unavailable', e); this.composer = null; }
    }
    const sun = this.sun;
    sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    if (this._dpr) this.resize(this.cssW, this.cssH, this._dpr);
  }

  toon(color, extra = {}) {
    return new THREE.MeshToonMaterial({ color, gradientMap: TOON_STEPS, ...extra });
  }

  resize(cssW, cssH, dpr) {
    this.cssW = cssW;
    this.cssH = cssH;
    this._dpr = dpr;
    const cap = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 2;
    const pr = Math.min(dpr, cap, cssW * cssH > 1.2e6 ? 1.5 : 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(cssW, cssH, false);
    this._sizeComposer();
  }

  // Match our game Camera (z-up, vertical fov, screen shake) exactly.
  syncCamera(cam, target = this.camera) {
    target.position.set(cam.eye.x, cam.eye.y, cam.eye.z);
    target.lookAt(cam.target.x, cam.target.y, cam.target.z);
    target.fov = (cam.fovY * 180) / Math.PI;
    target.aspect = cam.w / cam.h;
    const sx = cam.cx - cam.w / 2, sy = cam.cy - cam.h / 2;
    if (Math.abs(sx) > 0.01 || Math.abs(sy) > 0.01) target.setViewOffset(cam.w, cam.h, -sx, -sy, cam.w, cam.h);
    else if (target.view) target.clearViewOffset();
    target.updateProjectionMatrix();
    this.sky.position.copy(target.position);
  }

  render() {
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.cssW, this.cssH);
    if (this.quality === 'high' && this.composer) {
      this.grade.uniforms.time.value = (performance.now() % 100000) / 1000;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // Render the scene from another camera into a rectangle (CSS pixels, top-left origin).
  // block > 1 renders at lower resolution and upscales with chunky pixels.
  renderInset(rect, block = 1) {
    const r = this.renderer;
    const pr = r.getPixelRatio();
    const x = rect.x, y = this.cssH - rect.y - rect.h;
    this.inset.aspect = rect.w / rect.h;
    this.inset.updateProjectionMatrix();
    this.sky.position.copy(this.inset.position);
    if (block <= 1.01) {
      r.setScissorTest(true);
      r.setScissor(x, y, rect.w, rect.h);
      r.setViewport(x, y, rect.w, rect.h);
      r.render(this.scene, this.inset);
      r.setScissorTest(false);
      return;
    }
    const w = Math.max(16, Math.round((rect.w * pr) / block)), h = Math.max(16, Math.round((rect.h * pr) / block));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      if (this.rt) this.rt.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    r.setRenderTarget(this.rt);
    r.setViewport(0, 0, w, h);
    r.render(this.scene, this.inset);
    r.setRenderTarget(null);
    this.blitMat.map = this.rt.texture;
    this.blitMat.needsUpdate = true;
    r.setScissorTest(true);
    r.setScissor(x, y, rect.w, rect.h);
    r.setViewport(x, y, rect.w, rect.h);
    r.render(this.blitScene, this.blitCam);
    r.setScissorTest(false);
  }

  // Night mode for "Under the Lights" games.
  setTimeOfDay(mode = 'day') {
    const u = this.skyUniforms;
    if (mode === 'night') {
      u.top.value.set('#060b1e'); u.horizon.value.set('#28305a'); u.bottom.value.set('#1a2230'); u.sunAmt.value = 0;
      this.hemi.color.set('#9fb2ff'); this.hemi.groundColor.set('#22301e'); this.hemi.intensity = 0.9;
      this.sun.color.set('#e8f0ff'); this.sun.intensity = 1.9;
      this.sun.position.set(30, -60, 300);
      this.scene.fog.color.set('#1a2140');
      if (this.bloom) { this.bloom.strength = 0.85; this.bloom.threshold = 0.62; this.bloom.radius = 0.6; }
    } else {
      if (this.bloom) { this.bloom.strength = 0.16; this.bloom.threshold = 0.96; this.bloom.radius = 0.45; }
      u.top.value.set('#2f7fd6'); u.horizon.value.set('#cfe4f5'); u.bottom.value.set('#9fb7a0'); u.sunAmt.value = 1;
      this.hemi.color.set('#d7ecff'); this.hemi.groundColor.set('#5d7d43'); this.hemi.intensity = 1.25;
      this.sun.color.set('#fff1d9'); this.sun.intensity = 2.6;
      this.sun.position.copy(this.sunDir).multiplyScalar(400).add(new THREE.Vector3(0, 60, 0));
      this.scene.fog.color.copy(this.fogColor);
    }
    this.night = mode === 'night';
  }
}
