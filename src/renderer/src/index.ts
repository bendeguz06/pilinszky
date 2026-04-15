import { type Message } from "../../shared/types";
import { AvatarRenderer, type LipSyncSettings } from './avatar'

const isDev = import.meta.env.DEV;
const SILENCE_DETECTION_DURATION_MS = 600;
const SILENCE_DETECTION_RMS_THRESHOLD = 0.02;
const SILENCE_DETECTION_POLL_INTERVAL_MS = 100;
const CHAT_STREAM_CANCELLED = 'CHAT_STREAM_CANCELLED';
const MIC_ICON_PATH =
  'M12 15a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Zm7-4a1 1 0 1 0-2 0 5 5 0 1 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.93V21H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.07A7 7 0 0 0 19 11Z';
const STOP_ICON_PATH = 'M7 7h10v10H7z';

const history: Message[] = [];

const messagesEl = document.querySelector<HTMLDivElement>("#messages")!;
const canvasPanelEl = document.querySelector<HTMLElement>("#canvas-panel")!;
const inputEl = document.querySelector<HTMLInputElement>("#input")!;
const sendBtn = document.querySelector<HTMLButtonElement>("#send")!;
const micBtnEl = document.querySelector<HTMLButtonElement>("#mic-button")!;
const micIconPathEl = document.querySelector<SVGPathElement>('#mic-icon path')!;
const avatarCanvasEl = document.querySelector<HTMLCanvasElement>('#avatar-canvas')!

type MicState = 'idle' | 'active' | 'blocked' | 'unsupported';
let micState: MicState = 'idle';
let speechRecognition: SpeechRecognition | null = null;
const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const transcriptionMimeTypeCandidates = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg'
];
let localRecorder: MediaRecorder | null = null;
let localRecorderMimeType = 'audio/webm';
let localRecorderChunks: BlobPart[] = [];
let localRecorderStream: MediaStream | null = null;
let speechRecognitionMonitorStream: MediaStream | null = null;
let micSilenceAnalyserContext: AudioContext | null = null;
let micSilenceAnalyser: AnalyserNode | null = null;
let micSilenceBuffer: Uint8Array<ArrayBuffer> | null = null;
let micSilencePollTimer: number | null = null;
let micSilenceStartTime: number | null = null;
let micDetectedSpeech = false;
let speechRecognitionStoppingDueToSilence = false;
let speechRecognitionGotFinalResult = false;
let isAwaitingResponse = false;
let loadingMessageEl: HTMLDivElement | null = null;
const pendingAudioChunks: string[] = [];
let isPlayingQueuedAudio = false;
let isStoppingAssistantOutput = false;

const avatarStatusEl = document.createElement('div');
avatarStatusEl.id = 'avatar-status';
avatarStatusEl.setAttribute('role', 'status');
avatarStatusEl.setAttribute('aria-live', 'polite');
canvasPanelEl.appendChild(avatarStatusEl);

const avatar = new AvatarRenderer(avatarCanvasEl, "pilinszky");
const lipSyncSettingsStorageKey = 'pilinszky.dev.lipsyncSettings';

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

  const nextTitle = title ?? defaultTitleByState[state];
  micBtnEl.title = nextTitle;
  micBtnEl.setAttribute('aria-label', nextTitle);
  refreshMicButtonMode();
}

function isAssistantOutputActive(): boolean {
  return isAwaitingResponse || isPlayingQueuedAudio || pendingAudioChunks.length > 0;
}

function refreshMicButtonMode() {
  const shouldShowStop = isAssistantOutputActive();
  micBtnEl.dataset.mode = shouldShowStop ? 'stop' : 'mic';

  if (shouldShowStop) {
    micIconPathEl.setAttribute('d', STOP_ICON_PATH);
    micBtnEl.title = 'Leállítás (hang és válaszgenerálás)';
    micBtnEl.setAttribute('aria-label', 'Leállítás (hang és válaszgenerálás)');
    return;
  }

  micIconPathEl.setAttribute('d', MIC_ICON_PATH);
}

function canUseRecorderTranscriptionFallback(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function chooseRecorderMimeType(): string {
  const supported = transcriptionMimeTypeCandidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  return supported ?? 'audio/webm';
}

function setLoadingStatus(text: string | null) {
  avatarStatusEl.textContent = text ?? '';

  if (text === null) {
    avatarStatusEl.dataset.state = 'idle';
  } else {
    avatarStatusEl.dataset.state = 'busy';
  }

  if (text === null) {
    if (loadingMessageEl) {
      loadingMessageEl.remove();
      loadingMessageEl = null;
    }
    return;
  }

  if (!loadingMessageEl) {
    loadingMessageEl = document.createElement('div');
    loadingMessageEl.className = 'msg status';
    messagesEl.appendChild(loadingMessageEl);
  }

  loadingMessageEl.textContent = text;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setRequestInFlight(isInFlight: boolean) {
  isAwaitingResponse = isInFlight;
  inputEl.disabled = isInFlight;
  sendBtn.disabled = isInFlight;
  refreshMicButtonMode();

  if (!isInFlight) {
    setLoadingStatus(null);
  }
}

function stopSpeechRecognitionMonitorStream() {
  if (!speechRecognitionMonitorStream) {
    return;
  }

  speechRecognitionMonitorStream.getTracks().forEach((track) => track.stop());
  speechRecognitionMonitorStream = null;
}

function stopMicSilenceMonitor() {
  if (micSilencePollTimer !== null) {
    window.clearInterval(micSilencePollTimer);
    micSilencePollTimer = null;
  }

  if (micSilenceAnalyserContext) {
    void micSilenceAnalyserContext.close();
  }

  micSilenceAnalyserContext = null;
  micSilenceAnalyser = null;
  micSilenceBuffer = null;
  micSilenceStartTime = null;
  micDetectedSpeech = false;
}

async function startMicSilenceMonitor(stream: MediaStream, onSilence: () => void) {
  stopMicSilenceMonitor();

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  micSilenceAnalyserContext = audioContext;
  micSilenceAnalyser = analyser;
  micSilenceBuffer = new Uint8Array(analyser.fftSize);
  micSilenceStartTime = null;
  micDetectedSpeech = false;

  micSilencePollTimer = window.setInterval(() => {
    if (!micSilenceAnalyser || !micSilenceBuffer) {
      return;
    }

    micSilenceAnalyser.getByteTimeDomainData(micSilenceBuffer);

    let sumSquares = 0;
    for (let index = 0; index < micSilenceBuffer.length; index += 1) {
      const sample = (micSilenceBuffer[index] - 128) / 128;
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / micSilenceBuffer.length);
    const now = Date.now();

    if (rms >= SILENCE_DETECTION_RMS_THRESHOLD) {
      micDetectedSpeech = true;
      micSilenceStartTime = null;
      return;
    }

    if (!micDetectedSpeech) {
      return;
    }

    if (micSilenceStartTime === null) {
      micSilenceStartTime = now;
      return;
    }

    if (now - micSilenceStartTime >= SILENCE_DETECTION_DURATION_MS) {
      stopMicSilenceMonitor();
      onSilence();
    }
  }, SILENCE_DETECTION_POLL_INTERVAL_MS);
}

function clearLocalRecorderState() {
  if (localRecorderStream) {
    localRecorderStream.getTracks().forEach((track) => track.stop());
    localRecorderStream = null;
  }

  stopMicSilenceMonitor();
  localRecorder = null;
  localRecorderChunks = [];
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

async function startRecorderTranscriptionFallback(origin: string) {
  if (!canUseRecorderTranscriptionFallback()) {
    setMicState('unsupported', 'A környezet nem támogatja a rögzítés alapú átírást');
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
    setMicState('active', 'Rögzítés fut felhős átíráshoz');
    await startMicSilenceMonitor(stream, () => {
      if (localRecorder === recorder) {
        stopLocalRecorder();
      }
    });

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
        const transcript = (await window.pilinszky.transcribe(audioBuffer, localRecorderMimeType)).trim();

        if (!transcript) {
          setMicState('idle', 'Nem sikerült beszédet felismerni');
          return;
        }

        inputEl.value = transcript;
        await send();
        setMicState('idle');
      } catch (err) {
        console.error(`Recorder transcription fallback failed (${origin}):`, err);
        setMicState('blocked', 'Átírási hiba történt. Ellenőrizd az STT szolgáltatást.');
      }
    };

    recorder.start();
  } catch (err) {
    console.error(`Recorder transcription fallback capture failed (${origin}):`, err);
    setMicState('blocked', 'Mikrofon engedély vagy rögzítési hiba');
  }
}

function stopMic() {
  stopMicSilenceMonitor();
  stopSpeechRecognitionMonitorStream();
  speechRecognitionGotFinalResult = false;
  speechRecognitionStoppingDueToSilence = false;

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
    await startRecorderTranscriptionFallback('speech-unsupported');
    return;
  }

  try {
    stopMic();

    const recognition = new SpeechRecognitionCtor();
    speechRecognitionGotFinalResult = false;
    speechRecognitionStoppingDueToSilence = false;
    speechRecognition = recognition;
    recognition.lang = 'hu-HU';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setMicState('active');
    };

    recognition.onend = () => {
      stopMicSilenceMonitor();
      stopSpeechRecognitionMonitorStream();
      const stoppedDueToSilence = speechRecognitionStoppingDueToSilence;
      speechRecognitionStoppingDueToSilence = false;

      if (speechRecognition === recognition) {
        speechRecognition = null;
      }

      if (
        !speechRecognitionGotFinalResult &&
        !stoppedDueToSilence &&
        !localRecorder &&
        micState !== 'unsupported' &&
        micState !== 'blocked'
      ) {
        void startRecorderTranscriptionFallback('speech-ended-without-result');
        return;
      }

      if (!localRecorder && micState !== 'unsupported' && micState !== 'blocked') {
        setMicState('idle');
      }
    };

    recognition.onerror = async (event) => {
      console.error('Speech recognition failed:', event.error, event.message);
      stopMicSilenceMonitor();
      stopSpeechRecognitionMonitorStream();

      if (speechRecognition === recognition) {
        speechRecognition = null;
      }

      await startRecorderTranscriptionFallback(`speech-error:${event.error}`);
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

    try {
      const monitorStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      speechRecognitionMonitorStream = monitorStream;
      await startMicSilenceMonitor(monitorStream, () => {
        if (speechRecognition !== recognition || speechRecognitionGotFinalResult) {
          return;
        }

        speechRecognitionStoppingDueToSilence = true;
        try {
          recognition.stop();
        } catch (err) {
          console.warn('Failed to stop speech recognition on silence:', err);
        }
      });
    } catch (err) {
      console.warn('Could not start silence monitor for speech recognition:', err);
    }

    recognition.start();
    setMicState('active');
  } catch (err) {
    console.error('Speech recognition access failed:', err);
    speechRecognition = null;
    await startRecorderTranscriptionFallback('speech-start-exception');
  }
}

function appendMessage(role: string, text: string) {
  const el = document.createElement('div')
  el.className = 'msg ' + role
  el.textContent = text
  messagesEl.appendChild(el)
  messagesEl.scrollTop = messagesEl.scrollHeight
  return el
}

async function playQueuedAudioChunks() {
  if (isPlayingQueuedAudio) {
    return;
  }

  const nextChunk = pendingAudioChunks.shift();
  if (!nextChunk) {
    return;
  }

  isPlayingQueuedAudio = true;
  refreshMicButtonMode();
  try {
    await avatar.playLipSyncAudio(nextChunk);
  } catch (err) {
    console.error('Failed to play streamed audio chunk:', err);
  } finally {
    isPlayingQueuedAudio = false;
    refreshMicButtonMode();
    if (pendingAudioChunks.length > 0) {
      void playQueuedAudioChunks();
    }
  }
}

function queueAudioChunk(audioSrc: string) {
  if (!audioSrc) {
    return;
  }

  pendingAudioChunks.push(audioSrc);
  refreshMicButtonMode();
  void playQueuedAudioChunks();
}

async function stopAssistantOutput() {
  if (isStoppingAssistantOutput) {
    return;
  }

  isStoppingAssistantOutput = true;
  try {
    pendingAudioChunks.splice(0);
    refreshMicButtonMode();
    // Empty source is the current stop signal for avatar audio playback.
    await avatar.playLipSyncAudio('');

    if (isAwaitingResponse) {
      await window.pilinszky.cancelActiveChatStream();
    }
  } finally {
    isStoppingAssistantOutput = false;
    refreshMicButtonMode();
  }
}

async function send() {
  const message = inputEl.value.trim()
  if (!message || isAwaitingResponse) return

  pendingAudioChunks.splice(0);
  refreshMicButtonMode();
  // Empty source is the current stop signal for avatar audio playback.
  await avatar.playLipSyncAudio('');
  setRequestInFlight(true)
  setLoadingStatus('Pilinszky válaszol…')
  inputEl.value = ''
  appendMessage('user', message)
  history.push({ role: 'user', content: message })
  const assistantMessageEl = appendMessage('assistant', '')

  try {
    let partialReply = ''

    const reply = await window.pilinszky.chatStream(message, history, (event) => {
      if (event.type === 'text') {
        partialReply += event.data
        assistantMessageEl.textContent = partialReply
        messagesEl.scrollTop = messagesEl.scrollHeight
        return
      }

      if (event.type === 'audio') {
        queueAudioChunk(event.data)
      }
    })

    history.push({ role: 'assistant', content: reply })
    if (!assistantMessageEl.textContent?.trim()) {
      assistantMessageEl.textContent = reply
      messagesEl.scrollTop = messagesEl.scrollHeight
    }
  } catch (err) {
    const cancelled = err instanceof Error && err.message === CHAT_STREAM_CANCELLED;
    if (!assistantMessageEl.textContent?.trim()) {
      assistantMessageEl.remove()
    }
    if (!cancelled) {
      appendMessage('assistant', '[Hiba történt. Kérjük, próbálja újra.]')
      console.error(err)
    }
  } finally {
    setRequestInFlight(false)
    inputEl.focus()
  }
}

sendBtn.addEventListener('click', send)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send().then(null);
});

micBtnEl.addEventListener('click', () => {
  if (isAssistantOutputActive()) {
    void stopAssistantOutput();
    return;
  }

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
  if (canUseRecorderTranscriptionFallback()) {
    setMicState('idle', 'Natív beszédfelismerés nélkül felhős STT átírás lesz használva');
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
