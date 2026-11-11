import { createMotionSystem, enhanceUrbanEnvironment } from "./scene-activity.js?v=2";

const GROUND_Y = 14.67;
const MAP_WIDTH = 1120;
const MAP_DEPTH = 960;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function makeNoiseTexture(THREE, renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(256, 256);
  let seed = 41291;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = 112 + (seed % 32);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(140, 120);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function removeReplacedSurfaces(model) {
  for (const name of ["Site_Surface", "Site_Circulation"]) {
    model.getObjectByName(name)?.clear();
  }
  model.getObjectByName("Terrain")?.removeFromParent();
  const mapObjects = [];
  model.traverse((object) => {
    if (object.name.startsWith("map_39")) mapObjects.push(object);
  });
  for (const object of mapObjects) object.removeFromParent();
}

function addTerrain(model, THREE, renderer, image) {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    name: "Единый терраин | трава, дороги, тротуары и разметка",
    map: texture,
    bumpMap: makeNoiseTexture(THREE, renderer),
    bumpScale: 0.045,
    roughness: 0.94,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(MAP_WIDTH, MAP_DEPTH), material);
  terrain.name = "Terrain_Unified_Texture_1120x960";
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = GROUND_Y;
  terrain.receiveShadow = true;
  model.add(terrain);
  return terrain;
}

function addSkyEnvironment(scene, renderer, THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const sky = context.createLinearGradient(0, 0, 0, 330);
  sky.addColorStop(0, "#66a5d4");
  sky.addColorStop(0.55, "#b9d7e6");
  sky.addColorStop(1, "#eef0e7");
  context.fillStyle = sky;
  context.fillRect(0, 0, 1024, 330);
  const ground = context.createLinearGradient(0, 330, 0, 512);
  ground.addColorStop(0, "#79866b");
  ground.addColorStop(1, "#313d34");
  context.fillStyle = ground;
  context.fillRect(0, 330, 1024, 182);
  const sun = context.createRadialGradient(280, 105, 2, 280, 105, 80);
  sun.addColorStop(0, "rgba(255,252,226,1)");
  sun.addColorStop(0.08, "rgba(255,248,214,.95)");
  sun.addColorStop(0.25, "rgba(255,244,214,.25)");
  sun.addColorStop(1, "rgba(255,244,214,0)");
  context.fillStyle = sun;
  context.fillRect(190, 15, 180, 180);
  context.fillStyle = "rgba(255,255,255,.18)";
  for (const [x, y, rx, ry] of [[590, 105, 120, 16], [760, 165, 95, 13], [85, 180, 105, 15]]) {
    context.beginPath();
    context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(texture);
  scene.environment = target.texture;
  generator.dispose();
  texture.dispose();
}

function improveArchitecture(model, THREE) {
  const replacements = new Map();
  model.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const updated = materials.map((material) => {
      const name = material.name || "";
      if (!name.includes("Остекление") && !name.includes("Стекло")) return material;
      if (!replacements.has(material.uuid)) {
        replacements.set(material.uuid, new THREE.MeshPhysicalMaterial({
          name: `${name} | отражения и блики`,
          color: material.color.clone().multiplyScalar(0.92),
          map: material.map || null,
          roughness: 0.085,
          metalness: 0.3,
          clearcoat: 1,
          clearcoatRoughness: 0.045,
          envMapIntensity: 2.15,
          ior: 1.5,
          reflectivity: 0.82,
          transparent: material.transparent,
          opacity: material.opacity,
          side: material.side,
        }));
      }
      return replacements.get(material.uuid);
    });
    object.material = Array.isArray(object.material) ? updated : updated[0];
  });
}

function localPosition(building, x, y, z) {
  const cosine = Math.cos(building.angle);
  const sine = Math.sin(building.angle);
  return [
    building.x + cosine * x + sine * z,
    y,
    building.z - sine * x + cosine * z,
  ];
}

function setInstance(mesh, index, THREE, position, scale, angle, scratch) {
  scratch.position.set(...position);
  scratch.scale.set(...scale);
  scratch.quaternion.setFromAxisAngle(THREE.Up, angle);
  scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
  mesh.setMatrixAt(index, scratch.matrix);
}

function finishInstances(mesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}

function addEnvironment(model, THREE, buildings) {
  const group = new THREE.Group();
  group.name = "Environment_Simplified_Architecture";
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.025 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.12 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x43575c,
    roughness: 0.2,
    metalness: 0.34,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.25,
  });
  const walls = new THREE.InstancedMesh(unitBox, wallMaterial, buildings.length);
  const flatRoofs = new THREE.InstancedMesh(unitBox, roofMaterial, buildings.length);
  const hipRoofs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0, 1, 1, 4), roofMaterial, buildings.length);
  const bands = new THREE.InstancedMesh(unitBox, glassMaterial, buildings.length * 64);
  const entrances = new THREE.InstancedMesh(unitBox, glassMaterial, buildings.length);
  walls.name = "Окружение_Разнообразные_объёмы";
  flatRoofs.name = "Окружение_Плоские_кровли";
  hipRoofs.name = "Окружение_Скатные_кровли";
  bands.name = "Окружение_Остекление";
  entrances.name = "Окружение_Входы";

  const palette = [0xc9c5b8, 0xd8d5ca, 0xb7b7ad, 0xb79278, 0xc8b59c, 0x9ca7a5, 0xd0c3ae, 0xaaa397];
  const roofPalette = [0x555b59, 0x6c6961, 0x74655a, 0x484f50, 0x807366];
  const scratch = {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };
  let flatCount = 0;
  let hipCount = 0;
  let bandCount = 0;
  let entranceCount = 0;

  buildings.forEach((building, index) => {
    const height = Math.max(3.2, building.height);
    const isHouse = height < 10 && building.width * building.depth < 900;
    const baseY = GROUND_Y + 0.03;
    setInstance(walls, index, THREE, [building.x, baseY + height / 2, building.z], [building.width, height, building.depth], building.angle, scratch);
    walls.setColorAt(index, new THREE.Color(palette[(index * 5 + 2) % palette.length]));

    if (isHouse) {
      const roofHeight = Math.min(4.2, Math.max(1.8, Math.min(building.width, building.depth) * 0.28));
      setInstance(hipRoofs, hipCount, THREE, [building.x, baseY + height + roofHeight / 2, building.z], [building.width * 0.72, roofHeight, building.depth * 0.72], building.angle + Math.PI / 4, scratch);
      hipRoofs.setColorAt(hipCount, new THREE.Color(roofPalette[(index * 3) % roofPalette.length]));
      hipCount++;
    } else {
      setInstance(flatRoofs, flatCount, THREE, [building.x, baseY + height + 0.18, building.z], [building.width + 0.3, 0.36, building.depth + 0.3], building.angle, scratch);
      flatRoofs.setColorAt(flatCount, new THREE.Color(roofPalette[(index * 3) % roofPalette.length]));
      flatCount++;
    }

    const floors = Math.min(14, Math.max(1, Math.floor(height / 3.15)));
    for (let floor = 0; floor < floors; floor++) {
      const y = baseY + 1.65 + floor * 3.15;
      if (y > baseY + height - 0.35) continue;
      for (const side of [-1, 1]) {
        const position = localPosition(building, 0, y, side * (building.depth / 2 + 0.025));
        setInstance(bands, bandCount++, THREE, position, [building.width * 0.78, isHouse ? 0.85 : 1.15, 0.055], building.angle, scratch);
      }
      if (!isHouse && building.depth > 10) {
        for (const side of [-1, 1]) {
          const position = localPosition(building, side * (building.width / 2 + 0.025), y, 0);
          setInstance(bands, bandCount++, THREE, position, [0.055, 1.15, building.depth * 0.76], building.angle, scratch);
        }
      }
    }
    const entrance = localPosition(building, 0, baseY + 1.05, building.depth / 2 + 0.04);
    setInstance(entrances, entranceCount++, THREE, entrance, [Math.min(2.2, building.width * 0.25), 2.1, 0.08], building.angle, scratch);
  });

  hipRoofs.count = hipCount;
  flatRoofs.count = flatCount;
  bands.count = bandCount;
  entrances.count = entranceCount;
  for (const mesh of [walls, flatRoofs, hipRoofs, bands, entrances]) {
    finishInstances(mesh);
    group.add(mesh);
  }
  model.add(group);
  return { buildings: buildings.length, windowBands: bandCount };
}

function addTreeRows(model, THREE) {
  const positions = [];
  for (let x = -510, index = 0; x <= 510; x += 18, index++) {
    positions.push([x, -254 + Math.sin(index * 1.7) * 2.2, 0.85 + (index % 4) * 0.08]);
    if (x < -150 || x > 170) positions.push([x + 5, -137 + Math.cos(index) * 2, 0.9 + (index % 3) * 0.08]);
  }
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.22, 3.4, 7),
    new THREE.MeshStandardMaterial({ color: 0x5b4a36, roughness: 1 }),
    positions.length,
  );
  const crown = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 9, 7),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
    positions.length,
  );
  trunk.name = "Окружение_Деревья_стволы";
  crown.name = "Окружение_Деревья_кроны";
  const scratch = {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };
  positions.forEach(([x, z, scale], index) => {
    setInstance(trunk, index, THREE, [x, GROUND_Y + 1.7, z], [scale, scale, scale], 0, scratch);
    setInstance(crown, index, THREE, [x, GROUND_Y + 4.65 * scale, z], [2.4 * scale, 2.9 * scale, 2.35 * scale], index * 0.7, scratch);
    crown.setColorAt(index, new THREE.Color([0x35572e, 0x46683a, 0x527443, 0x3d6234][index % 4]));
  });
  finishInstances(trunk);
  finishInstances(crown);
  model.add(trunk, crown);
  return positions.length;
}

function addPlazaLife(model, THREE) {
  const group = new THREE.Group();
  group.name = "A9_Площадь_Мебель_и_наполнение";
  const wood = new THREE.MeshStandardMaterial({ color: 0x8f7253, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e3837, roughness: 0.45, metalness: 0.45 });
  const canopy = new THREE.MeshStandardMaterial({ color: 0xd8cfba, roughness: 0.82, side: THREE.DoubleSide });
  const tablePositions = [[75, -62], [80, -60], [77, -56], [72, -57]];
  for (const [x, z] of tablePositions) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.09, 20), wood);
    top.position.set(x, GROUND_Y + 0.78, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.75, 10), dark);
    pole.position.set(x, GROUND_Y + 1.38, z);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 1.75, 0.55, 20), canopy);
    shade.position.set(x, GROUND_Y + 2.65, z);
    group.add(top, pole, shade);
    for (const side of [-1, 1]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.55), wood);
      seat.position.set(x + side * 1.12, GROUND_Y + 0.46, z);
      group.add(seat);
    }
  }
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  model.add(group);

  const people = [[57, -79], [61, -74], [54, -67], [64, -58], [47, -77], [77, -70], [82, -66], [38, -43], [33, -47], [90, -44], [42, -91], [69, -88]];
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.19, 0.25, 0.85, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), people.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc99d7c, roughness: 0.9 }), people.length);
  bodies.name = "A9_Площадь_Люди";
  const scratch = { matrix: new THREE.Matrix4(), position: new THREE.Vector3(), scale: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  const colors = [0x4f6d78, 0x8b594c, 0xbaa16d, 0x3e4a50, 0x6f7652, 0x805d75];
  people.forEach(([x, z], index) => {
    setInstance(bodies, index, THREE, [x, GROUND_Y + 1.02, z], [1, 1, 1], index, scratch);
    setInstance(heads, index, THREE, [x, GROUND_Y + 1.62, z], [1, 1, 1], 0, scratch);
    bodies.setColorAt(index, new THREE.Color(colors[index % colors.length]));
  });
  finishInstances(bodies);
  finishInstances(heads);
  model.add(bodies, heads);
  return { cafeTables: tablePositions.length, people: people.length };
}

export async function refineArenaScene(model, context) {
  const { THREE, renderer, scene } = context;
  THREE.Up = new THREE.Vector3(0, 1, 0);
  addSkyEnvironment(scene, renderer, THREE);
  const [terrainImage, buildings, infrastructure] = await Promise.all([
    loadImage("./assets/terrain-novaya-riga.png?v=2"),
    fetch("./assets/environment-buildings.json").then((response) => {
      if (!response.ok) throw new Error(`Environment layout: ${response.status}`);
      return response.json();
    }),
    fetch("./assets/infrastructure.json").then((response) => {
      if (!response.ok) throw new Error(`Infrastructure layout: ${response.status}`);
      return response.json();
    }),
  ]);
  removeReplacedSurfaces(model);
  improveArchitecture(model, THREE);
  const terrain = addTerrain(model, THREE, renderer, terrainImage);
  const environment = addEnvironment(model, THREE, buildings);
  const trees = addTreeRows(model, THREE);
  const plaza = addPlazaLife(model, THREE);
  const urban = enhanceUrbanEnvironment(model, THREE, buildings, infrastructure);
  const motion = createMotionSystem(model, THREE, infrastructure);
  window.__A9_TRAFFIC_ASSET__ = motion.setAsset;
  window.__A9_MOTION__ = motion;
  model.userData.refinement = { mapMeters: [MAP_WIDTH, MAP_DEPTH], unifiedTerrain: true, ...environment, trees, ...plaza, ...urban };
  window.__A9_REFINEMENT__ = model.userData.refinement;
  return terrain;
}
