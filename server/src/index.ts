import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import sessionRouter from './routes/sessionRoutes.js';
import { registerWebSocketServer } from './ws/server.js';
import { logger } from './lib/logger.js';

const app = express();

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => {
  res.json({
    name: 'Solstice Desk Relay',
    version: '0.1.0',
    docs: '/docs',
  });
});

app.use('/health', healthRouter);
app.use('/api/sessions', sessionRouter);

const server = http.createServer(app);
registerWebSocketServer(server);

server.listen(config.port, () => {
  logger.info({ port: config.port }, 'server_started');
});

process.on('SIGINT', () => {
  logger.info('shutting_down');
  server.close(() => process.exit(0));
});

