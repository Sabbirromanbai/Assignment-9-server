import { validateImageUpload, uploadImageToImgBB, MAX_PROFILE_IMAGE_SIZE } from '../utils/imageUpload.js';

export async function uploadProfileImage(req, res) {
  try {
    const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    const validation = validateImageUpload(req.body, contentType, MAX_PROFILE_IMAGE_SIZE);
    if (!validation.ok) {
      return res.status(validation.status).json({ message: validation.message });
    }

    const suppliedName = req.get('x-file-name') ?? 'profile-image';
    const imageUrl = await uploadImageToImgBB(req.body, validation.contentType, suppliedName);

    return res.status(201).json({ message: 'Image uploaded', data: { url: imageUrl } });
  } catch (err) {
    console.error('uploadProfileImage error:', err.message);
    return res.status(502).json({ message: 'Image upload failed' });
  }
}
