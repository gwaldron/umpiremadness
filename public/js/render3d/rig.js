// The Blender-built ballplayer body (art/player.py -> models/player.glb), posed every frame from the
// same joint positions the game already computes for its close-up players (hip, neck, shoulders,
// elbows, hands, knees, feet...). Each bone turns so it runs from its joint to the next one, with a
// twist taken from the body's facing or the limb's bend; bones also stretch to land exactly on the
// joints, so the bat, gloves and gear the game draws on top stay attached.
// The rotation is found by comparing a frame built from the rest pose with the same frame built from
// the target pose, so it doesn't depend on how Blender rolled the bones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { TOON_STEPS } from './engine.js';

// Body regions, in the order art/player.py numbers them (vertex color red = (index + 0.5) / 16)
const REGIONS = ['jersey', 'trim', 'pants', 'socks', 'shoes', 'sole', 'belt', 'skin', 'hands'];

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UPV = v3(0, 0, 1);

// Joint set with frames, from either the rest skeleton or a game pose. Every vector is a Vector3.
function frames(J) {
  const up = J.neck.clone().sub(J.hip).normalize();
  const flat = (v) => v.clone().sub(up.clone().multiplyScalar(v.dot(up))).normalize();
  const Lt = flat(J.shF.clone().sub(J.shB));
  const Ft = Lt.clone().cross(up);
  const Lh = flat(J.L.clone().add(Lt));
  const Fh = Lh.clone().cross(up);
  const Fw = Fh.clone().add(Ft).normalize();
  const bend = (a, b, c, side) => {
    const u = b.clone().sub(a).normalize(), f = c.clone().sub(b).normalize();
    return u.clone().cross(f).add(u.clone().cross(side).multiplyScalar(0.15)).normalize();
  };
  const out = { up, Ft, Fh, Fw, Lt };
  for (const s of ['F', 'B']) {
    out['arm' + s] = bend(J['sh' + s], J['el' + s], J['wr' + s], Ft);
    out['leg' + s] = bend(J['hs' + s], J['kn' + s], J['an' + s], Lh);
  }
  return out;
}

// bone -> [head joint, aim (direction the bone runs), reference for the twist]
function spec(J, Fr) {
  const d = (a, b) => b.clone().sub(a);
  const S = {
    hip: [J.hip, Fr.up, Fr.Fh],
    spine: [J.spine, d(J.spine, J.chest), Fr.Fw],
    chest: [J.chest, d(J.chest, J.neck), Fr.Ft],
    neck: [J.neck, d(J.neck, J.head), J.look],
  };
  for (const s of ['F', 'B']) {
    S['clav_' + s] = [J.clav, d(J.clav, J['sh' + s]), Fr.Ft];
    S['arm_' + s] = [J['sh' + s], d(J['sh' + s], J['el' + s]), Fr['arm' + s]];
    S['fore_' + s] = [J['el' + s], d(J['el' + s], J['wr' + s]), Fr['arm' + s]];
    S['hand_' + s] = [J['wr' + s], d(J['el' + s], J['wr' + s]), Fr['arm' + s]];
    S['thigh_' + s] = [J['hs' + s], d(J['hs' + s], J['kn' + s]), Fr['leg' + s]];
    S['shin_' + s] = [J['kn' + s], d(J['kn' + s], J['an' + s]), Fr['leg' + s]];
    S['foot_' + s] = [J['an' + s], d(J['an' + s], J['toe' + s]), UPV];
  }
  return S;
}

const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _M = new THREE.Matrix4();
function basisQuat(aim, ref, out = new THREE.Quaternion()) {
  _Y.copy(aim).normalize();
  _Z.copy(ref).addScaledVector(_Y, -ref.dot(_Y));
  if (_Z.lengthSq() < 1e-8) _Z.set(0, 0, 1).addScaledVector(_Y, -_Y.z);
  _Z.normalize();
  _X.crossVectors(_Y, _Z);
  _M.makeBasis(_X, _Y, _Z);
  return out.setFromRotationMatrix(_M);
}

const ORDER = ['hip', 'spine', 'chest', 'neck', 'clav_F', 'arm_F', 'fore_F', 'hand_F', 'clav_B', 'arm_B', 'fore_B', 'hand_B',
  'thigh_F', 'shin_F', 'foot_F', 'thigh_B', 'shin_B', 'foot_B'];
const PARENT = { spine: 'hip', chest: 'spine', neck: 'chest', clav_F: 'chest', clav_B: 'chest', arm_F: 'clav_F', arm_B: 'clav_B',
  fore_F: 'arm_F', fore_B: 'arm_B', hand_F: 'fore_F', hand_B: 'fore_B', thigh_F: 'hip', thigh_B: 'hip', shin_F: 'thigh_F',
  shin_B: 'thigh_B', foot_F: 'shin_F', foot_B: 'shin_B' };

export class PlayerRig {
  constructor(scene, { safe = false } = {}) {
    this.scene = scene;
    this.safe = safe;
    this.pools = { hero: [], toon: [] };
    this.used = { hero: 0, toon: 0 };
    this.ready = false;
  }

  load(url = 'models/player.glb') {
    new GLTFLoader().load(url, (gltf) => {
      try { this._setup(gltf.scene); } catch (e) { console.warn('Player model failed to set up:', e); }
    }, undefined, (e) => console.warn('Player model not loaded:', e && e.message));
  }

  _setup(root) {
    root.updateMatrixWorld(true);
    let mesh = null;
    root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    if (!mesh) throw new Error('no skinned mesh');
    const bones = Object.fromEntries(mesh.skeleton.bones.map((b) => [b.name, b]));
    for (const n of ORDER) if (!bones[n]) throw new Error('missing bone ' + n);
    // the region ids ride in the vertex colors; give them their own name so three.js doesn't tint with them
    root.traverse((o) => {
      if (!o.isSkinnedMesh || !o.geometry.getAttribute('color')) return;
      o.geometry.setAttribute('region', o.geometry.getAttribute('color'));
      o.geometry.deleteAttribute('color');
    });
    const P = (n) => bones[n].getWorldPosition(new THREE.Vector3());
    // rest joints (the model is built in S units, facing +Y with its left at -X)
    const J = {
      hip: P('hip'), spine: P('spine'), chest: P('chest'), neck: P('neck'), clav: P('clav_F'),
      L: v3(-1, 0, 0), look: v3(0, 1, 0),
    };
    J.head = J.neck.clone().add(v3(0, 0.02, 0.58));
    for (const s of ['F', 'B']) {
      J['sh' + s] = P('arm_' + s); J['el' + s] = P('fore_' + s); J['wr' + s] = P('hand_' + s);
      J['hs' + s] = P('thigh_' + s); J['kn' + s] = P('shin_' + s); J['an' + s] = P('foot_' + s);
      J['toe' + s] = J['an' + s].clone().add(v3(0, 0.48, -0.13));
    }
    const restSpec = spec(J, frames(J));
    this.rest = {};
    for (const n of ORDER) {
      const q = bones[n].getWorldQuaternion(new THREE.Quaternion());
      const [, aim, ref] = restSpec[n];
      // world rotation = (target frame) * inverse(rest frame) * rest world rotation
      this.rest[n] = basisQuat(aim, ref).invert().multiply(q);
    }
    this.template = root;
    this.ready = true;
  }

  // One material per player: the shader reads each vertex's region id and colors it from this
  // player's palette, so a whole body is a single draw call.
  _material(style) {
    const pal = REGIONS.map(() => new THREE.Color());
    const mat = style === 'toon' ? new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: TOON_STEPS })
      : this.safe ? new THREE.MeshLambertMaterial({ color: '#ffffff' })
        : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPal = { value: pal };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 region;\nvarying float vRegion;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region.r;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uPal[${REGIONS.length}];\nvarying float vRegion;`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( uPal[ int( clamp( vRegion * 16.0, 0.0, ${REGIONS.length - 1}.0 ) ) ], opacity );`);
    };
    mat.customProgramCacheKey = () => 'ump-body-' + style;
    return { mat, pal };
  }

  _make(style) {
    const root = skeletonClone(this.template);
    const meshes = [];
    root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const { mat, pal } = this._material(style);
    for (const mesh of meshes) {
      mesh.material = mat;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = style === 'hero';
    }
    const bones = Object.fromEntries(meshes[0].skeleton.bones.map((b) => [b.name, b]));
    const inst = { root, pal, bones, world: {}, colors: [] };
    this.scene.add(root);
    return inst;
  }

  begin() { this.used.hero = this.used.toon = 0; }

  end() {
    for (const st of ['hero', 'toon']) {
      const pool = this.pools[st];
      for (let i = this.used[st]; i < pool.length; i++) pool[i].root.visible = false;
    }
  }

  // W: the game's joints. o: the same options drawHero / drawBody get (kit, skin, ...).
  // style: 'hero' (close-up players) or 'toon' (everyone on the field views, to match their look)
  draw(W, o, style = 'hero') {
    if (!this.ready) return false;
    const pool = this.pools[style];
    const inst = pool[this.used[style]] || (pool[this.used[style]] = this._make(style));
    this.used[style]++;
    inst.root.visible = true;
    this._colors(inst, o);
    this._pose(inst, W, o);
    return true;
  }

  _colors(inst, o) {
    const kit = o.kit;
    const trim = kit.trim || '#333333';
    const skin = o.skin || '#e0ac69';
    const want = [kit.jersey, trim, kit.pants, o.slacks || kit.ump ? kit.pants : o.gear === 'catcher' ? '#1f4fb0' : trim, '#16181f', '#e9e9ea', '#15161b', skin,
      o.battingGloves ? (o.gloveTone || '#f1f1f1') : skin];
    for (let i = 0; i < want.length; i++) {
      if (inst.colors[i] === want[i]) continue;
      inst.colors[i] = want[i];
      inst.pal[i].set(want[i]);
    }
  }

  _pose(inst, W, o) {
    const S = W.S || 1;
    const V = (p) => v3(p.x, p.y, p.z);
    const hip = V(W.hip), neck = V(W.neck);
    const up = neck.clone().sub(hip).normalize();
    const L = V(W.L);
    const lerp = (a, b, t) => a.clone().lerp(b, t);
    const J = { hip, neck, spine: lerp(hip, neck, 0.24), chest: lerp(hip, neck, 0.65), head: V(W.head), L };
    J.clav = neck.clone().addScaledVector(up, -0.05 * S);
    const look = o.lookDir ? v3(o.lookDir.x, o.lookDir.y, 0) : V(W.f);
    J.look = look.lengthSq() > 1e-6 ? look.normalize() : V(W.f);
    for (const s of ['F', 'B']) {
      J['sh' + s] = V(W['sh' + s]); J['el' + s] = V(W['el' + s]);
      // the game's hand point is the middle of the hand; the model's hand bone starts at the wrist
      const hand = V(W['hand' + s]);
      J['wr' + s] = hand.clone().addScaledVector(hand.clone().sub(J['el' + s]).normalize(), -0.13 * S);
      J['kn' + s] = V(W['knee' + s]);
      const foot = V(W['foot' + s]);
      J['an' + s] = foot.clone().addScaledVector(UPV, 0.2 * S);
      let fwd = v3(W.f.x, W.f.y, 0);
      const fx = foot.clone().sub(J['kn' + s]);
      if (o.feetAlong !== false && Math.hypot(fx.x, fx.y) > 0.45 * S) fwd = v3(fx.x, fx.y, 0);
      if (o.footDir) fwd = v3(o.footDir.x, o.footDir.y, 0);
      fwd.normalize();
      J['toe' + s] = foot.clone().addScaledVector(fwd, 0.48 * S).addScaledVector(UPV, 0.07 * S);
    }
    // the hips turn about halfway with the shoulders (as drawHero does)
    const Fr = frames({ ...J, hsF: hip, hsB: hip });
    const Lh = Fr.Fh.clone().cross(up).multiplyScalar(-1);
    for (const s of ['F', 'B']) {
      const sd = s === 'F' ? 1 : -1;
      J['hs' + s] = hip.clone().addScaledVector(Lh, 0.2 * S * sd).addScaledVector(up, -0.04 * S);
    }
    const Fr2 = frames(J);
    const sp = spec(J, Fr2);
    const scale = v3(S, S, S);
    const q = new THREE.Quaternion();
    const world = inst.world;
    for (const n of ORDER) {
      const [head, aim, ref] = sp[n];
      basisQuat(aim, ref, q).multiply(this.rest[n]);
      const wm = world[n] || (world[n] = new THREE.Matrix4());
      wm.compose(head, q, scale);
      const b = inst.bones[n];
      const pm = PARENT[n] ? world[PARENT[n]] : null;
      const local = pm ? _M.copy(pm).invert().multiply(wm) : _M.copy(wm);
      local.decompose(b.position, b.quaternion, b.scale);
    }
    inst.root.updateMatrixWorld(true);
  }
}
