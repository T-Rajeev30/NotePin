import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useLive } from './live';
import type { Device, Stats } from './types';

// Fetches once, then again whenever the server pushes a change (device online/offline, recording end...).
export function useRemote<T>(url: string, pick: (r: never) => T, initial: T) {
  const { version } = useLive();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(pick(await api.get<never>(url))); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useEffect(() => { void load(); }, [load, version]);
  return { data, loading, error, reload: load, setData };
}

export const useDevices = () => useRemote<Device[]>('/api/devices', (r: { devices: Device[] }) => r.devices as never, []);
export const useStats = () => useRemote<Stats | null>('/api/stats', (r: Stats) => r as never, null);