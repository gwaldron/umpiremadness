"""Umpire Madness ballplayer body: a smooth, rigged kid in uniform, built in Blender from code.

Run headless from the repo root:
    blender --background --factory-startup --python art/player.py

Writes public/models/player.glb (and art/out/player.blend).
Units are the game's "S" (a player is about 5 S tall; the game scales by S per player). The body faces
+Y with its left (the game's "F" side) at -X. Head, face, hair, caps and helmets, gloves, bats and
catcher's gear are drawn by the game on top, so the body stops at the neck.

Bones (the game drives these from its joint positions; see render3d/rig.js):
  hip > spine > chest > neck, chest > clav_F/B > arm_F/B > fore_F/B > hand_F/B,
  hip > thigh_F/B > shin_F/B > foot_F/B
Materials the game recolors per player: jersey, trim, pants, socks, shoes, sole, belt, skin, hands.
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'player.glb')
OUT_BLEND = os.path.join(ROOT, 'art', 'out', 'player.blend')

bpy.ops.wm.read_factory_settings(use_empty=True)
coll = bpy.context.scene.collection

# ---------------------------------------------------------------- rest skeleton (S units)
J = {}
J['hip'] = Vector((0, 0, 2.40))
J['neck'] = Vector((0, 0, 3.85))
J['head'] = Vector((0, 0.02, 4.43))
J['spine'] = J['hip'].lerp(J['neck'], 0.24)
J['chest'] = J['hip'].lerp(J['neck'], 0.65)
J['clav'] = J['neck'] + Vector((0, 0, -0.05))
for side, sx in (('F', -1), ('B', 1)):
    sh = Vector((sx * 0.55, 0, 3.70))
    el = sh + Vector((sx * 0.62, 0.06, -0.68)).normalized() * 0.92
    wr = el + Vector((sx * 0.45, 0.30, -0.78)).normalized() * 0.90
    hs = Vector((sx * 0.20, 0, 2.36))
    kn = Vector((sx * 0.22, 0.10, 1.26))
    an = Vector((sx * 0.22, 0.0, 0.20))
    toe = Vector((sx * 0.22, 0.48, 0.07))
    J['sh' + side], J['el' + side], J['wr' + side] = sh, el, wr
    J['hs' + side], J['kn' + side], J['an' + side], J['toe' + side] = hs, kn, an, toe
    J['handTip' + side] = wr + (wr - el).normalized() * 0.32

BONES = [  # name, head, tail, parent
    ('hip', J['hip'], J['spine'], None),
    ('spine', J['spine'], J['chest'], 'hip'),
    ('chest', J['chest'], J['neck'], 'spine'),
    ('neck', J['neck'], J['head'], 'chest'),
]
for s in ('F', 'B'):
    BONES += [
        ('clav_' + s, J['clav'], J['sh' + s], 'chest'),
        ('arm_' + s, J['sh' + s], J['el' + s], 'clav_' + s),
        ('fore_' + s, J['el' + s], J['wr' + s], 'arm_' + s),
        ('hand_' + s, J['wr' + s], J['handTip' + s], 'fore_' + s),
        ('thigh_' + s, J['hs' + s], J['kn' + s], 'hip'),
        ('shin_' + s, J['kn' + s], J['an' + s], 'thigh_' + s),
        ('foot_' + s, J['an' + s], J['toe' + s], 'shin_' + s),
    ]

# ---------------------------------------------------------------- body from overlapping shapes
parts = []


def ellipsoid(c, rx, ry, rz, frame=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1.0)
    bmesh.ops.scale(bm, vec=(rx, ry, rz), verts=bm.verts)
    me = bpy.data.meshes.new('e')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('e', me)
    coll.objects.link(o)
    if frame is not None:
        o.matrix_world = frame
    o.location = c
    parts.append(o)
    return o


def capsule(a, b, ra, rb, squash=1.0):
    """Tapered capsule from a (radius ra) to b (radius rb); squash flattens front-to-back."""
    a, b = Vector(a), Vector(b)
    d = b - a
    n = 14
    bm = bmesh.new()
    rings = []
    for i in range(n + 1):
        t = i / n
        r = ra + (rb - ra) * t
        ring = []
        for k in range(16):
            ang = 2 * math.pi * k / 16
            ring.append(bm.verts.new((math.cos(ang) * r, math.sin(ang) * r * squash, t * d.length)))
        rings.append(ring)
    for i in range(n):
        for k in range(16):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % 16], rings[i + 1][(k + 1) % 16], rings[i + 1][k]))
    bmesh.ops.contextual_create(bm, geom=rings[0])
    bmesh.ops.contextual_create(bm, geom=rings[-1])
    me = bpy.data.meshes.new('c')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('c', me)
    coll.objects.link(o)
    o.location = a
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    parts.append(o)
    # round end caps
    for p, r in ((a, ra), (b, rb)):
        e = ellipsoid(p, r, r * squash, r)
    return o


# torso (jersey), pelvis (pants), belt line
ellipsoid(J['hip'] + Vector((0, 0, 0.06)), 0.46, 0.32, 0.32)                 # pelvis
ellipsoid(J['hip'].lerp(J['neck'], 0.40), 0.44, 0.26, 0.50)                 # waist
ellipsoid(J['hip'].lerp(J['neck'], 0.72) + Vector((0, -0.02, 0)), 0.57, 0.31, 0.55)  # chest
ellipsoid(J['neck'] + Vector((0, 0, -0.18)), 0.50, 0.30, 0.22)              # shoulders/yoke
capsule(J['neck'] + Vector((0, 0, -0.2)), J['neck'] + Vector((0, 0.01, 0.35)), 0.15, 0.14)  # neck
for s in ('F', 'B'):
    sh, el, wr = J['sh' + s], J['el' + s], J['wr' + s]
    ellipsoid(sh, 0.21, 0.21, 0.21)                                          # deltoid
    sleeve_end = sh.lerp(el, 0.6)
    capsule(sh, sleeve_end, 0.19, 0.175)                                     # sleeve
    capsule(sh.lerp(el, 0.55), el, 0.13, 0.115)                              # upper arm
    capsule(el, wr, 0.115, 0.085)                                            # forearm
    hd = (wr - el).normalized()
    ellipsoid(wr + hd * 0.13, 0.085, 0.085, 0.085)                           # palm
    capsule(wr + hd * 0.05, wr + hd * 0.27, 0.09, 0.07, squash=0.7)         # fingers (mitten)
    hs, kn, an, toe = J['hs' + s], J['kn' + s], J['an' + s], J['toe' + s]
    capsule(hs + Vector((0, 0, 0.05)), kn, 0.27, 0.175)                      # thigh (pants)
    ellipsoid(kn, 0.175, 0.175, 0.17)                                        # knee
    capsule(kn, kn.lerp(an, 0.4), 0.17, 0.155)                               # pants below the knee
    capsule(kn.lerp(an, 0.32), an, 0.135, 0.095)                             # calf (socks)
    # cleat
    fwd = Vector((0, 1, 0))
    ellipsoid(an + Vector((0, 0.14, -0.08)), 0.15, 0.32, 0.12)
    ellipsoid(an + Vector((0, 0.15, -0.17)), 0.155, 0.34, 0.04)

# fuse everything into one smooth surface
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.convert(target='MESH')
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'body'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)  # local = world coordinates
rm = body.modifiers.new('remesh', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = 0.03
rm.adaptivity = 0.0
bpy.ops.object.modifier_apply(modifier='remesh')
sm = body.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
sm.factor = 0.5
sm.iterations = 6
sm.use_only_smooth = True
bpy.ops.object.modifier_apply(modifier='smooth')
dec = body.modifiers.new('decimate', 'DECIMATE')
dec.ratio = 0.12
bpy.ops.object.modifier_apply(modifier='decimate')
bpy.ops.object.shade_smooth()

# Clean seams: cut the mesh along a plane at each uniform edge (belt, sleeves, wrists, socks, shoes,
# collar) so the color boundaries are straight lines instead of a zigzag of faces.
def cut(co, no, near, radius):
    bm = bmesh.new()
    bm.from_mesh(body.data)
    faces = [f for f in bm.faces if (f.calc_center_median() - near).length < radius]
    geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no.normalized())
    bm.to_mesh(body.data)
    bm.free()


belt_z = J['hip'].z + 0.27
torso_mid = Vector((0, 0, belt_z))
cut(Vector((0, 0, belt_z - 0.06)), Vector((0, 0, 1)), torso_mid, 0.62)
cut(Vector((0, 0, belt_z + 0.06)), Vector((0, 0, 1)), torso_mid, 0.62)
cut(J['neck'] + Vector((0, 0, -0.02)), Vector((0, 0, 1)), J['neck'], 0.3)
for s in ('F', 'B'):
    sh, el, wr, kn, an = J['sh' + s], J['el' + s], J['wr' + s], J['kn' + s], J['an' + s]
    cut(sh.lerp(el, 0.6), el - sh, sh.lerp(el, 0.6), 0.32)
    cut(wr, wr - el, wr, 0.2)
    cut(kn.lerp(an, 0.36), an - kn, kn.lerp(an, 0.36), 0.3)
    cut(Vector((0, 0, 0.16)), Vector((0, 0, 1)), an, 0.3)
    cut(Vector((0, 0, 0.06)), Vector((0, 0, 1)), an + Vector((0, 0.15, -0.1)), 0.5)

# ---------------------------------------------------------------- materials by body region
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


# One material for the whole body (one draw call per player in the game). Each face carries its
# region in a color attribute: red = (index + 0.5) / 16, and the game's shader looks up that player's
# color for the region (jersey, pants, socks... in team colors).
REGIONS = ['jersey', 'trim', 'pants', 'socks', 'shoes', 'sole', 'belt', 'skin', 'hands']
PREVIEW = ['#f4f6fa', '#1f5fe0', '#c3c9d4', '#1f5fe0', '#16181f', '#e9e9ea', '#15161b', '#e0ac69', '#e0ac69']
body_mat = bpy.data.materials.new('body')
body_mat.use_nodes = True
body_mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
body.data.materials.append(body_mat)
region_attr = body.data.color_attributes.new('region', 'FLOAT_COLOR', 'CORNER')
body.data.color_attributes.active_color = region_attr
preview_attr = body.data.color_attributes.new('preview', 'BYTE_COLOR', 'CORNER')


def seg_t(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return t, (a + ab * t - p).length


SEGS = []
for s in ('F', 'B'):
    SEGS += [('arm', J['sh' + s], J['el' + s]), ('fore', J['el' + s], J['wr' + s]), ('hand', J['wr' + s], J['handTip' + s]),
             ('thigh', J['hs' + s], J['kn' + s]), ('shin', J['kn' + s], J['an' + s]), ('foot', J['an' + s], J['toe' + s])]
SEGS += [('torso', J['hip'], J['neck']), ('neck', J['neck'], J['head'])]

for poly in body.data.polygons:
    c = body.matrix_world @ poly.center
    best = min(((seg_t(c, a, b)[1], kind, seg_t(c, a, b)[0]) for kind, a, b in SEGS), key=lambda x: x[0])
    _, kind, t = best
    if kind in ('torso', 'neck') and c.z >= J['neck'].z - 0.02:
        kind = 'neck'
    elif kind == 'neck':
        kind = 'torso'
    if kind == 'torso':
        if c.z < belt_z - 0.06:
            m = 'pants'
        elif c.z < belt_z + 0.06:
            m = 'belt'
        else:
            m = 'jersey'
    elif kind == 'neck':
        m = 'skin'
    elif kind == 'arm':
        m = 'jersey' if t < 0.6 else 'skin'
    elif kind == 'fore':
        m = 'skin'
    elif kind == 'hand':
        m = 'hands'
    elif kind == 'thigh':
        m = 'pants'
    elif kind == 'shin':
        m = 'pants' if t < 0.36 else 'socks'
    else:  # foot
        m = 'sole' if c.z < 0.06 else 'shoes'
    # the bottom of the shins near the ankle that reaches into the cleat
    if kind == 'shin' and c.z < 0.16:
        m = 'shoes'
    k = REGIONS.index(m)
    pc = srgb(PREVIEW[k])
    for li in poly.loop_indices:
        region_attr.data[li].color = ((k + 0.5) / 16, 0.0, 0.0, 1.0)
        preview_attr.data[li].color = pc

# ---------------------------------------------------------------- armature + skinning
arm_data = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm_data)
coll.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for name, head, tail, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = eb[parent]
        b.use_connect = False
    eb[name] = b
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# keep weights tidy for the GPU: at most 4 influences, normalized
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
body.data.color_attributes.remove(body.data.color_attributes['preview'])  # Blender-only preview colors
body.data.color_attributes.active_color = body.data.color_attributes['region']
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_yup=False, export_apply=False,
    export_skins=True, export_animations=False, export_materials='EXPORT', export_texcoords=False,
    export_vertex_color='ACTIVE',
)
print('PLAYER', os.path.getsize(OUT_GLB), len(body.data.polygons), len(body.data.vertices), [g.name for g in body.vertex_groups])
