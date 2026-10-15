// The Blender-built ballplayer body (art/player.py -> models/player.glb), posed every frame from the
// same joint positions the game already computes for its close-up players (hip, neck, shoulders,
// elbows, hands, knees, feet...). Each bone turns so it runs from its joint to the next one, with a
// twist taken from the body's facing or the limb's bend; bones also stretch to land exactly on the
// joints, so the bat, gloves and gear the game draws on top stay attached.
// The rotation is found by comparing a frame built from the rest pose with the same frame built from
// the target pose, so it doesn't depend on how Blender rolled the bones.
// Each player also gets a Blender-built head (art/head.py -> models/head.glb): the face, a hair style
// and their cap, helmet or mask, merged into one mesh so it's a second draw call, moved with W.head
// and turned to look where the player looks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOON_STEPS } from './engine.js';
import { hairOf, hashStr } from './people.js';
import { KITS } from '../render/figures.js';
import { sport } from '../sport.js';

// Body regions, in the order art/player.py numbers them (vertex color red = (index + 0.5) / 16)
const REGIONS = ['jersey', 'trim', 'pants', 'socks', 'shoes', 'sole', 'belt', 'skin', 'hands'];
// Head regions, in the order art/head.py numbers them. Green is how far a ponytail swings there,
// blue how much cheek blush (palette slot 1) mixes into the skin.
const HEAD_REGIONS = ['skin', 'blush', 'hair', 'brow', 'eye', 'iris', 'pupil', 'mouth', 'tie', 'shell', 'under', 'logo', 'cage', 'pad', 'vent', 'shell2'];
const SHORT_HAIR = ['crew', 'shag', 'curly'];
const IRISES = ['#5b3a1f', '#3b2616', '#6b4a24', '#2f6fb3', '#4f7f3a'];
const GEAR = '#1f3f9e'; // catcher's helmet (as drawHero)
const TOON_HEAD = 1.1; // field players' heads are a little big, so faces still read from far away

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UPV = v3(0, 0, 1);
const BLUSH = new THREE.Color('#ff5a5a');
const _hu = v3(0, 0, 1), _hf = v3(0, 1, 0), _hx = v3(1, 0, 0), _hl = v3(-1, 0, 0), _hs = v3(1, 1, 1);

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

  load(url = 'models/player.glb', headUrl = 'models/head.glb') {
    new GLTFLoader().load(url, (gltf) => {
      try { this._setup(gltf.scene); } catch (e) { console.warn('Player model failed to set up:', e); }
    }, undefined, (e) => console.warn('Player model not loaded:', e && e.message));
    new GLTFLoader().load(headUrl, (gltf) => {
      try { this._setupHeads(gltf.scene); } catch (e) { console.warn('Head models failed to set up:', e); }
    }, undefined, (e) => console.warn('Head models not loaded:', e && e.message));
  }

  // Head parts by name (head, hair_crew, cap, helmet, ... and '_lo' versions for the field views)
  _setupHeads(root) {
    const parts = {};
    root.traverse((o) => {
      const g = o.isMesh && o.geometry;
      if (!g || !g.getAttribute('color')) return;
      g.setAttribute('region', g.getAttribute('color'));
      // keep just what the shader reads, so any parts merge into one mesh
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'region') g.deleteAttribute(k);
      parts[o.name] = g;
    });
    for (const n of ['head', 'head_lo', 'cap', 'cap_lo']) if (!parts[n]) throw new Error('missing head part ' + n);
    this.headGeo = new Map();
    this.heads = parts;
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
      for (let i = this.used[st]; i < pool.length; i++) {
        pool[i].root.visible = false;
        if (pool[i].head) pool[i].head.mesh.visible = false;
      }
    }
  }

  // W: the game's joints. o: the same options drawHero / drawBody get (kit, skin, ...).
  // style: 'hero' (close-up players) or 'toon' (everyone on the field views, to match their look)
  // Returns false (draw the old shapes), or the options to add for drawHero / drawBody: the body is
  // drawn (bodyless) and, once the head models are in, the head and headgear too (headless).
  draw(W, o, style = 'hero') {
    if (!this.ready) return false;
    const pool = this.pools[style];
    const inst = pool[this.used[style]] || (pool[this.used[style]] = this._make(style));
    this.used[style]++;
    inst.root.visible = true;
    this._colors(inst, o);
    this._pose(inst, W, o);
    const headless = !!this.heads;
    if (headless) this._head(inst, W, o, style);
    return { bodyless: true, headless };
  }

  // ---------- heads ----------
  // Like the body: one material per player whose shader colors each region from this player's palette.
  // The PBR version also takes each region's shine (glossy helmets and eyes, matte caps and skin).
  _headMaterial(style) {
    const n = HEAD_REGIONS.length;
    const u = {
      uPal: { value: HEAD_REGIONS.map(() => new THREE.Color()) },
      uRough: { value: new Array(n).fill(0.7) },
      uMetal: { value: new Array(n).fill(0) },
      uSway: { value: new THREE.Vector3() },
    };
    const pbr = style !== 'toon' && !this.safe;
    const mat = style === 'toon' ? new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: TOON_STEPS })
      : this.safe ? new THREE.MeshLambertMaterial({ color: '#ffffff' })
        : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 region;\nuniform vec3 uSway;\nvarying float vRegion;\nvarying float vBlush;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region.r;\nvBlush = region.b;\ntransformed += uSway * region.g;');
      let fs = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uPal[${n}];\nuniform float uRough[${n}];\nuniform float uMetal[${n}];\nvarying float vRegion;\nvarying float vBlush;`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `int rIdx = int( clamp( vRegion * 16.0, 0.0, ${n - 1}.0 ) );
vec3 rCol = uPal[ rIdx ];
if ( rIdx == 0 ) rCol = mix( rCol, uPal[ 1 ], vBlush );
vec4 diffuseColor = vec4( rCol, opacity );`);
      if (pbr) {
        fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uRough[ rIdx ];')
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uMetal[ rIdx ];');
      }
      sh.fragmentShader = fs;
    };
    mat.customProgramCacheKey = () => 'ump-head-' + style;
    return { mat, u };
  }

  _headGeometry(names) {
    const key = names.join('+');
    let g = this.headGeo.get(key);
    if (!g) {
      g = mergeGeometries(names.map((n) => this.heads[n]).filter(Boolean)) || this.heads[names[0]];
      this.headGeo.set(key, g);
    }
    return g;
  }

  // What this player wears: the parts to merge, and what to color them by
  _headLook(o, style) {
    const kit = o.kit;
    const lo = style === 'toon' ? '_lo' : '';
    const catcher = o.gear === 'catcher';
    const helmet = !catcher && !!(o.helmet || kit.helmet);
    const seed = String(o.skin) + (o.num ?? '') + (kit.jersey || '');
    // softball players tie their hair back: a bubble braid out of the batting helmet, a ponytail through
    // the back of the cap, or tied low at the nape under the catcher's helmet
    let tail = o.ponytail;
    if (tail === undefined) tail = sport.softball && !kit.ump && !kit.coach && (helmet ? 'bubble' : true);
    const hair = tail === 'bubble' ? 'bubble' : tail ? (catcher ? 'ponylow' : 'pony') : SHORT_HAIR[hashStr(seed + 'hair') % SHORT_HAIR.length];
    const gear = catcher ? 'catcher' : helmet ? 'helmet' : o.mask ? 'cap_short' : 'cap';
    const parts = ['head' + lo];
    if (SHORT_HAIR.includes(hair)) parts.push('hair_' + hair + lo);
    else parts.push('hair_sleek' + lo, 'tail_' + hair + lo); // combed back into the tail
    if (gear === 'cap' || gear === 'cap_short') parts.push('cap' + lo, (gear === 'cap' ? 'brim' : 'brim_short') + lo); // the plate ump's short bill clears his mask
    else parts.push(gear + lo);
    if (helmet && (o.faceguard ?? sport.softball)) parts.push('cage' + lo); // softball batting helmets have a face cage
    if (o.mask && !catcher) parts.push('umpmask' + lo);
    const team = kit.ump ? null : o.team ? o.team[0] : kit === KITS.off || kit.coach ? 'T' : kit === KITS.def ? 'H' : null;
    if (team && (gear === 'cap' || gear === 'helmet')) parts.push(`logo_${gear}_${team}`);
    return { parts, gear, hair, seed };
  }

  _headColors(h, o, look) {
    const skin = o.skin || '#e0ac69';
    const hair = hairOf(o);
    const shell = look.gear === 'catcher' ? GEAR : o.kit.cap;
    const iris = IRISES[hashStr(look.seed + 'eyes') % IRISES.length];
    const tie = o.scrunchie || (look.hair === 'bubble' ? '#ff4fa3' : '#d62839');
    const sig = [skin, hair, shell, iris, tie, look.gear].join('|');
    if (h.sig === sig) return;
    h.sig = sig;
    const cap = look.gear === 'cap' || look.gear === 'cap_short';
    const P = h.u.uPal.value;
    P[0].set(skin); P[1].set(skin).lerp(BLUSH, 0.32); P[2].set(hair); P[3].set(hair).multiplyScalar(0.55);
    P[4].set('#f7f5ef'); P[5].set(iris); P[6].set('#121014'); P[7].set('#7a2630'); P[8].set(tie);
    P[9].set(shell); P[10].set(cap ? shell : '#16171b').multiplyScalar(cap ? 0.45 : 1);
    P[11].set('#ffffff'); P[12].set('#2a2d35'); P[13].set('#16171b'); P[14].set('#0b0c10'); P[15].set(shell).multiplyScalar(0.7);
    // matte caps, glossy helmets, wet eyes, metal cage
    const hard = !cap;
    const R = h.u.uRough.value, M = h.u.uMetal.value;
    [0.7, 0.7, 0.55, 0.8, 0.18, 0.2, 0.15, 0.6, 0.65, hard ? 0.24 : 0.85, 0.9, hard ? 0.35 : 0.8, 0.4, 0.7, 0.9, hard ? 0.3 : 0.85].forEach((r, i) => { R[i] = r; });
    M.fill(0);
    M[12] = 0.5;
    if (hard) M[9] = M[15] = 0.05;
  }

  _head(inst, W, o, style) {
    if (!inst.head) {
      const { mat, u } = this._headMaterial(style);
      const mesh = new THREE.Mesh(this.heads.head, mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = style === 'hero';
      this.scene.add(mesh);
      inst.head = { mesh, u, key: '', sig: '' };
    }
    const h = inst.head;
    const look = this._headLook(o, style);
    const key = look.parts.join('+');
    if (h.key !== key) { h.key = key; h.mesh.geometry = this._headGeometry(look.parts); }
    this._headColors(h, o, look);
    h.u.uSway.value.set(Math.sin((W.hip.x + W.hip.y) * 2) * 0.07, 0, 0); // ponytails swing as the player moves
    // The head stays upright with a little of the neck's lean, and faces where the player looks
    // (o.lookDir), else between the chest and the feet (as drawHero / drawBody turned it).
    const S = (W.S || 1) * (style === 'toon' ? TOON_HEAD : 1);
    const upT = _hu.set(W.neck.x - W.hip.x, W.neck.y - W.hip.y, W.neck.z - W.hip.z).normalize();
    const flat = (v) => v.addScaledVector(upT, -v.dot(upT)).normalize();
    flat(_hl.set(W.L.x, W.L.y, W.L.z));
    _hx.set(W.shF.x - W.shB.x, W.shF.y - W.shB.y, W.shF.z - W.shB.z);
    if (_hx.length() > 0.2 * (W.S || 1) && flat(_hx).dot(_hl) > -0.2) _hl.copy(_hx);
    _hf.crossVectors(_hl, upT).add(_hx.set(W.f.x, W.f.y, 0)).setZ(0);
    if (o.lookDir) _hf.set(o.lookDir.x, o.lookDir.y, 0);
    if (_hf.lengthSq() < 0.04) _hf.set(W.f.x, W.f.y, 0);
    const up = _hu.set(W.head.x - W.neck.x, W.head.y - W.neck.y, W.head.z - W.neck.z).normalize().multiplyScalar(0.2).add(UPV).normalize();
    _hf.addScaledVector(up, -_hf.dot(up)).normalize();
    _hx.crossVectors(_hf, up);
    h.mesh.matrix.makeBasis(_hx, _hf, up).scale(_hs.set(S, S, S)).setPosition(W.head.x, W.head.y, W.head.z);
    h.mesh.matrixWorldNeedsUpdate = true;
    h.mesh.visible = true;
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
      const fd = W['footDir' + s]; // the pose turned this foot
      if (fd) fwd = v3(fd.x, fd.y, 0);
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
