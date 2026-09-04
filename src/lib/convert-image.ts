// Formatos de imagen que WhatsApp de verdad acepta para un mensaje de tipo
// "image" — cualquier otro (WebP, GIF, AVIF, BMP...) se sube "bien" a Kapso
// pero WhatsApp rechaza la entrega sin avisar nada en la UI, quedando como
// "Not delivered" sin ninguna pista de la causa real.
const WHATSAPP_SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

/**
 * Funcionalidad "Convertir imagen no soportada": si el archivo elegido es
 * una imagen en un formato que WhatsApp no acepta para mensajes de tipo
 * "image" (ver WHATSAPP_SUPPORTED_IMAGE_TYPES), la redibuja en un canvas y la
 * exporta como JPEG antes de subirla. Si no es una imagen, o ya viene en un
 * formato soportado, o la conversión falla por lo que sea, se devuelve el
 * archivo original tal cual (mejor intentar subir el original que bloquear
 * el envío por esto). Vive en un archivo aparte (y no solo en
 * message-view.tsx) porque quick-reply-picker.tsx también la necesita, para
 * guardar la imagen de una respuesta rápida ya en un formato que WhatsApp
 * vaya a aceptar cuando se use.
 */
export async function convertImageToSupportedFormatIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || WHATSAPP_SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return file;
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo leer la imagen'));
        img.src = objectUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.drawImage(image, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.92);
      });
      if (!blob) return file;

      const newName = file.name.replace(/\.[^./]+$/, '') + '.jpg';
      return new File([blob], newName, { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return file;
  }
}
