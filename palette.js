import { escapeHtml, highlight, placeholderImg, matchesQuery } from "../utils.js";
import { icon } from "../icons.js";
import { getCategoriaNome } from "../domain.js";

export function initPalette({ overlay, input, results }, store, actions, extraActionsProvider) {
  let matches = [];
  let index = 0;

  function open() {
    overlay.classList.add("active");
    input.value = "";
    input.focus();
    update("");
  }
  function close() { overlay.classList.remove("active"); }

  function update(query) {
    const q = query.toLowerCase().trim();
    const st = store.getState();
    const acoes = extraActionsProvider(q);
    const servicosMatch = st.servicos
      .filter(s => !q || matchesQuery(s, getCategoriaNome(st.categorias, s.categoriaId), q))
      .slice(0, 8)
      .map(s => ({ tipo: "servico", nome: s.nome, sub: getCategoriaNome(st.categorias, s.categoriaId), id: s.id, img: s.imagemBase64 || s.imagemUrl }));
    matches = [...servicosMatch, ...acoes];
    index = 0;
    if (!matches.length) { results.innerHTML = `<div class="palette-empty">Sem resultados para "${escapeHtml(query)}".</div>`; return; }
    results.innerHTML = matches.map((m, i) => {
      if (m.tipo === "servico") {
        const img = m.img || placeholderImg(m.nome);
        return `<div class="palette-item ${i === 0 ? "active" : ""}" data-idx="${i}"><img src="${img}"><div class="pi-text"><div class="pi-name">${highlight(m.nome, q)}</div><div class="pi-sub">${escapeHtml(m.sub)}</div></div></div>`;
      }
      return `<div class="palette-item ${i === 0 ? "active" : ""}" data-idx="${i}"><div class="pi-icon">${icon(m.icon)}</div><div class="pi-text"><div class="pi-name">${escapeHtml(m.nome)}</div><div class="pi-sub">Ação rápida</div></div></div>`;
    }).join("");
    results.querySelectorAll(".palette-item").forEach(itemEl => {
      itemEl.addEventListener("click", () => run(parseInt(itemEl.dataset.idx)));
      itemEl.addEventListener("mousemove", () => { index = parseInt(itemEl.dataset.idx); markActive(); });
    });
  }
  function markActive() {
    results.querySelectorAll(".palette-item").forEach(itemEl => itemEl.classList.toggle("active", parseInt(itemEl.dataset.idx) === index));
    const activeEl = results.querySelector(".palette-item.active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }
  function run(i) {
    const m = matches[i];
    if (!m) return;
    if (m.tipo === "servico") { close(); actions.abrirEmNovaAba(m.id); }
    else if (m.run) { close(); m.run(); }
  }

  input.addEventListener("input", (e) => update(e.target.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); index = Math.min(index + 1, matches.length - 1); markActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); index = Math.max(index - 1, 0); markActive(); }
    else if (e.key === "Enter") { e.preventDefault(); run(index); }
    else if (e.key === "Escape") close();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  return { open, close, isOpen: () => overlay.classList.contains("active") };
}
