# Orientation contract · 2026-10-13

默认 Three.js 为 Y-up；forwardAxis 未确认（null），不可由包围盒猜正面。

Read `orientation.json`, or import `orientation` from the existing entry. It is also available as `metadata.orientation` and `root.userData.asset.orientation`.

Reference state: `parked`. Status: `unknown`. These are whole-asset placement axes after loading, relative to an identity placement parent. They are not raw root-local axes and do not track moving children in other states. `createAsset` already converts Z-up to Y-up by default. Preserve the returned root rotation/scale; place and yaw an outer group.

No reliable whole-asset forward is declared. If facing matters, inspect one useful view and record it; do not guess a 180° correction from dimensions.

```js
import {createAsset, orientation} from './asset.mjs';
const root = await createAsset(THREE, {states:'lazy', sharedResources:true}); // Y-up
const placement = new THREE.Group();
placement.add(root);
scene.add(placement);
// Move/scale placement. Leave root's loader transform intact.
const f = orientation.placement.Y.forwardVector; // null means unknown
const targetInParent = null; // replace with a THREE.Vector3 target when needed
// Optional: yaw toward targetInParent (same parent coordinates as placement.position).
if (f && targetInParent) {
  const d = targetInParent.clone().sub(placement.position);
  if (Math.hypot(d.x, d.z) > 1e-8)
    placement.rotation.y = Math.atan2(d.x, d.z) - Math.atan2(f[0], f[2]);
}
```

For a Z-up application, request `upAxis:'Z'` explicitly and use `orientation.placement.Z`; do not apply another up-axis conversion. Direction vectors must be transformed with the **placement parent**, not the converted root, when checking scene-space facing. Non-reference states may require their own functional-direction check.

---

# Lightweight Web asset

Keep this directory together and serve it over HTTP(S). No CDN/runtime dependency is bundled; supply your installed Three.js namespace (verified r170).

```js
import {createAsset, availableStates} from './asset.mjs';
const root = await createAsset(THREE, {states:'lazy', sharedResources:true});
scene.add(root);
await root.setState(availableStates[0]);
// Remove from scene before disposal:
scene.remove(root);
await root.dispose();
```

Omit `states:'lazy'` to retain the original eager-state/synchronous setState API. With lazy states, await setState; await root.prepareState(name) can warm a state without switching. All original states, hierarchy, names, material slots and transforms are retained. Geometry is exact Float32 with exact-tuple indexing; no decimation. Texture resolution and alpha are unchanged. Color WebP95 has RGB RMS <=2/255, p99 <=6/255 and maximum <=32/255. Numeric texture changes use lossless WebP after uniform quantization with maximum <=2/255 channel error; normal-map mean angular error <=0.65 degrees, p99 <=1.4 and maximum <=2 degrees. Other maps retain exact decoded pixels. Per-texture measurements are in receipt.json. Originals and native editable files remain in the full asset package.

Shared resources are opt-in: geometry and textures are read-only/shared, but materials are independent. Use sharedResources:false (default) before editing vertex buffers or texture settings on one instance. Dispose is reference-counted. This performance derivative inherits its source qualification; it does not make an original asset a unified asset.
