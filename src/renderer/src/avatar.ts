type Character = string;
type PositionType = "lbeye" | "leye" | "leyeCenter" | "reye" | "rbeye" | "reyeCenter";
type BaseAvatarPart = typeof requiredAvatarParts[number];
type LipSyncHeadPart = typeof optionalLipSyncParts[number];
type AvatarPart = BaseAvatarPart | LipSyncHeadPart;

export type LipSyncSettings = {
  minDurationMs: number;
  maxDurationMs: number;
  estimatedCharMs: number;
  minStepMs: number;
};

const defaultLipSyncSettings: LipSyncSettings = {
  minDurationMs: 600,
  maxDurationMs: 4800,
  estimatedCharMs: 130,
  minStepMs: 90
};

const audioLipSyncConfig = {
  fftSize: 1024,
  smoothing: 0.75,
  silenceRmsThreshold: 0.016,
  bandsHz: {
    low: [80, 450],
    mid: [450, 1800],
    high: [1800, 4200],
    sibilant: [4200, 7600]
  },
  ratios: {
    sibilant: 0.28,
    highForSibilant: 0.2,
    lowRounded: 0.44,
    lowOpen: 0.34,
    midOpen: 0.22,
    midFront: 0.34,
    highFront: 0.26
  },
  rms: {
    rounded: 0.045,
    open: 0.05
  }
} as const;

const requiredAvatarParts = <const>["head", "leye", "lbeye", "reye", "rbeye"];
const optionalLipSyncParts = <const>["head_a", "head_ei", "head_ou", "head_fv", "head_consonant"];
const loadableAvatarParts = <const>[...requiredAvatarParts, ...optionalLipSyncParts];

function isAvatarPart(part: string): part is AvatarPart {
  return loadableAvatarParts.includes(part as AvatarPart);
}

const positions: Record<string, {
  [key in PositionType]: [number, number]
}> = {
  "pilinszky": {
    lbeye: [45, 142],
    leye: [52, 143],
    leyeCenter: [58, 144],
    reye: [126, 128],
    reyeCenter: [131, 130],
    rbeye: [115, 128]
  }
}

const avatarModules = import.meta.glob('../assets/avatar/**/*.png', {
  eager: true,
  import: 'default'
}) as Record<string, string>;

const avatarCatalog: Record<string, Partial<Record<AvatarPart, string>>> = {};

for (const [path, url] of Object.entries(avatarModules)) {
  const fileName = path.split('/').slice(-2).join('/'); // Get last two segments of the path
  if (!fileName) {
    continue;
  }

  const match = fileName.match(/^(.+?)\/(.+?)\.png$/i);
  if (!match) {
    continue;
  }

  const character = match[1];
  const part = match[2];

  if(!isAvatarPart(part)) {
    continue;
  }

  if (!avatarCatalog[character]) {
    avatarCatalog[character] = {};
  }

  avatarCatalog[character][part] = url;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = reject;
  })
}

export class AvatarRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  mouse: [number, number] = [0, 0];
  character: Character;

  // animation
  bobTime: number = 0;
  bobAmplitude: number = 4;
  bobSpeed: number = 0.004;

  // idle animation scheduler
  idleCheckTimer: number = 0;
  idleCheckIntervalMs: number = 1000;

  // blink animation
  blinkActive: boolean = false;
  blinkElapsed: number = 0;
  blinkDurationMs: number = 220;
  blinkChance: number = 0.25;

  // letter-based lip sync animation
  lipSyncChars: string[] = [];
  lipSyncIndex: number = 0;
  lipSyncElapsed: number = 0;
  lipSyncStepMs: number = 70;
  lipSyncActive: boolean = false;
  activeLipSyncHead: LipSyncHeadPart | null = null;
  lipSyncSettings: LipSyncSettings = { ...defaultLipSyncSettings };
  audioLipSyncContext: AudioContext | null = null;
  audioLipSyncElement: HTMLAudioElement | null = null;
  audioLipSyncSource: MediaElementAudioSourceNode | null = null;
  audioLipSyncAnalyser: AnalyserNode | null = null;
  audioLipSyncRafId: number | null = null;

  // images
  images: Record<AvatarPart, HTMLImageElement | null> = {
    head: null,
    head_a: null,
    head_ei: null,
    head_ou: null,
    head_fv: null,
    head_consonant: null,
    lbeye: null,
    leye: null,
    rbeye: null,
    reye: null
  };

  // time management
  previousFrame: number = performance.now();

  constructor(canvas: HTMLCanvasElement, character: Character) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.character = this.resolveCharacter(character);
    this.loadImages();
    this.draw(0.0);
  }

  private resolveCharacter(character: Character): Character {
    const hasPositions = positions[character] !== undefined;
    const assets = avatarCatalog[character];
    const hasAllAssets = requiredAvatarParts.every((part) => Boolean(assets?.[part]));

    if (hasPositions && hasAllAssets) {
      return character;
    }

    const fallback = Object.keys(positions).find((candidate) => {
      const candidateAssets = avatarCatalog[candidate];
      return requiredAvatarParts.every((part) => Boolean(candidateAssets?.[part]));
    });

    if (!fallback) {
      console.error('No complete avatar character found in assets/positions configuration.');
      return character;
    }

    console.warn(`Character "${character}" is incomplete. Falling back to "${fallback}".`);
    return fallback;
  }

  private drawEye(
    eyeBgImage: HTMLImageElement,
    eyeImage: HTMLImageElement,
    eyeBgPosition: [number, number],
    eyePosition: [number, number],
    eyeCenterPosition: [number, number],
    headX: number,
    headY: number,
    mouseRelative: [number, number],
    blinkProgress: number | null,
    trackMouse: boolean = true
  ) {
    const eyeMaxOffsetX = 6;
    const eyeMaxOffsetY = 3;

    const eyeBgX = headX + eyeBgPosition[0];
    const eyeBgY = headY + eyeBgPosition[1];
    this.ctx.drawImage(eyeBgImage, eyeBgX, eyeBgY);

    let eyeX = headX + eyePosition[0];
    let eyeY = headY + eyePosition[1];

    const eyeCenterX = headX + eyeCenterPosition[0];
    const eyeCenterY = headY + eyeCenterPosition[1];

    let mouseOffsetX = 0;
    let mouseOffsetY = 0;

    if (trackMouse) {
      const dx = mouseRelative[0] - eyeCenterX;
      const dy = mouseRelative[1] - eyeCenterY;
      const distanceToMouse = Math.hypot(dx, dy);

      if (distanceToMouse > 0.0001) {
        const unitX = dx / distanceToMouse;
        const unitY = dy / distanceToMouse;

        const { width: canvasWidth, height: canvasHeight } = this.canvas.getBoundingClientRect();
        const tX = unitX > 0
          ? (canvasWidth - eyeCenterX) / unitX
          : unitX < 0
            ? (0 - eyeCenterX) / unitX
            : Number.POSITIVE_INFINITY;
        const tY = unitY > 0
          ? (canvasHeight - eyeCenterY) / unitY
          : unitY < 0
            ? (0 - eyeCenterY) / unitY
            : Number.POSITIVE_INFINITY;

        const distanceToEdge = Math.min(tX, tY);
        const progress = distanceToEdge > 0
          ? Math.min(1, distanceToMouse / distanceToEdge)
          : 1;

        mouseOffsetX = unitX * eyeMaxOffsetX * progress;
        mouseOffsetY = unitY * eyeMaxOffsetY * progress;
      }
    }

    const offsetX = mouseOffsetX;
    const offsetY = mouseOffsetY;

    eyeX += offsetX;
    eyeY += offsetY;
    this.ctx.drawImage(eyeImage, eyeX, eyeY);

    if (blinkProgress !== null) {
      const eyeBgHeight = eyeBgImage.height;
      const blinkY = eyeBgY - eyeBgHeight + eyeBgHeight * blinkProgress;
      this.ctx.save();
      this.ctx.filter = 'brightness(28%)';
      this.ctx.drawImage(eyeBgImage, eyeBgX, blinkY);
      this.ctx.restore();
    }
  }

  private getBlinkProgress(): number | null {
    if (!this.blinkActive) {
      return null;
    }

    const t = Math.min(1, this.blinkElapsed / this.blinkDurationMs);
    // Close in first half, reopen in second half.
    return t < 0.5 ? t * 2 : (1 - t) * 2;
  }

  private updateIdleAnimations(delta: number) {
    this.idleCheckTimer += delta;

    while (this.idleCheckTimer >= this.idleCheckIntervalMs) {
      this.idleCheckTimer -= this.idleCheckIntervalMs;

      if (!this.blinkActive && Math.random() < this.blinkChance) {
        this.blinkActive = true;
        this.blinkElapsed = 0;
      }
    }

    if (this.blinkActive) {
      this.blinkElapsed += delta;
      if (this.blinkElapsed >= this.blinkDurationMs) {
        this.blinkActive = false;
        this.blinkElapsed = 0;
      }
    }
  }

  private loadImages() {
    const characterAssets = avatarCatalog[this.character];
    if (!characterAssets) {
      return;
    }

    for (const part of loadableAvatarParts) {
      const src = characterAssets[part];
      console.log("Loading image: ", src);
      if (!src) {
        continue;
      }

      loadImage(src)
        .then((img) => {
          this.images[part] = img;
        })
        .catch((err) => {
          console.error(`Failed to load image ${src}:`, err);
        });
    }
  }

  private getLipSyncHeadForChar(char: string): LipSyncHeadPart | null {
    const normalized = char.toLocaleLowerCase('hu-HU');
    if (normalized === 'a' || normalized === 'á') {
      return 'head_a';
    }

    if (normalized === 'e' || normalized === 'é' || normalized === 'i' || normalized === 'í') {
      return 'head_ei';
    }

    if(['u', 'ú', 'ü', 'ű', 'o', 'ó', 'ö', 'ő'].includes(normalized)) {
      return "head_ou"
    }

    if(['f', 'v'].includes(normalized)) {
      return "head_fv";
    }

    if(['l', 'n', 't', 'd', 's', 'z', 'r'].includes(normalized)) {
      return "head_consonant";
    }

    return null;
  }

  private stopLipSync() {
    this.stopAudioDrivenLipSync();
    this.lipSyncActive = false;
    this.lipSyncChars = [];
    this.lipSyncIndex = 0;
    this.lipSyncElapsed = 0;
    this.activeLipSyncHead = null;
  }

  private stopAudioDrivenLipSync() {
    if (this.audioLipSyncRafId !== null) {
      cancelAnimationFrame(this.audioLipSyncRafId);
      this.audioLipSyncRafId = null;
    }

    if (this.audioLipSyncSource) {
      this.audioLipSyncSource.disconnect();
      this.audioLipSyncSource = null;
    }

    if (this.audioLipSyncAnalyser) {
      this.audioLipSyncAnalyser.disconnect();
      this.audioLipSyncAnalyser = null;
    }

    if (this.audioLipSyncElement) {
      this.audioLipSyncElement.onended = null;
      this.audioLipSyncElement.onerror = null;
      this.audioLipSyncElement.pause();
      this.audioLipSyncElement.src = '';
      this.audioLipSyncElement.load();
      this.audioLipSyncElement = null;
    }

    if (this.audioLipSyncContext) {
      this.audioLipSyncContext.suspend().catch((error) => {
        console.warn('Failed to suspend audio lip-sync context:', error);
      });
    }
  }

  private getOrCreateAudioLipSyncContext(): AudioContext {
    if (this.audioLipSyncContext && this.audioLipSyncContext.state !== 'closed') {
      return this.audioLipSyncContext;
    }

    const context = new AudioContext();
    this.audioLipSyncContext = context;
    return context;
  }

  private stepLipSyncFrame() {
    if (this.lipSyncIndex >= this.lipSyncChars.length) {
      this.stopLipSync();
      return;
    }

    const char = this.lipSyncChars[this.lipSyncIndex];
    this.lipSyncIndex += 1;
    this.activeLipSyncHead = this.getLipSyncHeadForChar(char);

    if (this.lipSyncIndex >= this.lipSyncChars.length) {
      this.stopLipSync();
    }
  }

  private updateLipSync(delta: number) {
    if (!this.lipSyncActive) {
      return;
    }

    this.lipSyncElapsed += delta;
    while (this.lipSyncElapsed >= this.lipSyncStepMs && this.lipSyncActive) {
      this.lipSyncElapsed -= this.lipSyncStepMs;
      this.stepLipSyncFrame();
    }
  }

  private normalizeLipSyncSettings(settings: LipSyncSettings): LipSyncSettings {
    const minDurationMs = Math.min(20000, Math.max(120, settings.minDurationMs));
    const maxDurationMs = Math.min(30000, Math.max(minDurationMs, settings.maxDurationMs));
    const estimatedCharMs = Math.min(2000, Math.max(10, settings.estimatedCharMs));
    const minStepMs = Math.min(500, Math.max(8, settings.minStepMs));

    return {
      minDurationMs,
      maxDurationMs,
      estimatedCharMs,
      minStepMs
    };
  }

  getLipSyncSettings(): LipSyncSettings {
    return { ...this.lipSyncSettings };
  }

  setLipSyncSettings(partial: Partial<LipSyncSettings>) {
    this.lipSyncSettings = this.normalizeLipSyncSettings({
      ...this.lipSyncSettings,
      ...partial
    });
  }

  playLipSyncText(text: string) {
    const textChars = Array.from(text);
    if (textChars.length === 0) {
      this.stopLipSync();
      return;
    }
    const chars = [...textChars, ' '];

    this.lipSyncChars = chars;
    this.lipSyncIndex = 0;
    this.lipSyncElapsed = 0;
    this.lipSyncActive = true;

    const { minDurationMs, maxDurationMs, estimatedCharMs, minStepMs } = this.lipSyncSettings;
    const estimatedDurationMs = chars.length * estimatedCharMs;
    const totalDurationMs = Math.min(maxDurationMs, Math.max(minDurationMs, estimatedDurationMs));
    this.lipSyncStepMs = Math.max(minStepMs, totalDurationMs / chars.length);
    this.stepLipSyncFrame();
  }

  private mapAnalyserToHungarianViseme(
    frequencyData: Uint8Array,
    waveformData: Uint8Array,
    sampleRate: number
  ): LipSyncHeadPart | null {
    let sumSquares = 0;
    for (let index = 0; index < waveformData.length; index += 1) {
      const sample = (waveformData[index] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / waveformData.length);
    if (rms < audioLipSyncConfig.silenceRmsThreshold) {
      return null;
    }

    const nyquist = sampleRate / 2;
    const binWidthHz = nyquist / frequencyData.length;
    const averageBand = (minHz: number, maxHz: number): number => {
      const start = Math.max(0, Math.floor(minHz / binWidthHz));
      const end = Math.min(frequencyData.length - 1, Math.ceil(maxHz / binWidthHz));
      if (end < start) {
        return 0;
      }

      let sum = 0;
      let count = 0;
      for (let index = start; index <= end; index += 1) {
        sum += frequencyData[index];
        count += 1;
      }

      return count > 0 ? sum / count : 0;
    };

    const low = averageBand(audioLipSyncConfig.bandsHz.low[0], audioLipSyncConfig.bandsHz.low[1]);
    const mid = averageBand(audioLipSyncConfig.bandsHz.mid[0], audioLipSyncConfig.bandsHz.mid[1]);
    const high = averageBand(audioLipSyncConfig.bandsHz.high[0], audioLipSyncConfig.bandsHz.high[1]);
    const sibilant = averageBand(audioLipSyncConfig.bandsHz.sibilant[0], audioLipSyncConfig.bandsHz.sibilant[1]);
    const total = Math.max(1, low + mid + high + sibilant);

    const lowRatio = low / total;
    const midRatio = mid / total;
    const highRatio = high / total;
    const sibilantRatio = sibilant / total;

    if (
      sibilantRatio > audioLipSyncConfig.ratios.sibilant &&
      highRatio > audioLipSyncConfig.ratios.highForSibilant
    ) {
      return 'head_fv';
    }

    if (lowRatio > audioLipSyncConfig.ratios.lowRounded && rms > audioLipSyncConfig.rms.rounded) {
      return 'head_ou';
    }

    if (
      lowRatio > audioLipSyncConfig.ratios.lowOpen &&
      midRatio > audioLipSyncConfig.ratios.midOpen &&
      rms > audioLipSyncConfig.rms.open
    ) {
      return 'head_a';
    }

    if (midRatio > audioLipSyncConfig.ratios.midFront || highRatio > audioLipSyncConfig.ratios.highFront) {
      return 'head_ei';
    }

    return 'head_consonant';
  }

  async playLipSyncAudio(audioSrc: string) {
    if (!audioSrc) {
      this.stopLipSync();
      return;
    }

    this.stopLipSync();

    const audioContext = this.getOrCreateAudioLipSyncContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = audioLipSyncConfig.fftSize;
    analyser.smoothingTimeConstant = audioLipSyncConfig.smoothing;

    const audioElement = new Audio(audioSrc);
    const source = audioContext.createMediaElementSource(audioElement);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    this.audioLipSyncContext = audioContext;
    this.audioLipSyncElement = audioElement;
    this.audioLipSyncSource = source;
    this.audioLipSyncAnalyser = analyser;

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const waveformData = new Uint8Array(analyser.fftSize);

    const drive = () => {
      const currentAnalyser = this.audioLipSyncAnalyser;
      const currentContext = this.audioLipSyncContext;
      const currentElement = this.audioLipSyncElement;
      if (!currentAnalyser || !currentContext || !currentElement) {
        return;
      }

      currentAnalyser.getByteFrequencyData(frequencyData);
      currentAnalyser.getByteTimeDomainData(waveformData);
      this.activeLipSyncHead = this.mapAnalyserToHungarianViseme(
        frequencyData,
        waveformData,
        currentContext.sampleRate
      );

      if (!currentElement.paused && !currentElement.ended) {
        this.audioLipSyncRafId = requestAnimationFrame(drive);
      } else if (currentElement.ended) {
        this.stopLipSync();
      }
    };

    audioElement.onended = () => {
      this.stopLipSync();
    };
    audioElement.onerror = () => {
      this.stopLipSync();
    };

    await audioContext.resume();
    await audioElement.play();
    this.audioLipSyncRafId = requestAnimationFrame(drive);
  }

  private drawBackground() {
    const { width, height } = this.canvas.getBoundingClientRect();

    const canvasWidth = Math.max(1, Math.floor(width));
    const canvasHeight = Math.max(1, Math.floor(height));

    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
    }

    this.ctx.clearRect(0, 0, width, height);

    const gradient = this.ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#24211e');
    gradient.addColorStop(1, '#12110f');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.strokeStyle = '#3a3733';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  private drawHead() {
    const headImage = this.images.head;
    const lbEyeImage = this.images.lbeye;
    const leyeImage = this.images.leye;
    const rbEyeImage = this.images.rbeye;
    const reyeImage = this.images.reye;

    if(!headImage || !lbEyeImage || !leyeImage || !rbEyeImage || !reyeImage) {
      return;
    }

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    const headX = centerX - headImage.width / 2;
    let headY = centerY - headImage.height / 2;

    const bobOffset = Math.sin(this.bobTime * this.bobSpeed) * this.bobAmplitude;
    headY += bobOffset;

    const mouseRelative = this.toCanvasPosition(this.mouse[0], this.mouse[1]);
    const blinkProgress = this.getBlinkProgress();

    const lipSyncImage = this.activeLipSyncHead ? this.images[this.activeLipSyncHead] : null;
    const isSpeaking = this.lipSyncActive || (this.audioLipSyncElement !== null && !this.audioLipSyncElement.paused && !this.audioLipSyncElement.ended);

    this.drawEye(
      lbEyeImage,
      leyeImage,
      positions[this.character].lbeye,
      positions[this.character].leye,
      positions[this.character].leyeCenter,
      headX,
      headY,
      mouseRelative,
      blinkProgress,
      !isSpeaking
    )
    this.drawEye(
      rbEyeImage,
      reyeImage,
      positions[this.character].rbeye,
      positions[this.character].reye,
      positions[this.character].reyeCenter,
      headX,
      headY,
      mouseRelative,
      blinkProgress,
      !isSpeaking
    )

    this.ctx.drawImage(lipSyncImage ?? headImage, headX, headY);
  }

  private draw(delta: number) {
    // scale up canvas from the middle
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const scale = 2;
    this.ctx.setTransform(
      scale, 0, 0, scale,
      cx - scale * cx,
      cy - scale * cy
    );
    this.bobTime += delta;
    this.updateIdleAnimations(delta);
    this.updateLipSync(delta);
    this.drawBackground();
    this.drawHead();

    requestAnimationFrame(() => {
      const now = performance.now();
      const delta = now - this.previousFrame;
      this.previousFrame = now;
      this.draw(delta);
    });
  }

  /**
   * Gets the absolute position inside the DOM
   * document of a point relative to the canvas.
   * @param x
   * @param y
   */
  getAbsolutePosition(x: number, y: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [rect.left + x, rect.top + y];
  }

  /**
   * Converts an absolute position to canvas-relative coordinates.
   * @param x
   * @param y
   */
  toCanvasPosition(x: number, y: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [x - rect.left, y - rect.top];
  }

  updateMouse(mouseX: number, mouseY: number) {
    this.mouse = [mouseX, mouseY];
  }
}
