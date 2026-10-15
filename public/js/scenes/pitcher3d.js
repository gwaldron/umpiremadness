// The pitcher's delivery in 3D, as seen from behind the plate: set, leg lift (closed, glove side to
// the plate), stride, foot strike with the arm high-cocked, release out front, follow-through.
// Poses are authored for a right-hander in mound coordinates (u = glove side, v = toward home,
// z = height above the ground under that joint) and mirrored for lefties.
import { groundZ, vec3 } from '../render3d/people.js';

const { V, norm, cross } = vec3;
const RUBBER_Y = 46.6;
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
const ease = (x) => x * x * (3 - 2 * x);
const ZK = 1.15;
// limb lengths (in units of S) that match the stretched poses
export const PITCHER_LIMBS = { upper: 1.0, lower: 0.95, thigh: 1.16, shin: 1.08 };

// p: 0..1 through the delivery (release at 0.8). hand: 'R' | 'L'. rel: the ball's release point (world).
export function pitcherJoints(p, { hand = 'R', S = 1.08, rel = null } = {}) {
  p = Math.max(0, Math.min(1, p));
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1]) i++;
  const k = ease((p - KEYS[i]) / (KEYS[i + 1] - KEYS[i]));
  const mir = hand === 'L' ? -1 : 1;
  // the throwing hand meets the real release point at p = 0.8
  const relLocal = rel ? [rel.x * mir, RUBBER_Y - rel.y, rel.z - groundZ(rel.x, rel.y)] : null;
  const local = {};
  for (const j in POSES) {
    const a = POSES[j][i], b = POSES[j][i + 1];
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
