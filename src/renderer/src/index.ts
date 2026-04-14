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
let micState: MicState = 'idle';
let speechRecognition: SpeechRecognition | null = null;
const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;

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
    idle: 'Beszédfelismerés indítása magyar nyelven',
    active: 'Beszédfelismerés aktív (kattintás a leállításhoz)',
    blocked: 'A beszédfelismerés nem érhető el',
    unsupported: 'A böngésző környezet nem támogatja a beszédfelismerést'
  };

  micBtnEl.title = title ?? defaultTitleByState[state];
}

function stopMic() {
  const currentRecognition = speechRecognition;
  speechRecognition = null;

  if (currentRecognition) {
    currentRecognition.onstart = null;
    currentRecognition.onend = null;
    currentRecognition.onerror = null;
    currentRecognition.onresult = null;

    try {
      currentRecognition.abort();
    } catch (err) {
      console.warn('Failed to stop speech recognition:', err);
    }
  }

  if (micState !== 'unsupported') {
    setMicState('idle');
  }
}

function getSpeechRecognitionTranscript(event: SpeechRecognitionEvent): string {
  const transcripts: string[] = [];

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result.isFinal) {
      continue;
    }

    const transcript = result[0]?.transcript.trim();
    if (transcript) {
      transcripts.push(transcript);
    }
  }

  return transcripts.join(' ').trim();
}

async function startMic() {
  if (!SpeechRecognitionCtor) {
    setMicState('unsupported');
    return;
  }

  try {
    stopMic();

    const recognition = new SpeechRecognitionCtor();
    speechRecognition = recognition;
    recognition.lang = 'hu-HU';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setMicState('active');
    };

    recognition.onend = () => {
      if (speechRecognition === recognition) {
        speechRecognition = null;
      }

      if (micState !== 'unsupported' && micState !== 'blocked') {
        setMicState('idle');
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition failed:', event.error, event.message);

      if (speechRecognition === recognition) {
        speechRecognition = null;
      }

      const blockedErrors = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);
      if (blockedErrors.has(event.error)) {
        setMicState('blocked', 'A beszédfelismerés nem érhető el vagy nincs engedély');
        return;
      }

      if (micState !== 'unsupported') {
        setMicState('idle', 'Nem sikerült felismerni a beszédet');
      }
    };

    recognition.onresult = (event) => {
      const transcript = getSpeechRecognitionTranscript(event);
      if (!transcript) {
        return;
      }

      stopMic();
      inputEl.value = transcript;
      void send();
    };

    recognition.start();
    setMicState('active');
  } catch (err) {
    console.error('Speech recognition access failed:', err);
    speechRecognition = null;
    setMicState('blocked', 'Mikrofon engedély vagy beszédfelismerési hiba');
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
    const reply = await window.pilinszky.chat(message, history)
    history.push({ role: 'assistant', content: reply })
    appendMessage('assistant', reply)
    avatar.playLipSyncText(reply)

    const audioSrc = await window.pilinszky.speak(reply)
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

  if (speechRecognition) {
    stopMic();
    return;
  }

  startMic().then(null);
});

if (!SpeechRecognitionCtor) {
  setMicState('unsupported');
} else {
  setMicState('idle');
}

// update the mouse position (absolute position relative to dom)
document.addEventListener("mousemove", (event) => {
  const mouseX = event.clientX;
  const mouseY = event.clientY;

  avatar.updateMouse(mouseX, mouseY);
});

window.addEventListener('beforeunload', stopMic);

export {};
