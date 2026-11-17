import { formatMoney } from '../../shared/assets.js';
import { showToast } from './toast.js';

const STORAGE_KEY = 'qingguo_notify';

/**
 * 本地系统通知（护盘提醒降级版）
 *
 * 只用浏览器 Notification API，不依赖 Service Worker / Web Push / 后端：
 * - 覆盖「页面在后台但浏览器仍开着」的场景（WebSocket 连接还在）
 * - 页面在前台时交给游戏内 AttackAlert 演出，不重复弹通知
 * - 权限申请必须在用户手势中触发（顶栏 🔔 开关）
 */
export class DesktopNotify {
  constructor(button, label) {
    this.button = button;
    this.label = label;
    this.supported = typeof window !== 'undefined' && 'Notification' in window;
    this._baseTitle = document.title;

    this.button?.addEventListener('click', () => this.toggle());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._restoreTitle();
      this._render();
    });
    window.addEventListener('focus', () => this._restoreTitle());

    this._render();
  }

  get enabled() {
    return this.supported &&
      Notification.permission === 'granted' &&
      localStorage.getItem(STORAGE_KEY) === '1';
  }

  async toggle() {
    if (!this.supported) return;

    if (this.enabled) {
      localStorage.setItem(STORAGE_KEY, '0');
      this._render();
      showToast('已关闭后台护盘提醒');
      return;
    }

    if (Notification.permission === 'denied') {
      showToast('浏览器已禁用通知，请在地址栏的站点设置里允许');
      return;
    }

    let permission = Notification.permission;
    if (permission !== 'granted') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = 'denied';
      }
    }

    if (permission === 'granted') {
      localStorage.setItem(STORAGE_KEY, '1');
      showToast('已开启：切到后台时被踢馆会弹系统通知');
    } else {
      showToast('未授权通知，后台护盘提醒不可用');
    }
    this._render();
  }

  /** 收到 shop_attack 时调用；前台由 AttackAlert 负责 */
  notifyAttack(payload) {
    if (!payload) return;
    const title = `🚨「${payload.shopName || '你的店铺'}」正在被踢馆`;
    const body = `${payload.attackerNick || '有人'} 出价 ¥${formatMoney(payload.bid || 0)}，15 秒内回游戏护盘！`;

    // 窗口可见且有焦点：游戏内全屏警告已经弹出，不再重复打扰
    if (!document.hidden && document.hasFocus()) return;

    if (this.enabled) {
      try {
        const notification = new Notification(title, {
          body,
          tag: `shop-attack-${payload.attackId || 'now'}`,
          renotify: true,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
        setTimeout(() => notification.close(), 15000);
        return;
      } catch {
        // 个别环境构造 Notification 会抛异常，退回标题提醒
      }
    }
    this._flashTitle(`${title} · 15 秒内回游戏护盘`);
  }

  _flashTitle(text) {
    if (document.hidden) document.title = text;
  }

  _restoreTitle() {
    if (document.title !== this._baseTitle) document.title = this._baseTitle;
  }

  _render() {
    if (!this.button) return;
    if (!this.supported) {
      this.button.classList.add('hidden');
      return;
    }
    this.button.classList.remove('hidden');
    const on = this.enabled;
    this.button.classList.toggle('on', on);
    if (this.label) {
      this.label.textContent = on
        ? '提醒已开'
        : Notification.permission === 'denied' ? '通知被拒' : '护盘提醒';
    }
    this.button.title = on
      ? '后台护盘提醒已开启，点击关闭'
      : '切到后台时，店铺被踢馆会弹系统通知（点击开启）';
  }
}
