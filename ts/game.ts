/* ============================================================
 * 听力拼手速·抢食物大作战
 * 听语音 -> 1秒内点对食物 -> 食物飞向抢到方头像 -> 9个抢完结算
 * ============================================================ */

interface FoodDef {
  id: string;
  name: string;
  img: string;
  audio: string;
}

/** 9 种食物（固定顺序，网格中随机打乱位置） */
const FOODS: FoodDef[] = [
  { id: 'milk',    name: '牛奶',   img: 'img/milk.png',    audio: 'audio/milk.mp3' },
  { id: 'egg',     name: '鸡蛋',   img: 'img/egg.png',     audio: 'audio/egg.mp3' },
  { id: 'bread',   name: '面包',   img: 'img/bread.png',   audio: 'audio/bread.mp3' },
  { id: 'mango',   name: '芒果',   img: 'img/mango.png',   audio: 'audio/mango.mp3' },
  { id: 'apple',   name: '苹果',   img: 'img/apple.png',   audio: 'audio/apple.mp3' },
  { id: 'peach',   name: '桃子',   img: 'img/peach.png',   audio: 'audio/peach.mp3' },
  { id: 'pepper',  name: '青椒',   img: 'img/pepper.png',  audio: 'audio/pepper.mp3' },
  { id: 'carrot',  name: '胡萝卜', img: 'img/carrot.png',  audio: 'audio/carrot.mp3' },
  { id: 'pumpkin', name: '南瓜',   img: 'img/pumpkin.png', audio: 'audio/pumpkin.mp3' },
];

/** 角色与特效图片 */
const IMG_PLAYER = 'img/player.png';
const IMG_ROBOT = 'img/robot.png';
const IMG_CROSS = 'img/cross.png';
const IMG_VS = 'img/vs-panel.png';

const TOTAL_ROUNDS = FOODS.length;
const ROUND_TIME = 1000;   // 反应时限 1 秒
const FLY_TIME = 650;      // 食物飞行动画时长
const ROUND_GAP = 1300;    // 回合间隔
const COUNTDOWN_STEP = 720;

type Phase = 'menu' | 'countdown' | 'playing' | 'result';
type ResolveReason = 'correct' | 'wrong' | 'timeout';

interface CellEntry {
  food: FoodDef;
  el: HTMLButtonElement;
  taken: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- 音效与语音 ---------------- */

class AudioKit {
  private ctx: AudioContext | null = null;
  private zhVoice: SpeechSynthesisVoice | null = null;
  private clips = new Map<string, HTMLAudioElement>();

  /** 预加载所有 mp3：9 个食物播报 + 4 个音效 */
  initAudio(foods: FoodDef[]): void {
    const sfx: Record<string, string> = {
      select: 'audio/select.mp3',  // 点对食物
      wrong: 'audio/wrong.mp3',    // 点错 / 超时被抢
      miss: 'audio/miss.mp3',      // 结算输了（失去机会）
      win: 'audio/win.mp3',        // 结算赢了（游戏成功）
    };
    for (const [key, src] of Object.entries(sfx)) this.createClip('sfx-' + key, src);
    for (const f of foods) this.createClip('voice-' + f.id, f.audio);
  }

  private createClip(key: string, src: string): void {
    const a = new Audio(src);
    a.preload = 'auto';
    this.clips.set(key, a);
  }

  constructor() {
    if ('speechSynthesis' in window) {
      const pick = (): void => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length) {
          this.zhVoice =
            voices.find((v) => v.lang === 'zh-CN') ||
            voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ||
            null;
        }
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
  }

  /** 必须在用户手势（点击开始）中调用：解锁 WebAudio + 预热语音引擎 */
  ensure(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    // iOS 要求语音引擎第一次 speak 必须发生在用户手势内，用静音句子预热
    if ('speechSynthesis' in window) {
      try {
        const warm = new SpeechSynthesisUtterance(' ');
        warm.volume = 0;
        warm.lang = 'zh-CN';
        window.speechSynthesis.speak(warm);
      } catch {
        /* 忽略预热失败 */
      }
    }
    // 解锁所有 mp3 音频元素：手势内静音播放一次再暂停
    this.clips.forEach((a) => {
      try {
        a.muted = true;
        a.play()
          .then(() => {
            a.pause();
            a.currentTime = 0;
            a.muted = false;
          })
          .catch(() => {
            a.muted = false;
          });
      } catch {
        /* 忽略解锁失败 */
      }
    });
  }

  /** 播放食物播报 mp3，音频开口时触发 onStart（启动反应计时）；失败回退 TTS */
  playVoice(food: FoodDef, onStart?: () => void): void {
    let fired = false;
    const fire = (): void => {
      if (!fired) {
        fired = true;
        onStart?.();
      }
    };

    const clip = this.clips.get('voice-' + food.id);
    if (!clip) {
      this.speak(food.name, onStart);
      return;
    }

    let ttsUsed = false;
    const fallbackTts = (): void => {
      if (ttsUsed) return;
      ttsUsed = true;
      this.speak(food.name, onStart);
    };

    try {
      clip.pause();
      clip.currentTime = 0;
    } catch {
      /* 忽略 */
    }

    const onPlaying = (): void => {
      clip.removeEventListener('playing', onPlaying);
      clip.removeEventListener('error', onErr);
      fire();
    };
    const onErr = (): void => {
      clip.removeEventListener('playing', onPlaying);
      fallbackTts();
      fire();
    };
    clip.addEventListener('playing', onPlaying);
    clip.addEventListener('error', onErr);

    const p = clip.play();
    if (p && typeof p.then === 'function') {
      p.then(() => fire()).catch(() => {
        fallbackTts();
        fire();
      });
    }
    // 兜底：900ms 内未开口也启动计时，避免卡住游戏流程
    window.setTimeout(fire, 900);
  }

  /** 停止所有播报（mp3 + TTS） */
  stopVoice(): void {
    this.clips.forEach((a, key) => {
      if (key.startsWith('voice-')) {
        try {
          a.pause();
          a.currentTime = 0;
        } catch {
          /* 忽略 */
        }
      }
    });
    this.stopSpeak();
  }

  /** 短音效：select 点对 / wrong 点错 / miss 超时 / win 胜利 */
  playSfx(key: 'select' | 'wrong' | 'miss' | 'win'): void {
    const a = this.clips.get('sfx-' + key);
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
      void a.play().catch(() => {
        /* 忽略：音效失败不影响流程 */
      });
    } catch {
      /* 忽略 */
    }
  }

  private tone(
    freq: number,
    delay: number,
    dur: number,
    type: OscillatorType = 'sine',
    vol = 0.18
  ): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** 倒计时嘀 */
  countBeep(): void {
    this.tone(523, 0, 0.12, 'sine', 0.2);
  }
  /** 开始提示 */
  goBeep(): void {
    this.tone(784, 0, 0.1, 'triangle', 0.22);
    this.tone(1047, 0.09, 0.24, 'triangle', 0.2);
  }
  /** 听题提示音 */
  listenCue(): void {
    this.tone(660, 0, 0.08, 'sine', 0.15);
    this.tone(880, 0.08, 0.1, 'sine', 0.13);
  }
  /** 答对 */
  ding(): void {
    this.tone(880, 0, 0.12, 'triangle', 0.22);
    this.tone(1318, 0.09, 0.26, 'triangle', 0.2);
  }
  /** 答错 / 被抢 */
  buzz(): void {
    this.tone(200, 0, 0.2, 'sawtooth', 0.12);
    this.tone(150, 0.08, 0.26, 'square', 0.08);
  }
  /** 结算 */
  fanfare(win: boolean): void {
    if (win) {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.13, 0.24, 'triangle', 0.2));
    } else {
      [420, 360, 300].forEach((f, i) => this.tone(f, i * 0.16, 0.26, 'sine', 0.16));
    }
  }

  /** 中文语音播报，onStart 在开口时触发（用于启动反应计时） */
  speak(text: string, onStart?: () => void): void {
    let fired = false;
    const fire = (): void => {
      if (!fired) {
        fired = true;
        onStart?.();
      }
    };
    if (!('speechSynthesis' in window)) {
      fire();
      return;
    }
    const synth = window.speechSynthesis;
    try {
      synth.cancel();
      if (synth.paused) synth.resume();
    } catch {
      /* 忽略 */
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.95;
    u.pitch = 1.15;
    u.volume = 1;
    if (this.zhVoice) u.voice = this.zhVoice;
    u.onstart = fire;
    u.onerror = (): void => fire(); // 语音不可用也不卡住游戏流程
    // cancel 后立即 speak 在部分浏览器会被吞，稍作延迟
    window.setTimeout(() => {
      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch {
        fire();
      }
    }, 90);
    // 兜底：个别浏览器不触发 onstart
    window.setTimeout(fire, 700);
  }

  stopSpeak(): void {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* 忽略 */
      }
    }
  }
}

/* ---------------- 游戏主体 ---------------- */

class Game {
  private phase: Phase = 'menu';
  private cells: CellEntry[] = [];

  private playerScore = 0;
  private robotScore = 0;
  private round = 0;
  private target: FoodDef | null = null;
  private roundActive = false;

  private timerDeadline = 0;
  private rafId = 0;
  private timeoutIds: number[] = [];

  private readonly audio = new AudioKit();

  // DOM
  private gridEl!: HTMLDivElement;
  private overlayEl!: HTMLDivElement;
  private overlayCardEl!: HTMLDivElement;
  private speakerEl!: HTMLDivElement;
  private promptTextEl!: HTMLDivElement;
  private timerFillEl!: HTMLDivElement;
  private roundBadgeEl!: HTMLDivElement;
  private playerScoreEl!: HTMLDivElement;
  private robotScoreEl!: HTMLDivElement;
  private playerAvatarEl!: HTMLImageElement;
  private robotAvatarEl!: HTMLImageElement;

  init(): void {
    this.gridEl = document.getElementById('grid') as HTMLDivElement;
    this.overlayEl = document.getElementById('overlay') as HTMLDivElement;
    this.overlayCardEl = document.getElementById('overlayCard') as HTMLDivElement;
    this.speakerEl = document.getElementById('speaker') as HTMLDivElement;
    this.promptTextEl = document.getElementById('promptText') as HTMLDivElement;
    this.timerFillEl = document.getElementById('timerFill') as HTMLDivElement;
    this.roundBadgeEl = document.getElementById('roundBadge') as HTMLDivElement;
    this.playerScoreEl = document.getElementById('playerScore') as HTMLDivElement;
    this.robotScoreEl = document.getElementById('robotScore') as HTMLDivElement;
    this.playerAvatarEl = document.getElementById('playerAvatar') as HTMLImageElement;
    this.robotAvatarEl = document.getElementById('robotAvatar') as HTMLImageElement;

    this.audio.initAudio(FOODS);
    this.buildGrid();
    this.showMenu();
  }

  /* ---------- 公共流程 ---------- */

  private startGame(): void {
    this.clearScheduled();
    this.audio.stopVoice();
    this.audio.ensure();

    this.playerScore = 0;
    this.robotScore = 0;
    this.round = 0;
    this.target = null;
    this.roundActive = false;
    this.playerScoreEl.textContent = '0';
    this.robotScoreEl.textContent = '0';
    this.roundBadgeEl.textContent = '准备开始';
    this.promptTextEl.textContent = '仔细听，准备抢！';
    this.timerFillEl.style.transform = 'scaleX(0)';
    this.speakerEl.classList.remove('active');

    this.buildGrid();

    this.phase = 'countdown';
    this.runCountdown();
  }

  private runCountdown(): void {
    const steps: { text: string; go: boolean }[] = [
      { text: '3', go: false },
      { text: '2', go: false },
      { text: '1', go: false },
      { text: '开始！', go: true },
    ];
    let i = 0;
    const step = (): void => {
      if (this.phase !== 'countdown') return;
      if (i >= steps.length) {
        this.hideOverlay();
        this.phase = 'playing';
        this.promptTextEl.textContent = '听声音——快抢！';
        this.schedule(350, () => this.nextRound());
        return;
      }
      const s = steps[i];
      this.showCountdown(s.text, s.go);
      if (s.go) this.audio.goBeep();
      else this.audio.countBeep();
      i++;
      this.schedule(COUNTDOWN_STEP, step);
    };
    step();
  }

  private nextRound(): void {
    if (this.phase !== 'playing') return;

    // 清掉上回合的对错标记（已抢走的格子保留 taken 样式）
    this.cells.forEach((c) => c.el.classList.remove('correct', 'wrong', 'steal'));

    const remaining = this.cells.filter((c) => !c.taken);
    if (remaining.length === 0) {
      this.endGame();
      return;
    }

    this.round++;
    this.roundBadgeEl.textContent = `第 ${this.round} / ${TOTAL_ROUNDS} 轮`;

    const pick = remaining[Math.floor(Math.random() * remaining.length)];
    this.target = pick.food;
    this.roundActive = true;

    this.promptTextEl.textContent = '听！这是什么食物？快抢！';
    this.speakerEl.classList.add('active');
    this.timerFillEl.style.transform = 'scaleX(1)';

    this.audio.listenCue();
    // 提示音后播放食物播报 mp3，音频开口时才开始 1 秒反应计时
    const voiceTarget = this.target;
    this.schedule(220, () => {
      if (this.phase === 'playing' && this.roundActive && this.target === voiceTarget) {
        this.audio.playVoice(voiceTarget, () => this.startReactionTimer());
      }
    });
  }

  private startReactionTimer(): void {
    if (!this.roundActive) return;
    this.timerDeadline = performance.now() + ROUND_TIME;
    cancelAnimationFrame(this.rafId);
    const tick = (): void => {
      const left = this.timerDeadline - performance.now();
      const p = Math.max(0, left / ROUND_TIME);
      this.timerFillEl.style.transform = `scaleX(${p})`;
      if (left <= 0) {
        this.resolveRound('timeout', null);
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
    // 兜底超时
    this.schedule(ROUND_TIME + 150, () => {
      if (this.roundActive) this.resolveRound('timeout', null);
    });
  }

  private onTap(cell: CellEntry): void {
    if (this.phase !== 'playing' || !this.roundActive || !this.target) return;
    if (cell.taken) return;
    if (cell.food.id === this.target.id) {
      this.resolveRound('correct', cell);
    } else {
      this.resolveRound('wrong', cell);
    }
  }

  private resolveRound(reason: ResolveReason, tapped: CellEntry | null): void {
    if (!this.roundActive || !this.target) return;
    this.roundActive = false;
    cancelAnimationFrame(this.rafId);
    this.audio.stopVoice();
    this.speakerEl.classList.remove('active');
    this.timerFillEl.style.transform = 'scaleX(0)';

    const targetFood = this.target;
    const targetCell = this.cells.find((c) => c.food.id === targetFood.id);
    if (!targetCell) return;

    if (reason === 'correct' && tapped) {
      this.audio.playSfx('select');
      tapped.el.classList.add('correct');
      this.promptTextEl.textContent = `答对啦！抢到${targetFood.name}！`;
      targetCell.taken = true;
      targetCell.el.classList.add('taken');
      this.flyFood(targetFood.img, tapped.el, this.playerAvatarEl, () => {
        this.playerScore++;
        this.updateScore('player');
      });
    } else {
      if (reason === 'wrong' && tapped) {
        this.audio.playSfx('wrong');
        tapped.el.classList.add('wrong');
        this.promptTextEl.textContent = `点错啦！${targetFood.name}被人机抢走了！`;
      } else {
        this.audio.playSfx('wrong');
        targetCell.el.classList.add('steal');
        this.promptTextEl.textContent = `太慢啦！${targetFood.name}被人机抢走了！`;
      }
      targetCell.taken = true;
      targetCell.el.classList.add('taken');
      this.flyFood(targetFood.img, targetCell.el, this.robotAvatarEl, () => {
        this.robotScore++;
        this.updateScore('robot');
      });
    }

    this.target = null;
    this.schedule(ROUND_GAP, () => this.nextRound());
  }

  private endGame(): void {
    this.phase = 'result';
    this.roundActive = false;
    this.speakerEl.classList.remove('active');
    this.promptTextEl.textContent = '游戏结束！';
    this.roundBadgeEl.textContent = '结算';

    const win = this.playerScore > this.robotScore;
    const draw = this.playerScore === this.robotScore;
    // 赢了播"游戏成功"，输了播"失去机会"，平局按胜利处理播"游戏成功"
    this.audio.playSfx(win || draw ? 'win' : 'miss');
    this.showResult(win, draw);
    this.audio.speak(
      draw
        ? '打成平局啦，再来一局吧！'
        : win
          ? '恭喜你，赢啦！'
          : '哎呀，机器人赢啦，再来一局吧！'
    );
  }

  /* ---------- 界面构建 ---------- */

  private buildGrid(): void {
    this.gridEl.innerHTML = '';
    this.cells = [];
    const order = shuffle(FOODS);
    for (const food of order) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cell';
      el.setAttribute('aria-label', food.name);
      el.innerHTML =
        `<img class="cross-mark" src="${IMG_CROSS}" alt="">` +
        `<img class="cell-img" src="${food.img}" alt="${food.name}" draggable="false">`;
      const entry: CellEntry = { food, el, taken: false };
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.onTap(entry);
      });
      this.gridEl.appendChild(el);
      this.cells.push(entry);
    }
  }

  private flyFood(
    imgSrc: string,
    fromEl: HTMLElement,
    toEl: HTMLElement,
    onLand: () => void
  ): void {
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const sx = a.left + a.width / 2;
    const sy = a.top + a.height / 2;
    const dx = b.left + b.width / 2 - sx;
    const dy = b.top + b.height / 2 - sy;

    const fly = document.createElement('img');
    fly.className = 'fly-food';
    fly.src = imgSrc;
    fly.draggable = false;
    fly.style.left = `${sx}px`;
    fly.style.top = `${sy}px`;
    document.body.appendChild(fly);

    const anim = fly.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 - 70}px)) scale(0.85) rotate(-12deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.25) rotate(12deg)`,
          opacity: 0.95,
        },
      ],
      { duration: FLY_TIME, easing: 'cubic-bezier(.45,.05,.55,1)', fill: 'forwards' }
    );
    anim.onfinish = () => {
      fly.remove();
      toEl.classList.remove('land');
      void toEl.offsetWidth; // 重启动画
      toEl.classList.add('land');
      onLand();
    };
  }

  private updateScore(who: 'player' | 'robot'): void {
    const el = who === 'player' ? this.playerScoreEl : this.robotScoreEl;
    el.textContent = String(who === 'player' ? this.playerScore : this.robotScore);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /* ---------- 遮罩页 ---------- */

  private showOverlay(html: string): void {
    this.overlayCardEl.innerHTML = html;
    this.overlayEl.classList.remove('hidden');
  }

  private hideOverlay(): void {
    this.overlayEl.classList.add('hidden');
  }

  private showMenu(): void {
    const parade = FOODS.map((f) => `<img src="${f.img}" alt="${f.name}">`).join('');
    this.showOverlay(
      `<div class="menu-card">` +
        `<div class="menu-title">看谁抢得多</div>` +
        `<div class="food-parade">${parade}</div>` +
        `<div class="rules">` +
        `开拍后听到食物名称<br><b>1 秒内</b>快速点击抢食物<br>点错或太慢，会被人机抢走哦！` +
        `</div>` +
        `<button class="hud-btn" id="startBtn">开始游戏</button>` +
        `</div>`
    );
    document.getElementById('startBtn')?.addEventListener('click', () => this.startGame());
  }

  private showCountdown(text: string, go: boolean): void {
    this.showOverlay(
      `<div class="count-num ${go ? 'go' : ''}">${text}</div>` +
        `<div class="count-tip">${go ? '快抢！' : '准备好了吗？'}</div>`
    );
  }

  private showResult(win: boolean, draw: boolean): void {
    const title = draw ? '平局啦！' : win ? '你赢了！' : '你输了！';
    this.showOverlay(
      `<div class="result-panel">` +
        `<div class="result-tag">${title}</div>` +
        `<div class="vs-board">` +
        `<div class="vs-side vs-left"><div class="vs-name">我</div><div class="vs-num">${this.playerScore}</div></div>` +
        `<div class="vs-side vs-right"><div class="vs-name">人机</div><div class="vs-num">${this.robotScore}</div></div>` +
        `</div>` +
        `</div>` +
        `<button class="hud-btn" id="restartBtn">再来一局</button>`
    );
    document.getElementById('restartBtn')?.addEventListener('click', () => this.startGame());
  }

  /* ---------- 工具 ---------- */

  private schedule(ms: number, fn: () => void): void {
    const id = window.setTimeout(fn, ms);
    this.timeoutIds.push(id);
  }

  private clearScheduled(): void {
    this.timeoutIds.forEach((id) => window.clearTimeout(id));
    this.timeoutIds = [];
    cancelAnimationFrame(this.rafId);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new Game().init();
});
