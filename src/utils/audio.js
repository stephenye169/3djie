/**
 * 合成音效框架（零音频文件依赖，Web Audio 实时生成）
 * 首次用户交互后自动解锁；全站共享一个 AudioContext。
 *
 * 现有音效：siren（踢馆警报）/ tick（倒计时滴答 / 提示）/ success（成功锣）
 *           fail（失败闷响）/ coin（收购成交金币落袋）
 */

class SoundFx {
  constructor() {
    this.ctx = null;
  }

  _ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      return null;
    }
  }

  _tone({ freq, freqEnd, dur = 0.15, type = 'sine', gain = 0.05, delay = 0 }) {
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** 警报：上扬 + 下落两段汽笛（踢馆 / 还价请求到达） */
  siren() {
    this._tone({ freq: 420, freqEnd: 880, dur: 0.32, type: 'sawtooth', gain: 0.03 });
    this._tone({ freq: 880, freqEnd: 420, dur: 0.32, type: 'sawtooth', gain: 0.03, delay: 0.34 });
    this._tone({ freq: 420, freqEnd: 880, dur: 0.32, type: 'sawtooth', gain: 0.03, delay: 0.68 });
  }

  /** 倒计时滴答 / 轻提示 */
  tick() {
    this._tone({ freq: 900, dur: 0.06, type: 'square', gain: 0.045 });
  }

  /** 成功锣：上扬双音（护盘成功 / 收购成功） */
  success() {
    this._tone({ freq: 660, dur: 0.12, type: 'triangle', gain: 0.06 });
    this._tone({ freq: 990, dur: 0.22, type: 'triangle', gain: 0.06, delay: 0.12 });
  }

  /** 失败闷响 */
  fail() {
    this._tone({ freq: 220, freqEnd: 70, dur: 0.7, type: 'sawtooth', gain: 0.05 });
  }

  /** 金币落袋：三连上行 ding（收购成交 / 大额分红到账） */
  coin() {
    this._tone({ freq: 1046, dur: 0.09, type: 'triangle', gain: 0.05 });
    this._tone({ freq: 1318, dur: 0.09, type: 'triangle', gain: 0.05, delay: 0.09 });
    this._tone({ freq: 1568, dur: 0.18, type: 'triangle', gain: 0.055, delay: 0.18 });
  }
}

/** 全站单例：所有触发点共享同一 AudioContext */
export const soundFx = new SoundFx();
export default soundFx;
