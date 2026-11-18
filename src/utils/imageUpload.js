const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_MAX_SIZE = 5 * 1024 * 1024;

function sanitizeFileName(value) {
  return String(value ?? 'image')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100) || 'image';
}

export function validateImageUpload(buffer, contentType, maxSize = DEFAULT_MAX_SIZE) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, status: 400, message: 'Send one image file as the request body' };
  }

  const normalizedType = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(normalizedType)) {
    return { ok: false, status: 415, message: 'Only JPEG, PNG, and WebP images are supported' };
  }

  if (buffer.length > maxSize) {
    return { ok: false, status: 413, message: `Image must be ${Math.floor(maxSize / (1024 * 1024))} MB or smaller` };
  }

  return { ok: true, contentType: normalizedType };
}

export async function uploadImageToImgBB(buffer, contentType, fileName) {
  if (!process.env.IMGBB_API_KEY) {
    throw new Error('IMGBB_API_KEY is not configured');
  }

  const form = new FormData();
  form.append('image', new Blob([buffer], { type: contentType }), sanitizeFileName(fileName));
  form.append('name', sanitizeFileName(fileName));

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`,
    { method: 'POST', body: form },
  );
  const result = await response.json();
  const imageUrl = result?.data?.image?.url;

  if (!response.ok || result?.success !== true || typeof imageUrl !== 'string') {
    throw new Error('Image upload provider rejected the image');
  }

  try {
    const url = new URL(imageUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'i.ibb.co') {
      throw new Error('Invalid image provider response');
    }
  } catch {
    throw new Error('Invalid image provider response');
  }

  return imageUrl;
}

export { IMAGE_TYPES, DEFAULT_MAX_SIZE as MAX_PROFILE_IMAGE_SIZE };
