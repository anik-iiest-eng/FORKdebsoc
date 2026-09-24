import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { body, param } from 'express-validator';
import prisma from '../config/db.js';
import cloudinary from '../config/cloudinary.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.middleware.js';

const router = express.Router();

router.use(verifyToken, requireAdmin);

/* ------------------------------------------------------------------ */
/* CMS media helpers (Cloudinary). Same multer limits as user.routes.js */
/* ------------------------------------------------------------------ */
const CMS_FOLDER = 'debsoc/cms';
const CMS_TAG = 'debsoc-cms';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
    }
    cb(null, true);
  }
});

const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) =>
      error ? reject(error) : resolve(result)
    );
    stream.end(buffer);
  });

const toMedia = (r) => ({
  url: r.secure_url,
  publicId: r.public_id,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  format: r.format,
  createdAt: r.created_at
});

// Where an image URL is currently referenced (event covers, archive covers/galleries)
async function findMediaUsage(publicId) {
  const [events, archives] = await Promise.all([
    prisma.event.findMany({ select: { title: true, coverImage: true } }),
    prisma.history.findMany({ select: { title: true, coverImage: true, images: true } })
  ]);
  const usage = [];
  events.forEach((e) => {
    if (e.coverImage && e.coverImage.includes(publicId)) usage.push({ type: 'event', title: e.title });
  });
  archives.forEach((h) => {
    if ((h.coverImage && h.coverImage.includes(publicId)) || h.images.some((u) => u.includes(publicId))) {
      usage.push({ type: 'archive', title: h.title });
    }
  });
  return usage;
}

// 1. Get All Events (now includes registration counts)
router.get('/events', async (req, res) => {
  const events = await prisma.event.findMany({
    orderBy: { eventDate: 'desc' },
    include: { _count: { select: { participants: true } } }
  });
  res.json(events);
});

// 2. Create New Event
router.post('/events', async (req, res) => {
  const { title, description, eventType, eventDate, registrationDeadline, location, coverImage } = req.body;
  try {
    const event = await prisma.event.create({
      data: {
        title,
        description,
        eventType: eventType || 'MAIN',
        eventDate: new Date(eventDate),
        registrationDeadline: new Date(registrationDeadline),
        location,
        coverImage: coverImage || undefined,
        organizerId: req.user.id
      }
    });
    res.status(201).json(event);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2b. Update Event (NEW — the dashboard already called PUT /events/:id but the route did not exist)
router.put('/events/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, eventType, eventDate, registrationDeadline, location, coverImage } = req.body;

  if (![title, description, location].every((v) => typeof v === 'string' && v.trim())) {
    return res.status(400).json({ error: 'Title, description and location are required.' });
  }
  const date = new Date(eventDate);
  const deadline = new Date(registrationDeadline);
  if (Number.isNaN(date.getTime()) || Number.isNaN(deadline.getTime())) {
    return res.status(400).json({ error: 'Valid event date and registration deadline are required.' });
  }

  try {
    const event = await prisma.event.update({
      where: { id },
      data: {
        title: title.trim(),
        description: description.trim(),
        eventType: eventType || undefined,
        eventDate: date,
        registrationDeadline: deadline,
        location: location.trim(),
        coverImage: coverImage || undefined
      }
    });
    res.json(event);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Event not found.' });
    res.status(500).json({ error: e.message });
  }
});

// 3. Delete Event
router.delete('/events/:id', async (req, res) => {
  await prisma.event.delete({ where: { id: req.params.id } });
  res.json({ message: 'Event deleted' });
});

// 4. Archive Event to History
router.post('/events/:id/archive', async (req, res) => {
  const { id } = req.params;
  try {
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Create history record
    const history = await prisma.history.create({
      data: {
        eventId: event.id,
        title: event.title,
        description: event.description,
        eventType: event.eventType,
        location: event.location,
        coverImage: event.coverImage,
        eventDate: event.eventDate
      }
    });

    // Relink existing achievements and winner codes to the new historyId
    await prisma.achievement.updateMany({
      where: { eventId: event.id },
      data: { historyId: history.id }
    });

    await prisma.winnerCode.updateMany({
      where: { eventId: event.id },
      data: { historyId: history.id }
    });

    // Remove from active events
    await prisma.event.delete({ where: { id } });

    res.json({ message: 'Event archived to history successfully', history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Mint Winner Codes
router.post('/mint-codes', async (req, res) => {
  const { eventId, historyId, titles } = req.body;

  if ((eventId && historyId) || (!eventId && !historyId)) {
    return res.status(400).json({ error: 'Provide exactly one eventId or historyId.' });
  }

  if (!Array.isArray(titles) || titles.length === 0 || titles.some(title => typeof title !== 'string' || !title.trim())) {
    return res.status(400).json({ error: 'Provide at least one non-empty award title.' });
  }

  try {
    const target = eventId
      ? await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } })
      : await prisma.history.findUnique({ where: { id: historyId }, select: { id: true } });

    if (!target) return res.status(404).json({ error: 'Award target was not found.' });

    const results = [];
    for (const title of titles) {
      const rawToken = `DEBSOC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const codeHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await prisma.winnerCode.create({
        data: {
          ...(eventId ? { eventId } : { historyId }),
          positionTitle: title.trim(),
          codeHash
        }
      });

      results.push({ positionTitle: title.trim(), rawToken });
    }
    res.json({ codes: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5b. List minted codes with redemption status (NEW). Never returns codeHash or raw tokens.
router.get('/codes', async (req, res) => {
  const { eventId, historyId } = req.query;
  const where = {
    ...(typeof eventId === 'string' && eventId ? { eventId } : {}),
    ...(typeof historyId === 'string' && historyId ? { historyId } : {})
  };
  try {
    const codes = await prisma.winnerCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        positionTitle: true,
        isRedeemed: true,
        redeemedAt: true,
        createdAt: true,
        eventId: true,
        historyId: true,
        event: { select: { title: true } },
        history: { select: { title: true } },
        achievement: { select: { user: { select: { displayName: true, username: true } } } }
      }
    });
    res.json(codes);
  } catch (e) {
    console.error('List codes error:', e);
    res.status(500).json({ error: 'Failed to load codes.' });
  }
});

// 5c. Revoke an unredeemed code (NEW)
router.delete('/codes/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const code = await prisma.winnerCode.findUnique({
      where: { id: req.params.id },
      select: { isRedeemed: true }
    });
    if (!code) return res.status(404).json({ error: 'Code not found.' });
    if (code.isRedeemed) return res.status(409).json({ error: 'Redeemed codes cannot be revoked.' });

    await prisma.winnerCode.delete({ where: { id: req.params.id } });
    res.json({ message: 'Code revoked' });
  } catch (e) {
    console.error('Revoke code error:', e);
    res.status(500).json({ error: 'Failed to revoke code.' });
  }
});

// 6. Get History with Verified Awardees
router.get('/history', async (req, res) => {
  const archives = await prisma.history.findMany({
    orderBy: { eventDate: 'desc' },
    include: {
      achievements: {
        include: {
          user: { select: { displayName: true, email: true, username: true } }
        }
      }
    }
  });
  res.json(archives);
});

// 7. Delete History
router.delete('/history/:id', async (req, res) => {
  await prisma.history.delete({ where: { id: req.params.id } });
  res.json({ message: 'History record deleted' });
});

// 8. Assign a role to another user and record the change atomically.
router.patch('/users/:id/role', [
  param('id').isUUID(),
  body('role').isIn(['USER', 'ADMIN'])
], validate, async (req, res) => {
  const { role } = req.body;
  const targetUserId = req.params.id;
  const validRoles = ['USER', 'ADMIN'];

  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role value.' });
  }

  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'Cannot change your own role.' });
  }

  try {
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: targetUserId },
        data: { role },
        select: { id: true, email: true, username: true, role: true }
      }),
      prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: 'ROLE_CHANGE',
          targetId: targetUserId,
          metadata: { newRole: role }
        }
      })
    ]);

    return res.json({ message: 'Role updated successfully', user: updatedUser });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'User not found.' });
    }

    console.error('Role assignment error:', error);
    return res.status(500).json({ error: 'Failed to update user role.' });
  }
});

/// POST: Create direct history record with image array
router.post('/history', async (req, res) => {
  const { eventId, title, description, eventType, location, coverImage, images, eventDate, archivedAt, awardCount } = req.body;

  if (!Number.isInteger(awardCount) || awardCount < 0 || awardCount > 500) {
    return res.status(400).json({ error: 'Award count must be an integer between 0 and 500.' });
  }

  try {
    const newHistory = await prisma.history.create({
      data: {
        ...(eventId ? { event: { connect: { id: eventId } } } : {}),
        title,
        description,
        eventType: eventType || 'MAIN',
        location,
        coverImage: coverImage || 'https://via.placeholder.com/600x400',
        images: Array.isArray(images) ? images : [],
        awardCount,
        eventDate: new Date(eventDate),
        ...(archivedAt ? { archivedAt: new Date(archivedAt) } : {})
      }
    });

    res.status(201).json({ message: 'History archive created successfully', history: newHistory });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT: Update history record with image array
router.put('/history/:id', async (req, res) => {
  const { id } = req.params;
  const { eventId, title, description, eventType, location, coverImage, images, eventDate, archivedAt, awardCount } = req.body;

  if (!Number.isInteger(awardCount) || awardCount < 0 || awardCount > 500) {
    return res.status(400).json({ error: 'Award count must be an integer between 0 and 500.' });
  }

  try {
    const existingHistory = await prisma.history.findUnique({ where: { id }, select: { id: true } });
    if (!existingHistory) return res.status(404).json({ error: 'History record not found.' });

    const updatedHistory = await prisma.history.update({
      where: { id },
      data: {
        event: eventId ? { connect: { id: eventId } } : { disconnect: true },
        title,
        description,
        eventType,
        location,
        coverImage,
        images: Array.isArray(images) ? images : [],
        awardCount,
        eventDate: new Date(eventDate),
        ...(archivedAt ? { archivedAt: new Date(archivedAt) } : {})
      }
    });

    res.json({ message: 'History record updated successfully', history: updatedHistory });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* CMS media library (NEW) — backed by Cloudinary, no DB changes       */
/* ------------------------------------------------------------------ */

// Upload 1–10 images in one request (multipart field: "images")
router.post(
  '/media/upload',
  (req, res, next) => {
    upload.array('images', 10)(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: 'Each image must be 5MB or smaller.',
          LIMIT_FILE_COUNT: 'You can upload up to 10 images at a time.',
          LIMIT_UNEXPECTED_FILE: 'Unexpected upload field.'
        };
        return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          error: messages[error.code] || 'Invalid image upload.'
        });
      }
      return res.status(400).json({ error: error.message || 'Invalid image upload.' });
    });
  },
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Select at least one image.' });
    }
    try {
      const results = await Promise.all(
        req.files.map((file) =>
          uploadBufferToCloudinary(file.buffer, {
            folder: CMS_FOLDER,
            tags: [CMS_TAG],
            resource_type: 'image',
            transformation: [{ width: 2000, height: 2000, crop: 'limit' }, { quality: 'auto' }]
          })
        )
      );
      res.status(201).json({ media: results.map(toMedia) });
    } catch (error) {
      console.error('Media upload error:', error);
      res.status(500).json({ error: 'Failed to upload images.' });
    }
  }
);

// List CMS media, newest first (cursor pagination)
router.get('/media', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 60);
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
  try {
    let search = cloudinary.search
      .expression(`tags=${CMS_TAG}`)
      .sort_by('created_at', 'desc')
      .max_results(limit);
    if (cursor) search = search.next_cursor(cursor);
    const result = await search.execute();
    res.json({
      items: result.resources.map(toMedia),
      nextCursor: result.next_cursor || null,
      total: result.total_count ?? result.resources.length
    });
  } catch (error) {
    console.error('Media list error:', error);
    res.status(500).json({ error: 'Failed to load media library.' });
  }
});

// Delete a CMS image. Refuses (409) if it is still used, unless { force: true }
router.delete('/media', async (req, res) => {
  const { publicId, force } = req.body || {};
  if (typeof publicId !== 'string' || !publicId) {
    return res.status(400).json({ error: 'publicId is required.' });
  }
  try {
    let resource;
    try {
      resource = await cloudinary.api.resource(publicId);
    } catch (e) {
      if (e?.error?.http_code === 404 || e?.http_code === 404) {
        return res.status(404).json({ error: 'Image not found.' });
      }
      throw e;
    }
    if (!Array.isArray(resource.tags) || !resource.tags.includes(CMS_TAG)) {
      return res.status(403).json({ error: 'Only CMS media can be deleted here.' });
    }

    const usage = await findMediaUsage(publicId);
    if (usage.length > 0 && !force) {
      return res.status(409).json({ error: 'This image is still in use.', usage });
    }

    await cloudinary.uploader.destroy(publicId, { invalidate: true });
    res.json({ message: 'Media deleted' });
  } catch (error) {
    console.error('Media delete error:', error);
    res.status(500).json({ error: 'Failed to delete image.' });
  }
});

export default router;