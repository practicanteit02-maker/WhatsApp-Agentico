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
