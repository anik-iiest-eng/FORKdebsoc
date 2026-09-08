import express from 'express';
import crypto from 'crypto';
import { body, param } from 'express-validator';
import prisma from '../config/db.js';
import { verifyToken } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.middleware.js';

const router = express.Router();

router.use(verifyToken, requireAdmin);

// 1. Get All Events
router.get('/events', async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
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
  const { eventId, title, description, eventType, location, coverImage, images, eventDate, archivedAt } = req.body;
    const { awardCount } = req.body;

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
        archivedAt: new Date(archivedAt)
      }
    });

    res.json({ message: 'History record updated successfully', history: updatedHistory });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;