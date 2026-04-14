import { type Message } from "../../shared/types";
import { AvatarRenderer, type LipSyncSettings } from './avatar'

const isDev = import.meta.env.DEV;

const history: Message[] = [];

const messagesEl = document.querySelector<HTMLDivElement>("#messages")!;
const inputEl = document.querySelector<HTMLInputElement>("#input")!;
const sendBtn = document.querySelector<HTMLButtonElement>("#send")!;
const micBtnEl = document.querySelector<HTMLButtonElement>("#mic-button")!;
const avatarCanvasEl = document.querySelector<HTMLCanvasElement>('#avatar-canvas')!

type MicState = 'idle' | 'active' | 'blocked' | 'unsupported';
const micStorageKey = 'pilinszky.micDeviceId';
let micState: MicState = 'idle';
let micStream: MediaStream | null = null;
let selectedMicDeviceId: string | null = localStorage.getItem(micStorageKey);
let micPickerEl: HTMLDivElement | null = null;

const avatar = new AvatarRenderer(avatarCanvasEl, "pilinszky");
const lipSyncSettingsStorageKey = 'pilinszky.dev.lipsyncSettings';

if (!isDev) {
  document.body.classList.add("prod-layout");
}

function setupDevLipSyncPanel(targetAvatar: AvatarRenderer) {
  let storedSettings: Partial<LipSyncSettings> | null = null;
  try {
    const raw = localStorage.getItem(lipSyncSettingsStorageKey);
    storedSettings = raw ? JSON.parse(raw) as Partial<LipSyncSettings> : null;
  } catch (err) {
    console.warn('Failed to parse stored lip-sync settings:', err);
  }

  if (storedSettings) {
    targetAvatar.setLipSyncSettings(storedSettings);
  }

  const panel = document.createElement('aside');
  panel.className = 'dev-lipsync-panel';

  const title = document.createElement('h2');
  title.textContent = 'Dev Lip Sync';
  panel.appendChild(title);

  const settings = targetAvatar.getLipSyncSettings();

  const persistSettings = () => {
    localStorage.setItem(lipSyncSettingsStorageKey, JSON.stringify(targetAvatar.getLipSyncSettings()));
  };

  const addRow = (
    key: keyof LipSyncSettings,
    labelText: string,
    min: number,
    max: number,
    step: number
  ) => {
    const row = document.createElement('label');
    row.className = 'dev-lipsync-row';

    const label = document.createElement('span');
    label.className = 'dev-lipsync-label';
    label.textContent = labelText;
    row.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'dev-lipsync-controls';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(settings[key]);

    const number = document.createElement('input');
    number.type = 'number';
    number.min = String(min);
    number.max = String(max);
    number.step = String(step);
    number.value = String(settings[key]);

    const applyValue = (rawValue: number) => {
      targetAvatar.setLipSyncSettings({ [key]: rawValue });
      const nextSettings = targetAvatar.getLipSyncSettings();
      const nextValue = nextSettings[key];
      slider.value = String(nextValue);
      number.value = String(nextValue);
      persistSettings();
    };

    slider.addEventListener('input', () => {
      applyValue(Number(slider.value));
    });

    number.addEventListener('change', () => {
      applyValue(Number(number.value));
    });

    controls.appendChild(slider);
    controls.appendChild(number);
    row.appendChild(controls);
    panel.appendChild(row);
  };

  addRow('estimatedCharMs', 'Char ms', 10, 350, 1);
  addRow('minDurationMs', 'Min total ms', 120, 12000, 10);
  addRow('maxDurationMs', 'Max total ms', 200, 20000, 10);
  addRow('minStepMs', 'Min step ms', 8, 240, 1);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'dev-lipsync-preview';

  const previewInput = document.createElement('input');
  previewInput.type = 'text';
  previewInput.value = 'Szia, ez egy gyors ajakszinkron teszt.';
  previewInput.setAttribute('aria-label', 'Lip sync preview text');

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.textContent = 'Preview';
  previewBtn.addEventListener('click', () => {
    targetAvatar.playLipSyncText(previewInput.value);
  });

  previewWrap.appendChild(previewInput);
  previewWrap.appendChild(previewBtn);
  panel.appendChild(previewWrap);

  document.body.appendChild(panel);
}

if (isDev) {
  setupDevLipSyncPanel(avatar);
}

function setMicState(state: MicState, title?: string) {
  micState = state;
  micBtnEl.dataset.state = state;

  const defaultTitleByState: Record<MicState, string> = {
    idle: 'Mikrofon kiválasztása és bekapcsolása',
    active: 'Mikrofon aktív (kattintás a leállításhoz)',
    blocked: 'Mikrofon nem érhető el',
    unsupported: 'A böngésző környezet nem támogat mikrofon hozzáférést'
  };

  micBtnEl.title = title ?? defaultTitleByState[state];
}

function stopMic() {
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  if (micState !== 'unsupported') {
    setMicState('idle');
  }
}

async function getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}

async function chooseMicDevice(devices: MediaDeviceInfo[]): Promise<string | null> {
  if (devices.length === 0) {
    return null;
  }

  if (devices.length === 1) {
    return devices[0].deviceId;
  }

  if (micPickerEl) {
    micPickerEl.remove();
    micPickerEl = null;
  }

  return new Promise<string | null>((resolve) => {
    const picker = document.createElement('div');
    picker.className = 'mic-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Mikrofon kiválasztása');

    const title = document.createElement('p');
    title.className = 'mic-picker-title';
    title.textContent = 'Mikrofon kiválasztása';
    picker.appendChild(title);

    const list = document.createElement('div');
    list.className = 'mic-picker-list';

    const activeIndex = Math.max(0, devices.findIndex((device) => device.deviceId === selectedMicDeviceId));

    const close = (deviceId: string | null) => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
      picker.remove();
      if (micPickerEl === picker) {
        micPickerEl = null;
      }
      resolve(deviceId);
    };

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !picker.contains(target)) {
        close(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close(null);
      }
    };

    devices.forEach((device, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'mic-picker-option';
      option.textContent = device.label || `Mikrofon ${index + 1}`;
      option.dataset.selected = String(index === activeIndex);
      option.addEventListener('click', () => close(device.deviceId));
      list.appendChild(option);
    });

    picker.appendChild(list);
    document.body.appendChild(picker);
    micPickerEl = picker;

    const rect = micBtnEl.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const gap = 8;
    const rawLeft = rect.left;
    const maxLeft = window.innerWidth - pickerRect.width - 8;
    const left = Math.min(Math.max(8, rawLeft), Math.max(8, maxLeft));

    const topAbove = rect.top - pickerRect.height - gap;
    const topBelow = rect.bottom + gap;
    const maxTop = window.innerHeight - pickerRect.height - 8;
    const top = topAbove >= 8
      ? topAbove
      : Math.min(Math.max(8, topBelow), Math.max(8, maxTop));

    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
  });
}

async function startMic() {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
    setMicState('unsupported');
    return;
  }

  try {
    let deviceId = selectedMicDeviceId;
    const knownDevices = await getAudioInputDevices();

    if (!deviceId || !knownDevices.some((device) => device.deviceId === deviceId)) {
      const chosen = await chooseMicDevice(knownDevices);
      if (!chosen) {
        setMicState('idle', 'Nincs kiválasztott mikrofon');
        return;
      }
      deviceId = chosen;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    });

    stopMic();
    micStream = stream;

    const activeTrack = stream.getAudioTracks()[0];
    const activeDeviceId = activeTrack?.getSettings().deviceId ?? deviceId;
    if (activeDeviceId) {
      selectedMicDeviceId = activeDeviceId;
      localStorage.setItem(micStorageKey, activeDeviceId);
    }

    setMicState('active');
  } catch (err) {
    console.error('Microphone access failed:', err);
    setMicState('blocked', 'Mikrofon engedély vagy eszköz hiba');
  }
}

function appendMessage(role: string, text: string) {
  const el = document.createElement('div')
  el.className = 'msg ' + role
  el.textContent = text
  messagesEl.appendChild(el)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

async function send() {
  const message = inputEl.value.trim()
  if (!message) return

  inputEl.value = ''
  sendBtn.disabled = true
  appendMessage('user', message)
  history.push({ role: 'user', content: message })

  try {
    const { reply, audioSrc } = await window.pilinszky.chat(message, history)
    history.push({ role: 'assistant', content: reply })
    appendMessage('assistant', reply)
    avatar.playLipSyncText(reply)

    const audio = new Audio(audioSrc)
    audio.play().then(null);
  } catch (err) {
    appendMessage('assistant', '[Hiba történt. Kérjük, próbálja újra.]')
    console.error(err)
  } finally {
    sendBtn.disabled = false
    inputEl.focus()
  }
}

sendBtn.addEventListener('click', send)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send().then(null);
});

micBtnEl.addEventListener('click', () => {
  if (micState === 'unsupported') {
    return;
  }

  if (micStream) {
    stopMic();
    return;
  }

  startMic().then(null);
});

if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
  setMicState('unsupported');
} else {
  setMicState('idle');

  navigator.mediaDevices.addEventListener('devicechange', async () => {
    try {
      const devices = await getAudioInputDevices();
      if (selectedMicDeviceId && !devices.some((device) => device.deviceId === selectedMicDeviceId)) {
        selectedMicDeviceId = null;
        localStorage.removeItem(micStorageKey);
        if (micStream) {
          stopMic();
        }
      }
    } catch (err) {
      console.error('Failed to refresh microphone devices:', err);
    }
  });
}

// update the mouse position (absolute position relative to dom)
document.addEventListener("mousemove", (event) => {
  const mouseX = event.clientX;
  const mouseY = event.clientY;

  avatar.updateMouse(mouseX, mouseY);
});

window.addEventListener('beforeunload', stopMic);

export {};
