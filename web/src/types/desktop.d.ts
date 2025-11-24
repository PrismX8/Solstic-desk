export interface HostState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  sessionCode?: string;
  viewers: number;
  error?: string;
  deviceName?: string;
}

export interface HostApi {
  start: (options?: { deviceName?: string }) => Promise<HostState>;
  stop: () => Promise<HostState>;
  getState: () => Promise<HostState>;
  onState: (callback: (state: HostState) => void) => () => void;
  onLog?: (callback: (logData: { message: string; args: unknown[]; timestamp: number }) => void) => () => void;
}

declare global {
  interface Window {
    solsticeDesktop?: {
      platform: NodeJS.Platform;
      versions: Record<string, string>;
      host?: HostApi;
    };
  }
}

export {};

