// Field3D: the 3D replacement for the 2D FieldRenderer. Same draw(g, cam, world) entry point,
// so the game scenes don't need to know how the ballpark is drawn.
import * as THREE from 'three';
import { Engine } from './engine.js';
import { Stadium } from './stadium.js';
import { People, vec3 } from './people.js';
import { drawHero } from './hero.js';
import { ballTexture, labelTexture, glowTexture } from './textures.js';
import { ballColor } from '../sport.js';
import { Dust, onDirt } from './dust.js';

const { V } = vec3;

export class Field3D {
  constructor(canvas, opts = {}) {
    this.engine = new Engine(canvas, opts);
    this.safe = !!opts.safe;
    this.frame = 0;
    this.blank = 0;
    this.litCount = 0;
    this.verified = false;
    this.failed = null;
    this.scene = this.engine.scene;
    this.stadium = new Stadium(this.engine);
    this.people = new People(this.engine, { safe: !!opts.safe });
    this.dust = new Dust(this.scene);
    this.track = new WeakMap();
    this.prevBall = null;
    this.excite = 0;
    this.t0 = performance.now();
    this.last = this.t0;
    this.board = {};
    this.is3d = true;

    // Ball + blob shadow + trail
    const bt = ballTexture();
    // drawn in the transparent pass so it sits between its halo (behind) and outline ring (in front)
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshLambertMaterial({ map: bt, emissive: '#2a2a2a', transparent: true }));
    this.ball.renderOrder = 7;
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    const shadowTex = glowTexture('0,0,0');
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    this.ballShadow.renderOrder = 5;
    this.scene.add(this.ballShadow);
    // soft halo so a far-away ball pops against grass and dirt
    this.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe066', transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    this.ballGlow.renderOrder = 6;
    this.scene.add(this.ballGlow);
    // thin dark outline so the ball still reads on white chalk and light dirt
    const rc = document.createElement('canvas');
    rc.width = rc.height = 64;
    const rg = rc.getContext('2d');
    rg.strokeStyle = 'rgba(10,14,28,0.9)';
    rg.lineWidth = 7;
    rg.beginPath(); rg.arc(32, 32, 27, 0, Math.PI * 2); rg.stroke();
    this.ballRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(rc), transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    this.ballRing.renderOrder = 8;
    this.scene.add(this.ballRing);
    this.trail = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }), 12);
    this.trail.frustumCulled = false;
    this.trail.count = 0;
    this.scene.add(this.trail);

    // Ground markers (rings + labels)
    this.ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    this.discGeo = new THREE.CircleGeometry(1, 48);
    this.markerPool = [];
    this.labelCache = new Map();

    // Strike-zone helper (plate view): a box over the whole plate, front to back, because a pitch
    // that clips any part of it is a strike
    this.zone = new THREE.Group();
    const zf = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
    this.zone.add(zf);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineDashedMaterial({ color: '#ffd34d', dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.9 }));
    edge.computeLineDistances();
    this.zone.add(edge);
    this.zoneMats = [[zf.material, 0.07], [edge.material, 0.9]];
    this.zone.visible = false;
    this.scene.add(this.zone);

    // Pitch imprint: where the ball crossed the plate (the same point the K-Zone shows)
    this.imprint = new THREE.Group();
    this.imprintBall = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }));
    this.imprint.add(this.imprintBall);
    const ic = document.createElement('canvas');
    ic.width = ic.height = 64;
    const ig = ic.getContext('2d');
    ig.strokeStyle = '#ffffff';
    ig.lineWidth = 6;
    ig.beginPath(); ig.arc(32, 32, 26, 0, Math.PI * 2); ig.stroke();
    this.imprintRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(ic), transparent: true, depthTest: false, depthWrite: false }));
    this.imprintRing.renderOrder = 9;
    this.imprint.add(this.imprintRing);
    this.imprint.visible = false;
    this.scene.add(this.imprint);

    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  setTimeOfDay(mode) { this.engine.setTimeOfDay(mode); }
  // Baseball or softball: mound or circle, white ball or the big yellow one
  setSport(id, rubber, ballR) {
    this.stadium.setSport(id, rubber);
    this.ballR = ballR;
    if (this.ballSport === id) return;
    this.ballSport = id;
    const old = this.ball.material.map;
    this.ball.material.map = ballTexture(id === 'softball' ? ballColor() : '#fbfbf6');
    this.ball.material.needsUpdate = true;
    old.dispose();
  }
  setQuality(q) { this.engine.setQuality(q); }
  resize(cssW, cssH, dpr) { this.engine.resize(cssW, cssH, dpr); }
  cheer(amount = 1) { this.excite = Math.max(this.excite, amount); }

  _label(text, color) {
    const key = text + color;
    if (!this.labelCache.has(key)) this.labelCache.set(key, labelTexture(text, color));
    return this.labelCache.get(key);
  }

  // flat highlighted polygons on the ground (e.g. the B/C start zones)
  _bands(list, t) {
    if (!this.bandPool) this.bandPool = [];
    let i = 0;
    for (const m of list) {
      let e = this.bandPool[i];
      if (!e) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
        e = {
          // pulled toward the camera so the ground planes (which use their own polygon offset) can't hide it
          fill: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.22, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -60 })),
          edge: new THREE.Line(lg, new THREE.LineBasicMaterial({ transparent: true, depthTest: false })),
          label: new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })),
        };
        e.fill.renderOrder = e.edge.renderOrder = 6;
        e.fill.frustumCulled = e.edge.frustumCulled = false;
        this.scene.add(e.fill, e.edge, e.label);
        this.bandPool[i] = e;
      }
      const [a, b, c, d] = m.poly;
      const z = 0.09;
      const fp = e.fill.geometry.attributes.position;
      [a, b, c, a, c, d].forEach((p, k) => fp.setXYZ(k, p.x, p.y, z));
      fp.needsUpdate = true;
      const lp = e.edge.geometry.attributes.position;
      [a, b, c, d, a].forEach((p, k) => lp.setXYZ(k, p.x, p.y, z + 0.01));
      lp.needsUpdate = true;
      const color = new THREE.Color(m.color || '#ffd34d');
      e.fill.material.color.copy(color);
      e.fill.material.opacity = 0.3 + 0.1 * Math.sin(t * 4);
      e.edge.material.color.copy(color);
      e.fill.visible = e.edge.visible = true;
      if (m.label) {
        e.label.visible = true;
        e.label.material.map = this._label(m.label, m.color || '#ffd34d');
        e.label.position.set((a.x + b.x + c.x + d.x) / 4, (a.y + b.y + c.y + d.y) / 4, 3.2 + Math.sin(t * 3) * 0.3);
        e.label.scale.set(3.2, 3.2, 1);
      } else e.label.visible = false;
      i++;
    }
    for (; i < this.bandPool.length; i++) {
      const e = this.bandPool[i];
      e.fill.visible = e.edge.visible = e.label.visible = false;
    }
  }

  _markers(all, t) {
    this._bands(all.filter((m) => m.poly), t);
    const list = all.filter((m) => !m.poly);
    let i = 0;
    for (const m of list) {
      let e = this.markerPool[i];
      if (!e) {
        e = {
          ring: new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })),
          disc: new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.18 })),
          label: new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })),
        };
        e.ring.renderOrder = e.disc.renderOrder = 6;
        this.scene.add(e.ring, e.disc, e.label);
        this.markerPool[i] = e;
      }
      const pulse = m.pulse ? 1 + 0.1 * Math.sin(t * 6) : 1;
      const r = (m.r || 3) * pulse;
      const color = new THREE.Color(m.color && m.color.startsWith('#') ? m.color : '#ffd34d');
      e.ring.visible = e.disc.visible = true;
      e.ring.position.set(m.x, m.y, 0.08);
      e.ring.scale.set(r, r, 1);
      e.ring.material.color.copy(color);
      e.ring.material.opacity = m.dash ? 0.75 + 0.25 * Math.sin(t * 5) : 0.95;
      e.disc.position.set(m.x, m.y, 0.07);
      e.disc.scale.set(r, r, 1);
      e.disc.material.color.copy(color);
      if (m.label) {
        e.label.visible = true;
        e.label.material.map = this._label(m.label, m.color && m.color.startsWith('#') ? m.color : '#ffd34d');
        e.label.position.set(m.x, m.y, 3.2 + Math.sin(t * 3) * 0.3);
        e.label.scale.set(3.2, 3.2, 1);
      } else e.label.visible = false;
      i++;
    }
    for (; i < this.markerPool.length; i++) {
      const e = this.markerPool[i];
      e.ring.visible = e.disc.visible = e.label.visible = false;
    }
  }

  _ball(b, camPos) {
    const show = !!b && b.visible !== false;
    this.ball.visible = this.ballShadow.visible = this.ballGlow.visible = this.ballRing.visible = show;
    this.trail.count = 0;
    if (!show) return;
    const d = Math.hypot(b.x - camPos.x, b.y - camPos.y, (b.z || 0) - camPos.z);
    // never smaller than a few screen pixels (more on phones), whatever the camera distance
    const fc = this._focalCss || 900;
    const minPx = Math.min(this.engine.cssW, this.engine.cssH) < 500 ? 6.2 : 4.6;
    const r = Math.max((this.ballR || 0.121) * (b.scale || 1), (d * minPx) / fc);
    this.ball.position.set(b.x, b.y, Math.max(r * 0.6, b.z || 0));
    this.ball.scale.setScalar(r);
    this.ball.rotation.x += 0.4;
    this.ball.rotation.z += 0.3;
    const h = b.z || 0;
    const sr = Math.max(0.35, r * 2.2) * (1 + h * 0.02);
    this.ballShadow.position.set(b.x, b.y, 0.09);
    this.ballShadow.scale.set(sr * 2, sr * 2, 1);
    this.ballShadow.material.opacity = Math.max(0.12, 0.55 - h * 0.012);
    this.ballGlow.position.copy(this.ball.position);
    this.ballGlow.scale.setScalar(r * 6);
    const far = Math.max(0, Math.min(1, (d - 15) / 30));
    const halo = b.halo ?? 1;
    this.ballGlow.material.opacity = 0.7 * far * halo;
    this.ballRing.position.copy(this.ball.position);
    this.ballRing.scale.setScalar(r * 2.45);
    this.ballRing.material.opacity = far * Math.min(1, halo * 1.4);
    if (b.trail && b.trail.length > 1) {
      const n = Math.min(12, b.trail.length);
      for (let i = 0; i < n; i++) {
        const p = b.trail[b.trail.length - n + i];
        const k = (i + 1) / n;
        this._m.makeScale(r * 0.8 * k, r * 0.8 * k, r * 0.8 * k).setPosition(p.x, p.y, p.z || 0);
        this.trail.setMatrixAt(i, this._m);
      }
      this.trail.count = n;
      this.trail.instanceMatrix.needsUpdate = true;
    }
  }

  // Populate people + props for a world description. Shared by the main view and inset views.
  _emitDust(world, dt) {
    if (dt <= 0) return;
    for (const a of world.actors || []) {
      if (a.hidden) continue;
      let st = this.track.get(a);
      if (!st) { st = { x: a.x, y: a.y, acc: 0 }; this.track.set(a, st); }
      const v = Math.hypot(a.x - st.x, a.y - st.y) / dt;
      st.x = a.x; st.y = a.y;
      if (v > 60) continue; // teleport, not movement
      if ((a.pose === 'slide' || a.pose === 'dive') && v > 2.5) {
        this.dust.emit(a.x, a.y, 0.1, 3, { spread: 0.7, size: 1.3, up: 1.3, speed: 3.2, life: 1.1 });
      } else if (a.pose === 'run' && v > 6 && onDirt(a.x, a.y)) {
        st.acc += dt;
        if (st.acc > 0.11) { st.acc = 0; this.dust.emit(a.x, a.y, 0.05, 1, { size: 0.6, up: 0.9, speed: 1.4, life: 0.7, spread: 0.3 }); }
      }
    }
    const b = world.ball;
    if (b && b.visible !== false) {
      const p = this.prevBall;
      if (p && p.z > 0.5 && (b.z || 0) <= 0.5 && Math.hypot(b.x - p.x, b.y - p.y) < 8 && onDirt(b.x, b.y)) {
        this.dust.emit(b.x, b.y, 0.1, 7, { size: 0.55, spread: 0.25, up: 1.6, speed: 1.8, life: 0.8 });
      }
      this.prevBall = { x: b.x, y: b.y, z: b.z || 0 };
    } else this.prevBall = null;
  }

  _populate(world, camera, focal, t) {
    const P = this.people;
    P.begin(camera, focal);
    const markers = [...(world.markers || [])];
    for (const a of world.actors || []) {
      if (a.hidden) continue;
      P.drawActor(a);
      if (a.ring) markers.push({ x: a.x, y: a.y, r: 2.4, color: a.ring === true ? '#ffd34d' : a.ring, pulse: true });
    }
    for (const body of world.bodies || []) {
      if (body.hero) drawHero(P, body.W, body.o);
      else P.drawBody(body.W, body.o);
    }
    if (world.extra) world.extra(P, t);
    P.end();
    this._markers(markers, t);
    this._ball(world.ball, camera.position);
    if (world.zone) {
      const z = world.zone;
      this.zone.visible = true;
      this.zone.position.set(0, z.y ?? 0.708, (z.bot + z.top) / 2);
      this.zone.scale.set(1.416, z.depth ?? 1.416, z.top - z.bot);
      for (const [m, o] of this.zoneMats) m.opacity = o * (z.alpha ?? 1);
    } else this.zone.visible = false;
    const im = world.imprint;
    this.imprint.visible = !!im;
    if (im) {
      this.imprint.position.set(im.x, im.y, im.z);
      this.imprintBall.scale.setScalar(this.ballR || 0.121);
      this.imprintBall.material.color.set(im.color);
      this.imprintRing.material.color.set(im.color);
      this.imprintRing.scale.setScalar(0.42);
    }
  }

  draw(g, cam, world = {}) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    this.excite = Math.max(0, this.excite - dt * 0.7);
    g.clearRect(0, 0, cam.w, cam.h);
    const e = this.engine;
    e.syncCamera(cam);
    this.stadium.update(dt, t, { excite: this.excite, board: this.board });
    const focal = cam.focal;
    this._focalCss = (e.cssH / 2) / Math.tan((e.camera.fov * Math.PI) / 360);
    this._emitDust(world, dt);
    this.dust.update(dt);
    this.dust.setView(e.cssH * e.renderer.getPixelRatio(), e.camera.fov * Math.PI / 180);
    this._populate(world, e.camera, focal, t);
    e.render();
    this._watch(now);
    if (world.overlay) world.overlay(g, cam);
  }

  // Watch for a GPU that silently draws nothing; onFail(reason) lets the app switch to 2D.
  _watch(now) {
    if (this.failed) return;
    const h = this.engine.health;
    if (h.errors.length && !this.people.noHero) {
      // a shader failed to build on this GPU: keep going with the simpler cartoon shading
      this.people.noHero = true;
      console.warn('Realistic players off after a shader error on', this.engine.gpu);
    }
    const gap = now - (this._lastDraw || now);
    this._lastDraw = now;
    if (h.lost) {
      if (gap > 400) h.lostAt = now; // we were in the background: give the browser time to restore it
      if (now - h.lostAt > 3000) this._fail('lost', 'lost the graphics context');
      return;
    }
    // Startup check only: once the 3D view has drawn for a moment, stop probing pixels, so a stray
    // dark frame later (e.g. while a restored context rebuilds its shaders) can't trip it.
    if (this.verified) return;
    const f = ++this.frame;
    if (f < 4 || f % 3) return;
    if (this.engine.probe()) {
      this.blank = 0;
      if (++this.litCount >= 12) this.verified = true;
      return;
    }
    if (++this.blank >= 25) this._fail(h.errors.length ? 'shader' : 'blank', h.errors.length ? 'shader error' : 'nothing drawn');
  }

  _fail(kind, reason) {
    this.failed = reason;
    console.warn('3D renderer failed:', reason, this.engine.gpu, this.engine.health.errors);
    if (this.onFail) this.onFail(reason, kind);
  }

  // Render an inset view (UMP CAM). view: { eye, target, fov(rad) }, rect in CSS px.
  drawInset(view, rect, world, block = 1) {
    const e = this.engine;
    const c = e.inset;
    c.position.set(view.eye.x, view.eye.y, view.eye.z);
    c.up.set(0, 0, 1);
    c.lookAt(view.target.x, view.target.y, view.target.z);
    c.fov = (view.fov * 180) / Math.PI;
    const focal = (rect.h / 2) / Math.tan(view.fov / 2);
    this._focalCss = focal;
    const t = (performance.now() - this.t0) / 1000;
    this._populate(world, c, focal, t);
    this.dust.setView(rect.h * e.renderer.getPixelRatio() / block, view.fov);
    e.renderInset(rect, block);
  }

  // Project a world point with the inset camera into rect pixel coordinates (CSS px).
  projectInset(p, rect) {
    const v = this._v.set(p.x, p.y, p.z || 0).project(this.engine.inset);
    return { x: rect.x + ((v.x + 1) / 2) * rect.w, y: rect.y + ((1 - v.y) / 2) * rect.h, behind: v.z > 1 };
  }
}
