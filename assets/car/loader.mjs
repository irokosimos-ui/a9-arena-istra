// Compact asset resources. Geometry is bit-exact Float32; all state names survive.
// Resource sharing is opt-in: shared geometry/textures must be treated as read-only.
const pools = new WeakMap();
let manifestPromise;
async function unzip(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset resource ${response.status}: ${url}`);
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export async function openAsset(THREE, base, options) {
  manifestPromise ??= unzip(new URL('data.json.gz', base)).then(b => JSON.parse(new TextDecoder().decode(b))).catch(e => {manifestPromise = null; throw e;});
  const data = await manifestPromise;
  const shared = options.sharedResources === true && !options.loadTexture;
  let pool = shared ? pools.get(THREE) : null;
  if (!pool) {
    pool = {refs:0, blocks:new Map(), urls:new Map(), geometries:new Map(), textures:new Map()};
    if (shared) pools.set(THREE, pool);
  }
  pool.refs++;
  let released = false;
  let active = 0;
  const waiting = [];
  async function loadTexture(uri, loader) {
    if (active >= 8) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { return await loader(uri); }
    finally { active--; waiting.shift()?.(); }
  }
  async function prepare(name) {
    if (released) throw new Error('Asset has been disposed');
    if (!data.states[name]) throw new RangeError(`Unknown asset state: ${name}`);
    await Promise.all(data.statePacks[name].map(async file => {
      if (!pool.blocks.has(file)) {
        const block = {buffer:null};
        block.promise = unzip(new URL(file, base)).then(b => block.buffer = b).catch(e => {pool.blocks.delete(file);throw e;});
        pool.blocks.set(file, block);
      }
      await pool.blocks.get(file).promise;
    }));
    if (released) throw new Error('Asset has been disposed');
  }
  function bytes(d) {
    const buffer = pool.blocks.get(d.file)?.buffer;
    if (!buffer) throw new Error('Asset state has not been prepared');
    return new Uint8Array(buffer, d.offset, d.length);
  }
  function array(d) {
    const b = bytes(d);
    const Type = d.type === 'u32' ? Uint32Array : Float32Array;
    return new Type(b.buffer, b.byteOffset, b.byteLength / 4);
  }
  function uri(id) {
    const d = data.textures[id], key = `${d.file}:${d.offset}`;
    if (!pool.urls.has(key)) pool.urls.set(key, URL.createObjectURL(new Blob([bytes(d)], {type:d.mime})));
    return pool.urls.get(key);
  }
  async function release() {
    if (released) return;
    released = true;
    if (--pool.refs) return;
    // Detach immediately so a new instance cannot acquire resources being disposed.
    if (shared && pools.get(THREE) === pool) pools.delete(THREE);
    await Promise.allSettled([...pool.textures.values()].map(async t => (await t).dispose()));
    for (const g of pool.geometries.values()) g.dispose();
    for (const url of pool.urls.values()) URL.revokeObjectURL(url);
    pool.geometries.clear(); pool.textures.clear(); pool.urls.clear(); pool.blocks.clear();
  }
  return {data, prepare, array, uri, release, loadTexture, geometries:pool.geometries, textures:pool.textures};
}
