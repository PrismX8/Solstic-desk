export type RemoteStatus = 'idle' | 'connecting' | 'connected' | 'error';

export type ChatSender = 'agent' | 'viewer' | 'system';

export interface RemoteCursor {
  viewerId: string;
  x: number;
  y: number;
}

export interface RemoteFrame {
  src: string;
  width: number;
  height: number;
  bytes: number;
  timestamp: number;
  cursors?: RemoteCursor[];
}

export interface ChatMessage {
  id: string;
  sender: ChatSender;
  nickname: string;
  message: string;
  timestamp: number;
}

export interface ActivityEntry {
  id: string;
  label: string;
  detail?: string;
  timestamp: number;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

export interface TransferItem {
  id: string;
  name: string;
  size: number;
  mime?: string;
  direction: 'inbound' | 'outbound';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;
}

export interface ConnectOptions {
  viewOnly: boolean;
  clipboardSync: boolean;
  fileTransfer: 'full' | 'download' | 'upload';
  quality: 'balanced' | 'performance' | 'lossless';
}

export interface RemoteSessionState {
  status: RemoteStatus;
  code?: string;
  nickname?: string;
  deviceName?: string;
  os?: string;
  region?: string;
  viewers: number;
  fps: number;
  latency?: number;
  frame?: RemoteFrame;
  error?: string;
  chat: ChatMessage[];
  activity: ActivityEntry[];
  transfers: TransferItem[];
  connectOptions: ConnectOptions;
}

export interface RemoteSessionApi extends RemoteSessionState {
  connect: (code: string, nickname: string, options?: Partial<ConnectOptions>) => void;
  disconnect: () => void;
  sendInput: (payload: Record<string, unknown>) => void;
  sendChat: (message: string) => void;
  sendFile: (file: File) => Promise<void>;
  resetError: () => void;
}

