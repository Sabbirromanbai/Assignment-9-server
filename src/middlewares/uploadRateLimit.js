const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

export function profileImageUploadRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let record = attempts.get(key);

  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + WINDOW_MS };
  }

  record.count += 1;
  attempts.set(key, record);

  if (record.count > MAX_ATTEMPTS) {
    res.set('Retry-After', String(Math.ceil((record.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many upload attempts. Please try again later.' });
  }

  next();
}
