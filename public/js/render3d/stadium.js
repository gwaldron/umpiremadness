// The ballpark: everything that doesn't move (plus the crowd, which cheers).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintField, wallTexture, chainLinkTexture, scoreboardCanvas, paintScoreboard, cloudTexture, glowTexture, groundDetailTexture, addGroundDetail, flagTexture } from './textures.js';

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
    // Procedural stand-ins, grouped so the Blender-built kit (models/ballpark.glb) can replace them
    const pg = {};
    for (const k of ['dugouts', 'bleachers', 'backstop', 'towers', 'scoreboard', 'foulPoles', 'trees']) { pg[k] = new THREE.Group(); group.add(pg[k]); }
    this.pg = pg;

    // ---- Ground ----
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), lam('#2e6b30'));
    outer.position.z = -0.08;
    outer.receiveShadow = true;
    group.add(outer);

    const detail = groundDetailTexture();
    detail.anisotropy = aniso;
    this.fieldPlanes = [];
    const plane = (region, ppf, z, order) => {
      const tex = paintField(region, ppf);
      tex.anisotropy = aniso;
      const w = region.x1 - region.x0, h = region.y1 - region.y0;
      const mat = addGroundDetail(new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 4 }), detail);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(region.x0 + w / 2, region.y0 + h / 2, z);
      m.receiveShadow = true;
      m.renderOrder = order;
      group.add(m);
      this.fieldPlanes.push({ m, region, ppf });
      return m;
    };
    plane({ x0: -256, x1: 256, y0: -110, y1: 300 }, 4, 0, 1);
    plane({ x0: -64, x1: 64, y0: -24, y1: 104 }, 16, 0.01, 2);
    plane({ x0: -8, x1: 8, y0: -8, y1: 8 }, 64, 0.02, 3);

    // ---- Mound, rubber, bases, plate ----
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 5.6, 0.5, 40), addGroundDetail(lam('#c48246'), detail));
    mound.rotation.x = Math.PI / 2;
    mound.position.set(0, 46, 0.25);
    mound.receiveShadow = true;
    group.add(mound);
    const white = lam('#fbfbf6');
    this.mound = mound;
    this.moundRubber = box(2, 0.5, 0.08, white, 0, 46.2, 0.5);
    group.add(this.moundRubber);
    // Softball: a flat dirt circle, 16 ft across, chalked, with the pitcher's plate at its center
    const circle = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(8.7, 48), addGroundDetail(lam('#c98a50', { polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -24 }), detail));
    disc.position.z = 0.03;
    disc.receiveShadow = true;
    disc.renderOrder = 4;
    circle.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.88, 8.12, 72), lam('#f4f2ea', { polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -32 }));
    ring.position.z = 0.04;
    ring.renderOrder = 4;
    circle.add(ring);
    const plateSb = box(2, 0.5, 0.06, white, 0, 0.25, 0.02);
    circle.add(plateSb);
    circle.visible = false;
    group.add(circle);
    this.circle = circle;
    this.sport = 'baseball';
    for (const [x, y] of [[B - 0.9, B], [0, 2 * B], [-B + 0.9, B]]) {
      const b = box(1.25, 1.25, 0.28, white, x, y, 0);
      b.castShadow = true;
      b.receiveShadow = true;
      group.add(b);
    }
    // Home plate: 17 in wide, point toward the catcher. A white top on a black rubber base gives it
    // the dark beveled edge a real plate has, so it stands out from the chalk lines.
    const pent = (k) => {
      const sh = new THREE.Shape();
      const P = (x, y) => [x * k, 0.75 + (y - 0.75) * k];
      sh.moveTo(...P(0, 0)); sh.lineTo(...P(0.708, 0.706)); sh.lineTo(...P(0.708, 1.414)); sh.lineTo(...P(-0.708, 1.414)); sh.lineTo(...P(-0.708, 0.706)); sh.closePath();
      return sh;
    };
    const plateBase = new THREE.Mesh(new THREE.ExtrudeGeometry(pent(1.07), { depth: 0.04, bevelEnabled: false }), lam('#1b1c21'));
    plateBase.receiveShadow = true;
    group.add(plateBase);
    const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(pent(0.97), { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 }), white);
    plate.position.z = 0.012;
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
      pg.foulPoles.add(pole);
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
    this.linkMat = linkMat;
    const bs = new THREE.Mesh(arcStrip(bsR, Math.PI * 1.18, Math.PI * 1.82, 0, 14, 24), linkMat({ x: 70, y: 12 }));
    pg.backstop.add(bs);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * 1.18 + (Math.PI * 0.64 * i) / 6;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 14.2, 6), postMat);
      post.rotation.x = Math.PI / 2;
      post.position.set(Math.cos(a) * bsR, Math.sin(a) * bsR, 7.1);
      pg.backstop.add(post);
    }
    // padded wall at the base of the backstop
    pg.backstop.add(new THREE.Mesh(arcStrip(bsR - 0.2, Math.PI * 1.18, Math.PI * 1.82, 0, 3, 24), lam('#1d2b53', { side: THREE.DoubleSide })));

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
      pg.dugouts.add(dug);
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
        pg.bleachers.add(step);
        const rs = box(len, 0.25, z, riser, P(mid, d).x, P(mid, d).y, 0, rot);
        pg.bleachers.add(rs);
        for (let s = s0 + 1.2; s < s1 - 1; s += 2.1) {
          if (rnd() < 0.24) continue;
          if ((s > 57.2 && s < 61.8) || (s > 84.2 && s < 88.8)) continue; // aisles in the kit's bleachers
          const p = P(s + (rnd() - 0.5) * 0.5, d + 2.2);
          this.fans.push({ x: p.x, y: p.y, z, ph: rnd() * 6.28, sp: 0.8 + rnd() * 0.6, faceRot: rot, face: Math.atan2(-n.y, -n.x) });
        }
      }
      // back wall of the stands
      const bw = box(len, 0.4, 10, riser, P(mid, 49).x, P(mid, 49).y, 0, rot);
      pg.bleachers.add(bw);
    }
    const nf = this.fans.length;
    const shirtPalette = ['#d62839', '#1f5fe0', '#f4f6fa', '#ffd34d', '#2fd67b', '#ff7a1a', '#7b3fe4', '#1f2937', '#e85d9b', '#38bdf8', '#0b1530'];
    const skinPalette = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a86b3c'];
    this.fanBodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.62, 2.0, 8), engine.toon('#ffffff'), nf);
    this.fanHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), engine.toon('#ffffff'), nf);
    this.fanArms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1.4, 6), engine.toon('#ffffff'), nf * 2);
    const col = new THREE.Color();
    const pantsPalette = ['#2b4a7a', '#24395e', '#1f2937', '#3a3f47', '#c2b28f', '#5b6b4a'];
    const hairPalette = ['#2b1d14', '#4a2f1b', '#1a1a1a', '#7a4b23', '#c9a25c', '#8b3a1a', '#9a9a9a'];
    const capPalette = ['#d62839', '#1f5fe0', '#d62839', '#1f5fe0', '#1f2937', '#ffd34d'];
    this.fans.forEach((f, i) => {
      f.shirt = shirtPalette[(rnd() * shirtPalette.length) | 0];
      f.skin = skinPalette[(rnd() * skinPalette.length) | 0];
      f.pants = pantsPalette[(rnd() * pantsPalette.length) | 0];
      f.hair = hairPalette[(rnd() * hairPalette.length) | 0];
      f.cap = rnd() < 0.4 ? capPalette[(rnd() * capPalette.length) | 0] : null;
      f.size = rnd() < 0.3 ? 0.8 + rnd() * 0.08 : 0.95 + rnd() * 0.12; // some kids among the grown-ups
      f.oneArm = rnd() < 0.3; // some fans cheer with one fist up
      f.arm = 0;
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
    pg.trees.add(trunks, crowns);
    // where the trees stand (the kit's tree models get instanced at the same spots)
    this.treeSpots = [];
    for (let i = 0; i < nt; i++) {
      const e = trunks.instanceMatrix.array, o = i * 16;
      this.treeSpots.push({ x: e[o + 12], y: e[o + 13], h: Math.hypot(e[o + 4], e[o + 5], e[o + 6]) / 0.4 });
    }
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
      pg.towers.add(pole);
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
      pg.towers.add(bank);
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
    pg.scoreboard.add(sb);
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

    // ---- Flags (cloth waves in the breeze) ----
    this.flags = [];
    const addFlag = (x, y, poleH, w, h, tex, heading, poleColor = '#c9ced8') => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, poleH, 6), lam(poleColor));
      pole.rotation.x = Math.PI / 2;
      pole.position.set(x, y, poleH / 2);
      group.add(pole);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), lam('#ffd34d'));
      ball.position.set(x, y, poleH + 0.4);
      group.add(ball);
      const geo = new THREE.PlaneGeometry(w, h, 18, 6);
      geo.rotateX(Math.PI / 2);
      geo.translate(w / 2, 0, 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      mesh.position.set(x, y, poleH - h / 2 - 0.3);
      mesh.rotation.z = heading;
      group.add(mesh);
      this.flags.push({ geo, base: Float32Array.from(geo.attributes.position.array), w, ph: rnd() * 6 });
    };
    addFlag(-156, 219, 64, 15, 8.5, flagTexture('stars'), -0.35);
    addFlag(-142, 226, 40, 7, 3.6, flagTexture('#1f5fe0'), -0.35);
    addFlag(-94, 250, 40, 7, 3.6, flagTexture('#d62839'), -0.35);

    // ---- Night sky stars ----
    const sp = [];
    for (let i = 0; i < 450; i++) {
      const az = rnd() * Math.PI * 2, el = 0.12 + Math.pow(rnd(), 0.7) * 1.35;
      const r = 1700;
      sp.push(Math.cos(az) * Math.cos(el) * r, Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    this.stars.visible = false;
    group.add(this.stars);

    // ---- Birds circling out past the fence ----
    this.birds = [];
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.5, 0, 0, 0.6, 0, 2.5, -0.1, 0], 3));
    const birdMat = new THREE.MeshBasicMaterial({ color: '#1e2430', side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Group();
      const L = new THREE.Mesh(wingGeo, birdMat);
      const R = new THREE.Mesh(wingGeo, birdMat);
      R.scale.x = -1;
      b.add(L, R);
      group.add(b);
      this.birds.push({ g: b, L, R, cx: -60 + rnd() * 120, cy: 300 + rnd() * 140, cz: 70 + rnd() * 50, r: 40 + rnd() * 60, w: (0.12 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1), a: rnd() * 6.3, ph: rnd() * 6.3 });
    }
  }

  // ---- The Blender-built ballpark kit (art/ballpark.py -> models/ballpark.glb) ----
  // Loads in the background; until it arrives (or if it can't), the procedural stand-ins stay.
  loadKit(url = 'models/ballpark.glb') {
    new GLTFLoader().load(url, (gltf) => {
      try { this._installKit(gltf.scene); } catch (e) { console.warn('Ballpark kit failed to install:', e); }
    }, undefined, (e) => console.warn('Ballpark kit not loaded:', e && e.message));
    this.loadFans();
  }

  // ---- The Blender-built bleacher fan (art/fan.py -> models/fan.glb) ----
  // One instanced mesh per body part, each fan in its own colors. Until it loads, the simple fans stay.
  loadFans(url = 'models/fan.glb') {
    new GLTFLoader().load(url, (gltf) => {
      try { this._installFans(gltf.scene); } catch (e) { console.warn('Fan model failed to install:', e); }
    }, undefined, (e) => console.warn('Fan model not loaded:', e && e.message));
  }

  _installFans(root) {
    root.updateMatrixWorld(true);
    const part = (name) => {
      const node = root.getObjectByName(name);
      let mesh = null;
      node.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      // glTF puts the mesh under the node; its node offset is the pivot (the shoulder for arms)
      return { geo: mesh.geometry, at: new THREE.Matrix4().copy(mesh.matrixWorld) };
    };
    const fans = this.fans;
    const capped = fans.filter((f) => f.cap);
    const col = new THREE.Color();
    const mk = (name, list, color, shadow = true) => {
      const pt = part(name);
      const im = new THREE.InstancedMesh(pt.geo, this.engine.toon('#ffffff'), list.length);
      list.forEach((f, i) => im.setColorAt(i, col.set(color(f))));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = shadow;
      im.receiveShadow = false;
      im.frustumCulled = false;
      this.group.add(im);
      return { im, at: pt.at, list };
    };
    this.fanParts = {
      torso: mk('fan_torso', fans, (f) => f.shirt),
      legs: mk('fan_legs', fans, (f) => f.pants),
      shoes: mk('fan_shoes', fans, () => '#23252b', false),
      head: mk('fan_head', fans, (f) => f.skin),
      hair: mk('fan_hair', fans, (f) => f.hair, false),
      cap: mk('fan_cap', capped, (f) => f.cap, false),
      // arms are too thin to matter in the shadow map
      sleeveL: mk('fan_sleeve_l', fans, (f) => f.shirt, false),
      sleeveR: mk('fan_sleeve_r', fans, (f) => f.shirt, false),
      armL: mk('fan_arm_l', fans, (f) => f.skin, false),
      armR: mk('fan_arm_r', fans, (f) => f.skin, false),
    };
    capped.forEach((f, i) => { f.capIdx = i; });
    for (const m of [this.fanBodies, this.fanHeads, this.fanArms]) m.visible = false;
  }

  _kitMaterial(m, cache) {
    if (cache.has(m.name)) return cache.get(m.name);
    let out;
    if (m.name === 'chainlink') out = this.linkMat({ x: 1, y: 1 });
    else if (m.name === 'lamp') out = new THREE.MeshBasicMaterial({ color: '#fff6d8' });
    else if (m.name === 'sb_face') {
      // glTF UVs run top-down, so the kit's face gets its own unflipped copy of the scoreboard canvas
      this.sbTexKit = new THREE.CanvasTexture(this.sbCanvas);
      this.sbTexKit.flipY = false;
      this.sbTexKit.colorSpace = THREE.SRGBColorSpace;
      this.sbTexKit.anisotropy = this.engine.maxAniso;
      out = new THREE.MeshBasicMaterial({ map: this.sbTexKit, toneMapped: false });
    } else if (m.metalness > 0.4) {
      // aluminum and steel: a soft sheen without needing an environment map
      out = new THREE.MeshPhongMaterial({ color: m.color, specular: new THREE.Color('#8a929c'), shininess: 38 });
    } else out = new THREE.MeshLambertMaterial({ color: m.color });
    out.name = m.name;
    cache.set(m.name, out);
    return out;
  }

  _installKit(root) {
    const cache = new Map();
    const templates = [];
    const banks = {};
    for (const node of [...root.children]) {
      if (node.name.startsWith('lightbank_')) { node.updateWorldMatrix(true, false); banks[node.name] = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld); continue; }
      if (node.name.startsWith('tree_')) { templates.push(node); continue; }
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.material = this._kitMaterial(o.material, cache);
        const flat = o.material.isMeshBasicMaterial, see = o.material.name === 'chainlink';
        o.castShadow = !flat && !see;
        o.receiveShadow = !flat;
      });
      this.group.add(node);
    }
    // the stand-ins go away
    for (const k of ['dugouts', 'bleachers', 'backstop', 'towers', 'scoreboard', 'foulPoles']) this.pg[k].visible = false;
    // night glows move to the kit's lamp banks
    this.glows.forEach((glow, i) => {
      const at = banks[`lightbank_${i}`];
      if (!at) return;
      this.group.add(glow);
      glow.position.copy(at);
    });
    // trees: instance the kit's models at the same spots
    if (templates.length) {
      this.pg.trees.visible = false;
      const rnd = mulberry(99);
      const spots = this.treeSpots.map((t) => ({ ...t, v: (rnd() * templates.length) | 0, rot: rnd() * 6.28, sx: 0.85 + rnd() * 0.3 }));
      const m = new THREE.Matrix4(), base = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
      templates.forEach((tpl, k) => {
        const mine = spots.filter((sp) => sp.v === k);
        if (!mine.length) return;
        tpl.updateWorldMatrix(true, true);
        const inv = new THREE.Matrix4().copy(tpl.matrixWorld).invert();
        tpl.traverse((o) => {
          if (!o.isMesh) return;
          const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
          const im = new THREE.InstancedMesh(o.geometry, this._kitMaterial(o.material, cache), mine.length);
          mine.forEach((sp, i) => {
            const k2 = sp.h / 19;
            base.compose(v.set(sp.x, sp.y, 0), q.setFromAxisAngle(z, sp.rot), sc.set(k2 * sp.sx, k2 * sp.sx, k2));
            im.setMatrixAt(i, m.multiplyMatrices(base, local));
          });
          im.castShadow = true;
          this.group.add(im);
        });
      });
    }
    this.kit = root;
  }

  // Baseball has the raised mound at 46 ft; softball a flat chalked circle at 35 or 40 ft.
  setSport(id, rubber) {
    const sb = id === 'softball';
    this.mound.visible = this.moundRubber.visible = !sb;
    this.circle.visible = sb;
    this.circle.position.set(0, rubber, 0);
    if (this.sport === id) return;
    this.sport = id;
    // repaint the ground where the mound was (the home plate close-up doesn't reach it)
    for (const fp of this.fieldPlanes) {
      if (fp.region.y1 < 40) continue;
      const old = fp.m.material.map;
      const tex = paintField(fp.region, fp.ppf, 1, { softball: sb });
      tex.anisotropy = old.anisotropy;
      fp.m.material.map = tex;
      fp.m.material.needsUpdate = true;
      old.dispose();
    }
  }

  updateAmbience(t) {
    for (const f of this.flags) {
      const pos = f.geo.attributes.position;
      const a = pos.array, base = f.base;
      for (let i = 0; i < a.length; i += 3) {
        const u = base[i] / f.w;
        const z = base[i + 2];
        a[i] = base[i] * (1 - 0.04 * u);
        a[i + 1] = (Math.sin(u * 6.5 - t * 5.2 + f.ph + z * 0.15) * 0.75 + Math.sin(u * 13 - t * 8.3) * 0.18) * u;
        a[i + 2] = z - u * u * 0.5 * (0.6 + 0.4 * Math.sin(t * 0.7 + f.ph));
      }
      pos.needsUpdate = true;
      f.geo.computeVertexNormals();
    }
    const night = !!this.engine.night;
    this.stars.visible = night;
    if (night) this.stars.material.opacity = 0.7 + Math.sin(t * 1.7) * 0.08;
    for (const b of this.birds) {
      b.g.visible = !night;
      if (night) continue;
      const ang = b.a + t * b.w;
      b.g.position.set(b.cx + Math.cos(ang) * b.r, b.cy + Math.sin(ang) * b.r, b.cz + Math.sin(t * 0.3 + b.ph) * 6);
      b.g.rotation.z = ang + (b.w > 0 ? 0 : Math.PI);
      const glide = Math.sin(t * 0.45 + b.ph) > 0.2;
      const flap = glide ? 0.12 : Math.sin(t * 9 + b.ph) * 0.65;
      b.L.rotation.y = -flap;
      b.R.rotation.y = flap;
    }
  }

  updateCrowd(t, excite) {
    if (this.fanParts) { this._updateFans(t, excite); return; }
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

  // Seated fans: a little sway when it's quiet; when the crowd gets loud they hop and swing their arms
  // up into a waving V (some pump just one fist).
  _updateFans(t, excite) {
    const P = this.fanParts;
    const base = this._fb || (this._fb = new THREE.Matrix4());
    const m = this._m, q = this._q, v = this._v, s = this._s;
    const arm = this._fa || (this._fa = new THREE.Matrix4());
    const zAxis = this._zAxis || (this._zAxis = new THREE.Vector3(0, 0, 1));
    const dt = Math.min(0.1, Math.max(0, t - (this._fanT ?? t)));
    this._fanT = t;
    const up = excite > 0.3;
    this.fans.forEach((f, i) => {
      const hop = excite > 0.05 ? Math.max(0, Math.sin(t * 9 * f.sp + f.ph)) * 1.3 * excite : Math.sin(t * 1.2 * f.sp + f.ph) * 0.05;
      f.arm += ((up ? 1 : 0) - f.arm) * Math.min(1, dt * (up ? 9 : 4));
      base.compose(v.set(f.x, f.y, f.z + Math.max(0, hop)), q.setFromAxisAngle(zAxis, f.face - Math.PI / 2), s.set(f.size, f.size, f.size));
      for (const k of ['torso', 'legs', 'shoes', 'head', 'hair']) P[k].im.setMatrixAt(i, m.multiplyMatrices(base, P[k].at));
      if (f.cap) P.cap.im.setMatrixAt(f.capIdx, m.multiplyMatrices(base, P.cap.at));
      // arms swing out to the side at the shoulder (about the fan's forward axis)
      const wave = Math.sin(t * 7 * f.sp + f.ph) * 0.22 * f.arm;
      for (const [sl, sk, sx] of [['sleeveL', 'armL', -1], ['sleeveR', 'armR', 1]]) {
        const lift = f.oneArm && sx < 0 ? 0.15 * f.arm : f.arm;
        const ang = -sx * (lift * 2.7 + wave);
        arm.makeRotationY(ang);
        P[sl].im.setMatrixAt(i, m.multiplyMatrices(base, P[sl].at).multiply(arm));
        P[sk].im.setMatrixAt(i, m.multiplyMatrices(base, P[sk].at).multiply(arm));
      }
    });
    for (const k in P) P[k].im.instanceMatrix.needsUpdate = true;
  }

  update(dt, t, info = {}) {
    this.updateCrowd(t, info.excite || 0);
    this.updateAmbience(t);
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
      if (this.sbTexKit) this.sbTexKit.needsUpdate = true;
    }
  }
}
