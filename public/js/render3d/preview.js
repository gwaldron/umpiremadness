// Small standalone 3D preview of your umpire (Locker Room).
import * as THREE from 'three';
import { People } from './people.js';
import { drawHero } from './hero.js';
import { KITS } from '../render/figures.js';

export class UmpPreview {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(canvas.clientWidth || 300, canvas.clientHeight || 320, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight('#e2f0ff', '#4a6b3a', 1.4));
    const sun = new THREE.DirectionalLight('#fff1d9', 2.4);
    sun.position.set(-4, -6, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshLambertMaterial({ color: '#c98a50' }));
    dirt.receiveShadow = true;
    scene.add(dirt);
    const grass = new THREE.Mesh(new THREE.RingGeometry(3.2, 12, 48), new THREE.MeshLambertMaterial({ color: '#3d9a3a' }));
    grass.receiveShadow = true;
    scene.add(grass);
    this.people = new People({ scene, maxAniso: 1 });
    this.t0 = performance.now();
  }

  draw(look, colors) {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (w && h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
    }
    const t = (performance.now() - this.t0) / 1000;
    const a = -Math.PI / 2 + Math.sin(t * 0.6) * 0.6;
    this.camera.position.set(Math.cos(a) * 13.5, Math.sin(a) * 13.5, 4.2);
    this.camera.lookAt(0, 0, 2.9);
    this.camera.updateProjectionMatrix();
    const kit = { ...KITS.ump, jersey: colors.shirt, shade: colors.shirt, cap: colors.cap };
    const pose = ['out', 'safe', 'set', 'time'][Math.floor(t / 1.6) % 4];
    // face the camera
    const actor = { x: 0, y: 0, kit, skin: colors.skin, pose, phase: 1, heading: Math.atan2(this.camera.position.y, this.camera.position.x), vis: 1 };
    const P = this.people;
    P.begin(this.camera, h * this.renderer.getPixelRatio() / 2 / Math.tan((30 * Math.PI) / 360));
    // the locker shows your ump up close, so use the realistic body
    const W = P.jointsFor(actor);
    drawHero(P, W, { kit, skin: colors.skin, slacks: true, protector: true, lookDir: { x: this.camera.position.x, y: this.camera.position.y } });
    P.end();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
