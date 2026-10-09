/**
 * Shrinks an uploaded image to fit `max` × `max` and returns a data URL, so
 * logos and profile photos stay small enough to live inside a Firestore
 * document and draw on a canvas without cross-origin problems.
 */
export function resizeImageFile(file: File, max = 256, type: "image/png" | "image/jpeg" = "image/png", quality = 0.86): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("Sirf image (PNG / JPG / WebP) upload karein")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("Canvas nahi bana")); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(type, quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image parhi nahi ja saki")); };
    img.src = url;
  });
}
