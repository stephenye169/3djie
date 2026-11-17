/**
 * 店员对话面板
 * 只负责 DOM 展示与话题切换，对话内容来自 data/npcs.js
 */
export class DialoguePanel {
  constructor() {
    this.el = document.getElementById('dialogue-panel');
    this.avatarEl = document.getElementById('dialogue-avatar');
    this.nameEl = document.getElementById('dialogue-name');
    this.roleEl = document.getElementById('dialogue-role');
    this.textEl = document.getElementById('dialogue-text');
    this.optionsEl = document.getElementById('dialogue-options');
    this.closeBtn = document.getElementById('dialogue-close');

    this.npc = null;
    this.onClose = null;

    this.closeBtn.addEventListener('click', () => this.close());

    this.optionsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-topic]');
      if (!btn || !this.npc) return;
      const topic = this.npc.topics[Number(btn.dataset.topic)];
      if (!topic) return;
      this.textEl.textContent = topic.reply;
      this.optionsEl.querySelectorAll('.dialogue-option').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
    });
  }

  open(npc, onClose) {
    this.npc = npc;
    this.onClose = onClose || null;

    this.avatarEl.textContent = npc.avatar || '🙂';
    this.nameEl.textContent = npc.name || '店员';
    this.roleEl.textContent = npc.role || '';
    this.textEl.textContent = npc.greeting || '你好。';
    this.optionsEl.innerHTML = (npc.topics || [])
      .map((t, i) => `<button class="dialogue-option" data-topic="${i}">${t.label}</button>`)
      .join('');

    this.el.classList.remove('hidden');
  }

  close() {
    if (!this.npc) return;
    this.el.classList.add('hidden');
    this.npc = null;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }
}
