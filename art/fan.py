"""Umpire Madness bleacher fan: a low-poly seated spectator, built in Blender from code.

Run headless from the repo root:
    blender --background --factory-startup --python art/fan.py

Writes public/models/fan.glb (and art/out/fan.blend to open in Blender).
Units are feet. The fan sits with the hips on the seat top at the origin, faces +Y (toward the field),
knees forward and feet down on the footboard (the bleachers' footboard is 1.45 ft in front, 1.13 ft down).
The game draws every fan with one instanced mesh per part and gives each fan its own colors,
so each part is one mesh with a plain white material:
  fan_torso (shirt), fan_legs (pants), fan_shoes, fan_head (skin), fan_hair, fan_cap (some fans wear one),
  fan_sleeve_l / fan_sleeve_r (shirt) and fan_arm_l / fan_arm_r (skin), whose origins sit at the shoulder so
  the game can swing them up to cheer.
About 350 triangles per fan: there are a few hundred of them.
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'fan.glb')
OUT_BLEND = os.path.join(ROOT, 'art', 'out', 'fan.blend')

bpy.ops.wm.read_factory_settings(use_empty=True)
coll = bpy.context.scene.collection
white = bpy.data.materials.new('fan')
white.use_nodes = True
white.diffuse_color = (0.8, 0.8, 0.8, 1)


def obj(name, bm, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(white)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    o.location = loc
    return o


def ellipsoid(c, r, segs=(7, 5)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    bmesh.ops.scale(bm, vec=r, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def limb(a, b, ra, rb, sides=5):
    """Tapered open prism from a to b (the ends tuck inside neighbouring parts)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d)
    bm = bmesh.new()
    rings = []
    for p, r in ((a, ra), (b, rb)):
        rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / sides) + up * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)])
    for k in range(sides):
        bm.faces.new((rings[0][k], rings[0][(k + 1) % sides], rings[1][(k + 1) % sides], rings[1][k]))
    return bm


def loft(rings, sides=8):
    """A smooth body through elliptical rings [(z, rx, ry, y_offset)], closed at both ends."""
    bm = bmesh.new()
    vr = [[bm.verts.new((math.cos(2 * math.pi * k / sides) * rx, yo + math.sin(2 * math.pi * k / sides) * ry, z)) for k in range(sides)] for (z, rx, ry, yo) in rings]
    for i in range(len(vr) - 1):
        for k in range(sides):
            bm.faces.new((vr[i][k], vr[i][(k + 1) % sides], vr[i + 1][(k + 1) % sides], vr[i + 1][k]))
    bm.faces.new(list(reversed(vr[0])))
    bm.faces.new(vr[-1])
    return bm


def merge(name, bms, loc=(0, 0, 0)):
    """Combine several bmeshes into one object."""
    me_all = bmesh.new()
    for bm in bms:
        tmp = bpy.data.meshes.new('tmp')
        bm.to_mesh(tmp)
        bm.free()
        me_all.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    if loc != (0, 0, 0):
        bmesh.ops.translate(me_all, vec=-Vector(loc), verts=me_all.verts)
    o = obj(name, me_all, loc)
    o.data.polygons.foreach_set('use_smooth', [True] * len(o.data.polygons))
    return o


# ---------------------------------------------------------------- body
merge('fan_torso', [loft([  # shirt: from the lap up through the belly and chest to the shoulders
    (0.4, 0.46, 0.34, 0.06), (0.8, 0.53, 0.38, 0.05), (1.2, 0.58, 0.36, 0.02), (1.55, 0.58, 0.32, 0.0),
    (1.72, 0.42, 0.26, 0.0), (1.8, 0.18, 0.14, 0.0)])])
legs = [ellipsoid((0, 0.12, 0.22), (0.52, 0.48, 0.26), (7, 4))]  # lap
for sx in (-1, 1):
    legs.append(limb((sx * 0.27, 0.15, 0.24), (sx * 0.3, 1.28, 0.26), 0.22, 0.18))   # thigh, forward on the seat
    legs.append(limb((sx * 0.3, 1.28, 0.32), (sx * 0.31, 1.45, -1.0), 0.18, 0.13))   # shin, down to the footboard
merge('fan_legs', legs)
shoes = []
for sx in (-1, 1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.3, 0.6, 0.22), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((sx * 0.31, 1.58, -1.02)), verts=bm.verts)
    shoes.append(bm)
merge('fan_shoes', shoes)
merge('fan_head', [
    limb((0, 0, 1.7), (0, 0.03, 2.08), 0.15, 0.14),             # neck
    ellipsoid((0, 0.05, 2.35), (0.33, 0.36, 0.4)),              # head
    ellipsoid((0, 0.4, 2.3), (0.07, 0.07, 0.09), (4, 3)),       # nose
])
merge('fan_hair', [ellipsoid((0, -0.05, 2.45), (0.36, 0.36, 0.33), (7, 4))])
cap = [ellipsoid((0, 0.02, 2.5), (0.37, 0.39, 0.28), (7, 4))]
bm = bmesh.new()  # the brim
bmesh.ops.create_circle(bm, cap_ends=True, segments=6, radius=1.0)
bmesh.ops.scale(bm, vec=(0.28, 0.24, 1), verts=bm.verts)
bmesh.ops.translate(bm, vec=Vector((0, 0.42, 2.48)), verts=bm.verts)
cap.append(bm)
merge('fan_cap', cap)

# ---------------------------------------------------------------- arms (pivot at the shoulder)
# Resting: straight arms hanging at the sides, hands down by the seat. Straight arms mean a cheer is
# just one swing out to the side at the shoulder, up into a V.
for tag, sx in (('l', -1), ('r', 1)):
    sh = Vector((sx * 0.6, 0.0, 1.62))
    el = Vector((sx * 0.68, 0.06, 0.95))
    wr = Vector((sx * 0.71, 0.12, 0.4))
    hand = wr + (wr - el).normalized() * 0.07
    mid = sh.lerp(el, 0.55)
    merge(f'fan_sleeve_{tag}', [
        ellipsoid(sh, (0.19, 0.19, 0.19), (5, 3)),                 # shoulder
        limb(sh, mid, 0.17, 0.16),                                  # short sleeve
    ], loc=tuple(sh))
    merge(f'fan_arm_{tag}', [
        limb(sh.lerp(el, 0.45), el, 0.12, 0.11),                    # upper arm below the sleeve
        limb(el, wr, 0.11, 0.09),                                   # forearm
        ellipsoid(hand, (0.1, 0.12, 0.08), (5, 3)),                 # hand
    ], loc=tuple(sh))

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_yup=False, export_apply=True,
    export_texcoords=False, export_normals=True, export_materials='EXPORT',
)
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.objects if o.type == 'MESH'}
print('FAN', os.path.getsize(OUT_GLB), sum(tris.values()), tris)
