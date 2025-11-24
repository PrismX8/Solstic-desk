import { Router } from 'express';
import os from 'node:os';
import { sessionStore } from '../ws/server.js';

const router = Router();

router.get('/health', (_req, res) => {
  const memory = process.memoryUsage();
  const stats = sessionStore.stats();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    sessions: stats.sessions,
    viewers: stats.viewers,
    load: os.loadavg?.() ?? [],
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
    },
  });
});

export default router;

