const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');
const { screen, desktopCapturer } = require('electron');
const { applyInputEvent } = require('./input');

const DEFAULT_WS_URL = process.env.SOLSTICE_WS_URL || 'wss://railways.up.railway.app/ws';
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
    this.heartbeatInterval = null;
    this.streaming = false;
    this.processingFrame = false;
    this.frameQueue = [];
    this.config = {
      wsUrl: DEFAULT_WS_URL,
      fps: Number(process.env.SOLSTICE_HOST_FPS || 60),
      quality: Number(process.env.SOLSTICE_HOST_QUALITY || 70),
    };

    this.lastCaptureTime = 0;
    this.actualFps = 0;
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
    this.config = {
      ...this.config,
      wsUrl: options.wsUrl || this.config.wsUrl,
      fps: options.fps || this.config.fps,
      quality: options.quality || this.config.quality,
    };

    // Reset adaptive FPS and performance metrics
    this.adaptiveFps = this.config.fps;
    this.frameQueue = [];
    this.processingFrame = false;
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
    this.streaming = false;
    if (this.frameInterval) clearInterval(this.frameInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.frameQueue = [];
    this.processingFrame = false;

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
    if (this.frameInterval) clearInterval(this.frameInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.frameQueue = [];
    this.processingFrame = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  prepareLoops() {
    const interval = Math.max(1, Math.floor(1000 / this.adaptiveFps));
    
    // Clear any existing interval
    if (this.frameInterval) clearInterval(this.frameInterval);
    
    this.frameInterval = setInterval(() => {
      this.captureFrame();
    }, interval);

    this.heartbeatInterval = setInterval(() => {
      this.send('heartbeat', { 
        fps: this.actualFps || this.adaptiveFps,
        queueSize: this.frameQueue.length 
      });
    }, 10000);
  }

  getQuality() {
    if (this.frameQueue.length > 2) return 50; // Lower quality when backed up
    if (this.frameQueue.length > 0) return 65; // Medium quality
    return 70; // Balanced quality when caught up (reduced from 80)
  }

  async getFastFrame() {
    const now = Date.now();
    
    // Cache main display and source to avoid repeated lookups
    if (!this.mainDisplay || now - this.lastSourceRefresh > 30000) {
      this.mainDisplay = screen.getPrimaryDisplay();
      this.lastSourceRefresh = now;
    }
    
    // Use lower resolution for better performance (50% instead of 70%)
    const targetWidth = Math.floor(this.mainDisplay.size.width * 0.5);
    const targetHeight = Math.floor(this.mainDisplay.size.height * 0.5);
    
    // Only refresh source if cache is stale or doesn't exist
    if (!this.cachedSource || now - this.lastSourceRefresh > 30000) {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: targetWidth,
          height: targetHeight,
        }
      });

      this.cachedSource = sources.find(source => 
        source.display_id === this.mainDisplay.id.toString()
      ) || sources[0];
      this.lastSourceRefresh = now;
    }

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
    if (!this.streaming) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    // More aggressive frame dropping when backed up
    if (this.frameQueue.length > 1) {
      this.adjustFrameRate('decrease');
      return; // Skip frame to catch up
    }

    // Adaptive frame skipping
    if (this.frameQueue.length === 0 && this.adaptiveFps < this.config.fps) {
      this.adjustFrameRate('increase');
    }

    try {
      const start = Date.now();
      const { buffer, width, height } = await this.getFastFrame();
      
      // Skip if capture took too long (indicates system is overloaded)
      const captureTime = Date.now() - start;
      if (captureTime > 50) {
        return; // Skip this frame
      }
      
      const frameData = {
        data: buffer.toString('base64'),
        mime: 'image/jpeg',
        width,
        height,
        bytes: buffer.length,
        timestamp: Date.now(),
        cursors: this.getActiveCursors(),
      };

      // Add to queue and process immediately
      this.frameQueue.push(frameData);
      this.processFrameQueue();

      if (captureTime > 16) {
        this.log(`Slow frame: ${captureTime}ms`);
      }

    } catch (error) {
      console.error('[host] capture error', error);
      this.log('Capture error: ' + error.message);
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
        this.send('frame', frame);
      }
      
      // Calculate actual FPS
      const now = Date.now();
      if (this.lastCaptureTime) {
        const delta = now - this.lastCaptureTime;
        this.actualFps = Math.round(1000 / delta);
      }
      this.lastCaptureTime = now;
      
      // Remove delay - process immediately for better performance
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    // Check if WebSocket is backing up
    if (this.ws.bufferedAmount > 1024 * 1024) { // 1MB backlog
      this.log('WebSocket backlog, skipping frame');
      return;
    }
    
    this.ws.send(JSON.stringify({ type, payload }));
  }
}

module.exports = { HostController };
