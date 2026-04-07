import { type Message } from "../../shared/types";
import { AvatarRenderer } from './avatar'

// @ts-ignore
const isDev: boolean = import.meta.env.DEV;

const history: Message[] = [];

const messagesEl = document.querySelector<HTMLDivElement>("#messages")!;
const inputEl = document.querySelector<HTMLInputElement>("#input")!;
const sendBtn = document.querySelector<HTMLButtonElement>("#send")!;
const avatarCanvasEl = document.querySelector<HTMLCanvasElement>('#avatar-canvas')!

const avatar = new AvatarRenderer(avatarCanvasEl, "pilinszky");

if (!isDev) {
  document.body.classList.add("prod-layout");
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

// update the mouse position (absolute position relative to dom)
document.addEventListener("mousemove", (event) => {
  const mouseX = event.clientX;
  const mouseY = event.clientY;

  avatar.updateMouse(mouseX, mouseY);
})


export {};
