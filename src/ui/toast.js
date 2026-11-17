/** 通用轻提示（复用 #ui-toast 元素） */
let timer = null;

export function showToast(message, duration = 2200) {
  const el = document.getElementById('ui-toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.add('hidden'), duration);
}
