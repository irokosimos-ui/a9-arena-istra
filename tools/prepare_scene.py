from collections import defaultdict
import json
import math
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "A9_Arena.glb"
TERRAIN_OUTPUT = ROOT / "assets" / "terrain-novaya-riga.png"
BUILDINGS_OUTPUT = ROOT / "assets" / "environment-buildings.json"
INFRASTRUCTURE_OUTPUT = ROOT / "assets" / "infrastructure.json"
BOUNDS = (-560.0, 560.0, -480.0, 480.0)
WIDTH = 4096
HEIGHT = round(WIDTH * (BOUNDS[3] - BOUNDS[2]) / (BOUNDS[1] - BOUNDS[0]))


def read_glb(path):
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20 : 20 + json_length])
    return data, document, 28 + json_length


DATA, GLTF, BINARY_OFFSET = read_glb(SOURCE)


def accessor(index):
    desc = GLTF["accessors"][index]
    view = GLTF["bufferViews"][desc["bufferView"]]
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[desc["type"]]
    dtype = np.dtype({5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[desc["componentType"]])
    offset = BINARY_OFFSET + view.get("byteOffset", 0) + desc.get("byteOffset", 0)
    stride = view.get("byteStride", components * dtype.itemsize)
    array = np.ndarray(
        shape=(desc["count"], components),
        dtype=dtype,
        buffer=DATA,
        offset=offset,
        strides=(stride, dtype.itemsize),
    )
    return np.asarray(array)


def node_matrix(node):
    if "matrix" in node:
        return np.asarray(node["matrix"], dtype=float).reshape(4, 4).T
    matrix = np.eye(4)
    scale = node.get("scale", [1, 1, 1])
    rotation = node.get("rotation", [0, 0, 0, 1])
    x, y, z, w = rotation
    matrix[:3, :3] = np.asarray(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    ) @ np.diag(scale)
    matrix[:3, 3] = node.get("translation", [0, 0, 0])
    return matrix


def world_mesh(node_index, parent_matrix=None):
    node = GLTF["nodes"][node_index]
    matrix = (np.eye(4) if parent_matrix is None else parent_matrix) @ node_matrix(node)
    result = []
    if "mesh" in node:
        for primitive in GLTF["meshes"][node["mesh"]]["primitives"]:
            positions = accessor(primitive["attributes"]["POSITION"]).astype(float)
            homogeneous = np.column_stack((positions, np.ones(len(positions))))
            positions = (homogeneous @ matrix.T)[:, :3]
            indices = (
                accessor(primitive["indices"]).reshape(-1)
                if "indices" in primitive
                else np.arange(len(positions))
            )
            result.append((node, primitive, positions, indices.reshape(-1, 3)))
    return result


def collect_group(group_name):
    root_index = next(i for i, node in enumerate(GLTF["nodes"]) if node.get("name") == group_name)
    root = GLTF["nodes"][root_index]
    matrix = node_matrix(root)
    meshes = []
    for child in root.get("children", []):
        meshes.extend(world_mesh(child, matrix))
    return meshes


def pixel_coordinates(points):
    x = (points[..., 0] - BOUNDS[0]) / (BOUNDS[1] - BOUNDS[0]) * WIDTH
    y = (BOUNDS[3] - points[..., -1]) / (BOUNDS[3] - BOUNDS[2]) * HEIGHT
    return np.stack((x, y), axis=-1)


def rasterize_triangles(draw, positions, triangles, value=255):
    projected = pixel_coordinates(positions)
    for triangle in triangles:
        points = projected[triangle]
        if np.all(points[:, 0] < 0) or np.all(points[:, 0] >= WIDTH):
            continue
        if np.all(points[:, 1] < 0) or np.all(points[:, 1] >= HEIGHT):
            continue
        draw.polygon([tuple(point) for point in points], fill=value)


def random_surface(color, fine, broad, seed, paving=False):
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, fine, (HEIGHT, WIDTH, 1))
    low = rng.normal(0, broad, (max(2, HEIGHT // 48), max(2, WIDTH // 48)))
    low_image = Image.fromarray(np.uint8(np.clip(low * 18 + 128, 0, 255)))
    low_image = low_image.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(12))
    low_noise = (np.asarray(low_image, dtype=float) - 128) / 18
    pixels = np.clip(np.asarray(color)[None, None, :] + noise + low_noise[..., None], 0, 255).astype(np.uint8)
    image = Image.fromarray(pixels, "RGB")
    if paving:
        draw = ImageDraw.Draw(image)
        step = 5
        joint = tuple(max(0, channel - 15) for channel in color)
        for x in range(0, WIDTH, step):
            draw.line((x, 0, x, HEIGHT), fill=joint, width=1)
        for y in range(0, HEIGHT, step):
            draw.line((0, y, WIDTH, y), fill=joint, width=1)
    return image


def add_mesh_to_mask(masks, category, mesh):
    node, _, positions, triangles = mesh
    if category not in masks:
        masks[category] = Image.new("L", (WIDTH, HEIGHT), 0)
    rasterize_triangles(ImageDraw.Draw(masks[category]), positions, triangles)


def ensure_mask(masks, category):
    if category not in masks:
        masks[category] = Image.new("L", (WIDTH, HEIGHT), 0)
    return masks[category]


def road_paths(mesh):
    _, _, positions, _ = mesh
    left = positions[0::2][:, [0, 2]]
    right = positions[1::2][:, [0, 2]]
    for i in range(1, len(left)):
        if np.dot(right[i] - left[i], right[i - 1] - left[i - 1]) < 0:
            left[i], right[i] = right[i].copy(), left[i].copy()
    centers = (left + right) / 2
    paths = []
    current = {"left": [], "right": []}
    for i in range(len(centers)):
        discontinuity = i and (
            np.linalg.norm(centers[i] - centers[i - 1]) > 45
            or np.linalg.norm(left[i] - left[i - 1]) > 45
            or np.linalg.norm(right[i] - right[i - 1]) > 45
        )
        if discontinuity:
            if len(current["left"]) > 1:
                paths.append(current)
            current = {"left": [], "right": []}
        current["left"].append([round(float(left[i, 0]), 3), round(float(left[i, 1]), 3)])
        current["right"].append([round(float(right[i, 0]), 3), round(float(right[i, 1]), 3)])
    if len(current["left"]) > 1:
        paths.append(current)
    return paths


def road_markings(mesh, masks, category):
    paths = road_paths(mesh)
    marking = ImageDraw.Draw(ensure_mask(masks, "marking"))
    edge = ImageDraw.Draw(ensure_mask(masks, "road_edge"))
    yellow = ImageDraw.Draw(ensure_mask(masks, "road_yellow"))
    pixels_per_meter = WIDTH / (BOUNDS[1] - BOUNDS[0])
    for path in paths:
        left = np.asarray(path["left"])
        right = np.asarray(path["right"])
        centers = (left + right) / 2
        for i in range(len(centers) - 1):
            direction = centers[i + 1] - centers[i]
            length = np.linalg.norm(direction)
            if length < 0.1:
                continue
            direction /= length
            normal = np.asarray([-direction[1], direction[0]])
            road_width = np.linalg.norm(right[i] - left[i])
            offsets = [-road_width / 4, 0, road_width / 4] if category == "motorway" else [0]
            if category == "residential" and road_width < 5.5:
                offsets = []
            if i % 2 == 0:
                for offset in offsets:
                    a = centers[i] + normal * offset
                    b = centers[i + 1] + normal * offset
                    b = a + (b - a) * 0.44
                    marking.line((tuple(pixel_coordinates(a)), tuple(pixel_coordinates(b))), fill=255, width=max(1, round(0.13 * pixels_per_meter)))
            if category == "motorway":
                for edge_points in (left, right):
                    a = pixel_coordinates(edge_points[i])
                    b = pixel_coordinates(edge_points[i + 1])
                    edge.line((tuple(a), tuple(b)), fill=230, width=max(1, round(0.1 * pixels_per_meter)))
                    yellow.line((tuple(a), tuple(b)), fill=255, width=max(1, round(0.16 * pixels_per_meter)))


def add_crosswalks(road_meshes, masks):
    draw = ImageDraw.Draw(ensure_mask(masks, "marking"))
    targets = [(-128, -133), (153, -122), (151, 35), (-126, 37)]
    segments = []
    for meshes in road_meshes.values():
        for mesh in meshes:
            for path in road_paths(mesh):
                left = np.asarray(path["left"])
                right = np.asarray(path["right"])
                centers = (left + right) / 2
                for i in range(len(centers) - 1):
                    if np.linalg.norm(centers[i + 1] - centers[i]) > 0.1 and np.linalg.norm(right[i] - left[i]) > 1:
                        segments.append((centers[i], centers[i + 1], right[i] - left[i]))
    for target in targets:
        target = np.asarray(target)
        segment = min(segments, key=lambda item: np.linalg.norm((item[0] + item[1]) / 2 - target))
        a, b, across = segment
        midpoint = (a + b) / 2
        if np.linalg.norm(midpoint - target) > 45:
            continue
        direction = (b - a) / np.linalg.norm(b - a)
        normal = across / np.linalg.norm(across)
        width = np.linalg.norm(across) * 0.82
        for stripe in range(-4, 5):
            center = midpoint + direction * stripe * 0.78
            half_line = normal * width / 2
            half_stripe = direction * 0.19
            corners = [center - half_line - half_stripe, center + half_line - half_stripe, center + half_line + half_stripe, center - half_line + half_stripe]
            draw.polygon([tuple(pixel_coordinates(point)) for point in corners], fill=255)


def build_terrain():
    masks = {}
    map_sources = [
        ("map_39.osm_forest", "forest"),
        ("map_39.osm_water", "water"),
        ("map_39.osm_roads_track", "track"),
        ("map_39.osm_roads_residential", "residential"),
        ("map_39.osm_roads_tertiary", "tertiary"),
        ("map_39.osm_roads_secondary", "secondary"),
        ("map_39.osm_roads_motorway", "motorway"),
        ("map_39.osm_paths_footway", "footway"),
    ]
    node_lookup = {node.get("name"): i for i, node in enumerate(GLTF["nodes"])}
    road_meshes = defaultdict(list)
    for name, category in map_sources:
        mesh = world_mesh(node_lookup[name])[0]
        add_mesh_to_mask(masks, category, mesh)
        if category in {"motorway", "secondary", "tertiary", "residential"}:
            road_meshes[category].append(mesh)
            road_markings(mesh, masks, category)
    add_crosswalks(road_meshes, masks)

    for mesh in collect_group("Site_Surface"):
        add_mesh_to_mask(masks, "site_lawn", mesh)

    for mesh in collect_group("Site_Circulation"):
        node, primitive, _, _ = mesh
        name = node.get("name", "")
        material = GLTF["materials"][primitive["material"]].get("name", "")
        if "Трасса" in name:
            category = "marking"
        elif "Асфальт" in material or "дорога" in name.lower() or "подъезд" in name.lower() or "парковка" in name.lower():
            category = "site_asphalt"
        elif "тёплый камень" in material:
            category = "site_stone"
        else:
            category = "site_paving"
        add_mesh_to_mask(masks, category, mesh)

    surfaces = {
        "forest": ((75, 100, 62), 3.2, 5.0, False),
        "water": ((75, 116, 128), 1.2, 2.0, False),
        "track": ((126, 119, 100), 4.0, 3.0, False),
        "residential": ((91, 94, 89), 3.2, 2.0, False),
        "tertiary": ((84, 88, 85), 3.0, 2.0, False),
        "secondary": ((79, 83, 82), 3.0, 2.0, False),
        "motorway": ((68, 73, 74), 2.8, 1.5, False),
        "footway": ((166, 161, 145), 2.8, 2.0, True),
        "site_lawn": ((104, 127, 78), 3.0, 4.0, False),
        "site_asphalt": ((73, 78, 77), 3.0, 1.5, False),
        "site_paving": ((174, 165, 148), 2.2, 1.5, True),
        "site_stone": ((193, 182, 161), 2.0, 1.5, True),
        "marking": ((220, 218, 199), 1.2, 0.5, False),
        "road_edge": ((202, 204, 194), 1.0, 0.3, False),
        "road_yellow": ((218, 184, 67), 1.0, 0.3, False),
    }
    base = random_surface((98, 119, 73), 3.8, 5.5, 9127)
    for index, (category, (color, fine, broad, paving)) in enumerate(surfaces.items()):
        if category not in masks:
            continue
        surface = random_surface(color, fine, broad, 1200 + index, paving)
        base.paste(surface, (0, 0), masks[category])
    base.save(TERRAIN_OUTPUT, optimize=True)
    return masks


class UnionFind:
    def __init__(self, count):
        self.parent = list(range(count))

    def find(self, item):
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.parent[b] = a


def oriented_footprint(points):
    xz = points[:, [0, 2]]
    covariance = np.cov(xz.T)
    values, vectors = np.linalg.eigh(covariance)
    axis = vectors[:, np.argmax(values)]
    if axis[0] < 0:
        axis = -axis
    perpendicular = np.asarray([-axis[1], axis[0]])
    u = xz @ axis
    v = xz @ perpendicular
    u_min, u_max = u.min(), u.max()
    v_min, v_max = v.min(), v.max()
    center = axis * ((u_min + u_max) / 2) + perpendicular * ((v_min + v_max) / 2)
    return center, u_max - u_min, v_max - v_min, -math.atan2(axis[1], axis[0])


def build_environment():
    node_index = next(i for i, node in enumerate(GLTF["nodes"]) if node.get("name") == "map_39.osm_buildings")
    _, _, positions, triangles = world_mesh(node_index)[0]
    union = UnionFind(len(positions))
    coordinates = {}
    for index, point in enumerate(positions):
        key = tuple(np.round(point, 4))
        if key in coordinates:
            union.union(index, coordinates[key])
        else:
            coordinates[key] = index
    for triangle in triangles:
        union.union(int(triangle[0]), int(triangle[1]))
        union.union(int(triangle[0]), int(triangle[2]))
    components = defaultdict(list)
    for index in range(len(positions)):
        components[union.find(index)].append(index)

    buildings = []
    for indices in components.values():
        points = positions[indices]
        center, width, depth, angle = oriented_footprint(points)
        height = float(points[:, 1].max() - points[:, 1].min())
        if width < 2 or depth < 2 or height < 2:
            continue
        if not (BOUNDS[0] < center[0] < BOUNDS[1] and BOUNDS[2] < center[1] < BOUNDS[3]):
            continue
        if -150 < center[0] < 170 and -155 < center[1] < 115:
            continue
        buildings.append(
            {
                "id": len(buildings),
                "x": round(float(center[0]), 3),
                "z": round(float(center[1]), 3),
                "width": round(float(width), 3),
                "depth": round(float(depth), 3),
                "height": round(height, 3),
                "angle": round(angle, 6),
            }
        )
    buildings.sort(key=lambda item: (item["z"], item["x"]))
    for index, building in enumerate(buildings):
        building["id"] = index
    BUILDINGS_OUTPUT.write_text(json.dumps(buildings, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(components), len(buildings)


def build_infrastructure(masks):
    roads = {}
    for category in ["motorway", "secondary", "tertiary", "residential"]:
        name = f"map_39.osm_roads_{category}"
        node_index = next(i for i, node in enumerate(GLTF["nodes"]) if node.get("name") == name)
        roads[category] = road_paths(world_mesh(node_index)[0])
    forest_trees = []
    rng = np.random.default_rng(5519)
    forest = np.asarray(masks["forest"])
    for _ in range(5000):
        x = rng.uniform(BOUNDS[0] + 12, BOUNDS[1] - 12)
        z = rng.uniform(BOUNDS[2] + 12, BOUNDS[3] - 12)
        px = int((x - BOUNDS[0]) / (BOUNDS[1] - BOUNDS[0]) * WIDTH)
        py = int((BOUNDS[3] - z) / (BOUNDS[3] - BOUNDS[2]) * HEIGHT)
        if forest[py, px] < 180:
            continue
        if -155 < x < 170 and -160 < z < 120:
            continue
        forest_trees.append([round(float(x), 2), round(float(z), 2), round(float(rng.uniform(0.82, 1.28)), 2)])
        if len(forest_trees) >= 230:
            break
    result = {"roads": roads, "forestTrees": forest_trees}
    INFRASTRUCTURE_OUTPUT.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return {category: len(paths) for category, paths in roads.items()}


if __name__ == "__main__":
    masks = build_terrain()
    components, buildings = build_environment()
    paths = build_infrastructure(masks)
    print(json.dumps({"terrain": [WIDTH, HEIGHT], "surfaceLayers": list(masks), "sourceComponents": components, "buildings": buildings, "roadPaths": paths, "forestTrees": len(json.loads(INFRASTRUCTURE_OUTPUT.read_text())['forestTrees'])}, ensure_ascii=False))
