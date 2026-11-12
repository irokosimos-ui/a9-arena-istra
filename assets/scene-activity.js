const GROUND_Y = 14.67;
const UP = [0, 1, 0];

function scratch(THREE) {
  return {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    axis: new THREE.Vector3(...UP),
  };
}

function setInstance(mesh, index, THREE, position, scale, angle, state) {
  state.position.set(...position);
  state.scale.set(...scale);
  state.quaternion.setFromAxisAngle(state.axis, angle);
  state.matrix.compose(state.position, state.quaternion, state.scale);
  mesh.setMatrixAt(index, state.matrix);
}

function finishInstances(mesh, shadows = true) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
}

function localPoint(building, x, z, y = GROUND_Y) {
  const cosine = Math.cos(building.angle);
  const sine = Math.sin(building.angle);
  return [building.x + cosine * x + sine * z, y, building.z - sine * x + cosine * z];
}

function addLabel(model, THREE, text, x, z, width = 25) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(24,35,34,.9)";
  context.beginPath();
  context.roundRect(8, 8, 1008, 144, 28);
  context.fill();
  context.strokeStyle = "rgba(220,232,207,.75)";
  context.lineWidth = 3;
  context.stroke();
  let fontSize = 50;
  context.font = `600 ${fontSize}px Arial, sans-serif`;
  while (context.measureText(text).width > 930 && fontSize > 28) {
    fontSize -= 2;
    context.font = `600 ${fontSize}px Arial, sans-serif`;
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f0f1e9";
  context.fillText(text, 512, 82, 930);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true }));
  sprite.name = `Улица_${text}`;
  sprite.position.set(x, GROUND_Y + 5.2, z);
  sprite.scale.set(width, width * 0.15625, 1);
  model.add(sprite);
  return sprite;
}

function addStreetNames(model, THREE) {
  const labels = [
    ["НОВОРИЖСКОЕ ШОССЕ · М-9 / E22", -230, -193, 32],
    ["НОВОРИЖСКОЕ ШОССЕ · М-9 / E22", 270, -193, 32],
    ["НОВОРИЖСКИЙ БУЛЬВАР", -265, -126, 28],
    ["НОВОРИЖСКИЙ БУЛЬВАР", 295, -126, 28],
    ["НОВОСПАССКИЙ БУЛЬВАР", 166, 115, 28],
    ["ВОСТОЧНАЯ УЛИЦА", 380, 35, 24],
    ["ЗАПАДНАЯ УЛИЦА", -355, -20, 24],
  ];
  return labels.map(([text, x, z, width]) => addLabel(model, THREE, text, x, z, width));
}

function addHighwayGuardrails(model, THREE, paths) {
  const segments = [];
  for (const path of paths) {
    for (const edge of [path.left, path.right]) {
      for (let i = 0; i < edge.length - 1; i++) {
        const a = edge[i];
        const b = edge[i + 1];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length > 0.2 && length < 45) segments.push({ a, b, length });
      }
    }
  }
  const material = new THREE.MeshStandardMaterial({ color: 0xb8bfbd, roughness: 0.34, metalness: 0.72 });
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, segments.length * 2);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, segments.length);
  rails.name = "Новорижское_шоссе_Ограждение_двойное";
  posts.name = "Новорижское_шоссе_Стойки_ограждения";
  const state = scratch(THREE);
  let postIndex = 0;
  segments.forEach(({ a, b, length }, index) => {
    const x = (a[0] + b[0]) / 2;
    const z = (a[1] + b[1]) / 2;
    const angle = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    setInstance(rails, index * 2, THREE, [x, GROUND_Y + 0.55, z], [length, 0.11, 0.1], angle, state);
    setInstance(rails, index * 2 + 1, THREE, [x, GROUND_Y + 0.82, z], [length, 0.09, 0.08], angle, state);
    setInstance(posts, postIndex++, THREE, [a[0], GROUND_Y + 0.42, a[1]], [0.1, 0.84, 0.1], angle, state);
  });
  finishInstances(rails);
  finishInstances(posts);
  model.add(rails, posts);
  return segments.length;
}

function addFencesAndCourtyards(model, THREE, buildings) {
  const houses = buildings.filter((building) => building.height < 10 && building.width * building.depth < 900);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const fenceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.76, metalness: 0.08 });
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7153, roughness: 0.78 });
  const playMaterial = new THREE.MeshStandardMaterial({ color: 0xb99158, roughness: 0.82 });
  const fences = new THREE.InstancedMesh(box, fenceMaterial, houses.length * 5);
  const benches = new THREE.InstancedMesh(box, woodMaterial, Math.ceil(houses.length / 2));
  const playAreas = new THREE.InstancedMesh(box, playMaterial, Math.ceil(houses.length / 8));
  fences.name = "Дворы_Ограждения_участков";
  benches.name = "Дворы_Скамейки";
  playAreas.name = "Дворы_Песочницы_и_игровые_участки";
  const state = scratch(THREE);
  const colors = [0x8b7c68, 0x9b9484, 0x6d776c, 0x9a8067];
  let fenceIndex = 0;
  let benchIndex = 0;
  let playIndex = 0;
  houses.forEach((building, index) => {
    const offset = 3;
    const width = building.width + offset * 2;
    const depth = building.depth + offset * 2;
    const segments = [
      [0, depth / 2, width, 0.1],
      [-width / 2, 0, 0.1, depth],
      [width / 2, 0, 0.1, depth],
      [-width * 0.31, -depth / 2, width * 0.38, 0.1],
      [width * 0.31, -depth / 2, width * 0.38, 0.1],
    ];
    for (const [x, z, sx, sz] of segments) {
      const position = localPoint(building, x, z, GROUND_Y + 0.53);
      setInstance(fences, fenceIndex, THREE, position, [sx, 1.06, sz], building.angle, state);
      fences.setColorAt(fenceIndex, new THREE.Color(colors[(index + fenceIndex) % colors.length]));
      fenceIndex++;
    }
    if (index % 2 === 0) {
      const position = localPoint(building, 0, -building.depth / 2 - 1.3, GROUND_Y + 0.46);
      setInstance(benches, benchIndex++, THREE, position, [1.65, 0.16, 0.48], building.angle, state);
    }
    if (index % 8 === 0) {
      const position = localPoint(building, building.width / 2 + 1.4, 0, GROUND_Y + 0.18);
      setInstance(playAreas, playIndex++, THREE, position, [1.8, 0.36, 2.1], building.angle, state);
    }
  });
  benches.count = benchIndex;
  playAreas.count = playIndex;
  finishInstances(fences);
  finishInstances(benches);
  finishInstances(playAreas);
  model.add(fences, benches, playAreas);
  return { fences: houses.length, benches: benchIndex, playAreas: playIndex };
}

function insideBuilding(x, z, buildings, margin = 2) {
  return buildings.some((building) => {
    const dx = x - building.x;
    const dz = z - building.z;
    const cosine = Math.cos(building.angle);
    const sine = Math.sin(building.angle);
    const localX = cosine * dx - sine * dz;
    const localZ = sine * dx + cosine * dz;
    return Math.abs(localX) < building.width / 2 + margin && Math.abs(localZ) < building.depth / 2 + margin;
  });
}

function addUrbanTrees(model, THREE, buildings, infrastructure) {
  const positions = [...infrastructure.forestTrees];
  const occupied = new Set();
  const add = (x, z, scale = 1) => {
    if (Math.abs(x) > 545 || Math.abs(z) > 465) return;
    if (x > -150 && x < 170 && z > -155 && z < 115) return;
    if (insideBuilding(x, z, buildings, 2.5)) return;
    const key = `${Math.round(x / 6)}:${Math.round(z / 6)}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    positions.push([x, z, scale]);
  };
  buildings.forEach((building, index) => {
    if (index % 2 !== 0) return;
    const side = index % 4 === 0 ? 1 : -1;
    const point = localPoint(building, side * (building.width / 2 + 4.2), building.depth / 2 + 3.8);
    add(point[0], point[2], 0.85 + (index % 5) * 0.08);
  });
  for (const category of ["secondary", "tertiary", "residential"]) {
    for (const path of infrastructure.roads[category]) {
      for (let i = 0; i < path.left.length - 1; i += 5) {
        const left = path.left[i];
        const right = path.right[i];
        const next = path.left[i + 1];
        const dx = next[0] - left[0];
        const dz = next[1] - left[1];
        const length = Math.hypot(dx, dz);
        if (length < 0.1) continue;
        const width = Math.hypot(right[0] - left[0], right[1] - left[1]);
        const centerX = (left[0] + right[0]) / 2;
        const centerZ = (left[1] + right[1]) / 2;
        const offset = width / 2 + 4.2;
        add(centerX - dz / length * offset, centerZ + dx / length * offset, 0.9 + (i % 3) * 0.1);
      }
    }
  }
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.24, 3.5, 7),
    new THREE.MeshStandardMaterial({ color: 0x5a4935, roughness: 1 }),
    positions.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 }),
    positions.length * 2,
  );
  trunks.name = "Город_Деревья_стволы";
  crowns.name = "Город_Деревья_объёмные_кроны";
  const state = scratch(THREE);
  const palette = [0x35572e, 0x46683a, 0x527443, 0x3d6234, 0x607d46];
  positions.forEach(([x, z, scale], index) => {
    setInstance(trunks, index, THREE, [x, GROUND_Y + 1.75 * scale, z], [scale, scale, scale], 0, state);
    setInstance(crowns, index * 2, THREE, [x, GROUND_Y + 4.7 * scale, z], [2.5 * scale, 2.8 * scale, 2.45 * scale], index * 0.61, state);
    setInstance(crowns, index * 2 + 1, THREE, [x + 0.7 * scale, GROUND_Y + 5.55 * scale, z - 0.35 * scale], [1.75 * scale, 1.8 * scale, 1.7 * scale], index, state);
    crowns.setColorAt(index * 2, new THREE.Color(palette[index % palette.length]));
    crowns.setColorAt(index * 2 + 1, new THREE.Color(palette[(index + 2) % palette.length]));
  });
  finishInstances(trunks);
  finishInstances(crowns);
  model.add(trunks, crowns);
  return positions.length;
}

function addParkingAccessAndStairs(model, THREE) {
  const group = new THREE.Group();
  group.name = "А9_Съезд_и_лестницы_по_генплану";
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9aaa2, roughness: 0.8 });
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x343b3c, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x626d6c, roughness: 0.36, metalness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151d1d, roughness: 0.86 });
  const box = (name, size, position, material, angle = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.rotation.y = angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  box("Паркинг_Тёмный_проём", [14, 0.12, 7.2], [-110, GROUND_Y + 0.055, -43], dark);
  const ramp = box("Паркинг_Съезд_14x8_по_генплану", [14, 0.2, 7], [-110, GROUND_Y + 0.14, -43], asphalt);
  ramp.rotation.z = -0.055;
  for (const side of [-1, 1]) {
    box("Паркинг_Боковая_стена", [14.4, 0.75, 0.22], [-110, GROUND_Y + 0.42, -43 + side * 3.65], concrete);
    box("Паркинг_Верхнее_ограждение", [14.4, 0.08, 0.09], [-110, GROUND_Y + 1.03, -43 + side * 3.65], metal);
  }
  for (const side of [-1, 1]) {
    box("Паркинг_Стойка_шлагбаума", [0.18, 1.15, 0.18], [-116.2, GROUND_Y + 0.58, -43 + side * 2.65], metal);
    box("Паркинг_Шлагбаум", [0.12, 0.12, 2.5], [-116.2, GROUND_Y + 1.08, -43 + side * 1.35], concrete);
  }
  addLabel(group, THREE, "ВЪЕЗД / ВЫЕЗД · ПАРКИНГ А9", -110, -43, 15).position.y = GROUND_Y + 3.3;

  const stairs = [
    [-49, -35.5, 0],
    [-6, -35.5, 0],
    [-105.5, -21, Math.PI / 2],
    [-87, 13, 0],
    [-71, 13, 0],
    [-56, 13, 0],
    [27, 11, Math.PI / 2],
  ];
  stairs.forEach(([x, z, angle], stairIndex) => {
    const stair = new THREE.Group();
    stair.name = `Лестница_генплан_${stairIndex + 1}`;
    stair.position.set(x, GROUND_Y, z);
    stair.rotation.y = angle;
    for (let step = 0; step < 7; step++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.12 + step * 0.1, 0.55), concrete);
      mesh.position.set(0, (0.12 + step * 0.1) / 2, -1.65 + step * 0.55);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      stair.add(mesh);
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 4.2), metal);
      rail.position.set(side * 1.48, 1.05, 0);
      stair.add(rail);
      for (const end of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), metal);
        post.position.set(side * 1.48, 0.55, end * 1.75);
        stair.add(post);
      }
    }
    group.add(stair);
  });
  model.add(group);
  return { stairs: stairs.length, parkingAccess: [-110, -43] };
}

function pathData(raw) {
  const points = raw.left.map((point, index) => [(point[0] + raw.right[index][0]) / 2, (point[1] + raw.right[index][1]) / 2]);
  const widths = raw.left.map((point, index) => Math.hypot(raw.right[index][0] - point[0], raw.right[index][1] - point[1]));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, widths, lengths, total: lengths[lengths.length - 1] };
}

function samplePath(path, distance) {
  const target = Math.max(0, Math.min(path.total, distance));
  let index = 0;
  while (index < path.lengths.length - 2 && path.lengths[index + 1] < target) index++;
  const a = path.points[index];
  const b = path.points[index + 1];
  const length = path.lengths[index + 1] - path.lengths[index];
  const mix = length > 0 ? (target - path.lengths[index]) / length : 0;
  const tx = (b[0] - a[0]) / (length || 1);
  const tz = (b[1] - a[1]) / (length || 1);
  return {
    x: a[0] + (b[0] - a[0]) * mix,
    z: a[1] + (b[1] - a[1]) * mix,
    tx,
    tz,
    width: path.widths[index],
  };
}

function createPeople(model, THREE) {
  const paths = [
    [[33.781, -75.643], [36.791, -70.961], [44.15, -65.108], [52.847, -61.987], [62.213, -61.206], [70.241, -65.498], [76.931, -74.082], [80.945, -83.447], [82.952, -90.47]],
    [[82.952, -90.47], [80.61, -81.886], [80.276, -73.302], [81.948, -65.498], [84.29, -59.255]],
    [[62.213, -61.206], [61.879, -63.313], [61.544, -57.851], [63.886, -52.778], [70.241, -50.203], [77.265, -52.388]],
    [[81.948, -65.498], [86.297, -65.498], [91.649, -69.01], [98.004, -70.961]],
    [[87.969, -48.486], [92.987, -46.145], [98.339, -45.365]],
  ];
  const routes = paths.map((points) => pathData({ left: points, right: points }));
  const count = 22;
  const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc99d7c, roughness: 0.9 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x303b43, roughness: 0.92 });
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.21, 0.55, 10), cloth, count);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.135, 12, 8), skin, count);
  const arms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.045, 0.52, 8), cloth, count * 2);
  const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.065, 0.58, 8), trousers, count * 2);
  bodies.name = "А9_Идущие_люди_туловища";
  heads.name = "А9_Идущие_люди_головы";
  arms.name = "А9_Идущие_люди_руки";
  legs.name = "А9_Идущие_люди_ноги";
  const meshes = [bodies, heads, arms, legs];
  meshes.forEach((mesh) => { mesh.frustumCulled = false; });
  const colors = [0x4f6d78, 0x8b594c, 0xbaa16d, 0x3e4a50, 0x6f7652, 0x805d75];
  const people = Array.from({ length: count }, (_, index) => ({
    route: routes[index % routes.length],
    phase: (index * 7.13) % routes[index % routes.length].total,
    speed: 0.48 + (index % 5) * 0.07,
    scale: 0.94 + (index % 4) * 0.035,
  }));
  const state = scratch(THREE);
  const swingAxis = new THREE.Vector3(1, 0, 0);
  const swingQuaternion = new THREE.Quaternion();
  const setLimb = (mesh, index, position, scale, angle, swing) => {
    state.position.set(...position);
    state.scale.set(scale, scale, scale);
    state.quaternion.setFromAxisAngle(state.axis, angle).multiply(swingQuaternion.setFromAxisAngle(swingAxis, swing));
    state.matrix.compose(state.position, state.quaternion, state.scale);
    mesh.setMatrixAt(index, state.matrix);
  };
  const update = (time) => {
    people.forEach((person, index) => {
      const route = person.route;
      const distance = (person.phase + time * person.speed) % route.total;
      const point = samplePath(route, distance);
      const scale = person.scale;
      const ground = 14.84;
      const step = time * 5.6 * person.speed + index * 0.7;
      const bob = Math.abs(Math.sin(step)) * 0.018;
      const angle = Math.atan2(point.tx, point.tz);
      const color = new THREE.Color(colors[index % colors.length]);
      setInstance(bodies, index, THREE, [point.x, ground + 1.04 * scale + bob, point.z], [scale, scale, scale], angle, state);
      setInstance(heads, index, THREE, [point.x, ground + 1.51 * scale + bob, point.z], [scale, scale, scale], angle, state);
      bodies.setColorAt(index, color);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      for (const side of [-1, 1]) {
        const limbIndex = index * 2 + (side === 1 ? 1 : 0);
        const offsetX = cosine * side * 0.23 * scale;
        const offsetZ = -sine * side * 0.23 * scale;
        const swing = Math.sin(step) * 0.42 * side;
        setLimb(arms, limbIndex, [point.x + offsetX, ground + 1.04 * scale + bob, point.z + offsetZ], scale, angle, -swing * 0.8);
        setLimb(legs, limbIndex, [point.x + cosine * side * 0.09 * scale, ground + 0.38 * scale + bob, point.z - sine * side * 0.09 * scale], scale, angle, swing);
        arms.setColorAt(limbIndex, color);
      }
    });
    meshes.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  };
  update(0);
  meshes.forEach((mesh) => finishInstances(mesh));
  model.add(bodies, heads, arms, legs);
  return update;
}

function createTraffic(model, THREE, infrastructure) {
  const highwayPaths = infrastructure.roads.motorway.map(pathData).filter((path) => path.total > 20);
  const cityPaths = [...infrastructure.roads.secondary, ...infrastructure.roads.tertiary, ...infrastructure.roads.residential].map(pathData).filter((path) => path.total > 25);
  const vehicleCount = 66;
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.35 });
  const detailMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.22 });
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bodyMaterial, vehicleCount);
  const details = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), detailMaterial, vehicleCount);
  bodies.name = "Транспорт_Движение_кузова";
  details.name = "Транспорт_Движение_детали";
  bodies.frustumCulled = details.frustumCulled = false;
  const colors = [0xd9d9d2, 0x8e2f2b, 0x273c50, 0x2e3335, 0x787e7d, 0xc3b69b, 0x385b4c];
  const vehicles = Array.from({ length: vehicleCount }, (_, index) => {
    const highway = index < 50;
    const paths = highway ? highwayPaths : cityPaths;
    return {
      path: paths[(index * 7 + 1) % paths.length],
      phase: (index * 31.7) % (highway ? 800 : 180),
      speed: highway ? 18 + (index % 6) * 1.6 : 6 + (index % 4),
      lane: highway ? (index % 3 - 1) : 0.23,
      reverse: index % 2 === 1,
      highway,
    };
  });
  const state = scratch(THREE);
  const update = (time) => {
    vehicles.forEach((vehicle, index) => {
      const path = vehicle.path;
      const direction = vehicle.reverse ? -1 : 1;
      const rawDistance = (vehicle.phase + time * vehicle.speed * direction) % path.total;
      const distance = rawDistance < 0 ? rawDistance + path.total : rawDistance;
      const point = samplePath(path, distance);
      const normalX = -point.tz;
      const normalZ = point.tx;
      const laneOffset = vehicle.highway ? vehicle.lane * point.width / 4 : vehicle.lane * point.width * direction;
      const x = point.x + normalX * laneOffset;
      const z = point.z + normalZ * laneOffset;
      const angle = -Math.atan2(point.tz * direction, point.tx * direction) + Math.PI;
      setInstance(bodies, index, THREE, [x, GROUND_Y + 0.06, z], [1, 1, 1], angle, state);
      setInstance(details, index, THREE, [x, GROUND_Y + 0.06, z], [1, 1, 1], angle, state);
    });
    bodies.instanceMatrix.needsUpdate = true;
    details.instanceMatrix.needsUpdate = true;
  };
  const setAsset = (bodyGeometry, detailGeometry) => {
    bodies.geometry.dispose();
    details.geometry.dispose();
    bodies.geometry = bodyGeometry;
    details.geometry = detailGeometry;
    vehicles.forEach((_, index) => bodies.setColorAt(index, new THREE.Color(colors[index % colors.length])));
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    update(0);
  };
  update(0);
  model.add(bodies, details);
  return { update, setAsset, count: vehicleCount };
}

export function enhanceUrbanEnvironment(model, THREE, buildings, infrastructure) {
  const labels = addStreetNames(model, THREE);
  const guardrailSegments = addHighwayGuardrails(model, THREE, infrastructure.roads.motorway);
  const courtyards = addFencesAndCourtyards(model, THREE, buildings);
  const urbanTrees = addUrbanTrees(model, THREE, buildings, infrastructure);
  const genplan = addParkingAccessAndStairs(model, THREE);
  return { labels: labels.length, guardrailSegments, ...courtyards, urbanTrees, ...genplan };
}

export function createMotionSystem(model, THREE, infrastructure, renderer) {
  const updatePeople = createPeople(model, THREE);
  const traffic = createTraffic(model, THREE, infrastructure);
  const staticRoadVehicles = [];
  model.traverse((object) => {
    if (/^GPU_Расстановка_(?:car_|van$|truck$)/.test(object.name)) staticRoadVehicles.push(object);
  });
  let playing = false;
  let time = 0;
  let previous = performance.now();
  const frame = (now) => {
    const delta = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    if (playing) {
      time += delta;
      updatePeople(time);
      traffic.update(time);
      window.__play?.();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__A9_MOTION_STATE__ = { highwayVehicles: 50, cityVehicles: 16, walkingPeople: 22, staticRoadVehicles: staticRoadVehicles.length };
  return {
    setAsset: traffic.setAsset,
    toggle() {
      playing = !playing;
      staticRoadVehicles.forEach((object) => { object.visible = !playing; });
      if (renderer) renderer.shadowMap.needsUpdate = true;
      previous = performance.now();
      window.__play?.();
      return playing;
    },
    get playing() {
      return playing;
    },
  };
}
