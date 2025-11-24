const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const screenshot = require('screenshot-desktop');
const WebSocket = require('ws');
const { screen } = require('electron');
const { applyInputEvent } = require('./input');

const DEFAULT_WS_URL = process.env.SOLSTICE_WS_URL || 'ws://localhost:8080/ws';
const DOWNLOAD_DIR =
  process.env.SOLSTICE_DOWNLOAD_DIR ||
  path.join(os.homedir(), 'Downloads', 'Solstice');

const defaultState = {
  status: 'idle',
  viewers: 0,
  sessionCode: undefined,
  error: undefined,
  deviceName: os.hostname(),
};

class HostController extends EventEmitter {
  constructor() {
    super();
    this.state = { ...defaultState };
    this.ws = null;
    this.captureInterval = null;
    this.heartbeatInterval = null;
    this.streaming = false;
    this.sendingFrame = false;
    this.config = {
      wsUrl: DEFAULT_WS_URL,
      fps: Number(process.env.SOLSTICE_HOST_FPS || 8),
      quality: Number(process.env.SOLSTICE_HOST_QUALITY || 65),
    };
    this.fileBuffers = new Map();
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  getState() {
    return this.state;
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  async start(options = {}) {
    if (this.ws) {
      await this.stop();
    }
    this.config = {
      ...this.config,
      wsUrl: options.wsUrl || this.config.wsUrl,
      fps: options.fps || this.config.fps,
      quality: options.quality || this.config.quality,
    };
    this.updateState({
      status: 'connecting',
      error: undefined,
      viewers: 0,
      sessionCode: undefined,
      deviceName: options.deviceName || os.hostname(),
    });
    await this.openSocket();
  }

  async stop() {
    this.streaming = false;
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    this.updateState({ ...defaultState });
  }

  async openSocket() {
    const ws = new WebSocket(this.config.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.send('announce_agent', {
        deviceName: this.state.deviceName || os.hostname(),
        os: `${os.type()} ${os.release()}`,
        region: 'local',
        capabilities: ['control', 'files', 'chat'],
      });
      this.prepareLoops();
    });

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('[host] invalid message', error);
      }
    });

    ws.on('close', () => {
      this.updateState({
        status: 'error',
        error: 'Connection closed',
      });
      this.cleanupSocket();
    });

    ws.on('error', (error) => {
      this.updateState({ status: 'error', error: error.message });
      this.cleanupSocket();
    });
  }

  cleanupSocket() {
    this.streaming = false;
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  prepareLoops() {
    if (!this.captureInterval) {
      const interval = Math.max(1, Math.floor(1000 / this.config.fps));
      this.captureInterval = setInterval(
        () => this.captureFrame(),
        interval,
      );
    }
    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        this.send('heartbeat', { fps: this.config.fps });
      }, 10000);
    }
  }

  async captureFrame() {
    if (!this.streaming) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.sendingFrame) return;
    this.sendingFrame = true;
    try {
      const buffer = await screenshot({ format: 'jpg', quality: this.config.quality });
      const { width, height } = screen.getPrimaryDisplay().size;
      this.send('frame', {
        data: buffer.toString('base64'),
        mime: 'image/jpeg',
        width,
        height,
        bytes: buffer.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[host] capture error', error);
    } finally {
      this.sendingFrame = false;
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'session_ready':
        this.updateState({
          status: 'connected',
          sessionCode: message.payload.code,
          error: undefined,
        });
        break;
      case 'viewer_joined':
        this.streaming = true;
        this.updateState({ viewers: message.payload.totalViewers });
        break;
      case 'viewer_left':
        this.updateState({ viewers: message.payload.totalViewers });
        if ((message.payload.totalViewers || 0) <= 0) {
          this.streaming = false;
        }
        break;
      case 'input_event':
        this.applyInput(message.payload);
        break;
      case 'file_offer':
        this.prepareFileBuffer(message.payload);
        break;
      case 'file_chunk':
        this.handleFileChunk(message.payload);
        break;
      default:
        break;
    }
  }

  async applyInput(payload) {
    try {
      const display = screen.getPrimaryDisplay();
      await applyInputEvent(payload, display.size);
    } catch (error) {
      console.error('[host] input error', error);
    }
  }

  prepareFileBuffer(payload) {
    if (payload.direction !== 'viewer_to_agent') return;
    this.fileBuffers.set(payload.fileId, {
      name: payload.name,
      total: payload.total || 0,
      chunks: [],
    });
  }

  handleFileChunk(payload) {
    if (payload.sender !== 'viewer') return;
    const buffer = this.fileBuffers.get(payload.fileId);
    if (!buffer) return;
    buffer.chunks[payload.index] = payload.data;

    const completed =
      buffer.chunks.filter((chunk) => typeof chunk === 'string').length >=
      payload.total;
    if (payload.done || completed) {
      const merged = buffer.chunks.join('');
      const binary = Buffer.from(merged, 'base64');
      const fileName = `${Date.now()}-${buffer.name}`;
      const target = path.join(DOWNLOAD_DIR, fileName);
      fs.writeFileSync(target, binary);
      this.fileBuffers.delete(payload.fileId);
    }
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }
}

module.exports = { HostController };

