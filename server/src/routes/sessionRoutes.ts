import { Router } from 'express';
import { sessionStore } from '../ws/server.js';

const router = Router();

router.get('/:code', (req, res) => {
  const code = req.params.code?.toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'CODE_REQUIRED' });
    return;
  }
  const session = sessionStore.getSessionByCode(code);
  if (!session) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  res.json({
    code: session.code,
    deviceName: session.metadata.deviceName,
    os: session.metadata.os,
    region: session.metadata.region,
    expiresAt: session.expiresAt,
    viewers: session.viewers.size,
    createdAt: session.createdAt,
  });
});

router.delete('/:code', (req, res) => {
  const code = req.params.code?.toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'CODE_REQUIRED' });
    return;
  }
  const session = sessionStore.getSessionByCode(code);
  if (!session) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  sessionStore.detachClient(session.agent.id);
  res.json({ status: 'revoked' });
});

export default router;

