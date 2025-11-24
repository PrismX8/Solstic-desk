import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostState } from '../types/desktop';

const initialState: HostState = {
  status: 'idle',
  viewers: 0,
};

export const useHostSession = () => {
  const hostApi = window.solsticeDesktop?.host;
  const [state, setState] = useState<HostState>(initialState);

  useEffect(() => {
    if (!hostApi) return undefined;
    let mounted = true;
    hostApi.getState().then((current) => {
      if (mounted && current) {
        setState(current);
      }
    });
    const unsubscribe = hostApi.onState((next) => setState(next));
    const unsubscribeLogs = hostApi.onLog?.((logData) => {
      console.log(`[host] ${logData.message}`, ...logData.args);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeLogs?.();
    };
  }, [hostApi]);

  const start = useCallback(
    async (deviceName?: string) => {
      if (!hostApi) return;
      const next = await hostApi.start({ deviceName });
      setState(next);
    },
    [hostApi],
  );

  const stop = useCallback(async () => {
    if (!hostApi) return;
    const next = await hostApi.stop();
    setState(next);
  }, [hostApi]);

  return useMemo(
    () => ({
      available: Boolean(hostApi),
      state,
      start,
      stop,
    }),
    [hostApi, start, state, stop],
  );
};

