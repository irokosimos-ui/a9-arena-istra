import json
from pathlib import Path
import struct
import sys

import bpy


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
OUTPUT = ASSETS / "A9_Arena.glb"
CHUNK_SIZE = 12 * 1024 * 1024


def principled(material):
    if not material.use_nodes:
        return None
    return next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)


def flatten_web_materials():
    flattened = []
    for material in bpy.data.materials:
        if not material.users:
            continue
        shader = principled(material)
        if shader is None:
            continue
        base = shader.inputs["Base Color"]
        if base.links and base.links[0].from_node.type != "VERTEX_COLOR":
            color = tuple(material.diffuse_color)
            if material.name in {"РН_a9g", "РН_a9g_warm", "РН_a9sky"}:
                color = (0.34, 0.26, 0.17, 1.0)
            for link in list(base.links):
                material.node_tree.links.remove(link)
            base.default_value = color
            flattened.append(material.name)
        emission = shader.inputs.get("Emission Strength")
        if emission and emission.links:
            for link in list(emission.links):
                material.node_tree.links.remove(link)
            emission.default_value = 0.34 if material.name in {"РН_a9g", "РН_a9g_warm", "РН_a9sky"} else 1.0
    return flattened


def read_glb(path):
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20 : 20 + json_length])


def triangle_count(document):
    total = 0
    for node in document.get("nodes", []):
        if "mesh" not in node:
            continue
        mesh = document["meshes"][node["mesh"]]
        instances = 1
        extension = node.get("extensions", {}).get("EXT_mesh_gpu_instancing")
        if extension:
            accessor = document["accessors"][extension["attributes"]["TRANSLATION"]]
            instances = accessor["count"]
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                continue
            if "indices" in primitive:
                count = document["accessors"][primitive["indices"]]["count"]
            else:
                count = document["accessors"][primitive["attributes"]["POSITION"]]["count"]
            total += count // 3 * instances
    return total


def write_web_metadata(source_objects):
    document = read_glb(OUTPUT)
    data = OUTPUT.read_bytes()
    stats = {
        "mesh_objects": sum("mesh" in node for node in document.get("nodes", [])),
        "triangles_instanced": triangle_count(document),
        "materials": len(document.get("materials", [])),
        "packed_images": len(document.get("images", [])),
        "gpu_instance_groups": sum("EXT_mesh_gpu_instancing" in node.get("extensions", {}) for node in document.get("nodes", [])),
        "glb_bytes": len(data),
        "glb_mb": round(len(data) / 1_000_000, 1),
        "blend_bytes": Path(bpy.data.filepath).stat().st_size,
        "source_mesh_objects": len(source_objects),
    }
    (ASSETS / "model-stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for old_part in ASSETS.glob("A9_Arena.glb.part*"):
        old_part.unlink()
    parts = []
    for index, offset in enumerate(range(0, len(data), CHUNK_SIZE), 1):
        name = f"A9_Arena.glb.part{index}"
        (ASSETS / name).write_bytes(data[offset : offset + CHUNK_SIZE])
        parts.append(name)
    (ASSETS / "model-parts.json").write_text(json.dumps({"parts": parts}, ensure_ascii=False) + "\n", encoding="utf-8")
    return stats


def build_instance_hierarchy(scatter_objects):
    from array import array
    from mathutils import Matrix

    collection = bpy.data.collections.new("Web_GPU_Instances")
    bpy.context.scene.collection.children.link(collection)
    export_objects = []
    instance_count = 0
    mesh_cache = {}
    for source in scatter_objects:
        modifier = next(mod for mod in source.modifiers if mod.type == "NODES")
        socket = next(
            item
            for item in modifier.node_group.interface.items_tree
            if item.item_type == "SOCKET" and item.in_out == "INPUT" and item.socket_type == "NodeSocketObject"
        )
        prototype = modifier[socket.identifier]
        if prototype is None:
            continue
        mesh_key = prototype.data.as_pointer()
        if mesh_key not in mesh_cache:
            mesh = prototype.data
            byte_colors = next((attribute for attribute in mesh.color_attributes if attribute.data_type == "BYTE_COLOR"), None)
            if byte_colors:
                mesh = prototype.data.copy()
                old_attribute = mesh.color_attributes[byte_colors.name]
                name = old_attribute.name
                values = array("f", [0.0]) * (len(old_attribute.data) * 4)
                old_attribute.data.foreach_get("color", values)
                mesh.color_attributes.remove(old_attribute)
                attribute = mesh.color_attributes.new(name=name, type="FLOAT_COLOR", domain="CORNER")
                attribute.data.foreach_set("color", values)
                mesh.color_attributes.active_color = attribute
            mesh_cache[mesh_key] = mesh
        mesh = mesh_cache[mesh_key]
        parent = bpy.data.objects.new(f"GPU_{source.name}", None)
        collection.objects.link(parent)
        export_objects.append(parent)
        rotations = source.data.attributes.get("rot")
        scales = source.data.attributes.get("scl")
        for index, point in enumerate(source.data.vertices):
            rotation = rotations.data[index].value if rotations else 0.0
            scale = scales.data[index].value if scales else 1.0
            transform = (
                Matrix.Translation(point.co)
                @ Matrix.Rotation(rotation, 4, "Z")
                @ Matrix.Diagonal((scale, scale, scale, 1.0))
                @ prototype.matrix_world
            )
            instance = bpy.data.objects.new(f"{source.name}_{index}", mesh)
            collection.objects.link(instance)
            instance.parent = parent
            instance.matrix_basis = transform
            export_objects.append(instance)
            instance_count += 1
    return export_objects, instance_count


args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if args:
    OUTPUT = Path(args[0]).resolve()

source_objects = [
    obj
    for obj in bpy.context.scene.objects
    if obj.type == "MESH" and obj.visible_get() and not obj.hide_render and not obj.hide_viewport
]
scatter_objects = [obj for obj in source_objects if any(mod.type == "NODES" for mod in obj.modifiers)]
objects = [obj for obj in source_objects if obj not in scatter_objects]
instances, instance_count = build_instance_hierarchy(scatter_objects)
objects.extend(instances)
parents = {obj.parent for obj in objects if obj.parent and obj.parent.type == "EMPTY"}
flattened = flatten_web_materials()

bpy.ops.object.select_all(action="DESELECT")
for obj in objects + list(parents):
    obj.select_set(True)
if objects:
    bpy.context.view_layer.objects.active = objects[0]

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_gpu_instances=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_yup=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_draco_color_quantization=10,
)
stats = write_web_metadata(source_objects)
print(json.dumps({"output": str(OUTPUT), "flattened_materials": len(flattened), "source_instances": instance_count, **stats}, ensure_ascii=False))
