import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Settings } from './api';

const KEY = 'holobooth-companion-settings';

const DEFAULTS: Settings = { serverUrl: 'http://192.168.1.50:4242', boothId: 'BOOTH-001', appKey: '', locationId: '' };

/** Settings persisted on-device — same three fields on every screen that needs them. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(raw => { if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) }); })
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback((next: Settings) => {
    setSettings(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  return { settings, save, loaded };
}
