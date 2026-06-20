export interface HostState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  sessionCode?: string;
  viewers: number;
  error?: string;
  deviceName?: string;
  fps?: number;
  captureMs?: number;
  droppedFrames?: number;
}

export interface CaptureSource {
  id: string;
  name: string;
  displayId?: string;
  thumbnail: string;
}

export interface HostApi {
  start: (options?: { deviceName?: string }) => Promise<HostState>;
  stop: () => Promise<HostState>;
  getState: () => Promise<HostState>;
  applyInput: (payload: Record<string, unknown>) => void;
  listCaptureSources: () => Promise<CaptureSource[]>;
  setCaptureSource: (sourceId: string) => Promise<void>;
  onState: (callback: (state: HostState) => void) => () => void;
  onLog?: (callback: (logData: { message: string; args: unknown[]; timestamp: number }) => void) => () => void;
}

export type UpdateStatus = {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  error?: string;
  percent?: number;
};

export interface UpdateApi {
  checkForUpdates: () => Promise<unknown>;
  getStatus: () => Promise<UpdateStatus | null>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  onUpdateProgress: (
    callback: (progress: { percent: number; transferred: number; total: number }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    solsticeDesktop?: {
      appVersion: string;
      platform: NodeJS.Platform;
      versions: Record<string, string>;
      host?: HostApi;
      updates?: UpdateApi;
    };
  }
}

export {};

