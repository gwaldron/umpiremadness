"""Umpire Madness heads, hair and headgear, built in Blender from code.

Run headless from the repo root:
    blender --background --factory-startup --python art/head.py
    blender --background --factory-startup --python art/head.py -- --preview <folder>   (also renders previews)

Writes public/models/head.glb (and art/out/head.blend).
Units are the game's "S", like art/player.py. Every part is built around the middle of the skull (the
game's W.head point) at the origin, facing +Y with Z up and the left (the game's F side) at -X.
The game (render3d/rig.js) merges the parts each player needs into one mesh, so a player's head,
hair and headgear are one draw call, and moves it with the player's head.

Parts:
  head                                  a kid's head: cartoon face (eyes, brows, nose, smile), ears, neck
  hair_crew, hair_shag, hair_curly      short hair styles (they peek out under caps and helmets)
  hair_sleek + tail_pony / tail_ponylow / tail_bubble
                                        softball: hair combed back into a ponytail (high for caps, low
                                        for the catcher's helmet) or a bubble braid (batting helmet)
  cap + brim / brim_short               six-panel ball cap and its curved bill (the plate umpire's is short)
  helmet                                two-flap Little League batting helmet
  cage                                  the softball batting helmet's face cage
  catcher                               hockey-style catcher's helmet with its mask and throat guard
  umpmask                               the plate umpire's mask, worn over a cap
  logo_cap_T/H, logo_helmet_T/H         team letters for the Titans and the Hawks
Every part also comes in a lighter `_lo` version for the players out on the field views (the
team letters are shared). Each face stores its region in a color attribute (red = (index + 0.5) / 16), so the game colors skin,
hair, eyes and team gear per player from a palette. Green is how far that spot of a ponytail swings,
and blue is the rosy-cheek blush.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW_DIR = ARGS[ARGS.index('--preview') + 1] if '--preview' in ARGS else None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'head.glb')
OUT_BLEND = os.path.join(ROOT, 'art', 'out', 'head.blend')

bpy.ops.wm.read_factory_settings(use_empty=True)
coll = bpy.context.scene.collection
TAU = math.tau
rad = math.radians
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

# Regions, in the order render3d/rig.js colors them
REGIONS = ['skin', 'blush', 'hair', 'brow', 'eye', 'iris', 'pupil', 'mouth', 'tie', 'shell', 'under', 'logo', 'cage', 'pad', 'vent', 'shell2']
PREVIEW = {
    'skin': '#e0ac69', 'blush': '#ec8f80', 'hair': '#5a3a22', 'brow': '#3a2414', 'eye': '#f7f5ef', 'iris': '#4f7f3a',
    'pupil': '#121014', 'mouth': '#7a2630', 'tie': '#ff4fa3', 'shell': '#1f5fe0', 'under': '#173a7a', 'logo': '#ffffff',
    'cage': '#2a2d35', 'pad': '#17181c', 'vent': '#0b0c10', 'shell2': '#163f8f',
}
mat = bpy.data.materials.new('head')
mat.use_nodes = True
mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ---------------------------------------------------------------- mesh plumbing
def new_bm():
    bm = bmesh.new()
    bm.faces.layers.int.new('reg')
    return bm


def add_face(bm, verts, reg):
    f = bm.faces.new(verts)
    f[bm.faces.layers.int['reg']] = REGIONS.index(reg)
    return f


def make(name, bm, reg=None, sway=None, blush=None, smooth=True, weld=True):
    """Mesh object from a bmesh. reg: one region for the whole piece, or None to use the face layer.
    sway(co) / blush(co): per-vertex weights for the green and blue channels."""
    if weld:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    ra = me.color_attributes.new('region', 'FLOAT_COLOR', 'CORNER')
    pa = me.color_attributes.new('preview', 'BYTE_COLOR', 'CORNER')
    layer = me.attributes.get('reg')
    skin, blc = srgb(PREVIEW['skin']), srgb(PREVIEW['blush'])
    for p in me.polygons:
        r = reg if reg is not None else REGIONS[layer.data[p.index].value]
        k = REGIONS.index(r)
        pc = srgb(PREVIEW[r])
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            g = sway(co) if sway else 0.0
            b = blush(co) if blush else 0.0
            ra.data[li].color = ((k + 0.5) / 16, g, b, 1.0)
            c = [pc[i] + (blc[i] - pc[i]) * b for i in range(3)] if r == 'skin' else pc
            pa.data[li].color = (*c, 1.0)
    if layer is not None:
        me.attributes.remove(me.attributes['reg'])
    me.color_attributes.active_color = ra
    if smooth:
        me.shade_smooth()
    else:
        me.shade_flat()
    return o


def join(name, objs):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    o.data.materials.clear()
    o.data.materials.append(mat)
    return o


def recalc(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def orient_out(bm, center):
    """Open pieces lying on the head or a shell: make every face point away from `center`."""
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(f.calc_center_median() - center) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    return bm


def sweep(bm, rows, regs, pole0=None, pole1=None, reg0=None, reg1=None, wrap=True):
    """Quad strips between consecutive rows of points. regs[j] is the band between rows j and j+1.
    pole0 / pole1 close the first / last row to a point. Winding: rows run with increasing index
    clockwise seen from where pole0 is, so a dome swept from its top faces outward."""
    V = [[bm.verts.new(p) for p in row] for row in rows]
    n = len(rows[0])
    m = n if wrap else n - 1
    for j in range(len(rows) - 1):
        for i in range(m):
            i2 = (i + 1) % n
            add_face(bm, (V[j][i], V[j][i2], V[j + 1][i2], V[j + 1][i]), regs[j])
    if pole0 is not None:
        p = bm.verts.new(pole0)
        for i in range(m):
            add_face(bm, (p, V[0][(i + 1) % n], V[0][i]), reg0)
    if pole1 is not None:
        p = bm.verts.new(pole1)
        for i in range(m):
            add_face(bm, (V[-1][i], V[-1][(i + 1) % n], p), reg1)
    return bm


def ellipsoid(c, r, segs=(24, 16), rot=None, bm=None, reg='skin'):
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    bmesh.ops.scale(tmp, vec=r, verts=tmp.verts)
    if rot is not None:
        bmesh.ops.rotate(tmp, cent=(0, 0, 0), matrix=rot, verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(c), verts=tmp.verts)
    if bm is None:
        return tmp
    me = bpy.data.meshes.new('tmp')
    tmp.to_mesh(me)
    tmp.free()
    k = len(bm.faces)
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    lay = bm.faces.layers.int['reg']
    bm.faces.ensure_lookup_table()
    for f in bm.faces[k:]:
        f[lay] = REGIONS.index(reg)
    return bm


def frames_along(pts, ref):
    """Tangent, normal, binormal at each point of a polyline (parallel transport from `ref`)."""
    n = len(pts)
    tans = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    nrm = tans[0].cross(ref)
    if nrm.length < 1e-5:
        nrm = tans[0].orthogonal()
    out = []
    for t in tans:
        nrm = nrm - t * nrm.dot(t)
        if nrm.length < 1e-6:
            nrm = t.orthogonal()
        nrm.normalize()
        out.append((t, nrm, t.cross(nrm)))
    return out


def tube(bm, pts, radius, reg, sides=8, ref=Z, squash=1.0, shape=None, caps=True):
    """Tube along a polyline. radius: number or function of s (0..1 along). shape(angle, s): multiplier."""
    pts = [Vector(p) for p in pts]
    fr = frames_along(pts, ref)
    rows = []
    for i, (p, (t, nrm, bn)) in enumerate(zip(pts, fr)):
        s = i / (len(pts) - 1)
        r = radius(s) if callable(radius) else radius
        row = []
        for k in range(sides):
            a = TAU * k / sides
            m = shape(a, s) if shape else 1.0
            row.append(p + (nrm * math.cos(a) + bn * math.sin(a) * squash) * r * m)
        rows.append(row)
    sweep(bm, rows, [reg] * (len(rows) - 1), pole0=pts[0] if caps else None, pole1=pts[-1] if caps else None, reg0=reg, reg1=reg)
    return bm


def bezier(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(p0 * u ** 3 + p1 * 3 * u * u * t + p2 * 3 * u * t * t + p3 * t ** 3)
    return out


def torus(bm, c, axis, R, r, reg, n1=20, n2=8, bumps=0, bump=0.0):
    axis = Vector(axis).normalized()
    u = axis.orthogonal().normalized()
    w = axis.cross(u)
    rows = []
    for i in range(n1 + 1):
        a = TAU * i / n1
        d = u * math.cos(a) + w * math.sin(a)
        rr = r * (1 + bump * math.sin(bumps * a)) if bumps else r
        rows.append([Vector(c) + d * (R + rr * math.cos(b)) + axis * rr * math.sin(b) for b in (TAU * k / n2 for k in range(n2))])
    sweep(bm, rows, [reg] * n1)
    return bm


def sym_curve(keys):
    """Smooth, overshoot-free function of the angle round the head (radians) through (degrees, value)
    keys given for 0..180 and mirrored onto the left side."""
    ks = sorted(keys)
    xs = [k[0] for k in ks]
    ys = [k[1] for k in ks]
    Xs = [-x for x in reversed(xs[1:])] + xs + [360 - x for x in reversed(xs[:-1])]
    Ys = list(reversed(ys[1:])) + ys + list(reversed(ys[:-1]))
    d = [(Ys[i + 1] - Ys[i]) / (Xs[i + 1] - Xs[i]) for i in range(len(Xs) - 1)]
    m = [0.0] * len(Xs)
    for i in range(1, len(Xs) - 1):
        if d[i - 1] * d[i] > 0:
            m[i] = 2 * d[i - 1] * d[i] / (d[i - 1] + d[i])

    def f(th):
        t = math.degrees(th) % 360
        if t > 180:
            t = 360 - t
        i = 0
        while i < len(Xs) - 2 and Xs[i + 1] < t:
            i += 1
        h = Xs[i + 1] - Xs[i]
        s = (t - Xs[i]) / h
        return ((2 * s ** 3 - 3 * s ** 2 + 1) * Ys[i] + (s ** 3 - 2 * s ** 2 + s) * h * m[i]
                + (-2 * s ** 3 + 3 * s ** 2) * Ys[i + 1] + (s ** 3 - s ** 2) * h * m[i + 1])
    return f


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def tri(x):
    """Triangle wave, 0..1, period 1."""
    x = x % 1.0
    return 1 - abs(2 * x - 1)


def fringe(th, depth, period, width):
    """Spiky bangs: a zigzag that drops the hairline in points across the forehead."""
    a = abs(((math.degrees(th) + 180) % 360) - 180)
    return -depth * tri(math.degrees(th) / period) * (1 - smoothstep(width * 0.6, width, a))


# ---------------------------------------------------------------- the shape of the head
C0 = Vector((0.0, -0.01, 0.02))          # middle of the skull
SKULL_R = Vector((0.315, 0.345, 0.36))
FACE_C, FACE_R = Vector((0, 0.10, -0.12)), Vector((0.27, 0.24, 0.22))
JAW_C, JAW_R = Vector((0, 0.15, -0.22)), Vector((0.17, 0.16, 0.13))
BVH = None   # the head being built (for laying the face on it)


def ray_ellipsoid(o, d, c, r):
    oc = Vector(((o.x - c.x) / r.x, (o.y - c.y) / r.y, (o.z - c.z) / r.z))
    dd = Vector((d.x / r.x, d.y / r.y, d.z / r.z))
    a, b, cc = dd.dot(dd), 2 * oc.dot(dd), oc.dot(oc) - 1
    disc = b * b - 4 * a * cc
    if disc < 0:
        return None
    t = (-b + math.sqrt(disc)) / (2 * a)
    return t if t > 0 else None


def direction(th, ph):
    """th: round the head from the front (+Y) toward the right (+X); ph: up from level."""
    return Vector((math.cos(ph) * math.sin(th), math.cos(ph) * math.cos(th), math.sin(ph)))


def hair_pt(th, ph, off):
    """A point `off` above the skull (and the cheeks) in direction (th, ph) from the skull's middle."""
    d = direction(th, ph)
    t = max(x for x in (ray_ellipsoid(C0, d, C0, SKULL_R), ray_ellipsoid(C0, d, FACE_C, FACE_R)) if x)
    return C0 + d * (t + off)


def gear_pt(th, ph, off, hang=0.35):
    """A point on an ellipsoid `off` outside the skull; below the equator the sides hang straighter
    (helmet flaps and cap bands don't curl in under the cheekbones)."""
    c = math.cos(ph)
    if ph < 0:
        c = c ** hang
    return C0 + Vector(((SKULL_R.x + off) * c * math.sin(th), (SKULL_R.y + off) * c * math.cos(th), (SKULL_R.z + off) * math.sin(ph)))


def head_mesh(tris):
    """The kid's head fused from soft shapes (skull, cheeks, chin, button nose, ears, neck), as a bmesh."""
    bm = bmesh.new()
    shapes = [
        (C0, SKULL_R, None),
        (FACE_C, FACE_R, None),
        (JAW_C, JAW_R, None),
        (Vector((0.135, 0.19, -0.115)), Vector((0.12, 0.11, 0.1)), None),     # cheeks
        (Vector((-0.135, 0.19, -0.115)), Vector((0.12, 0.11, 0.1)), None),
        (Vector((0, 0.335, -0.055)), Vector((0.044, 0.042, 0.05)), None),     # button nose
        (Vector((0, -0.035, -0.28)), Vector((0.12, 0.12, 0.12)), None),       # neck under the jaw
    ]
    for sx in (1, -1):  # ears, tops tipped back
        shapes.append((Vector((sx * 0.298, -0.025, -0.025)), Vector((0.05, 0.08, 0.108)), Matrix.Rotation(rad(14), 3, 'X')))
    for c, r, rot in shapes:
        tmp = ellipsoid(c, r, (40, 24), rot)
        me = bpy.data.meshes.new('tmp')
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new('head_raw')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('head_raw', me)
    coll.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    rm = o.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = 0.0075
    rm.adaptivity = 0.0
    bpy.ops.object.modifier_apply(modifier='remesh')
    sm = o.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    sm.factor = 0.5
    sm.iterations = 10
    sm.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier='smooth')
    dec = o.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = tris / max(1, len(o.data.polygons) * 2)
    bpy.ops.object.modifier_apply(modifier='decimate')
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bpy.data.objects.remove(o)
    bpy.data.meshes.remove(me)
    return bm


def on_face(x, z, h=0.0):
    """The point on the face straight in front of (x, z), lifted h toward the viewer (+Y)."""
    loc, nrm, _, _ = BVH.ray_cast(Vector((x, 1.0, z)), -Y, 3.0)
    return loc + Y * h


def polar(bm, map2, rx, rz, profile, n_ang=24):
    """Disc / rings decal. map2(a, b, h) -> point for local coords (a, b) and lift h.
    profile: [(r, h, region of the band from the previous ring)], the first entry is the centre."""
    angs = [TAU * k / n_ang for k in range(n_ang)]
    r0, h0, reg0 = profile[0]
    rows, regs = [], []
    for r, h, reg in profile[1:]:
        rows.append([map2(r * rx * math.cos(a), r * rz * math.sin(a), h) for a in angs])
        regs.append(reg)
    sweep(bm, rows, regs[1:], pole0=map2(0, 0, h0), reg0=regs[0])
    return bm


def face_parts(Q, N):
    """Eyes (big glossy whites, iris, pupil, sparkle, lash line), brows and a big smile, laid on the face."""
    parts = []
    for sx in (1, -1):
        ex, ez, erx, erz = sx * 0.112, 0.008, 0.047, 0.059

        def dome(a, b, erx=erx, erz=erz):
            r2 = (a / erx) ** 2 + (b / erz) ** 2
            return 0.018 * math.sqrt(max(0.0, 1 - r2)) - 0.0045

        def eye_pt(a, b, h, ex=ex, ez=ez, dome=dome):
            return on_face(ex + a, ez + b, max(dome(a, b), 0.0) + h)

        def white_pt(a, b, h, ex=ex, ez=ez, dome=dome):
            return on_face(ex + a, ez + b, dome(a, b))

        rings = (0.25, 0.5, 0.7, 0.85, 0.95, 1.0) if Q > 0.6 else (0.55, 0.88, 1.0)
        bm = new_bm()
        polar(bm, white_pt, erx, erz, [(0, 0, 'eye')] + [(r, 0, 'eye') for r in rings], n_ang=N(28, 12))
        parts.append(make('eye', orient_out(bm, C0)))
        ic = (sx * 0.004, -0.008)  # irises look a touch inward and down: friendly, not startled

        def iris_pt(a, b, h, ic=ic, eye_pt=eye_pt):
            return eye_pt(ic[0] + a, ic[1] + b, h)
        bm = new_bm()
        polar(bm, iris_pt, 0.031, 0.036, [(0, 0.0016, 'iris'), (0.5, 0.0016, 'iris'), (1.0, 0.0016, 'iris')], n_ang=N(20, 10))
        polar(bm, iris_pt, 0.017, 0.02, [(0, 0.0028, 'pupil'), (0.6, 0.0028, 'pupil'), (1.0, 0.0028, 'pupil')], n_ang=N(16, 8))

        def spark_pt(a, b, h, ic=ic, eye_pt=eye_pt):
            return eye_pt(ic[0] + 0.011 + a, ic[1] + 0.014 + b, h)
        polar(bm, spark_pt, 0.009, 0.009, [(0, 0.004, 'eye'), (1.0, 0.004, 'eye')], n_ang=N(10, 6))
        parts.append(make('iris', orient_out(bm, C0)))
        # upper lash line: a dark crescent along the top of the eye, thickest at the outer corner
        rows = []
        nk = N(15, 7)
        for w in (0.88, 1.0, 1.12):
            row = []
            for k in range(nk):
                a = rad(8 + 164 * k / (nk - 1))
                r = 1.0 + (w - 1.0) * (1.0 + 0.9 * max(0.0, math.cos(a) * sx))
                aa, bb = erx * r * math.cos(a), erz * r * math.sin(a)
                row.append(on_face(ex + aa, ez + bb, max(dome(aa, bb), 0.0) + 0.0016))
            rows.append(row)
        bm = new_bm()
        sweep(bm, rows, ['pupil', 'pupil'], wrap=False)
        parts.append(make('lash', orient_out(bm, C0)))
        # eyebrow: a soft arch
        rows = []
        nk = N(13, 6)
        ws = (-1, -0.5, 0, 0.5, 1) if Q > 0.6 else (-1, 0, 1)
        for w in ws:
            row = []
            for k in range(nk):
                s = k / (nk - 1)
                x = sx * (0.058 + 0.112 * s)
                z = 0.104 + 0.024 * math.sin(math.pi * s * 0.95) - 0.012 * s
                hw = 0.0115 * (0.45 + 0.55 * math.sin(math.pi * (0.15 + 0.8 * s)))
                row.append(on_face(x, z + w * hw, 0.0035 + 0.0035 * (1 - w * w)))
            rows.append(row)
        bm = new_bm()
        sweep(bm, rows, ['brow'] * (len(ws) - 1), wrap=False)
        parts.append(make('brow', orient_out(bm, C0)))
    # a big open smile with a row of teeth
    rows = []
    nw = 8 if Q > 0.6 else 4
    nk = N(17, 9)
    for j in range(nw + 1):
        w = j / nw
        row = []
        for k in range(nk):
            s = -1 + 2 * k / (nk - 1)
            ztop = -0.172 + 0.024 * s * s
            zbot = ztop - 0.05 * (1 - s * s) ** 0.75
            row.append(on_face(0.078 * s, ztop + (zbot - ztop) * w, 0.0035))
        rows.append(row)
    bm = new_bm()
    teeth = nw // 4
    sweep(bm, rows, ['eye'] * teeth + ['mouth'] * (nw - teeth), wrap=False)
    parts.append(make('mouth', orient_out(bm, C0)))
    return parts


# ---------------------------------------------------------------- shells: hair, caps, helmets
def shell(pt, edge, o_out, o_in=None, n_th=96, n_t=20, n_in=6, reg_out='shell', reg_lip='pad', reg_in='pad', under=-0.012, lip_r=0.4):
    """A cap of hair, or a cap / helmet shell, from the crown down to an edge.
    pt(th, ph, off): surface point; edge(th): elevation of the edge (radians);
    o_out(th, ph, t) / o_in(...): outside / inside offsets (t = 0 at the crown, 1 at the edge).
    Without o_in it's hair: the edge rolls under into the head (offset `under`) and stays open."""
    ths = [TAU * i / n_th for i in range(n_th)]

    def ph_at(th, t):
        return math.pi / 2 - t * (math.pi / 2 - edge(th))
    rows, regs = [], []
    for j in range(1, n_t + 1):
        t = j / n_t
        rows.append([pt(th, ph_at(th, t), o_out(th, ph_at(th, t), t)) for th in ths])
        if j > 1:
            regs.append(reg_out)
    bm = new_bm()
    if o_in is None:
        rows.append([pt(th, edge(th) - 0.5 * (o_out(th, edge(th), 1.0) - under) / lip_r * 0.6, 0.5 * (o_out(th, edge(th), 1.0) + under)) for th in ths])
        regs.append(reg_out)
        rows.append([pt(th, edge(th) + rad(4), under) for th in ths])
        regs.append(reg_out)
        sweep(bm, rows, regs, pole0=pt(0, math.pi / 2, o_out(0, math.pi / 2, 0)), reg0=reg_out)
        return bm
    rows.append([pt(th, edge(th) - 0.5 * (o_out(th, edge(th), 1.0) - o_in(th, edge(th), 1.0)) / lip_r, 0.5 * (o_out(th, edge(th), 1.0) + o_in(th, edge(th), 1.0))) for th in ths])
    regs.append(reg_lip)
    for j in range(n_in, 0, -1):
        t = j / n_in
        rows.append([pt(th, ph_at(th, t), o_in(th, ph_at(th, t), t)) for th in ths])
        regs.append(reg_lip if j == n_in else reg_in)
    sweep(bm, rows, regs, pole0=pt(0, math.pi / 2, o_out(0, math.pi / 2, 0)), pole1=pt(0, math.pi / 2, o_in(0, math.pi / 2, 0)), reg0=reg_out, reg1=reg_in)
    return recalc(bm)


def slab(bm, fn, ra, rb, h, regs=('shell', 'pad', 'pad'), n_ang=32, n_ring=5, e=0.45, lip=0.0):
    """A thick rounded plate. fn(a, b, off) -> point for local coords (a, b) and offset off.
    The outline is a superellipse (e < 1 is boxier); regs: top, edge, bottom."""
    def ring(s, off):
        out = []
        for k in range(n_ang):
            ang = TAU * k / n_ang
            c, sn = math.cos(ang), math.sin(ang)
            out.append(fn(ra * s * math.copysign(abs(c) ** e, c), rb * s * math.copysign(abs(sn) ** e, sn), off))
        return out
    rows, rg = [], []
    for k in range(1, n_ring + 1):
        rows.append(ring(k / n_ring, h / 2))
        if k > 1:
            rg.append(regs[0])
    rows.append(ring(1 + lip, 0.0))
    rg.append(regs[1])
    for k in range(n_ring, 0, -1):
        rows.append(ring(k / n_ring, -h / 2))
        rg.append(regs[1] if k == n_ring else regs[2])
    sweep(bm, rows, rg, pole0=fn(0, 0, h / 2), pole1=fn(0, 0, -h / 2), reg0=regs[0], reg1=regs[2])
    return recalc(bm)


# hairlines (degrees up from level, round the head from the front)
CREW_EDGE = sym_curve([(0, 31), (40, 26), (62, 9), (69, -12), (74, -12), (79, 15), (104, 15), (114, -10), (135, -30), (160, -38), (180, -40)])
SHAG_EDGE = sym_curve([(0, 12), (40, 10), (64, -4), (74, -26), (100, -28), (130, -38), (180, -50)])
CURLY_EDGE = sym_curve([(0, 26), (45, 21), (64, 6), (78, 8), (104, 8), (115, -14), (140, -30), (180, -36)])
SLEEK_EDGE = sym_curve([(0, 30), (40, 25), (62, 8), (69, -8), (74, -8), (79, 15), (104, 15), (114, -10), (135, -30), (160, -38), (180, -40)])

# curls: little domes scattered evenly over the head
GOLD = math.pi * (3 - math.sqrt(5))
CURLS = []
for i in range(230):
    zc = 1 - 2 * (i + 0.5) / 230
    rr = math.sqrt(1 - zc * zc)
    CURLS.append(Vector((math.cos(GOLD * i) * rr, math.sin(GOLD * i) * rr, zc)))
CURL_A = rad(9.5)
CURL_COS = math.cos(CURL_A)


def curl_bump(d):
    best = 0.0
    for c in CURLS:
        cosang = d.dot(c)
        if cosang > CURL_COS:
            a = math.acos(min(1.0, cosang)) / CURL_A
            best = max(best, math.sqrt(max(0.0, 1 - a * a)))
    return best


def hair_crew(th, ph, t):
    return 0.022 + 0.006 * math.sin(5 * th) * math.sin(3 * ph) * (1 - t)


def hair_shag(th, ph, t):
    side = smoothstep(35, 75, abs(((math.degrees(th) + 180) % 360) - 180))
    return 0.032 + 0.006 * math.sin(7 * th + 2 * ph) + 0.036 * t ** 3 * side


def hair_curly(th, ph, t):
    o = 0.026 + 0.036 * curl_bump(direction(th, ph))
    if ph > rad(10):  # tucked flatter on top so caps and helmets still fit
        o = min(o, 0.044)
    return o


def hair_sleek(th, ph, t):
    return 0.024 + 0.002 * math.sin(40 * th) * (1 - t)  # combed-back strands


# ball cap: the band sits just above the brows, with a snapback opening at the back
CAP_EDGE = sym_curve([(0, 17), (40, 14), (90, 7), (130, 0), (150, -4), (158, -4), (166, 2), (173, 10), (180, 12)])
CAP_O = 0.058


def cap_env(t):
    return math.sin(math.pi * min(1.0, t)) ** 0.7


def cap_out(th, ph, t):
    pillow = 0.008 * math.sin(3 * (th - rad(30))) ** 2           # six panels puff out between the seams
    front = 0.016 * max(0.0, math.cos(th)) ** 2                    # structured front stands up taller
    return CAP_O + (pillow + front) * cap_env(t)


def cap_in(th, ph, t):
    return CAP_O - 0.011 + 0.016 * max(0.0, math.cos(th)) ** 2 * cap_env(t)


def brim(bm, length, width_deg, drop, curve, thick, nu, nv, edge, off, reg_top='shell', reg_bot='under'):
    """A curved bill on the front of a cap (or helmet): D-shaped from above, bent down at the sides."""
    A, B = [], []
    for i in range(nu + 1):
        th = rad(width_deg) * (-1 + 2 * i / nu)
        A.append(gear_pt(th, edge(th), off(th)))
    ys, xs, tip = A[0].y, abs(A[0].x), A[nu // 2].y + length
    for i in range(nu + 1):
        u = -1 + 2 * i / nu
        B.append(Vector((xs * math.sin(u * math.pi / 2), ys + (tip - ys) * max(0.0, math.cos(u * math.pi / 2)) ** 0.75, 0)))
    lens = [math.hypot(b.x - a.x, b.y - a.y) for a, b in zip(A, B)]

    def top(i, v):
        u = -1 + 2 * i / nu
        a = A[i]
        p = a.lerp(Vector((B[i].x, B[i].y, a.z)), v)
        p.z -= (drop * v + curve * math.sin(u * math.pi / 2) ** 2 * v ** 1.2) * lens[i] / lens[nu // 2]
        return p
    rows_top = [[top(i, j / nv) for i in range(nu + 1)] for j in range(nv + 1)]
    rows_bot = [[p - Vector((0, 0, thick)) for p in row] for row in rows_top]
    mid = []
    for i in range(nu + 1):
        p = (rows_top[-1][i] + rows_bot[-1][i]) / 2
        out = rows_top[-1][i] - rows_top[-2][i]
        out.z = 0
        mid.append(p + (out.normalized() * thick * 0.55 if out.length > 1e-6 else Vector()))
    rows = rows_top + [mid] + list(reversed(rows_bot))
    regs = [reg_top] * nv + [reg_top, reg_bot] + [reg_bot] * nv
    sweep(bm, rows, regs, wrap=False)
    return bm


# batting helmet: two ear flaps; the back covers the back of the head
HELMET_EDGE = sym_curve([(0, 21), (32, 19), (46, 9), (56, -20), (68, -40), (95, -45), (116, -38), (128, -18), (142, -16), (180, -22)])
H_OUT, H_IN = 0.098, 0.062
# catcher's helmet: down to the jaw at the sides, open in front for the mask
CATCH_EDGE = sym_curve([(0, 22), (30, 20), (44, 6), (54, -22), (64, -52), (90, -56), (120, -48), (150, -40), (180, -40)])
CA_OUT, CA_IN = 0.088, 0.058


def catcher_out(th, ph, t):
    x = math.cos(ph) * math.sin(th)
    ridge = 0.012 * math.exp(-(x / 0.07) ** 2) * smoothstep(-0.2, 0.3, math.sin(ph) + 0.25 * math.cos(th))
    return CA_OUT + ridge


def cage_bar_pt(th, z, rx=0.405, ry=0.505):
    return Vector((rx * math.sin(th), C0.y + ry * math.cos(th), z))


# ---------------------------------------------------------------- one level of detail
def build(Q, sfx):
    """Every part at detail Q (1 = close-ups; less for players far out on the field)."""
    global BVH

    def N(k, lo=4):
        return max(lo, int(round(k * Q)))
    P = {}
    hd = head_mesh(3000 * Q)
    BVH = BVHTree.FromBMesh(hd)
    # cheeks, nose tip and the inside of the ears get a rosy blush (blended in by the game's shader)
    cheeks = [on_face(sx * 0.178, -0.105) for sx in (1, -1)]
    nose = on_face(0, -0.06)
    ears = [Vector((sx * 0.335, -0.02, -0.03)) for sx in (1, -1)]

    def blush_at(co):
        w = 0.0
        for c in cheeks:
            w = max(w, 0.85 * max(0.0, 1 - (co - c).length / 0.08) ** 1.4)
        w = max(w, 0.4 * max(0.0, 1 - (co - nose).length / 0.035))
        for c in ears:
            w = max(w, 0.55 * max(0.0, 1 - (co - c).length / 0.07))
        return w
    face = face_parts(Q, N)
    P['head'] = join('head' + sfx, [make('head' + sfx, hd, reg='skin', blush=blush_at)] + face)

    # ----- hair
    P['hair_crew'] = make('hair_crew' + sfx, shell(hair_pt, lambda th: rad(CREW_EDGE(th) + fringe(th, 7, 12, 50)), hair_crew, n_th=N(88, 40), n_t=N(13, 7), reg_out='hair'))
    P['hair_shag'] = make('hair_shag' + sfx, shell(hair_pt, lambda th: rad(SHAG_EDGE(th) + fringe(th, 6, 13, 55) - 5 * tri(math.degrees(th) / 17)), hair_shag, n_th=N(96, 44), n_t=N(15, 7), reg_out='hair'))
    P['hair_curly'] = make('hair_curly' + sfx, shell(hair_pt, lambda th: rad(CURLY_EDGE(th) - 6 * curl_bump(direction(th, rad(CURLY_EDGE(th))))), hair_curly, n_th=N(96, 48), n_t=N(20, 10), reg_out='hair'))

    def pony(name, tie, c1, c2, end, drop):
        """A ponytail with a scrunchie at `tie`, hanging down the back."""
        bm = new_bm()
        tube(bm, bezier(tie, c1, c2, end, N(18, 8)), lambda s: 0.022 + 0.06 * math.sin(math.pi * min(1.0, 0.15 + s * 0.95)) ** 0.8 * (1 - s) ** 0.35,
             'hair', sides=N(12, 7), ref=X, shape=lambda a, s: 1 + 0.07 * math.cos(7 * a + 6 * s))
        tail = make('pony_tail', recalc(bm), sway=lambda co: max(0.0, min(1.0, (tie.z - co.z) / drop)) ** 1.3)
        bm = new_bm()
        torus(bm, tie + Vector((0, -0.01, 0)), (0, -1, -0.25), 0.042, 0.02, 'tie', n1=N(24, 12), n2=N(8, 5), bumps=11, bump=0.22)
        return join(name + sfx, [tail, make('pony_tie', recalc(bm))])
    # tied high at the back, out through the cap's back opening
    P['tail_pony'] = pony('tail_pony', Vector((0, -0.395, 0.02)), (0, -0.52, -0.01), (0, -0.53, -0.32), (0, -0.45, -0.6), 0.62)
    # tied low at the nape, out under the back of a catcher's helmet
    P['tail_ponylow'] = pony('tail_ponylow', Vector((0, -0.43, -0.25)), (0, -0.5, -0.29), (0, -0.51, -0.5), (0, -0.45, -0.75), 0.5)
    # bubble braid: puffs of hair with bright ties between, hanging from the nape
    b0 = Vector((0, -0.385, -0.13))
    path = bezier(b0, (0, -0.47, -0.2), (0, -0.47, -0.48), (0, -0.42, -0.78), 60)
    cum = [0.0]
    for a, b in zip(path, path[1:]):
        cum.append(cum[-1] + (b - a).length)

    def along(dist):
        for i in range(1, len(cum)):
            if cum[i] >= dist:
                u = (dist - cum[i - 1]) / max(1e-9, cum[i] - cum[i - 1])
                return path[i - 1].lerp(path[i], u)
        return path[-1]
    bm, ties = new_bm(), new_bm()
    dist = 0.0
    torus(ties, along(0.0), (0, -0.6, -0.8), 0.046, 0.016, 'tie', n1=N(18, 10), n2=N(7, 4))
    for r in (0.085, 0.077, 0.069, 0.061, 0.053):
        ellipsoid(along(dist + r * 0.88), (r, r * 0.95, r * 0.88), (N(14, 8), N(9, 6)), bm=bm, reg='hair')
        dist += r * 1.76
        torus(ties, along(dist), (along(dist + 0.01) - along(dist - 0.01)).normalized(), r * 0.36, 0.014, 'tie', n1=N(12, 8), n2=N(6, 4))
    end = along(dist)
    tube(bm, [end, end + Vector((0, 0.01, -0.06)), end + Vector((0, 0.02, -0.11))], lambda s: 0.03 * (1 - s) + 0.006, 'hair', sides=N(10, 6))
    braid_sway = lambda co: max(0.0, min(1.0, (b0.z - co.z) / 0.7)) ** 1.3
    P['tail_bubble'] = join('tail_bubble' + sfx, [make('braid', recalc(bm), sway=braid_sway), make('braid_ties', recalc(ties), sway=braid_sway)])
    # the hair under all three, combed back (the game adds the tail)
    P['hair_sleek'] = join('hair_sleek' + sfx, [make('hair_sleek', shell(hair_pt, lambda th: rad(SLEEK_EDGE(th)), hair_sleek, n_th=N(80, 36), n_t=N(13, 6), reg_out='hair'))])
    for k in ('crew', 'shag', 'curly'):
        P['hair_' + k] = join('hair_' + k + sfx, [P['hair_' + k]])

    # ----- ball caps
    def bill(name, brim_len):
        bm = new_bm()
        long_bill = brim_len > 0.2
        brim(bm, brim_len, 80, 0.03 if long_bill else 0.02, 0.07 if long_bill else 0.035, 0.014, N(18, 10), N(5, 3),
             edge=lambda th: rad(CAP_EDGE(th)), off=lambda th: CAP_O - 0.004)
        return join(name + sfx, [make(name, bm)])

    def cap(name):
        parts = []
        bm = shell(gear_pt, lambda th: rad(CAP_EDGE(th)), cap_out, cap_in, n_th=N(64, 30), n_t=N(12, 6), n_in=N(3, 2),
                   reg_out='shell', reg_lip='shell', reg_in='under', lip_r=0.42)
        parts.append(make(name + '_crown', bm))
        bm = new_bm()
        top = gear_pt(0, math.pi / 2, CAP_O)
        ellipsoid(top + Vector((0, 0, 0.004)), (0.024, 0.024, 0.013), (N(14, 8), N(8, 5)), bm=bm, reg='shell')   # button
        if Q > 0.6:
            for k in range(6):  # sewn eyelets
                th = rad(60 * k)
                polar(bm, lambda a, b, h, th=th: gear_pt(th + a / 0.3, rad(56) + b / 0.42, cap_out(th + a / 0.3, rad(56) + b / 0.42, 0.45) + h),
                      0.008, 0.008, [(0, 0.0012, 'vent'), (1.0, 0.0012, 'vent')], n_ang=8)
        parts.append(make(name + '_bits', orient_out(bm, C0)))
        # snapback strap across the bottom of the back opening
        arc = [gear_pt(rad(a), rad(-1.5), CAP_O - 0.002) for a in range(150, 211, 5 if Q > 0.6 else 10)]
        bm = new_bm()
        tube(bm, arc, 0.014, 'shell2', sides=N(8, 4), ref=-Y, squash=0.3)
        parts.append(make(name + '_strap', recalc(bm)))
        return join(name + sfx, parts)
    P['cap'] = cap('cap')                       # the crown; the game adds a bill:
    P['brim'] = bill('brim', 0.27)              # a player's curved bill
    P['brim_short'] = bill('brim_short', 0.16)  # the plate umpire's short one (it clears his mask)

    # ----- batting helmet
    parts = []
    bm = shell(gear_pt, lambda th: rad(HELMET_EDGE(th)), lambda th, ph, t: H_OUT, lambda th, ph, t: H_IN,
               n_th=N(72, 34), n_t=N(14, 7), n_in=N(3, 2), reg_out='shell', reg_lip='pad', reg_in='pad', lip_r=0.45)
    parts.append(make('helmet_shell', bm))
    bm = new_bm()
    brim(bm, 0.105, 44, 0.035, 0.012, 0.02, N(14, 8), N(4, 2), edge=lambda th: rad(HELMET_EDGE(th)) + rad(1),
         off=lambda th: H_OUT - 0.012, reg_top='shell', reg_bot='shell')
    parts.append(make('helmet_visor', bm))
    bm = new_bm()
    for sx in (1, -1):  # ear holes with a raised ring
        th0, ph0 = sx * rad(92), rad(-12)

        def ear(a, b, h, th0=th0, ph0=ph0):
            return gear_pt(th0 + a / 0.4, ph0 + b / 0.45, H_OUT + h)
        polar(bm, ear, 0.03, 0.03, [(0, -0.004, 'vent'), (0.6, -0.003, 'vent'), (1.0, 0.003, 'vent'), (1.04, 0.006, 'shell2'),
                                   (1.4, 0.006, 'shell2'), (1.6, -0.003, 'shell2')], n_ang=N(20, 10))
    for sx in (1, -1):  # vents on top
        for th0, ph0, ln in ((rad(16), rad(52), 0.05), (rad(34), rad(40), 0.04)):
            th1 = sx * th0

            def vent(a, b, h, th1=th1, ph0=ph0):
                return gear_pt(th1 + a / 0.3, ph0 + b / 0.45, H_OUT + h)
            polar(bm, vent, 0.016, ln, [(0, 0.0015, 'vent'), (1.0, 0.0015, 'vent')], n_ang=N(14, 8))
    parts.append(make('helmet_bits', orient_out(bm, C0)))
    P['helmet'] = join('helmet' + sfx, parts)

    # ----- softball face cage, bolted to both ear flaps: bars below the eyes, round the front of the face
    bm = new_bm()
    sides = N(6, 4)
    for z, k in ((-0.055, 1.0), (-0.15, 1.0), (-0.245, 0.97), (-0.32, 0.88)):
        span = rad(60) if z > -0.3 else rad(50)
        n = N(30, 12)
        tube(bm, [cage_bar_pt(-span + 2 * span * i / n, z, 0.405 * k, 0.505 * k) for i in range(n + 1)], 0.0125, 'cage', sides=sides)
    for th in (0.0, rad(20), rad(-20), rad(40), rad(-40)):
        pts = []
        for i in range(N(12, 5) + 1):
            z = -0.055 - (0.32 - 0.055) * i / N(12, 5)
            k = 1.0 if z > -0.15 else 1.0 - 0.12 * (z + 0.15) / -0.17
            pts.append(cage_bar_pt(th, z, 0.405 * k, 0.505 * k))
        tube(bm, pts, 0.0125, 'cage', sides=sides)
    for sx in (1, -1):  # mounting brackets on the flaps
        for z in (-0.055, -0.245):
            ellipsoid(cage_bar_pt(sx * rad(60), z) + Vector((sx * 0.004, -0.01, 0)), (0.022, 0.026, 0.02), (N(10, 6), N(6, 4)), bm=bm, reg='cage')
    P['cage'] = join('cage' + sfx, [make('cage', recalc(bm))])

    # ----- catcher's helmet with its mask
    parts = []
    edge = lambda th: rad(CATCH_EDGE(th))
    bm = shell(gear_pt, edge, catcher_out, lambda th, ph, t: CA_IN, n_th=N(72, 34), n_t=N(14, 7), n_in=N(3, 2), reg_out='shell', reg_lip='pad', reg_in='pad', lip_r=0.45)
    parts.append(make('catcher_shell', bm))
    bm = new_bm()  # the adjustable back plate
    slab(bm, lambda a, b, off: gear_pt(math.pi + a, rad(-17) + b, 0.102 + off), 0.55, 0.22, 0.02, regs=('shell', 'shell2', 'pad'), n_ang=N(28, 14), n_ring=N(4, 2), e=0.5)
    parts.append(make('catcher_plate', bm))
    bm = new_bm()  # vents along the top and sides
    for th0, ph0, ln in ((rad(28), rad(48), 0.05), (rad(60), rad(25), 0.04)):
        for sx in (1, -1):
            th1 = sx * th0

            def vent(a, b, h, th1=th1, ph0=ph0):
                return gear_pt(th1 + a / 0.3, ph0 + b / 0.45, catcher_out(th1 + a / 0.3, ph0 + b / 0.45, 0.5) + h)
            polar(bm, vent, 0.015, ln, [(0, 0.0015, 'vent'), (1.0, 0.0015, 'vent')], n_ang=N(14, 8))
    parts.append(make('catcher_vents', orient_out(bm, C0)))
    bm = new_bm()  # the mask: a padded frame round the face opening, then the cage
    sides = N(6, 4)
    n = N(32, 14)
    rim = [gear_pt(rad(-62 + 124 * i / n), edge(rad(-62 + 124 * i / n)) - rad(2), (CA_OUT + CA_IN) / 2 + 0.004) for i in range(n + 1)]
    tube(bm, rim, 0.022, 'cage', sides=N(8, 5))
    jl, jr = rim[0], rim[-1]
    tube(bm, bezier(jl, jl + Vector((0.06, 0.2, -0.06)), jr + Vector((-0.06, 0.2, -0.06)), jr, N(18, 9)), 0.022, 'cage', sides=N(8, 5))

    def cage_surf(x, z):
        """The front of the cage: a rounded shell well clear of the nose."""
        return Vector((x, 0.47 - 1.15 * x * x - 0.35 * (z + 0.1) ** 2, z))
    for z in (-0.06, -0.16, -0.26):  # bars below the eyes, round the mouth and chin
        half = 0.3 if z > -0.2 else 0.25
        n = N(18, 9)
        tube(bm, [cage_surf(-half + 2 * half * i / n, z) for i in range(n + 1)], 0.013, 'cage', sides=sides)
    n = N(10, 5)
    for x in (0.0, 0.1, -0.1):
        tube(bm, [cage_surf(x, -0.06 - 0.3 * i / n) for i in range(n + 1)], 0.013, 'cage', sides=sides)
    for sx in (1, -1):  # side bars up to the brow
        tube(bm, [cage_surf(sx * (0.27 - 0.04 * i / n), 0.13 - 0.19 * i / n) for i in range(n + 1)], 0.013, 'cage', sides=sides)
    n = N(20, 8)
    tube(bm, [cage_surf(-0.27 + 0.54 * i / n, 0.13) for i in range(n + 1)], 0.014, 'cage', sides=sides)  # brow bar
    parts.append(make('catcher_cage', recalc(bm)))
    bm = new_bm()  # throat guard hanging under the chin
    tg_c = Vector((0, 0.33, -0.5))
    slab(bm, lambda a, b, off: tg_c + Vector((a, off + 0.25 * a * a + 0.12 * b, b)), 0.075, 0.07, 0.014, regs=('pad', 'pad', 'pad'), n_ang=N(28, 12), n_ring=N(4, 2), e=0.6)
    tube(bm, [Vector((0, 0.36, -0.4)), tg_c + Vector((0, 0.0, 0.05))], 0.012, 'pad', sides=sides)
    parts.append(make('catcher_throat', bm))
    P['catcher'] = join('catcher' + sfx, parts)

    # ----- the plate umpire's mask, worn over a cap
    parts = []
    bm = new_bm()
    cz, hw, hh = -0.11, 0.232, 0.245
    nl = N(32, 14)
    loop = []
    for i in range(nl):
        a = TAU * i / nl
        c, s = math.cos(a), math.sin(a)
        loop.append((hw * math.copysign(abs(c) ** 0.8, c), cz + hh * math.copysign(abs(s) ** 0.8, s)))

    def on_head(x, z, h):
        d = Vector((x, 0.42, z + 0.05)).normalized()
        loc, nrm, _, _ = BVH.ray_cast(Vector((0, 0.05, -0.05)) + d * 1.5, -d, 3.0)
        return loc + d * h
    pads = [on_head(x, z, 0.04) for x, z in loop]
    tube(bm, pads + [pads[0]], 0.034, 'pad', sides=N(8, 5), ref=Y, squash=0.75, caps=False)
    parts.append(make('ump_pads', recalc(bm)))
    bm = new_bm()

    def cage(x, z):
        return Vector((x, 0.51 - 1.2 * x * x - 0.45 * (z - cz) ** 2, z))
    frame = [cage(x * 1.06, cz + (z - cz) * 1.05) for x, z in loop]
    tube(bm, frame + [frame[0]], 0.016, 'cage', sides=sides, ref=Y, caps=False)
    for i in range(0, nl, nl // 6):  # struts from the frame back to the pads
        tube(bm, [frame[i], pads[i]], 0.011, 'cage', sides=N(6, 4))
    for z in (-0.065, -0.165, -0.255):
        w = hw * 1.06 * math.sqrt(max(0.0, 1 - ((z - cz) / (hh * 1.05)) ** 2)) ** 0.8
        n = N(14, 7)
        tube(bm, [cage(-w + 2 * w * i / n, z) for i in range(n + 1)], 0.012, 'cage', sides=sides)
    for x in (0.0, 0.09, -0.09):
        top = 0.12 if x == 0.0 else -0.065
        n = N(12, 5)
        tube(bm, [cage(x, top + (cz - hh * 1.05 + 0.005 - top) * i / n) for i in range(n + 1)], 0.012, 'cage', sides=sides)
    tg = cage(0, cz - hh * 1.05)
    tube(bm, [tg, tg + Vector((0, -0.02, -0.07)), tg + Vector((0, -0.05, -0.15))], 0.012, 'cage', sides=sides)  # throat guard arm
    parts.append(make('ump_cage', recalc(bm)))
    bm = new_bm()
    tgc = tg + Vector((0, -0.04, -0.12))
    slab(bm, lambda a, b, off: tgc + Vector((a, off + 0.3 * a * a + 0.2 * b, b)), 0.07, 0.06, 0.012, regs=('pad', 'pad', 'pad'), n_ang=N(24, 12), n_ring=N(4, 2), e=0.6)
    parts.append(make('ump_throat', bm))
    # harness straps from the sides of the mask round the back of the head, over the cap and under it
    bm = new_bm()
    for a0, a1, ph, lift in ((rad(38), rad(142), rad(20), 0.01), (rad(-38), rad(218), rad(-30), 0.07)):
        i0, i1 = round(a0 / TAU * nl) % nl, round(a1 / TAU * nl) % nl
        arc = [gear_pt(rad(a), ph, (cap_out(rad(a), ph, 0.8) + lift) if ph > 0 else lift, hang=0.6) for a in range(72, 289, 8 if Q > 0.6 else 18)]
        tube(bm, [pads[i0]] + arc + [pads[i1]], 0.02, 'pad', sides=N(8, 4), ref=-Y, squash=0.3)
    parts.append(make('ump_straps', recalc(bm)))
    P['umpmask'] = join('umpmask' + sfx, parts)
    return P


# ---------------------------------------------------------------- team letters
def font():
    for path in ('C:/Windows/Fonts/georgiaz.ttf', '/Library/Fonts/Georgia Bold Italic.ttf', '/usr/share/fonts/truetype/msttcorefonts/Georgia_Bold_Italic.ttf'):
        if os.path.exists(path):
            return bpy.data.fonts.load(path)
    return None


FONT = font()


def letter(ch, height):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = ch
    cu.resolution_u = 2
    if FONT:
        cu.font = FONT
    else:
        cu.offset = 0.04
        cu.shear = 0.15
    ob = bpy.data.objects.new('txt', cu)
    coll.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bm = new_bm()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), 0))
    hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), 0))
    k = height / (hi.y - lo.y)
    for v in bm.verts:
        v.co = Vector(((v.co.x - (lo.x + hi.x) / 2) * k, (v.co.y - (lo.y + hi.y) / 2) * k, 0))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > height * 0.4], cuts=1)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def wrap_letter(name, ch, height, th0, ph0, surf, rh, rv, lift=0.005, thick=0.008):
    """Lay a letter on a cap or helmet: its x runs round the head, its y up the crown."""
    bm = letter(ch, height)
    for v in bm.verts:
        v.co = surf(th0 - v.co.x / rh, ph0 + v.co.y / rv, lift)
    orient_out(bm, C0)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thick)
    lay = bm.faces.layers.int['reg']
    for f in bm.faces:
        f[lay] = REGIONS.index('logo')
    return make(name, recalc(bm), smooth=False)


LOGOS = {}
for ch in ('T', 'H'):
    LOGOS['logo_cap_' + ch] = join('logo_cap_' + ch, [wrap_letter('logo_cap_' + ch, ch, 0.12, 0.0, rad(37),
                                   lambda th, ph, lift: gear_pt(th, ph, cap_out(th, ph, (math.pi / 2 - ph) / (math.pi / 2 - rad(17))) + lift), 0.37, 0.42)])
    LOGOS['logo_helmet_' + ch] = join('logo_helmet_' + ch, [wrap_letter('logo_helmet_' + ch + str(sx), ch, 0.12, sx * rad(80), rad(24),
                                      lambda th, ph, lift: gear_pt(th, ph, H_OUT + lift), 0.4, 0.46) for sx in (1, -1)])

HI = build(1.0, '')
LO = build(0.45, '_lo')
EXPORT = list(HI.values()) + list(LO.values()) + list(LOGOS.values())


# ---------------------------------------------------------------- previews, checks and export
def use_colors(o, name):
    ca = o.data.color_attributes
    ca.active_color_name = name
    ca.default_color_name = name


def preview(folder):
    """Workbench renders of the parts put together the ways the game wears them."""
    os.makedirs(folder, exist_ok=True)

    def combos(P):
        return [
            [P['head'], P['hair_crew'], P['cap'], P['brim'], LOGOS['logo_cap_H']], [P['head'], P['hair_shag'], P['helmet'], LOGOS['logo_helmet_T']],
            [P['head'], P['hair_curly'], P['cap'], P['brim'], LOGOS['logo_cap_T']], [P['head'], P['hair_sleek'], P['tail_bubble'], P['helmet'], P['cage'], LOGOS['logo_helmet_T']],
            [P['head'], P['hair_sleek'], P['tail_ponylow'], P['catcher']], [P['head'], P['hair_crew'], P['cap'], P['brim_short'], P['umpmask']],
            [P['head'], P['hair_sleek'], P['tail_pony'], P['cap'], P['brim'], LOGOS['logo_cap_H']],
            [P['head'], P['hair_curly']], [P['head'], P['hair_shag']], [P['head'], P['hair_sleek'], P['tail_bubble']],
        ]
    step = 1.5
    rows = [combos(HI), combos(LO)]
    dups = []
    for o in EXPORT:
        o.hide_render = True
        use_colors(o, 'preview')
    for r, row in enumerate(rows):
        for k, objs in enumerate(row):
            for o in objs:
                d = o.copy()
                coll.objects.link(d)
                d.location = (k * step, 0, -r * 1.6)
                d.hide_render = False
                dups.append(d)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_cavity = True
    sh.cavity_type = 'WORLD'
    sh.show_specular_highlight = True
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cd)
    coll.objects.link(cam)
    scene.camera = cam

    def shoot(name, target, d, scale, w, h):
        scene.render.resolution_x, scene.render.resolution_y = w, h
        cd.ortho_scale = scale
        d = d.normalized()
        cam.location = target + d * 30
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        cd.clip_start, cd.clip_end = (29.0, 31.0) if scale < 3 else (0.1, 100.0)
        scene.render.filepath = os.path.join(folder, 'head_%s.png' % name)
        bpy.ops.render.render(write_still=True)
    n = len(rows[0])
    mid = Vector(((n - 1) * step / 2, 0, -0.9))
    shoot('front', mid, Vector((0, 1, 0)), n * step, 3000, 1000)
    shoot('back', mid, Vector((0, -1, 0.15)), n * step, 3000, 1000)
    for k in range(n):  # three-quarter and side close-ups of each
        c = Vector((k * step, 0, -0.1))
        shoot('c%d_three' % k, c, Vector((0.9, 1, 0.25)), 1.8, 600, 600)
        shoot('c%d_side' % k, c, Vector((1, -0.05, 0.05)), 1.8, 600, 600)
        shoot('c%d_backq' % k, c, Vector((-0.8, -1, 0.3)), 1.8, 600, 600)
    for d in dups:
        bpy.data.objects.remove(d)
    bpy.data.objects.remove(cam)
    for o in EXPORT:
        o.hide_render = False


def clearance(o):
    """Closest distance from a piece to the head (negative: the head pokes through it)."""
    worst = 1.0
    for v in o.data.vertices:
        loc, nrm, _, d = BVH_HI.find_nearest(v.co)
        if loc is None:
            continue
        worst = min(worst, -d if (v.co - loc).dot(nrm) < 0 else d)
    return worst


if PREVIEW_DIR:
    preview(PREVIEW_DIR)

bm = bmesh.new()
bm.from_mesh(HI['head'].data)
BVH_HI = BVHTree.FromBMesh(bm)
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
for o in EXPORT:
    use_colors(o, 'region')
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
for o in EXPORT:
    o.data.color_attributes.remove(o.data.color_attributes['preview'])
    use_colors(o, 'region')
bpy.ops.object.select_all(action='DESELECT')
for o in EXPORT:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_yup=False, export_apply=False, use_selection=True,
    export_skins=False, export_animations=False, export_materials='EXPORT', export_texcoords=False,
    export_vertex_color='ACTIVE',
)
print('HEAD_GLB', os.path.getsize(OUT_GLB), {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in EXPORT})
for k in ('cap', 'brim', 'helmet', 'catcher', 'cage', 'umpmask'):
    print('CLEARANCE', k, round(clearance(HI[k]), 4), round(clearance(LO[k]), 4))
