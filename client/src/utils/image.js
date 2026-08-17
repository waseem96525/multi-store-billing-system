// Reads an image File, downscales it so its longest edge is at most
// `maxEdge` px, and returns a compressed JPEG data URL suitable for storing
// in the database as a wallpaper/background. Keeps payloads small enough
// for Realtime Database while preserving decent quality.
export function fileToDataUrl(file, { maxEdge = 1920, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please choose an image file'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load the image'));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(new Error('Could not process the image'));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
