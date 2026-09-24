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
      async delete(key) { blobs.delete(key); },
      // Ponto 54 — subconjunto mínimo do `.list()` real do Netlify Blobs,
      // usado pelo Painel Developer/Super-Admin para enumerar contas.
      async list(opts) {
        const prefix = (opts && opts.prefix) || "";
        return { blobs: [...blobs.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
      }
    };
  };
  return { getStoreImpl, blobs, calls };
}
