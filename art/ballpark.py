"""Umpire Madness ballpark kit, built in Blender from code.

Run headless from the repo root:
    blender --background --factory-startup --python art/ballpark.py

Writes public/models/ballpark.glb (and art/out/ballpark.blend to open in Blender).
World units are feet, Z up, home plate at the origin, first base along +X+Y: the game's own
coordinates, so nothing needs moving after loading. Pieces the game treats specially are named:
  dugout_1b / dugout_3b (+ dugout_roof_1b / _3b), bleachers_1b_0..2 / bleachers_3b_0..2 (+ aisle steps),
  backstop, lighttower_0..3 (+ empty lightbank_0..3), scoreboard (+ plane sb_face), foulpole_l / foulpole_r,
  tree_0..3 (templates the game instances).
Repeated pieces (bleacher sections, light towers, dugout bodies) are built once and placed several times;
glTF stores one mesh for all of them, which keeps the file small.
Materials with special jobs: chainlink (the game swaps in its see-through chain-link texture),
lamp (glows at night), sb_face (gets the live scoreboard canvas), roof_home / roof_away (team colors).
"""
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'ballpark.glb')
OUT_BLEND = os.path.join(ROOT, 'art', 'out', 'ballpark.blend')
R2 = math.sqrt(0.5)
rng = random.Random(7)

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'NONE'
coll = bpy.data.collections.new('Ballpark')
scene.collection.children.link(coll)


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


MATS = {}


def mat(name, hexcol, rough=0.8, metal=0.0, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = srgb(hexcol)
    m.diffuse_color = srgb(hexcol)  # viewport / workbench color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = srgb(emit)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    MATS[name] = m
    return m


# palette (matches the game's flat, sunny look)
M = {
    'block': mat('block', '#aeb4bd', 0.95),
    'blockDark': mat('block_dark', '#7d8590', 0.95),
    'concrete': mat('concrete', '#c9c4ba', 0.95),
    'alu': mat('alu', '#c6ccd4', 0.35, 0.8),
    'aluDark': mat('alu_dark', '#8d96a3', 0.4, 0.8),
    'steel': mat('steel', '#6b7585', 0.5, 0.6),
    'darkSteel': mat('steel_dark', '#3b4252', 0.6, 0.5),
    'wood': mat('wood', '#a87a4a', 0.8),
    'pad': mat('pad', '#1d2b53', 0.7),
    'chain': mat('chainlink', '#c9d2d8', 0.5, 0.6),
    'roofHome': mat('roof_home', '#c62f3d', 0.6),
    'roofAway': mat('roof_away', '#2f62c6', 0.6),
    'trim': mat('trim', '#f4f6fa', 0.6),
    'lamp': mat('lamp', '#fff6d8', 0.3, 0.0, emit='#fff6d8'),
    'sbCab': mat('sb_cabinet', '#10213f', 0.6),
    'sbFace': mat('sb_face', '#0b1530', 0.5),
    'yellow': mat('foulpole', '#ffd400', 0.5),
    'orange': mat('cooler', '#ff7a1a', 0.6),
    'white': mat('white', '#f4f4f0', 0.6),
    'helmetRed': mat('helmet_red', '#d62839', 0.35),
    'helmetBlue': mat('helmet_blue', '#1f5fe0', 0.35),
    'bark': mat('bark', '#5b3a1e', 0.9),
    'leaf0': mat('leaf_a', '#2f7a36', 0.9),
    'leaf1': mat('leaf_b', '#3d8a3f', 0.9),
    'leaf2': mat('leaf_c', '#256b30', 0.9),
    'pine': mat('pine', '#1f5a2e', 0.9),
    'glass': mat('glass', '#1a2738', 0.2, 0.3),
    'sign': mat('sign', '#ffd34d', 0.5),
    'signText': mat('sign_text', '#0b1530', 0.5),
}


def link(obj):
    coll.objects.link(obj)
    return obj


def mesh_obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    return link(bpy.data.objects.new(name, me))


def box(name, size, center, material, rot_z=0.0, bevel=0.06):
    """Box of size (x, y, z) whose bottom-center sits at center (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, size[2] / 2)), verts=bm.verts)
    o = mesh_obj(name, bm, material)
    o.location = center
    o.rotation_euler = (0, 0, rot_z)
    if bevel > 0:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width = min(bevel, min(size) * 0.45)
        b.segments = 1
        b.limit_method = 'ANGLE'
    return o


def tube(name, a, b, r, material, verts=10, caps=True):
    """Cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=verts, radius1=r, radius2=r, depth=d.length)
    o = mesh_obj(name, bm, material)
    o.location = (a + b) / 2
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return o


def cone(name, r1, r2, h, base, material, verts=12):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector((0, 0, h / 2)), verts=bm.verts)
    o = mesh_obj(name, bm, material)
    o.location = base
    return o


def plane(name, w, h, center, material, rot=(math.pi / 2, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=Vector((w, h, 1)), verts=bm.verts)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for lp in f.loops:
            co = lp.vert.co
            # chain-link tiles every 1.2 ft; everything else spans 0..1
            lp[uv].uv = (co.x / 1.2, co.y / 1.2) if material.name == 'chainlink' else (co.x / w + 0.5, co.y / h + 0.5)
    o = mesh_obj(name, bm, material)
    o.location = center
    o.rotation_euler = rot
    return o


def join(name, objs, parent_matrix=None):
    """Apply modifiers, join into one object (one mesh, several materials)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    if parent_matrix is not None:
        o.matrix_world = parent_matrix @ o.matrix_world
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    return o


def bake(o):
    """Apply every modifier (including the smooth-by-angle one) so copies can share one mesh."""
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    # bake the joined parts' offset into the mesh, so the object sits at a clean origin and
    # setting its placement (and its copies') can't shift it
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def copy_at(name, src, matrix):
    """Another placement of src's mesh (a linked duplicate: glTF stores the mesh once)."""
    o = link(bpy.data.objects.new(name, src.data))
    o.matrix_world = matrix
    return o


def sweep(name, pts, r, material, verts=6):
    """One continuous tube through a list of points (no caps): cheaper than a tube per segment."""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        p = Vector(p)
        t = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(t)
        rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / verts) + up * math.sin(2 * math.pi * k / verts)) * r) for k in range(verts)])
    for i in range(len(rings) - 1):
        for k in range(verts):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % verts], rings[i + 1][(k + 1) % verts], rings[i + 1][k]))
    return mesh_obj(name, bm, material)


def frame(side):
    """Foul-line frame for one side (+1 = first base): s along the line, d out into foul ground."""
    u = Vector((side * R2, R2, 0))
    n = Vector((side * R2, -R2, 0))
    return u, n


def P(side, s, d, z=0.0):
    u, n = frame(side)
    return u * s + n * d + Vector((0, 0, z))


def spot(side, s, d, rot_extra=0.0):
    """Placement matrix for a piece built around the origin with local +Y toward the field."""
    u, n = frame(side)
    rot = math.atan2(n.x, -n.y) + rot_extra
    return Matrix.Translation(P(side, s, d)) @ Matrix.Rotation(rot, 4, 'Z')


def place(local_objs, side, s, d, rot_extra=0.0):
    """Move objects built around the origin (local +Y toward the field) to the foul-line spot."""
    M_ = spot(side, s, d, rot_extra)
    bpy.context.view_layer.update()  # make matrix_world reflect the locations just set
    for o in local_objs:
        o.matrix_world = M_ @ o.matrix_world
    return local_objs


# ---------------------------------------------------------------- dugouts
DUG = (20.0, 8.0, 7.2)  # along the line, deep, tall


def dugout_body():
    """Everything but the team colors, built at the origin (local +Y toward the field)."""
    parts = []
    W, D, H = DUG
    # cinder-block back and side walls, a low front wall with padding
    parts.append(box('back', (W, 0.8, H), (0, -D / 2, 0), M['block']))
    for sx in (-1, 1):
        parts.append(box('side', (0.8, D, H), (sx * W / 2, 0, 0), M['block']))
    parts.append(box('front', (W, 0.7, 3.0), (0, D / 2 - 0.35, 0), M['blockDark']))
    parts.append(box('frontpad', (W - 1.4, 0.35, 1.2), (0, D / 2 + 0.05, 1.6), M['pad']))
    # concrete floor, sunk a little
    parts.append(box('floor', (W - 0.4, D - 0.4, 0.3), (0, 0, -0.2), M['concrete'], bevel=0.0))
    parts.append(box('fasciaTrim', (W + 1.75, 0.38, 0.18), (0, D / 2 + 1.8, H + 0.45), M['trim'], bevel=0.0))
    # chain-link screen between the front wall and the roof, with steel posts
    parts.append(plane('screen', W - 1.0, H - 3.0, (0, D / 2 - 0.35, 3.0 + (H - 3.0) / 2), M['chain']))
    for k in range(5):
        x = -W / 2 + 0.6 + k * (W - 1.2) / 4
        parts.append(tube('post', (x, D / 2 - 0.35, 3.0), (x, D / 2 - 0.35, H), 0.12, M['steel'], 6, caps=False))
    # bench along the back wall
    parts.append(box('bench', (W - 2.0, 1.2, 0.18), (0, -D / 2 + 1.4, 1.5), M['wood'], bevel=0.0))
    for k in range(5):
        x = -W / 2 + 1.6 + k * (W - 3.2) / 4
        parts.append(box('benchleg', (0.2, 0.9, 1.5), (x, -D / 2 + 1.4, 0), M['steel'], bevel=0.0))
    # helmet cubby, a bat rack and a water cooler
    cx = -W / 2 + 3.2
    parts.append(box('cubby', (4.0, 1.0, 2.6), (cx, -D / 2 + 0.9, 3.4), M['wood'], bevel=0.0))
    bx = W / 2 - 3.0
    parts.append(box('batrack', (3.6, 0.5, 0.25), (bx, -D / 2 + 0.7, 2.8), M['wood'], bevel=0.0))
    for i in range(6):
        x = bx - 1.5 + i * 0.6
        parts.append(tube('bat', (x, -D / 2 + 0.75, 0.2), (x, -D / 2 + 0.95, 2.9), 0.09, M['aluDark'] if i % 2 else M['helmetRed'], 6))
    parts.append(cone('cooler', 0.8, 0.8, 1.6, (W / 2 - 1.6, D / 2 - 1.6, 0), M['orange'], 10))
    parts.append(cone('coolerLid', 0.82, 0.7, 0.3, (W / 2 - 1.6, D / 2 - 1.6, 1.6), M['white'], 10))
    return bake(join('dugout_body', parts))


def dugout_roof(side):
    """The team-colored roof and fascia, plus the team's helmets in the cubby."""
    parts = []
    W, D, H = DUG
    roof = M['roofHome'] if side > 0 else M['roofAway']
    parts.append(box('roof', (W + 1.6, D + 2.4, 0.45), (0, 0.6, H), roof, bevel=0.08))
    parts.append(box('fascia', (W + 1.7, 0.35, 1.1), (0, D / 2 + 1.8, H - 0.6), roof))
    cx = -W / 2 + 3.2
    hm = M['helmetRed'] if side > 0 else M['helmetBlue']
    for i in range(3):
        for j in range(2):
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=0.42)
            h = mesh_obj('helmet', bm, hm)
            h.location = (cx - 1.3 + i * 1.3, -D / 2 + 1.25, 3.85 + j * 1.15)
            h.scale = (1, 1.15, 0.85)
            parts.append(h)
    place(parts, side, 17, 30)
    return join('dugout_roof_1b' if side > 0 else 'dugout_roof_3b', parts)


def dugouts():
    body = dugout_body()
    body.name = 'dugout_1b'
    body.matrix_world = spot(1, 17, 30)
    copy_at('dugout_3b', body, spot(-1, 17, 30))
    dugout_roof(1)
    dugout_roof(-1)


# ---------------------------------------------------------------- bleachers
# Rows match the game's fans: row r seats at height 1.2 + 1.4 r, set back 31 + 3 r from the line.
SECTIONS = [(34, 58), (61, 85), (88, 112)]   # aisles in between (the game skips fans there)


ROWS = 6


def bleacher_section(L):
    """One section, built at the origin: y = 0 at the front edge, -y away from the field."""
    local = []
    rows = ROWS
    for r in range(rows):
        d = 31 + 3 * r
        z = 1.2 + 1.4 * r
        # seat plank (two boards) at the back of the row, footboard in front a step lower
        for off in (1.95, 2.55):
            local.append(box('seat', (L, 0.55, 0.16), (0, -(d + off - 31), z - 0.16), M['alu'], bevel=0.0))
        local.append(box('foot', (L, 1.3, 0.12), (0, -(d + 0.75 - 31), z - 1.25), M['aluDark'], bevel=0.0))
        # riser kick plate under the seat
        local.append(box('riser', (L, 0.08, 1.15), (0, -(d + 1.6 - 31), z - 1.3), M['aluDark'], bevel=0.0))
    top = 1.2 + 1.4 * (rows - 1)
    back = -(3 * rows)
    # understructure: a frame every ~8 ft, each a stringer up the slope plus a leg under every row
    nfr = max(2, int(L / 8) + 1)
    xs = [-L / 2 + 0.4 + i * (L - 0.8) / (nfr - 1) for i in range(nfr)]
    for x in xs:
        local.append(tube('stringer', (x, 0.2, 0.0), (x, back + 0.3, top - 0.3), 0.12, M['steel'], 4, caps=False))
        for r in range(1, rows):
            d = 31 + 3 * r
            z = 1.2 + 1.4 * r
            local.append(tube('leg', (x, -(d + 2.2 - 31), 0.0), (x, -(d + 2.2 - 31), z - 0.2), 0.09, M['steel'], 4, caps=False))
    # guardrail across the back and down the ends
    rail_z = top + 3.2
    local.append(tube('railTop', (-L / 2, back, rail_z), (L / 2, back, rail_z), 0.1, M['alu'], 6))
    local.append(tube('railMid', (-L / 2, back, rail_z - 1.5), (L / 2, back, rail_z - 1.5), 0.08, M['alu'], 6, caps=False))
    for x in xs:
        local.append(tube('railPost', (x, back, top - 0.3), (x, back, rail_z), 0.09, M['alu'], 6, caps=False))
    for sx in (-1, 1):
        x = sx * L / 2
        local.append(tube('endRail', (x, -0.8, 1.2 + 2.8), (x, back, rail_z), 0.09, M['alu'], 6))
    return bake(join('bleacher_section', local))


def aisle_steps():
    local = []
    for r in range(ROWS):
        d = 31 + 3 * r
        z = 1.2 + 1.4 * r
        local.append(box('step', (2.6, 1.5, 0.14), (0, -(d + 0.75 - 31), z - 1.25 + 0.7), M['aluDark'], bevel=0.0))
    return bake(join('aisle_steps', local))


def bleachers():
    lengths = {b - a for a, b in SECTIONS}
    assert len(lengths) == 1, 'bleacher sections share one mesh, so they must be the same length'
    sec = bleacher_section(lengths.pop())
    steps = aisle_steps()
    first = True
    for side in (1, -1):
        tag = '1b' if side > 0 else '3b'
        for i, (s0, s1) in enumerate(SECTIONS):
            m = spot(side, (s0 + s1) / 2, 31)
            if first:
                sec.name, sec.matrix_world, first = f'bleachers_{tag}_{i}', m, False
            else:
                copy_at(f'bleachers_{tag}_{i}', sec, m)
        for i, (a, b) in enumerate(zip(SECTIONS[:-1], SECTIONS[1:])):
            copy_at(f'aisle_{tag}_{i}', steps, spot(side, (a[1] + b[0]) / 2, 31))
    bpy.data.objects.remove(steps)  # only its copies are placed


# ---------------------------------------------------------------- backstop
def backstop():
    parts = []
    R, a0, a1, H = 36.0, math.pi * 1.18, math.pi * 1.82, 14.0
    n = 24
    # chain-link panel (an arc strip) with UVs in feet so the texture tiles evenly
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    top = []
    bot = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        bot.append(bm.verts.new((math.cos(a) * R, math.sin(a) * R, 3.0)))
        top.append(bm.verts.new((math.cos(a) * R, math.sin(a) * R, H)))
    arc = R * (a1 - a0)
    for i in range(n):
        f = bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
        for lp in f.loops:
            co = lp.vert.co
            k = math.atan2(co.y, co.x) % (2 * math.pi)
            lp[uv].uv = ((k - a0) * R / 1.2, co.z / 1.2)
    parts.append(mesh_obj('backstopMesh', bm, M['chain']))
    # a forward-leaning hood of netting along the top
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    lo, hi = [], []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        lo.append(bm.verts.new((math.cos(a) * R, math.sin(a) * R, H)))
        hi.append(bm.verts.new((math.cos(a) * (R - 5), math.sin(a) * (R - 5), H + 3.5)))
    for i in range(n):
        f = bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
        for lp in f.loops:
            co = lp.vert.co
            k = math.atan2(co.y, co.x) % (2 * math.pi)
            lp[uv].uv = ((k - a0) * R / 1.2, (co.z - H) / 1.2 + (R - co.to_2d().length) / 1.2)
    parts.append(mesh_obj('hood', bm, M['chain']))
    # padded wall along the bottom: separate pads so the seams read
    pads = 14
    for i in range(pads):
        a = a0 + (a1 - a0) * (i + 0.5) / pads
        w = arc / pads - 0.15
        p = box('pad', (w, 0.9, 3.0), (math.cos(a) * (R - 0.25), math.sin(a) * (R - 0.25), 0), M['pad'], rot_z=a + math.pi / 2, bevel=0.15)
        parts.append(p)
    # steel posts, top rail and the hood's arms
    for i in range(7):
        a = a0 + (a1 - a0) * i / 6
        c, s = math.cos(a), math.sin(a)
        parts.append(tube('post', (c * (R + 0.3), s * (R + 0.3), 0), (c * (R + 0.3), s * (R + 0.3), H + 0.3), 0.28, M['steel'], 8))
        parts.append(tube('arm', (c * (R + 0.3), s * (R + 0.3), H + 0.2), (c * (R - 5), s * (R - 5), H + 3.6), 0.14, M['steel'], 6, caps=False))
    arc_pts = lambda rr, z: [(math.cos(a0 + (a1 - a0) * i / n) * rr, math.sin(a0 + (a1 - a0) * i / n) * rr, z) for i in range(n + 1)]
    parts.append(sweep('rail', arc_pts(R, H), 0.12, M['steel']))
    parts.append(sweep('hoodRail', arc_pts(R - 5, H + 3.5), 0.1, M['steel']))
    return join('backstop', parts)


# ---------------------------------------------------------------- light towers
TOWERS = [(-95, 5), (95, 5), (-165, 175), (165, 175)]


def light_tower_mesh():
    """One tower at the origin with its lamp bank facing local -Y; each placement turns it to the infield."""
    parts = []
    H = 72.0
    parts.append(cone('pole', 1.25, 0.6, H, (0, 0, 0), M['steel'], 10))
    parts.append(cone('base', 2.0, 1.6, 2.2, (0, 0, 0), M['concrete'], 10))
    bank = []
    bank.append(box('frame', (16, 1.0, 0.5), (0, 0, -0.2), M['darkSteel'], bevel=0.0))
    bank.append(box('frame2', (16, 1.0, 0.5), (0, 0, -4.4), M['darkSteel'], bevel=0.0))
    bank.append(box('frame3', (16, 1.0, 0.5), (0, 0, -8.6), M['darkSteel'], bevel=0.0))
    bank.append(box('frame4', (16, 1.0, 0.5), (0, 0, -12.8), M['darkSteel'], bevel=0.0))
    for k in (-1, 1):
        bank.append(box('upright', (0.5, 0.8, 13.2), (k * 7.8, 0, -12.9), M['darkSteel'], bevel=0.0))
    for row in range(3):
        for col in range(5):
            lx, lz = -6.0 + col * 3.0, -1.6 - row * 4.2
            hous = cone('lampHousing', 1.2, 0.9, 1.4, (0, 0, 0), M['darkSteel'], 8)
            hous.rotation_euler = (math.radians(-110), 0, 0)
            hous.location = (lx, 0.3, lz)
            bank.append(hous)
            bm = bmesh.new()  # the lamp's glowing face: a flat disc
            bmesh.ops.create_circle(bm, cap_ends=True, segments=8, radius=1.12)
            face = mesh_obj('lampFace', bm, M['lamp'])
            face.rotation_euler = (math.radians(-110), 0, 0)
            face.location = (lx, -1.05, lz - 0.5)
            bank.append(face)
    # the bank hangs in front of the pole top (local -Y faces the field)
    Mb = Matrix.Translation((0, 0, H + 5)) @ Matrix.Translation((0, -1.8, 0))
    bpy.context.view_layer.update()
    parts.append(box('bracket', (2.0, 2.4, 1.2), (0, 0, H - 0.4), M['darkSteel'], bevel=0.0))
    for o in bank:
        o.matrix_world = Mb @ o.matrix_world
    parts += bank
    return bake(join('lighttower', parts)), Mb


def light_towers():
    tower, Mb = light_tower_mesh()
    for i, (x, y) in enumerate(TOWERS):
        N = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.atan2(-x, -(40 - y)), 4, 'Z')
        if i == 0:
            tower.name, tower.matrix_world = 'lighttower_0', N
        else:
            copy_at(f'lighttower_{i}', tower, N)
        e = bpy.data.objects.new(f'lightbank_{i}', None)
        e.location = N @ Mb @ Vector((0, -3, -4))
        link(e)


# ---------------------------------------------------------------- scoreboard
def scoreboard():
    parts = []
    # built facing -Y (toward home) at the origin, then moved where the game has it
    for k in (-1, 1):
        parts.append(box('leg', (1.6, 1.6, 16), (k * 16, 0.6, 0), M['steel'], bevel=0.06))
        parts.append(box('legBase', (3.0, 3.0, 1.0), (k * 16, 0.6, 0), M['concrete'], bevel=0.1))
    parts.append(box('cabinet', (47, 2.4, 25), (0, 0.8, 14.5), M['sbCab'], bevel=0.25))
    parts.append(box('rim', (47.6, 2.6, 0.6), (0, 0.8, 39.3), M['trim'], bevel=0.1))
    face = plane('sb_face', 44, 22, (0, -0.45, 27), M['sbFace'])
    face.name = 'sb_face'
    # marquee sign on top
    parts.append(box('marquee', (30, 1.6, 5.2), (0, 0.8, 39.8), M['sign'], bevel=0.25))
    bpy.ops.object.text_add(location=(0, 0, 0))
    t = bpy.context.active_object
    t.data.body = 'MAKE THE CALL'
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.data.size = 3.0
    t.data.extrude = 0.12
    t.data.resolution_u = 3
    t.data.materials.append(M['signText'])
    coll.objects.link(t) if t.name not in coll.objects else None
    for c in list(t.users_collection):
        if c != coll:
            c.objects.unlink(t)
    t.rotation_euler = (math.radians(90), 0, 0)
    t.location = (0, -0.05, 42.4)
    parts.append(t)
    Mx = Matrix.Translation((-118, 238, 0)) @ Matrix.Rotation(math.atan2(-238, 118) + math.pi / 2, 4, 'Z')
    bpy.context.view_layer.update()
    for o in parts + [face]:
        o.matrix_world = Mx @ o.matrix_world
    sb = join('scoreboard', parts)
    face.parent = sb
    face.matrix_parent_inverse = sb.matrix_world.inverted()
    return sb


# ---------------------------------------------------------------- foul poles
def foul_pole(side):
    parts = []
    x, y = side * 200 * R2, 200 * R2
    parts.append(cone('pole', 0.45, 0.35, 34, (x, y, 0), M['yellow'], 12))
    # the screen ("wing") on the fair side of the pole
    u = Vector((-side * R2, R2, 0))  # along the wall, into fair territory... wing hangs on the foul side
    w = plane('wing', 3.0, 26, (0, 0, 0), M['yellow'], rot=(math.pi / 2, 0, 0))
    w.rotation_euler = (math.pi / 2, 0, math.atan2(-y, -x) + math.pi / 2)
    w.location = Vector((x, y, 8 + 13)) + Vector((-math.sin(math.atan2(-y, -x)), math.cos(math.atan2(-y, -x)), 0)) * 0
    w.location = (x + side * 1.6 * R2, y - 1.6 * R2, 21)
    parts.append(w)
    return join('foulpole_r' if side > 0 else 'foulpole_l', parts)


# ---------------------------------------------------------------- trees (templates)
def leafy_tree(i, leaf, seed):
    r = random.Random(seed)
    parts = []
    parts.append(cone('trunk', 0.9, 0.55, 9.0, (0, 0, 0), M['bark'], 7))
    # a few branches
    for k in range(3):
        a = k * 2.1 + r.random()
        parts.append(tube('branch', (0, 0, 6.5 + k), (math.cos(a) * 3, math.sin(a) * 3, 10 + k * 0.8), 0.32, M['bark'], 5))
    # crown: lumpy icospheres
    blobs = [(0, 0, 13, 6.5), (3.5, 1.0, 11.5, 4.6), (-3.2, -1.2, 11.8, 4.8), (0.8, -3.0, 12.5, 4.2), (-0.8, 2.8, 14.5, 4.4), (0.5, 0.5, 16.5, 3.6)]
    for (bx, by, bz, br) in blobs:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=br)
        for v in bm.verts:
            v.co *= 0.85 + r.random() * 0.3
        o = mesh_obj('crown', bm, leaf)
        o.location = (bx, by, bz)
        o.scale = (1, 1, 0.85)
        parts.append(o)
    t = join(f'tree_{i}', parts)
    t.data.polygons.foreach_set('use_smooth', [False] * len(t.data.polygons))
    return t


def pine_tree(i):
    parts = [cone('trunk', 0.7, 0.4, 5.0, (0, 0, 0), M['bark'], 6)]
    for k, (r1, h, z) in enumerate([(6.5, 8, 3.5), (5.2, 7, 8.0), (3.8, 6.5, 12.0), (2.4, 5.5, 15.5)]):
        parts.append(cone('needles', r1, 0.2, h, (0, 0, z), M['pine'], 9))
    t = join(f'tree_{i}', parts)
    t.data.polygons.foreach_set('use_smooth', [False] * len(t.data.polygons))
    return t


# ---------------------------------------------------------------- build
dugouts()
bleachers()
backstop()
light_towers()
scoreboard()
foul_pole(1)
foul_pole(-1)
trees = [leafy_tree(0, M['leaf0'], 1), leafy_tree(1, M['leaf1'], 2), leafy_tree(2, M['leaf2'], 3), pine_tree(3)]
for k, t in enumerate(trees):  # park the templates out of sight; the game instances them
    t.location = (k * 40, -400, 0)


# ---------------------------------------------------------------- ambient occlusion
def bake_ao(rays=64, distance=6.0):
    """Bake ambient occlusion into a per-corner float attribute _AO (exported as a custom glTF
    attribute; the game darkens the sky light with it: under seats and roofs, inside the dugouts,
    where walls and legs meet the ground).
    Ray cast here rather than with Cycles: a vertex buried inside another part (a pole's end inside
    its base, wall corners inside the next wall) would come out black, so rays pass through back
    faces, and see-through chain-link doesn't block them. The ground is a big plane at z = 0.
    Shared meshes (bleacher sections, towers, dugout bodies) are baked once, at their first placement."""
    from mathutils.bvhtree import BVHTree
    deps = bpy.context.evaluated_depsgraph_get()
    verts, polys = [(-2000, -2000, 0), (2000, -2000, 0), (2000, 2000, 0), (-2000, 2000, 0)], [(0, 1, 2, 3)]
    for o in coll.objects:
        if o.type != 'MESH':
            continue
        me = o.evaluated_get(deps).to_mesh()
        base, mw = len(verts), o.matrix_world
        verts += [tuple(mw @ v.co) for v in me.vertices]
        see = {i for i, m in enumerate(me.materials) if m and m.name == 'chainlink'}
        polys += [tuple(base + i for i in p.vertices) for p in me.polygons if p.material_index not in see]
        o.evaluated_get(deps).to_mesh_clear()
    tree = BVHTree.FromPolygons(verts, polys)
    # cosine-weighted directions on the +Z hemisphere (a Fibonacci spiral), turned onto each normal
    golden = math.pi * (3 - math.sqrt(5))
    dirs = []
    for i in range(rays):
        z = math.sqrt(1 - (i + 0.5) / rays)
        r = math.sqrt(max(0.0, 1 - z * z))
        dirs.append(Vector((math.cos(i * golden) * r, math.sin(i * golden) * r, z)))

    def ao_at(p, n):
        t = n.orthogonal().normalized()
        b = n.cross(t)
        spin = rng.random() * 2 * math.pi  # a different turn of the spiral at each point: no banding
        cs, sn = math.cos(spin), math.sin(spin)
        occ = 0.0
        for d in dirs:
            x, y = d.x * cs - d.y * sn, d.x * sn + d.y * cs
            w = (t * x + b * y + n * d.z).normalized()
            o, left = p + n * 0.02, distance
            for _ in range(4):
                loc, nrm, _i, dist = tree.ray_cast(o, w, left)
                if loc is None:
                    break
                if nrm.dot(w) < 0:  # a front face: blocked (closer counts more)
                    occ += 1 - (dist / distance) ** 2
                    break
                o, left = loc + w * 0.01, left - dist - 0.01  # inside a part: keep going
        return 1 - occ / rays

    seen, n = set(), 0
    for o in list(coll.objects):
        if o.type != 'MESH' or o.data.name in seen:
            continue
        seen.add(o.data.name)
        me_eval = o.evaluated_get(deps).to_mesh()
        mw, nm = o.matrix_world, o.matrix_world.to_3x3().inverted().transposed()
        cn = me_eval.corner_normals
        vals, cache = [], {}
        for lp in me_eval.loops:
            nr = cn[lp.index].vector
            key = (lp.vertex_index, round(nr.x, 3), round(nr.y, 3), round(nr.z, 3))
            if key not in cache:
                cache[key] = ao_at(mw @ me_eval.vertices[lp.vertex_index].co, (nm @ nr).normalized())
            vals.append(cache[key])
        o.evaluated_get(deps).to_mesh_clear()
        a = o.data.attributes.new('_AO', 'FLOAT', 'CORNER')
        a.data.foreach_set('value', vals)
        n += len(cache)
    print('AO baked at', n, 'points on', len(seen), 'meshes')


bake_ao()

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_yup=False, export_apply=True,
    export_texcoords=True, export_normals=True, export_materials='EXPORT',
    export_extras=False, export_cameras=False, export_lights=False,
    export_attributes=True,  # the baked _AO
)
stats = {o.data.name: len(o.data.polygons) for o in coll.objects if o.type == 'MESH'}  # each shared mesh once
print('BALLPARK', os.path.getsize(OUT_GLB), sum(stats.values()), stats)
