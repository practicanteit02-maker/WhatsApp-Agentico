"use client";

// Funcionalidad "Sonido de mensajes": el usuario solo tenía un archivo de
// audio disponible (misma carpeta de Música del escritorio), así que se usa
// el mismo sonido tanto para "enviado" como para "recibido" — separar las
// dos funciones exportadas de todos modos deja listo el cambio si algún día
// aparece un segundo archivo distinto para cada caso.
const MESSAGE_SOUND_SRC = "/sounds/message.mp3";

function playMessageSound() {
  try {
    // Una instancia de Audio nueva por reproducción (en vez de una sola
    // reusada) para que un "enviado" y un "recibido" que caen casi juntos no
    // se corten entre sí.
    const audio = new Audio(MESSAGE_SOUND_SRC);
    audio.volume = 0.5;
    void audio.play().catch(() => {
      // El navegador bloqueó la reproducción automática (p. ej. todavía no
      // hubo ninguna interacción del usuario en la página) — no es un error
      // real que haya que mostrar, simplemente no suena esta vez.
    });
  } catch {
    // El sonido es un extra: nunca debe romper el envío/recepción del mensaje.
  }
}

export function playSentMessageSound() {
  playMessageSound();
}

export function playReceivedMessageSound() {
  playMessageSound();
}

// Funcionalidad "Alerta de tiempo de respuesta" (banner + sonido): a
// diferencia del sonido de mensajes de arriba (que reproduce un archivo .mp3
// fijo), este "ding-dong" de dos notas se sintetiza con la Web Audio API —
// sin agregar ningún archivo de audio nuevo. Primera nota Do5 (523.25 Hz),
// segunda Mi5 (659.25 Hz) 150ms después; cada una con una envolvente simple
// (ataque instantáneo a ganancia ~0.28, decaimiento exponencial a lo largo de
// ~400ms) para que no corte en seco ni deje un "click" audible al final.
const RESPONSE_ALERT_NOTES_HZ = [523.25, 659.25]; // Do5, Mi5
const RESPONSE_ALERT_NOTE_GAP_S = 0.15;
const RESPONSE_ALERT_NOTE_GAIN = 0.28;
const RESPONSE_ALERT_NOTE_DECAY_S = 0.4;

// Una sola instancia compartida (a diferencia de playMessageSound, que crea
// un elemento Audio nuevo por reproducción): un AudioContext es un recurso
// más pesado que un <audio>, y varios banners casi simultáneos (varios chats
// cruzando el umbral juntos) pueden reusar el mismo sin que los sonidos se
// corten entre sí — cada llamada solo agrega nodos oscillator/gain nuevos.
let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextClass();
  }
  return sharedAudioContext;
}

function playTone(context: AudioContext, frequencyHz: number, startTime: number) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequencyHz;

  gainNode.gain.setValueAtTime(RESPONSE_ALERT_NOTE_GAIN, startTime);
  // exponentialRampToValueAtTime no acepta 0 exacto como destino (división
  // por cero en la curva) — 0.0001 es, en la práctica, silencio.
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + RESPONSE_ALERT_NOTE_DECAY_S);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + RESPONSE_ALERT_NOTE_DECAY_S);
}

export function playResponseAlertSound() {
  try {
    const context = getSharedAudioContext();
    if (!context) return;

    // Igual que playMessageSound(): si el navegador todavía no tuvo ninguna
    // interacción del usuario en la página, el AudioContext puede arrancar
    // "suspended" — resume() no hace nada si ya estaba corriendo.
    void context.resume().catch(() => {});

    const now = context.currentTime;
    RESPONSE_ALERT_NOTES_HZ.forEach((frequencyHz, index) => {
      playTone(context, frequencyHz, now + index * RESPONSE_ALERT_NOTE_GAP_S);
    });
  } catch {
    // El sonido es un extra: nunca debe romper el banner ni el resto de la app.
  }
}
