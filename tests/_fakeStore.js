/** Fake mínimo do Netlify Blobs Store (genérico, chave-valor), para testes. */
export function fakeStoreFactory(inicial = {}) {
  const blobs = new Map(Object.entries(inicial));
  const calls = [];
  const getStoreImpl = (name) => {
    calls.push(name);
    return {
      async get(key, opts) {
        const v = blobs.get(key);
        if (v === undefined) return null;
        return opts && opts.type === "text" ? v : v;
      },
      async setJSON(key, value) { blobs.set(key, value); },
      async set(key, value) { blobs.set(key, value); },
      async delete(key) { blobs.delete(key); }
    };
  };
  return { getStoreImpl, blobs, calls };
}
