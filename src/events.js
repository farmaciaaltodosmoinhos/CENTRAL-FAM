/** events.js — bus de eventos efémeros (toasts, pedidos de foco). Não guarda estado. */
export function createEventBus() {
  const listeners = {};
  return {
    on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); return () => this.off(evt, cb); },
    off(evt, cb) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== cb); },
    emit(evt, payload) { (listeners[evt] || []).slice().forEach(cb => { try { cb(payload); } catch (e) { console.error("Erro no listener de", evt, e); } }); }
  };
}

export const bus = createEventBus();
