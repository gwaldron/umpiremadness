// The ballpark: everything that doesn't move (plus the crowd, which cheers).
import * as THREE from 'three';
import { paintField, wallTexture, chainLinkTexture, scoreboardCanvas, paintScoreboard, cloudTexture, glowTexture } from './textures.js';

const R2 = Math.SQRT1_2;
const B = 60 * R2;
const FENCE_R = 200;

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A vertical strip following an arc (used for the outfield wall, rails, fences).
function arcStrip(r, a0, a1, z0, z1, segs) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, a = a0 + (a1 - a0) * t;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    pos.push(x, y, z0, x, y, z1);
    uv.push(1 - t, 0, 1 - t, 1);
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A straight vertical strip between two ground points.
function wallStrip(p0, p1, z0, z1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([p0.x, p0.y, z0, p1.x, p1.y, z0, p0.x, p0.y, z1, p1.x, p1.y, z1], 3));
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len / 3, 0, 0, (z1 - z0) / 3, len / 3, (z1 - z0) / 3], 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.computeVertexNormals();
  return g;
}

function box(w, d, h, mat, x, y, z, rotZ = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.position.set(x, y, z + h / 2);
  m.rotation.z = rotZ;
  return m;
}

export class Stadium {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;
    const group = new THREE.Group();
    this.group = group;
    scene.add(group);
    const aniso = engine.maxAniso;
    const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

    // ---- Ground ----
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), lam('#2e6b30'));
    outer.position.z = -0.08;
    outer.receiveShadow = true;
    group.add(outer);

    const plane = (region, ppf, z, order) => {
      const tex = paintField(region, ppf);
      tex.anisotropy = aniso;
      const w = region.x1 - region.x0, h = region.y1 - region.y0;
      const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 4 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(region.x0 + w / 2, region.y0 + h / 2, z);
      m.receiveShadow = true;
      m.renderOrder = order;
      group.add(m);
      return m;
    };
    plane({ x0: -256, x1: 256, y0: -110, y1: 300 }, 4, 0, 1);
    plane({ x0: -64, x1: 64, y0: -24, y1: 104 }, 16, 0.01, 2);
    plane({ x0: -8, x1: 8, y0: -8, y1: 8 }, 64, 0.02, 3);

    // ---- Mound, rubber, bases, plate ----
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 5.6, 0.5, 40), lam('#c48246'));
    mound.rotation.x = Math.PI / 2;
    mound.position.set(0, 46, 0.25);
    mound.receiveShadow = true;
    group.add(mound);
    const white = lam('#fbfbf6');
    group.add(box(2, 0.5, 0.08, white, 0, 46.2, 0.5));
    for (const [x, y] of [[B - 0.9, B], [0, 2 * B], [-B + 0.9, B]]) {
      const b = box(1.25, 1.25, 0.28, white, x, y, 0);
      b.castShadow = true;
      b.receiveShadow = true;
      group.add(b);
    }
    const hp = new THREE.Shape();
    hp.moveTo(0, 0); hp.lineTo(0.708, 0.706); hp.lineTo(0.708, 1.414); hp.lineTo(-0.708, 1.414); hp.lineTo(-0.708, 0.706); hp.closePath();
    const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(hp, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }), white);
    plate.position.z = 0.0;
    plate.receiveShadow = true;
    group.add(plate);

    // ---- Outfield wall with ads, top rail, foul poles ----
    const a0 = Math.PI * 0.25, a1 = Math.PI * 0.75;
    const wall = new THREE.Mesh(arcStrip(FENCE_R, a0, a1, 0, 6, 96), new THREE.MeshLambertMaterial({ map: wallTexture(), side: THREE.DoubleSide }));
    wall.material.map.anisotropy = aniso;
    wall.receiveShadow = true;
    group.add(wall);
    const rail = new THREE.Mesh(arcStrip(FENCE_R - 0.15, a0, a1, 6, 6.6, 96), lam('#f2c230', { side: THREE.DoubleSide }));
    group.add(rail);
    const back = new THREE.Mesh(arcStrip(FENCE_R + 1.2, a0, a1, 0, 6.6, 96), lam('#173d22', { side: THREE.DoubleSide }));
    group.add(back);
    // batter's eye
    const eye = new THREE.Mesh(arcStrip(FENCE_R + 18, Math.PI * 0.46, Math.PI * 0.54, 0, 22, 8), lam('#123221', { side: THREE.DoubleSide }));
    group.add(eye);
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 34, 10), lam('#ffd400'));
      pole.rotation.x = Math.PI / 2;
      pole.position.set(sx * FENCE_R * R2, FENCE_R * R2, 17);
      group.add(pole);
    }

    // ---- Chain-link: foul-side fences and backstop ----
    const link = chainLinkTexture();
    const linkMat = (rep) => {
      const t = link.clone();
      t.needsUpdate = true;
      t.repeat.set(rep.x, rep.y);
      return new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: '#c9d2d8' });
    };
    const postMat = lam('#7b8794');
    const fenceAlong = (side) => {
      const u = { x: side * R2, y: R2 }, n = { x: side * R2, y: -R2 };
      const P = (s, d) => ({ x: u.x * s + n.x * d, y: u.y * s + n.y * d });
      const p0 = P(26, 25), p1 = P(FENCE_R + 5, 25);
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const m = new THREE.Mesh(wallStrip(p0, p1, 0, 4.5), linkMat({ x: len / 1.2, y: 4.5 / 1.2 }));
      group.add(m);
      const railM = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 6), postMat);
      railM.position.set((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 4.5);
      railM.rotation.z = Math.atan2(p1.y - p0.y, p1.x - p0.x) - Math.PI / 2;
      group.add(railM);
      for (let s = 26; s <= FENCE_R + 5; s += 12) {
        const p = P(s, 25);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.6, 6), postMat);
        post.rotation.x = Math.PI / 2;
        post.position.set(p.x, p.y, 2.3);
        group.add(post);
      }
    };
    fenceAlong(-1);
    fenceAlong(1);
    // backstop behind home (tall chain-link arc)
    const bsR = 36;
    const bs = new THREE.Mesh(arcStrip(bsR, Math.PI * 1.18, Math.PI * 1.82, 0, 14, 24), linkMat({ x: 70, y: 12 }));
    group.add(bs);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * 1.18 + (Math.PI * 0.64 * i) / 6;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 14.2, 6), postMat);
      post.rotation.x = Math.PI / 2;
      post.position.set(Math.cos(a) * bsR, Math.sin(a) * bsR, 7.1);
      group.add(post);
    }
    // padded wall at the base of the backstop
    group.add(new THREE.Mesh(arcStrip(bsR - 0.2, Math.PI * 1.18, Math.PI * 1.82, 0, 3, 24), lam('#1d2b53', { side: THREE.DoubleSide })));

    // ---- Dugouts ----
    for (const side of [-1, 1]) {
      const u = { x: side * R2, y: R2 }, n = { x: side * R2, y: -R2 };
      const P = (s, d) => ({ x: u.x * s + n.x * d, y: u.y * s + n.y * d });
      // local +y points at the field, local -y away from it
      const rot = Math.atan2(n.x, -n.y);
      const c = P(17, 30);
      const dug = new THREE.Group();
      dug.position.set(c.x, c.y, 0);
      dug.rotation.z = rot;
      const wallM = lam('#3a4560');
      const roofM = lam(side > 0 ? '#c62f3d' : '#2f62c6');
      dug.add(box(18, 0.6, 7, wallM, 0, -3.4, 0));
      dug.add(box(0.6, 7, 7, wallM, -9, 0, 0));
      dug.add(box(0.6, 7, 7, wallM, 9, 0, 0));
      dug.add(box(19, 8, 0.6, roofM, 0, 0, 7));
      dug.add(box(18, 6.6, 2.6, lam('#2a3346'), 0, -0.2, 0));
      dug.add(box(16, 1.2, 0.4, lam('#8a6a44'), 0, -2.2, 2.0));
      dug.children.forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
      group.add(dug);
    }

    // ---- Bleachers + crowd ----
    const plankA = lam('#c7ced9'), plankB = lam('#aab4c3'), riser = lam('#7d8696');
    this.fans = [];
    const rnd = mulberry(42);
    for (const side of [-1, 1]) {
      const u = { x: side * R2, y: R2 }, n = { x: side * R2, y: -R2 };
      const P = (s, d) => ({ x: u.x * s + n.x * d, y: u.y * s + n.y * d });
      const rot = Math.atan2(u.y, u.x);
      const s0 = 34, s1 = 112, mid = (s0 + s1) / 2, len = s1 - s0;
      for (let r = 0; r < 6; r++) {
        const d = 31 + r * 3, z = 1.2 + r * 1.4;
        const c = P(mid, d + 1.5);
        const step = box(len, 3, 0.35, r % 2 ? plankA : plankB, c.x, c.y, z - 0.35, rot);
        step.receiveShadow = true;
        step.castShadow = true;
        group.add(step);
        const rs = box(len, 0.25, z, riser, P(mid, d).x, P(mid, d).y, 0, rot);
        group.add(rs);
        for (let s = s0 + 1.2; s < s1 - 1; s += 2.1) {
          if (rnd() < 0.24) continue;
          const p = P(s + (rnd() - 0.5) * 0.5, d + 1.6);
          this.fans.push({ x: p.x, y: p.y, z, ph: rnd() * 6.28, sp: 0.8 + rnd() * 0.6, faceRot: rot });
        }
      }
      // back wall of the stands
      const bw = box(len, 0.4, 10, riser, P(mid, 49).x, P(mid, 49).y, 0, rot);
      group.add(bw);
    }
    const nf = this.fans.length;
    const shirtPalette = ['#d62839', '#1f5fe0', '#f4f6fa', '#ffd34d', '#2fd67b', '#ff7a1a', '#7b3fe4', '#1f2937', '#e85d9b', '#38bdf8', '#0b1530'];
    const skinPalette = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a86b3c'];
    this.fanBodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.62, 2.0, 8), engine.toon('#ffffff'), nf);
    this.fanHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), engine.toon('#ffffff'), nf);
    this.fanArms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1.4, 6), engine.toon('#ffffff'), nf * 2);
    const col = new THREE.Color();
    this.fans.forEach((f, i) => {
      f.shirt = shirtPalette[(rnd() * shirtPalette.length) | 0];
      f.skin = skinPalette[(rnd() * skinPalette.length) | 0];
      this.fanBodies.setColorAt(i, col.set(f.shirt));
      this.fanHeads.setColorAt(i, col.set(f.skin));
      this.fanArms.setColorAt(i * 2, col.set(f.skin));
      this.fanArms.setColorAt(i * 2 + 1, col.set(f.skin));
    });
    for (const m of [this.fanBodies, this.fanHeads, this.fanArms]) {
      m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(m);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.updateCrowd(0, 0);

    // ---- Trees, hills ----
    const nt = 70;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1.1, 1, 6), lam('#5b3a1e'), nt);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), lam('#ffffff', { flatShading: true }), nt * 2);
    for (let i = 0; i < nt; i++) {
      const a = Math.PI * 0.12 + Math.PI * 0.76 * (i / (nt - 1)) + (rnd() - 0.5) * 0.02;
      const r = 236 + rnd() * 70;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const h = 22 + rnd() * 26, w = 9 + rnd() * 9;
      this._m.compose(this._v.set(x, y, h * 0.2), this._q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), this._s.set(1, h * 0.4, 1));
      trunks.setMatrixAt(i, this._m);
      for (let k = 0; k < 2; k++) {
        this._m.compose(this._v.set(x + (rnd() - 0.5) * 4, y + (rnd() - 0.5) * 4, h * (0.55 + k * 0.25)), this._q.identity(), this._s.set(w * (1 - k * 0.3), w * (1 - k * 0.3), h * (0.38 - k * 0.1)));
        crowns.setMatrixAt(i * 2 + k, this._m);
        crowns.setColorAt(i * 2 + k, col.set(['#2a6e33', '#317a38', '#24612d', '#3a8540'][(rnd() * 4) | 0]));
      }
    }
    group.add(trunks, crowns);
    const hillGeo = new THREE.CylinderGeometry(900, 900, 1, 64, 1, true);
    const hp2 = hillGeo.attributes.position;
    for (let i = 0; i < hp2.count; i++) {
      if (hp2.getY(i) > 0) hp2.setY(i, 30 + Math.sin(i * 0.37) * 18 + Math.sin(i * 1.3) * 8);
      else hp2.setY(i, -2);
    }
    hillGeo.computeVertexNormals();
    const hills = new THREE.Mesh(hillGeo, lam('#4c7a52', { side: THREE.BackSide }));
    hills.rotation.x = Math.PI / 2;
    group.add(hills);

    // ---- Light towers ----
    this.glows = [];
    const glowTex = glowTexture();
    for (const [x, y] of [[-95, 5], [95, 5], [-165, 175], [165, 175]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 72, 8), lam('#6b7585'));
      pole.rotation.x = Math.PI / 2;
      pole.position.set(x, y, 36);
      group.add(pole);
      const bank = new THREE.Group();
      bank.position.set(x, y, 74);
      bank.rotation.z = Math.atan2(-x, -(40 - y));
      bank.add(box(14, 1.5, 8, lam('#3b4252'), 0, 0, -4));
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(1.2, 12), new THREE.MeshBasicMaterial({ color: '#fff6d8' }));
        lamp.position.set(-4.5 + i * 3, -0.8, -2 + j * -3.6);
        lamp.rotation.x = Math.PI / 2;
        bank.add(lamp);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff6d8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.scale.set(60, 60, 1);
      glow.position.set(0, -3, -4);
      bank.add(glow);
      this.glows.push(glow);
      group.add(bank);
    }

    // ---- Scoreboard ----
    this.sbCanvas = scoreboardCanvas();
    paintScoreboard(this.sbCanvas, {});
    this.sbTex = new THREE.CanvasTexture(this.sbCanvas);
    this.sbTex.colorSpace = THREE.SRGBColorSpace;
    this.sbTex.anisotropy = aniso;
    const sb = new THREE.Group();
    sb.position.set(-118, 238, 0);
    sb.rotation.z = Math.atan2(-238, 118) + Math.PI / 2;
    sb.add(box(1.5, 1.5, 16, lam('#3b3f48'), -16, 0, 0));
    sb.add(box(1.5, 1.5, 16, lam('#3b3f48'), 16, 0, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshBasicMaterial({ map: this.sbTex, toneMapped: false }));
    face.rotation.x = Math.PI / 2;
    face.position.set(0, -0.8, 27);
    sb.add(box(46, 1.4, 24, lam('#10213f'), 0, 0, 15));
    sb.add(face);
    group.add(sb);
    this.sbKey = '';

    // ---- Clouds ----
    const ct = cloudTexture();
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }));
      const a = Math.PI * (0.05 + 0.9 * rnd());
      const r = 1200 + rnd() * 400;
      s.position.set(Math.cos(a) * r, Math.sin(a) * r, 220 + rnd() * 260);
      const k = 260 + rnd() * 260;
      s.scale.set(k * 2, k, 1);
      s.userData.a = a; s.userData.r = r;
      group.add(s);
      this.clouds.push(s);
    }
  }

  updateCrowd(t, excite) {
    const m = this._m, q = this._q, v = this._v, s = this._s;
    const up = this._up || (this._up = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    const eul = this._eul || (this._eul = new THREE.Euler());
    this.fans.forEach((f, i) => {
      const hop = excite > 0.05 ? Math.max(0, Math.sin(t * 9 * f.sp + f.ph)) * 1.3 * excite : Math.sin(t * 1.2 * f.sp + f.ph) * 0.05;
      const z = f.z + hop;
      m.compose(v.set(f.x, f.y, z + 1.0), up, s.set(1, 1, 1));
      this.fanBodies.setMatrixAt(i, m);
      m.compose(v.set(f.x, f.y, z + 2.45), q.identity(), s.set(1, 1, 1));
      this.fanHeads.setMatrixAt(i, m);
      // arms: down at sides, or up when cheering
      const armsUp = excite > 0.3;
      for (let k = 0; k < 2; k++) {
        const sx = k ? 1 : -1;
        const ox = Math.cos(f.faceRot) * 0.62 * sx, oy = Math.sin(f.faceRot) * 0.62 * sx;
        const tilt = armsUp ? 0.35 * sx : 0.1 * sx;
        q.setFromEuler(eul.set(Math.PI / 2, tilt, f.faceRot));
        m.compose(v.set(f.x + ox * (armsUp ? 1.2 : 1), f.y + oy * (armsUp ? 1.2 : 1), z + (armsUp ? 2.7 : 1.1)), armsUp ? q : up, s.set(1, 1, 1));
        this.fanArms.setMatrixAt(i * 2 + k, m);
      }
    });
    this.fanBodies.instanceMatrix.needsUpdate = true;
    this.fanHeads.instanceMatrix.needsUpdate = true;
    this.fanArms.instanceMatrix.needsUpdate = true;
  }

  update(dt, t, info = {}) {
    this.updateCrowd(t, info.excite || 0);
    for (const c of this.clouds) {
      c.userData.a += dt * 0.002;
      c.position.x = Math.cos(c.userData.a) * c.userData.r;
      c.position.y = Math.sin(c.userData.a) * c.userData.r;
    }
    const night = !!this.engine.night;
    for (const gl of this.glows) gl.material.opacity = night ? 0.95 : 0.0;
    if (this._night !== night) {
      this._night = night;
      for (const c of this.clouds) { c.material.color.set(night ? '#3a4470' : '#ffffff'); c.material.opacity = night ? 0.5 : 0.9; }
    }
    const key = JSON.stringify(info.board || {});
    if (key !== this.sbKey) {
      this.sbKey = key;
      paintScoreboard(this.sbCanvas, info.board || {});
      this.sbTex.needsUpdate = true;
    }
  }
}
