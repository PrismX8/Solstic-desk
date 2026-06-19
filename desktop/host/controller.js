const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');
const { screen, desktopCapturer } = require('electron');
const { applyInputEvent } = require('./input');

const DEFAULT_WS_URL = process.env.SOLSTICE_WS_URL || 'ws://127.0.0.1:17654/ws';
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
    this.frameInterval = null;
    this.frameTimer = null;
    this.heartbeatInterval = null;
    this.reconnectTimer = null;
    this.shouldReconnect = false;
    this.reconnectAttempts = 0;
    this.streaming = false;
    this.captureInFlight = false;
    this.processingFrame = false;
    this.frameQueue = [];
    this.config = {
      wsUrl: DEFAULT_WS_URL,
      fps: Number(process.env.SOLSTICE_HOST_FPS || 15),
      quality: Number(process.env.SOLSTICE_HOST_QUALITY || 58),
    };

    this.lastCaptureTime = 0;
    this.actualFps = 0;
    this.frameSample = {
      startedAt: Date.now(),
      sent: 0,
      dropped: 0,
      captureMs: 0,
    };
    this.adaptiveFps = this.config.fps;
    this.viewerCursors = new Map();
    this.fileBuffers = new Map();
    this.performanceMetrics = {
      frameTimes: [],
      lastAdjustment: Date.now(),
    };
    
    // Cache screen source to avoid repeated lookups
    this.cachedSource = null;
    this.mainDisplay = null;
    this.lastSourceRefresh = 0;
    const SOURCE_CACHE_TTL = 30000; // Refresh source every 30 seconds

    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    this.log = (msg, ...args) => {
      console.log(`[host] ${msg}`, ...args);
      this.emit('log', { message: msg, args, timestamp: Date.now() });
    };
  }

  getState() {
    return this.state;
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  async start(options = {}) {
    if (this.ws) await this.stop();
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.config = {
      ...this.config,
      wsUrl: options.wsUrl || this.config.wsUrl,
      fps: options.fps || this.config.fps,
      quality: options.quality || this.config.quality,
    };

    // Reset adaptive FPS and performance metrics
    this.adaptiveFps = this.config.fps;
    this.frameQueue = [];
    this.captureInFlight = false;
    this.processingFrame = false;
    this.frameSample = {
      startedAt: Date.now(),
      sent: 0,
      dropped: 0,
      captureMs: 0,
    };
    this.performanceMetrics.lastAdjustment = Date.now();

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
    this.shouldReconnect = false;
    this.streaming = false;
    if (this.frameInterval) clearInterval(this.frameInterval);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.frameQueue = [];
    this.captureInFlight = false;
    this.processingFrame = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    this.updateState({ ...defaultState });
  }

  async openSocket() {
    const ws = new WebSocket(this.config.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.reconnectAttempts = 0;
      this.send('announce_agent', {
        deviceName: this.state.deviceName || os.hostname(),
        os: `${os.type()} ${os.release()}`,
        region: 'local',
        capabilities: ['control', 'files', 'chat'],
      });
      this.prepareLoops();
    });

    ws.on('message', (raw) => {
      if (this.ws !== ws) return;
      try {
        const message = JSON.parse(raw.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('[host] invalid message', error);
      }
    });

    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.handleSocketFailure('Relay connection closed');
    });

    ws.on('error', (error) => {
      if (this.ws !== ws) return;
      this.handleSocketFailure(error.message);
    });
  }

  handleSocketFailure(message) {
    this.cleanupSocket();
    this.updateState({
      status: this.shouldReconnect ? 'connecting' : 'error',
      error: message,
      sessionCode: undefined,
      viewers: 0,
    });

    if (!this.shouldReconnect || this.reconnectTimer) return;
    const delay = Math.min(5000, 500 * (2 ** this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.openSocket();
    }, delay);
  }

  cleanupSocket() {
    this.streaming = false;
    if (this.frameInterval) clearInterval(this.frameInterval);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.frameInterval = null;
    this.frameTimer = null;
    this.heartbeatInterval = null;
    this.frameQueue = [];
    this.captureInFlight = false;
    this.processingFrame = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  prepareLoops() {
    if (this.frameInterval) clearInterval(this.frameInterval);
    this.frameInterval = null;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.scheduleNextFrame(0);

    this.heartbeatInterval = setInterval(() => {
      this.send('heartbeat', { 
        fps: this.actualFps || this.adaptiveFps,
        queueSize: this.frameQueue.length 
      });
    }, 10000);
  }

  scheduleNextFrame(delay) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      this.captureFrame();
    }, Math.max(0, delay));
  }

  getQuality() {
    if (this.frameQueue.length > 1) return Math.max(42, this.config.quality - 12);
    return this.config.quality;
  }

  async getFastFrame() {
    const now = Date.now();
    
    // Cache main display and source to avoid repeated lookups
    if (!this.mainDisplay || now - this.lastSourceRefresh > 30000) {
      this.mainDisplay = screen.getPrimaryDisplay();
      this.lastSourceRefresh = now;
    }
    
    const scale = Math.min(1, 960 / this.mainDisplay.size.width);
    const targetWidth = Math.floor(this.mainDisplay.size.width * scale);
    const targetHeight = Math.floor(this.mainDisplay.size.height * scale);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: targetWidth,
        height: targetHeight,
      },
    });

    this.cachedSource = sources.find(source =>
      source.display_id === this.mainDisplay.id.toString()
    ) || sources[0];
    this.lastSourceRefresh = now;

    // Use dynamic quality based on performance
    const quality = this.getQuality();
    const jpeg = this.cachedSource.thumbnail.toJPEG(quality);
    const size = this.cachedSource.thumbnail.getSize();

    return {
      buffer: jpeg,
      width: size.width,
      height: size.height,
    };
  }

  async captureFrame() {
    if (!this.streaming || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.captureInFlight) {
      this.frameSample.dropped += 1;
      this.scheduleNextFrame(Math.floor(1000 / this.adaptiveFps));
      return; // Skip frame to catch up
    }

    this.captureInFlight = true;
    const started = Date.now();

    try {
      const { buffer, width, height } = await this.getFastFrame();
      
      const captureTime = Date.now() - started;
      this.frameSample.captureMs = captureTime;
      
      const frameData = {
        data: buffer.toString('base64'),
        mime: 'image/jpeg',
        width,
        height,
        bytes: buffer.length,
        timestamp: Date.now(),
        cursors: this.getActiveCursors(),
      };

      this.frameQueue = [];
      this.frameQueue.push(frameData);
      this.processFrameQueue();

      if (captureTime > 180) {
        this.log(`Slow frame: ${captureTime}ms`);
      }

    } catch (error) {
      console.error('[host] capture error', error);
      this.log('Capture error: ' + error.message);
    } finally {
      this.captureInFlight = false;
      const elapsed = Date.now() - started;
      const targetDelay = Math.max(0, Math.floor(1000 / this.adaptiveFps) - elapsed);
      this.scheduleNextFrame(targetDelay);
    }
  }

  async processFrameQueue() {
    if (this.processingFrame || this.frameQueue.length === 0) return;
    
    this.processingFrame = true;
    
    // Process frames more aggressively - only keep the latest frame if queue backs up
    if (this.frameQueue.length > 1) {
      // Keep only the most recent frame
      const latestFrame = this.frameQueue[this.frameQueue.length - 1];
      this.frameQueue = [latestFrame];
    }
    
    while (this.frameQueue.length > 0) {
      const frame = this.frameQueue.shift();
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const sent = this.send('frame', frame);
        if (sent) this.frameSample.sent += 1;
        else this.frameSample.dropped += 1;
      }
      
      const now = Date.now();
      if (now - this.frameSample.startedAt >= 1000) {
        this.actualFps = this.frameSample.sent;
        this.updateState({
          fps: this.actualFps,
          captureMs: this.frameSample.captureMs,
          droppedFrames: this.frameSample.dropped,
        });
        this.frameSample.startedAt = now;
        this.frameSample.sent = 0;
        this.frameSample.dropped = 0;
      }
      this.lastCaptureTime = now;
    }
    
    this.processingFrame = false;
  }

  adjustFrameRate(direction) {
    const now = Date.now();
    if (now - this.performanceMetrics.lastAdjustment < 2000) return; // Only adjust every 2 seconds
    
    if (direction === 'decrease') {
      this.adaptiveFps = Math.max(5, this.adaptiveFps - 5);
    } else {
      this.adaptiveFps = Math.min(this.config.fps, this.adaptiveFps + 5);
    }
    
    this.performanceMetrics.lastAdjustment = now;
    
    // Update interval
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      const newInterval = Math.max(1, Math.floor(1000 / this.adaptiveFps));
      this.frameInterval = setInterval(() => this.captureFrame(), newInterval);
    }
    
    this.log(`Adaptive FPS adjustment: ${this.adaptiveFps}fps`);
  }

  getActiveCursors() {
    const now = Date.now();
    const active = [];
    for (const [viewerId, cursor] of this.viewerCursors.entries()) {
      if (now - cursor.timestamp < 1000) {
        active.push({
          viewerId,
          x: cursor.x,
          y: cursor.y,
        });
      } else {
        this.viewerCursors.delete(viewerId);
      }
    }
    return active;
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
        this.captureFrame();
        break;

      case 'viewer_left':
        this.updateState({ viewers: message.payload.totalViewers });
        if (message.payload.totalViewers <= 0) {
          this.streaming = false;
        }
        break;

      case 'input_event':
        this.applyInput(message.payload);
        if (message.payload.kind === 'mouse_move' && message.payload.viewerId) {
          this.viewerCursors.set(message.payload.viewerId, {
            x: message.payload.x,
            y: message.payload.y,
            viewerId: message.payload.viewerId,
            timestamp: Date.now(),
          });
        }
        break;

      case 'file_offer':
        this.prepareFileBuffer(message.payload);
        break;

      case 'file_chunk':
        this.handleFileChunk(message.payload);
        break;
    }
  }

  async applyInput(payload) {
    try {
      const display = screen.getPrimaryDisplay();
      await applyInputEvent(payload, display.bounds);
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

    const complete =
      buffer.chunks.filter((c) => typeof c === 'string').length >= payload.total;

    if (payload.done || complete) {
      const merged = buffer.chunks.join('');
      const binary = Buffer.from(merged, 'base64');
      const fileName = `${Date.now()}-${buffer.name}`;
      const target = path.join(DOWNLOAD_DIR, fileName);
      fs.writeFileSync(target, binary);
      this.fileBuffers.delete(payload.fileId);
    }
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    
    if (type === 'frame' && this.ws.bufferedAmount > 384 * 1024) {
      this.log('WebSocket backlog, skipping frame');
      return false;
    }
    
    this.ws.send(JSON.stringify({ type, payload }));
    return true;
  }
}

module.exports = { HostController };
