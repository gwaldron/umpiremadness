// A tiny pinhole camera for a Z-up world measured in feet.
// World axes: +x toward first base / right field, +y from home plate toward center field, +z up.
// Home plate's back point is the origin.

export class Camera {
  constructor() {
    this.eye = { x: 0, y: -70, z: 50 };
    this.target = { x: 0, y: 60, z: 0 };
    this.fovY = 0.8;
    this.w = 800;
    this.h = 600;
    this.cx = 400;
    this.cy = 300;
    this.near = 0.35;
    this.shake = 0;
    this.update();
  }

  setViewport(w, h) {
    this.w = w;
    this.h = h;
    this.update();
  }

  lookAt(eye, target) {
    this.eye = { ...eye };
    this.target = { ...target };
    this.update();
  }

  update() {
    const e = this.eye, t = this.target;
    let fx = t.x - e.x, fy = t.y - e.y, fz = t.z - e.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // right = f × up(0,0,1)
    let rx = fy, ry = -fx, rz = 0;
    const rl = Math.hypot(rx, ry) || 1;
    rx /= rl; ry /= rl;
    // up = r × f
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    this.f = { x: fx, y: fy, z: fz };
    this.r = { x: rx, y: ry, z: rz };
    this.u = { x: ux, y: uy, z: uz };
    this.focal = this.h / 2 / Math.tan(this.fovY / 2);
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }
    this.cx = this.w / 2 + sx;
    this.cy = this.h / 2 + sy;
  }

  toCam(x, y, z) {
    const dx = x - this.eye.x, dy = y - this.eye.y, dz = z - this.eye.z;
    return {
      x: dx * this.r.x + dy * this.r.y + dz * this.r.z,
      y: dx * this.u.x + dy * this.u.y + dz * this.u.z,
      z: dx * this.f.x + dy * this.f.y + dz * this.f.z,
    };
  }

  camToScreen(c) {
    const s = this.focal / c.z;
    return { x: this.cx + c.x * s, y: this.cy - c.y * s, s, depth: c.z };
  }

  project(x, y, z = 0) {
    const c = this.toCam(x, y, z);
    if (c.z < this.near) return null;
    return this.camToScreen(c);
  }

  // Build a canvas path for a 3D polygon, clipped against the near plane.
  // pts: array of [x, y, z]. Returns true if anything was emitted.
  polyPath(g, pts) {
    const cam = pts.map((p) => this.toCam(p[0], p[1], p[2] || 0));
    const near = this.near;
    const out = [];
    for (let i = 0; i < cam.length; i++) {
      const a = cam[i], b = cam[(i + 1) % cam.length];
      const ain = a.z >= near, bin = b.z >= near;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (near - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
      }
    }
    if (out.length < 3) return false;
    g.beginPath();
    for (let i = 0; i < out.length; i++) {
      const s = this.camToScreen(out[i]);
      if (i === 0) g.moveTo(s.x, s.y);
      else g.lineTo(s.x, s.y);
    }
    g.closePath();
    return true;
  }

  fillPoly(g, pts, color) {
    if (this.polyPath(g, pts)) {
      g.fillStyle = color;
      g.fill();
    }
  }

  // A 3D line segment, clipped to the near plane.
  line(g, a, b) {
    let ca = this.toCam(a[0], a[1], a[2] || 0);
    let cb = this.toCam(b[0], b[1], b[2] || 0);
    if (ca.z < this.near && cb.z < this.near) return false;
    if (ca.z < this.near || cb.z < this.near) {
      const t = (this.near - ca.z) / (cb.z - ca.z);
      const m = { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t, z: this.near };
      if (ca.z < this.near) ca = m; else cb = m;
    }
    const sa = this.camToScreen(ca), sb = this.camToScreen(cb);
    g.beginPath();
    g.moveTo(sa.x, sa.y);
    g.lineTo(sb.x, sb.y);
    return true;
  }

  // Ground-plane point under a screen pixel (used for tap-to-move & framing).
  unproject(px, py, planeZ = 0) {
    const cx = (px - this.cx) / this.focal;
    const cy = -(py - this.cy) / this.focal;
    const dir = {
      x: this.f.x + this.r.x * cx + this.u.x * cy,
      y: this.f.y + this.r.y * cx + this.u.y * cy,
      z: this.f.z + this.r.z * cx + this.u.z * cy,
    };
    if (Math.abs(dir.z) < 1e-6) return null;
    const t = (planeZ - this.eye.z) / dir.z;
    if (t < 0) return null;
    return { x: this.eye.x + dir.x * t, y: this.eye.y + dir.y * t };
  }
}

// A smoothed "broadcast" rig that looks from behind home plate toward a focus point.
export class FieldRig {
  constructor(cam) {
    this.cam = cam;
    this.focus = { x: 0, y: 55, z: 0 }; // z: look at a height (a ball in the air) instead of the ground
    this.extent = 75; // half-width in feet that must fit on screen
    this.goalFocus = { ...this.focus };
    this.goalExtent = this.extent;
    this.pitch = 0.62; // radians above horizontal
    this.goalPitch = this.pitch;
  }

  // yaw (optional): look from a set compass direction instead of from behind home (a side-on close-up)
  set(focus, extent, pitch, yaw = null) {
    this.goalFocus = { x: focus.x, y: focus.y, z: focus.z || 0 };
    if (extent) this.goalExtent = extent;
    if (pitch) this.goalPitch = pitch;
    if (yaw !== null) this.yaw = yaw;
    this.goalYawMix = yaw === null ? 0 : 1;
  }

  snap() {
    this.focus = { ...this.goalFocus };
    this.extent = this.goalExtent;
    this.pitch = this.goalPitch;
    this.yawMix = this.goalYawMix || 0;
  }

  update(dt) {
    const k = 1 - Math.exp(-Math.max(0, Math.min(0.25, dt)) * 3.2);
    this.focus.x += (this.goalFocus.x - this.focus.x) * k;
    this.focus.y += (this.goalFocus.y - this.focus.y) * k;
    this.focus.z += ((this.goalFocus.z || 0) - (this.focus.z || 0)) * k;
    this.extent += (this.goalExtent - this.extent) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    const cam = this.cam;
    const aspect = cam.w / cam.h;
    // Fit the extent horizontally; on tall (portrait) screens this pulls the camera back.
    const halfFovX = Math.atan(Math.tan(cam.fovY / 2) * aspect);
    const fit = Math.max(this.extent / Math.tan(halfFovX), (this.extent * 0.75) / Math.tan(cam.fovY / 2));
    const d = fit * 1.05;
    const p = this.pitch;
    let ex = this.focus.x * 0.85, ey = this.focus.y - d * Math.cos(p);
    this.yawMix = (this.yawMix || 0) + ((this.goalYawMix || 0) - (this.yawMix || 0)) * k;
    if (this.yawMix > 0.001) {
      // swing around the focus (by angle, the short way) rather than sliding through it
      const m = this.yawMix * this.yawMix * (3 - 2 * this.yawMix);
      const hx = this.focus.x - ex, hy = this.focus.y - ey;
      const y0 = Math.atan2(hx, hy), r0 = Math.hypot(hx, hy), r1 = d * Math.cos(p);
      let dy = this.yaw - y0;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const yw = y0 + dy * m, r = r0 + (r1 - r0) * m;
      ex = this.focus.x - Math.sin(yw) * r;
      ey = this.focus.y - Math.cos(yw) * r;
    }
    const fz = this.focus.z || 0;
    cam.lookAt({ x: ex, y: ey, z: d * Math.sin(p) + fz }, { x: this.focus.x, y: this.focus.y, z: fz });
  }
}
