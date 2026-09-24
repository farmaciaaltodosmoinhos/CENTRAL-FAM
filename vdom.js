/**
 * vdom.js — motor de Virtual DOM leve.
 *
 * Não é uma dependência externa: ~140 linhas, sem build step, pensado
 * apenas para as vistas de alta frequência de re-renderização (grelha de
 * categorias e grelha de serviços). O resto da interface (modais, forms)
 * usa DOM direto porque não há benefício de diffing em painéis que só
 * abrem por ação explícita do utilizador.
 *
 * API:
 *   h(tag, props, ...children)   -> cria um vnode
 *   mount(vnode, container)      -> primeira renderização
 *   patch(vnode, container)      -> renderização subsequente (diff + update)
 */

export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) };
}

function isVNode(x) { return x && typeof x === "object" && "tag" in x; }

function setProp(domEl, name, value, oldValue) {
  if (name === "key") return;
  if (name.startsWith("on") && typeof value === "function") {
    const evt = name.slice(2).toLowerCase();
    if (oldValue) domEl.removeEventListener(evt, oldValue);
    domEl.addEventListener(evt, value);
    domEl.__listeners = domEl.__listeners || {};
    domEl.__listeners[evt] = value;
    return;
  }
  if (name === "class") { domEl.className = value || ""; return; }
  if (name === "style" && typeof value === "object") {
    Object.assign(domEl.style, value);
    return;
  }
  if (name === "dataset" && typeof value === "object") {
    Object.assign(domEl.dataset, value);
    return;
  }
  if (name === "html") { domEl.innerHTML = value; return; }
  if (value === false || value === null || value === undefined) { domEl.removeAttribute(name); return; }
  if (name in domEl && name !== "list") { try { domEl[name] = value; return; } catch (e) { /* fallback to attribute */ } }
  domEl.setAttribute(name, value);
}

function createDom(vnode) {
  if (typeof vnode === "string" || typeof vnode === "number") {
    return document.createTextNode(String(vnode));
  }
  if (typeof vnode.tag === "function") {
    const rendered = vnode.tag(vnode.props, vnode.children);
    vnode._rendered = rendered;
    return createDom(rendered);
  }
  const domEl = document.createElement(vnode.tag);
  for (const [k, v] of Object.entries(vnode.props || {})) setProp(domEl, k, v);
  vnode._dom = domEl;
  if (!("html" in (vnode.props || {}))) (vnode.children || []).forEach(child => domEl.appendChild(createDom(child)));
  return domEl;
}

function sameType(a, b) {
  if (typeof a !== typeof b) return false;
  if (isVNode(a) && isVNode(b)) return a.tag === b.tag;
  return true;
}

function keyOf(vnode, index) {
  if (isVNode(vnode) && vnode.props && vnode.props.key !== undefined) return "k:" + vnode.props.key;
  return "i:" + index;
}

function diffChildren(parentDom, oldChildren, newChildren) {
  oldChildren = oldChildren || [];
  newChildren = newChildren || [];
  const oldKeyed = new Map();
  oldChildren.forEach((c, i) => oldKeyed.set(keyOf(c, i), { vnode: c, dom: c && c._dom ? c._dom : (parentDom.childNodes[i] || null) }));

  let domCursor = parentDom.firstChild;
  const usedDom = new Set();

  newChildren.forEach((newChild, i) => {
    const key = keyOf(newChild, i);
    const match = oldKeyed.get(key);
    if (match && sameType(match.vnode, newChild)) {
      const updatedDom = patchNode(match.vnode, newChild, match.dom);
      if (updatedDom !== domCursor) parentDom.insertBefore(updatedDom, domCursor);
      usedDom.add(updatedDom);
      domCursor = updatedDom.nextSibling;
    } else {
      const newDom = createDom(newChild);
      parentDom.insertBefore(newDom, domCursor);
      usedDom.add(newDom);
    }
  });

  // remove nós antigos não reutilizados
  Array.from(parentDom.childNodes).forEach(node => { if (!usedDom.has(node)) parentDom.removeChild(node); });
}

function patchNode(oldVnode, newVnode, dom) {
  if (typeof newVnode === "string" || typeof newVnode === "number") {
    if (dom.nodeType === 3) { if (dom.textContent !== String(newVnode)) dom.textContent = String(newVnode); return dom; }
    const textNode = document.createTextNode(String(newVnode));
    return textNode;
  }
  if (typeof newVnode.tag === "function") {
    const rendered = newVnode.tag(newVnode.props, newVnode.children);
    newVnode._rendered = rendered;
    const oldRendered = oldVnode && oldVnode._rendered;
    const updated = oldRendered ? patchNode(oldRendered, rendered, dom) : createDom(rendered);
    return updated;
  }
  if (!oldVnode || oldVnode.tag !== newVnode.tag) return createDom(newVnode);

  const oldProps = oldVnode.props || {};
  const newProps = newVnode.props || {};
  for (const k of new Set([...Object.keys(oldProps), ...Object.keys(newProps)])) {
    if (oldProps[k] !== newProps[k]) setProp(dom, k, newProps[k], oldProps[k]);
  }
  newVnode._dom = dom;
  // Nós que usam a prop `html` (equivalente a dangerouslySetInnerHTML) gerem o
  // seu próprio conteúdo diretamente via innerHTML — nunca têm `children` no
  // sentido do vdom. Sem esta guarda, diffChildren trataria esse conteúdo
  // como "não reconhecido" e removia-o a cada patch subsequente ao primeiro
  // (o mount inicial não sofre isto porque não corre nenhuma limpeza).
  if (!("html" in newProps)) diffChildren(dom, oldVnode.children, newVnode.children);
  return dom;
}

const _roots = new WeakMap();

export function render(vnode, container) {
  const prev = _roots.get(container);
  if (!prev) {
    container.innerHTML = "";
    const dom = createDom(vnode);
    container.appendChild(dom);
    _roots.set(container, vnode);
    return;
  }
  const rootDomChild = container.firstChild;
  const updated = patchNode(prev, vnode, rootDomChild);
  if (updated !== rootDomChild) { container.innerHTML = ""; container.appendChild(updated); }
  _roots.set(container, vnode);
}

export function resetRoot(container) { _roots.delete(container); container.innerHTML = ""; }
