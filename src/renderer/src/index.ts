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
const localWhisperMaxRecordingMs = 7000;
const speechRecognitionMaxListeningMs = 6000;
const localWhisperMimeTypeCandidates = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg'
];
let localRecorder: MediaRecorder | null = null;
let localRecorderMimeType = 'audio/webm';
let localRecorderChunks: BlobPart[] = [];
let localRecorderStream: MediaStream | null = null;
let localRecorderStopTimeout: number | null = null;
let speechRecognitionWatchdogTimeout: number | null = null;
let speechRecognitionGotFinalResult = false;

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

function canUseLocalWhisperFallback(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function chooseRecorderMimeType(): string {
  const supported = localWhisperMimeTypeCandidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  return supported ?? 'audio/webm';
}

function clearLocalRecorderState() {
  if (localRecorderStopTimeout !== null) {
    window.clearTimeout(localRecorderStopTimeout);
    localRecorderStopTimeout = null;
  }

  if (localRecorderStream) {
    localRecorderStream.getTracks().forEach((track) => track.stop());
    localRecorderStream = null;
  }

  localRecorder = null;
  localRecorderChunks = [];
}

function clearSpeechRecognitionWatchdog() {
  if (speechRecognitionWatchdogTimeout !== null) {
    window.clearTimeout(speechRecognitionWatchdogTimeout);
    speechRecognitionWatchdogTimeout = null;
  }
}

function armSpeechRecognitionWatchdog(recognition: SpeechRecognition) {
  clearSpeechRecognitionWatchdog();

  speechRecognitionWatchdogTimeout = window.setTimeout(() => {
    if (speechRecognition !== recognition || speechRecognitionGotFinalResult || localRecorder) {
      return;
    }

    console.warn('Speech recognition stalled without result, switching to local Whisper fallback');
    speechRecognition = null;
    recognition.onstart = null;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;

    try {
      recognition.abort();
    } catch (err) {
      console.warn('Failed to abort stalled speech recognition session:', err);
    }

    void startLocalWhisperFallback('speech-timeout');
  }, speechRecognitionMaxListeningMs);
}

function stopLocalRecorder() {
  if (!localRecorder) {
    clearLocalRecorderState();
    return;
  }

  const recorder = localRecorder;
  localRecorder = null;
  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
}

async function startLocalWhisperFallback(origin: string) {
  if (!canUseLocalWhisperFallback()) {
    setMicState('unsupported', 'A környezet nem támogatja a lokális hangrögzítést');
    return;
  }

  if (localRecorder) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    localRecorder = recorder;
    localRecorderMimeType = recorder.mimeType || mimeType || 'audio/webm';
    localRecorderChunks = [];
    localRecorderStream = stream;
    setMicState('active', 'Lokális Whisper fallback rögzítés fut');

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        localRecorderChunks.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      console.error('Local recorder failed:', event.error);
      clearLocalRecorderState();
      setMicState('blocked', 'Lokális rögzítési hiba történt');
    };

    recorder.onstop = async () => {
      const chunks = [...localRecorderChunks];
      clearLocalRecorderState();

      if (chunks.length === 0) {
        setMicState('idle', 'Nem érkezett rögzített hang');
        return;
      }

      try {
        const blob = new Blob(chunks, { type: localRecorderMimeType });
        const audioBuffer = await blob.arrayBuffer();
        const transcript = (await window.pilinszky.transcribeLocal(audioBuffer, localRecorderMimeType)).trim();

        if (!transcript) {
          setMicState('idle', 'A lokális Whisper nem talált beszédet');
          return;
        }

        inputEl.value = transcript;
        await send();
        setMicState('idle');
      } catch (err) {
        console.error(`Local Whisper fallback failed (${origin}):`, err);
        setMicState('blocked', 'Lokális Whisper hiba. Ellenőrizd a binárist és a modellt.');
      }
    };

    recorder.start();
    localRecorderStopTimeout = window.setTimeout(() => {
      stopLocalRecorder();
    }, localWhisperMaxRecordingMs);
  } catch (err) {
    console.error(`Local Whisper fallback capture failed (${origin}):`, err);
    setMicState('blocked', 'Mikrofon engedély vagy lokális rögzítési hiba');
  }
}

function stopMic() {
  clearSpeechRecognitionWatchdog();
  speechRecognitionGotFinalResult = false;

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

  stopLocalRecorder();

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
    await startLocalWhisperFallback('speech-unsupported');
    return;
  }

  try {
    stopMic();

    const recognition = new SpeechRecognitionCtor();
    speechRecognitionGotFinalResult = false;
    speechRecognition = recognition;
    recognition.lang = 'hu-HU';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setMicState('active');
      armSpeechRecognitionWatchdog(recognition);
    };

    recognition.onend = () => {
      clearSpeechRecognitionWatchdog();

      if (speechRecognition === recognition) {
        speechRecognition = null;
      }

      if (!speechRecognitionGotFinalResult && !localRecorder && micState !== 'unsupported' && micState !== 'blocked') {
        void startLocalWhisperFallback('speech-ended-without-result');
        return;
      }

      if (!localRecorder && micState !== 'unsupported' && micState !== 'blocked') {
        setMicState('idle');
      }
    };

    recognition.onerror = async (event) => {
      console.error('Speech recognition failed:', event.error, event.message);
      clearSpeechRecognitionWatchdog();

      if (speechRecognition === recognition) {
        speechRecognition = null;
      }

      await startLocalWhisperFallback(`speech-error:${event.error}`);
    };

    recognition.onresult = (event) => {
      const transcript = getSpeechRecognitionTranscript(event);
      if (!transcript) {
        return;
      }

      speechRecognitionGotFinalResult = true;
      stopMic();
      inputEl.value = transcript;
      void send();
    };

    recognition.start();
    setMicState('active');
  } catch (err) {
    console.error('Speech recognition access failed:', err);
    speechRecognition = null;
    await startLocalWhisperFallback('speech-start-exception');
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

  if (speechRecognition || localRecorder) {
    stopMic();
    return;
  }

  startMic().then(null);
});

if (!SpeechRecognitionCtor) {
  if (canUseLocalWhisperFallback()) {
    setMicState('idle', 'Natív beszédfelismerés nélkül lokális Whisper fallback lesz használva');
  } else {
    setMicState('unsupported');
  }
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
