const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_MAX_SIZE = 5 * 1024 * 1024;
const IMGBB_TIMEOUT_MS = 15 * 1000;

const UPLOAD_ERROR_MESSAGES = {
  configuration: 'Image upload is not configured',
  timeout: 'ImgBB request timed out',
  network: 'ImgBB request failed',
  http_rejection: 'ImgBB rejected the upload',
  provider_rejection: 'ImgBB rejected the upload',
  json_parse: 'ImgBB returned invalid JSON',
  invalid_response: 'ImgBB returned an invalid response',
  invalid_response_url: 'ImgBB returned an invalid image URL',
};

class ImgBBUploadError extends Error {
  constructor(category, providerStatus = null) {
    super(UPLOAD_ERROR_MESSAGES[category]);
    this.name = 'ImgBBUploadError';
    this.category = category;
    this.providerStatus = providerStatus;
    this.code = category === 'configuration' ? 'IMGBB_NOT_CONFIGURED' : 'IMGBB_UPLOAD_FAILED';
  }
}

function sanitizeFileName(value) {
  return String(value ?? 'image')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100) || 'image';
}

export function getSafeImgBBErrorDetails(error) {
  if (!(error instanceof ImgBBUploadError)) {
    return {
      category: 'unknown',
      providerStatus: null,
      message: 'Unexpected image upload failure',
    };
  }

  return {
    category: error.category,
    providerStatus: error.providerStatus,
    message: error.message,
  };
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
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    throw new ImgBBUploadError('configuration');
  }

  const form = new FormData();
  form.append('image', new Blob([buffer], { type: contentType }), sanitizeFileName(fileName));
  form.append('name', sanitizeFileName(fileName));

  let response;
  try {
    response = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(IMGBB_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const category = error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError'
      ? 'timeout'
      : 'network';
    throw new ImgBBUploadError(category);
  }

  if (!response.ok) {
    throw new ImgBBUploadError('http_rejection', response.status);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new ImgBBUploadError('json_parse', response.status);
  }

  const imageUrl = result?.data?.image?.url;

  if (result?.success !== true) {
    throw new ImgBBUploadError('provider_rejection', response.status);
  }
  if (typeof imageUrl !== 'string') {
    throw new ImgBBUploadError('invalid_response', response.status);
  }

  try {
    const url = new URL(imageUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'i.ibb.co') {
      throw new Error();
    }
  } catch {
    throw new ImgBBUploadError('invalid_response_url', response.status);
  }

  return imageUrl;
}

export { IMAGE_TYPES, DEFAULT_MAX_SIZE as MAX_PROFILE_IMAGE_SIZE };
