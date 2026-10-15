// The pitcher's delivery in 3D, as seen from behind the plate: set, leg lift (closed, glove side to
// the plate), stride, foot strike with the arm high-cocked, release out front, follow-through.
// Poses are authored for a right-hander in mound coordinates (u = glove side, v = toward home,
// z = height above the ground under that joint) and mirrored for lefties.
import { groundZ, vec3 } from '../render3d/people.js';
import { sport } from '../sport.js';

const { V, norm, cross } = vec3;
const KEYS = [0, 0.3, 0.52, 0.66, 0.8, 1.0];
// joint: [set, leg lift, stride, foot strike, release, follow-through] as [u, v, z]
const POSES = {
  hip: [[0, 0.1, 2.05], [0, 0, 2.15], [0, 1.0, 1.95], [0, 1.85, 1.8], [0, 2.35, 1.8], [0.1, 3.0, 1.75]],
  neck: [[0, 0.1, 3.45], [-0.08, -0.05, 3.55], [0, 0.75, 3.35], [-0.05, 2.0, 3.2], [-0.1, 2.95, 3.1], [0.15, 3.75, 2.8]],
  head: [[0, 0.15, 3.95], [-0.12, 0, 4.05], [0.02, 0.95, 3.8], [-0.05, 2.25, 3.65], [-0.12, 3.25, 3.45], [0.12, 4.05, 3.05]],
  shF: [[0.55, 0.1, 3.3], [-0.05, 0.55, 3.4], [0, 1.35, 3.25], [0.45, 2.25, 3.15], [0.45, 2.85, 3.0], [0.65, 3.5, 2.75]],
  shB: [[-0.55, 0.1, 3.3], [-0.05, -0.55, 3.4], [0, 0.15, 3.25], [-0.5, 1.6, 3.25], [-0.55, 3.0, 3.2], [-0.35, 3.85, 2.85]],
  elF: [[0.6, 0.35, 2.55], [-0.3, 0.45, 2.75], [0.15, 1.95, 3.1], [0.75, 2.75, 2.95], [0.7, 2.6, 2.55], [0.95, 3.3, 2.25]],
  handF: [[0.08, 0.55, 2.85], [-0.5, 0.06, 2.95], [0.2, 2.45, 3.05], [0.6, 3.05, 2.6], [0.35, 2.85, 2.55], [0.6, 3.75, 2.05]],
  elB: [[-0.6, 0.35, 2.55], [-0.3, -0.45, 2.75], [-0.2, -0.3, 2.85], [-1.05, 1.45, 3.35], [-1.0, 3.4, 3.9], [0, 4.25, 2.3]],
  handB: [[-0.06, 0.52, 2.85], [-0.5, -0.04, 2.95], [-0.35, -0.7, 2.6], [-1.1, 1.3, 4.25], [-1.0, 4.3, 4.6], [0.6, 4.05, 1.55]],
  kneeF: [[0.4, 0.35, 1.08], [-0.75, 0.2, 2.45], [0.05, 2.0, 1.25], [0.25, 3.25, 1.05], [0.22, 3.55, 1.0], [0.2, 3.85, 1.0]],
  footF: [[0.42, 0.3, 0], [-0.45, 0.25, 1.35], [0.2, 2.9, 0.35], [0.25, 3.6, 0], [0.25, 3.6, 0], [0.25, 3.6, 0]],
  kneeB: [[-0.35, 0.15, 1.08], [-0.2, -0.05, 1.12], [-0.35, 0.55, 0.95], [-0.3, 1.0, 0.75], [-0.3, 1.6, 0.7], [-0.6, 3.25, 0.95]],
  footB: [[-0.32, 0, 0], [0, -0.05, 0], [0, 0, 0], [-0.05, 0.15, 0.05], [-0.2, 0.8, 0.3], [-0.75, 3.3, 0]],
};
// Softball windmill (underhand), same six beats: set with the hands together, the arm swings up in
// front, over the top, back behind, then whips down past the hip to release, and follows through
// up in front. The hips open toward third base (for a righty) and close again at release.
const SB_KEYS = [0, 0.22, 0.45, 0.62, 0.8, 1.0];
const SB_POSES = {
  hip: [[0, 0, 2.05], [0, -0.15, 2.05], [0, 1.2, 1.95], [0, 2.0, 1.8], [0, 2.6, 1.8], [0, 2.9, 1.85]],
  neck: [[0, 0.05, 3.45], [0, -0.15, 3.45], [-0.05, 1.05, 3.4], [-0.05, 1.7, 3.3], [-0.05, 2.6, 3.2], [0, 3.0, 3.35]],
  head: [[0, 0.12, 3.95], [0, -0.1, 3.97], [-0.05, 1.1, 3.92], [-0.05, 1.8, 3.82], [-0.05, 2.7, 3.72], [0, 3.1, 3.88]],
  shF: [[0.55, 0.05, 3.3], [0.55, -0.05, 3.3], [0.3, 1.55, 3.3], [0.15, 2.25, 3.25], [0.5, 2.8, 3.15], [0.55, 3.0, 3.28]],
  shB: [[-0.55, 0.05, 3.3], [-0.55, -0.1, 3.32], [-0.35, 0.6, 3.3], [-0.2, 1.15, 3.25], [-0.55, 2.5, 3.1], [-0.55, 3.0, 3.28]],
  elF: [[0.55, 0.4, 2.65], [0.55, 0.65, 3.1], [0.35, 2.35, 3.35], [0.45, 2.8, 3.1], [0.75, 2.5, 2.8], [0.75, 3.05, 2.85]],
  handF: [[0.08, 0.6, 2.65], [0.45, 1.3, 3.2], [0.35, 3.1, 3.4], [0.45, 3.4, 3.0], [0.6, 2.4, 2.4], [0.55, 3.0, 2.4]],
  elB: [[-0.55, 0.4, 2.65], [-0.57, 0.6, 3.9], [-0.4, 0.6, 4.15], [-0.25, 0.2, 3.1], [-0.65, 2.45, 2.3], [-0.55, 3.8, 3.4]],
  handB: [[-0.05, 0.62, 2.65], [-0.55, 1.27, 4.51], [-0.4, 0.55, 4.95], [-0.28, -0.79, 2.9], [-0.7, 2.75, 1.5], [-0.35, 3.6, 4.05]],
  kneeF: [[0.32, -0.25, 1.08], [0.3, 0.3, 1.6], [0.25, 2.4, 1.3], [0.25, 3.35, 1.1], [0.25, 3.45, 1.05], [0.25, 3.5, 1.05]],
  footF: [[0.32, -0.35, 0], [0.3, 0.2, 0.55], [0.25, 2.9, 0.35], [0.25, 3.8, 0], [0.25, 3.8, 0], [0.25, 3.8, 0]],
  kneeB: [[-0.3, 0.05, 1.08], [-0.3, 0, 1.05], [-0.3, 0.65, 0.95], [-0.35, 1.05, 0.75], [-0.35, 1.75, 0.7], [-0.3, 2.85, 1.0]],
  footB: [[-0.3, 0, 0], [-0.3, 0, 0], [-0.3, 0.1, 0.05], [-0.3, 0.6, 0.05], [-0.3, 1.2, 0.05], [-0.35, 2.7, 0.05]],
};
const ease = (x) => x * x * (3 - 2 * x);
const ZK = 1.15;
// limb lengths (in units of S) that match the stretched poses
export const PITCHER_LIMBS = { upper: 1.0, lower: 0.95, thigh: 1.16, shin: 1.08 };

// p: 0..1 through the delivery (release at 0.8). hand: 'R' | 'L'. rel: the ball's release point (world).
export function pitcherJoints(p, { hand = 'R', S = 1.08, rel = null } = {}) {
  p = Math.max(0, Math.min(1, p));
  const keys = sport.softball ? SB_KEYS : KEYS, poses = sport.softball ? SB_POSES : POSES;
  // baseball: the mound's rubber; softball: the pitcher's plate (the pivot foot sits on it)
  const RUBBER_Y = sport.softball ? sport.rubber + 0.35 : 46.6;
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1]) i++;
  const k = ease((p - keys[i]) / (keys[i + 1] - keys[i]));
  const mir = hand === 'L' ? -1 : 1;
  // the throwing hand meets the real release point at p = 0.8
  const relLocal = rel ? [rel.x * mir, RUBBER_Y - rel.y, rel.z - groundZ(rel.x, rel.y)] : null;
  const local = {};
  for (const j in poses) {
    const a = poses[j][i], b = poses[j][i + 1];
    // real kid proportions: the authored poses are a little squat, so stretch everything above the feet
    const zk = j.startsWith('foot') ? S : S * ZK;
    const sc = (q) => [q[0] * S, q[1] * S, q[2] * zk];
    const A = (j === 'handB' && relLocal && i === 4) ? relLocal : sc(a);
    const B = (j === 'handB' && relLocal && i + 1 === 4) ? relLocal : sc(b);
    local[j] = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
  }
  const W = { S };
  for (const j in local) {
    const [u, v, z] = local[j];
    const x = u * mir, y = RUBBER_Y - v;
    // lefties: mirror, then swap sides so F stays the character's left
    let name = j;
    if (mir < 0) name = j.endsWith('F') ? j.slice(0, -1) + 'B' : j.endsWith('B') ? j.slice(0, -1) + 'F' : j;
    W[name] = V(x, y, z + groundZ(x, y));
  }
  const sx = W.shF.x - W.shB.x, sy = W.shF.y - W.shB.y;
  W.L = norm(V(sx, sy, 0));
  W.f = cross(W.L, V(0, 0, 1));
  return W;
}
