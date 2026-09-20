import { escapeHtml } from "../utils.js";
import { icon } from "../icons.js";

export function initToasts(container, bus) {
  bus.on("toast:show", ({ type, msg }) => {
    const iconName = type === "err" ? "alertTriangle" : type === "warn" ? "info" : "checkCircle";
    const t = document.createElement("div");
    t.className = "toast " + (type || "ok");
    t.innerHTML = `${icon(iconName)}<span>${escapeHtml(msg)}</span>`;
    container.appendChild(t);
    setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 220); }, 3200);
  });
}
