import { z } from 'zod';

export const envelopeSchema = z.object({
  type: z.string(),
  payload: z.unknown(),
  ref: z.string().optional(),
});

export const agentAnnounceSchema = z.object({
  deviceName: z.string().min(1),
  os: z.string().min(1),
  region: z.string().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

export const viewerJoinSchema = z.object({
  code: z.string().min(5),
  nickname: z.string().min(1).max(32),
});

export const framePayloadSchema = z.object({
  data: z.string().min(10),
  mime: z.string().default('image/jpeg'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  timestamp: z.number().int().optional(),
});

const mouseButtonSchema = z.enum(['left', 'middle', 'right']);

export const inputEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mouse_move'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('mouse_down'),
    button: mouseButtonSchema,
  }),
  z.object({
    kind: z.literal('mouse_up'),
    button: mouseButtonSchema,
  }),
  z.object({
    kind: z.literal('mouse_wheel'),
    deltaX: z.number(),
    deltaY: z.number(),
  }),
  z.object({
    kind: z.literal('key_down'),
    key: z.string().min(1).max(16),
    meta: z.record(z.boolean()).optional(),
  }),
  z.object({
    kind: z.literal('key_up'),
    key: z.string().min(1).max(16),
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1).max(64),
  }),
]);

export const chatPayloadSchema = z.object({
  message: z.string().min(1).max(400),
  nickname: z.string().min(1).max(32),
});

export const fileOfferPayloadSchema = z.object({
  fileId: z.string().min(8),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mime: z.string().optional(),
  direction: z.enum(['agent_to_viewer', 'viewer_to_agent']),
});

export const fileChunkPayloadSchema = z.object({
  fileId: z.string().min(8),
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  data: z.string().min(1), // base64
  done: z.boolean().optional(),
});

export const heartbeatPayloadSchema = z.object({
  fps: z.number().optional(),
  cpu: z.number().optional(),
  latency: z.number().optional(),
});

