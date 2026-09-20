import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';
import type { Settings } from '../api';

/**
 * Bluetooth pairing with the M2. This is the one screen that only runs once
 * per session (the reader stays connected until the app is killed or the
 * M2 is powered off) — CollectScreen assumes connectedReader is already set
 * by the time it mounts.
 */
export default function PairScreen({ settings, onConnected }: { settings: Settings; onConnected: () => void }) {
  const { discoverReaders, connectBluetoothReader, discoveredReaders, connectedReader } = useStripeTerminal();
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connectedReader) onConnected();
  }, [connectedReader]);

  const scan = async () => {
    setError(null);
    setScanning(true);
    const { error: err } = await discoverReaders({ discoveryMethod: 'bluetoothScan' });
    if (err) setError(err.message);
    setScanning(false);
  };

  useEffect(() => { scan(); }, []);

  const connect = async (readerSerial: string) => {
    const reader = discoveredReaders.find(r => r.serialNumber === readerSerial);
    if (!reader) return;
    setConnectingId(readerSerial);
    setError(null);
    const { reader: connected, error: err } = await connectBluetoothReader({
      reader,
      locationId: settings.locationId,
    });
    setConnectingId(null);
    if (err) setError(err.message);
    else if (connected) onConnected();
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Pair the M2</Text>
      <Text style={styles.help}>
        Turn the reader on and hold the phone close. Discovered readers show up below —
        tap one to connect.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={discoveredReaders}
        keyExtractor={r => r.serialNumber}
        style={{ width: '100%' }}
        ListEmptyComponent={
          scanning
            ? <ActivityIndicator style={{ marginTop: 24 }} />
            : <Text style={styles.help}>No readers found yet.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.readerRow}
            disabled={connectingId !== null}
            onPress={() => connect(item.serialNumber)}
          >
            <Text style={styles.readerLabel}>{item.deviceType} · {item.serialNumber}</Text>
            {connectingId === item.serialNumber
              ? <ActivityIndicator />
              : <Text style={styles.connectText}>Connect</Text>}
          </Pressable>
        )}
      />

      <Pressable style={styles.rescan} onPress={scan} disabled={scanning}>
        <Text style={styles.rescanText}>{scanning ? 'Scanning…' : 'Scan again'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, paddingTop: 64, alignItems: 'center', gap: 16 },
  title: { fontSize: 24, fontWeight: '800' },
  help: { color: '#666', textAlign: 'center' },
  error: { color: '#b3261e', textAlign: 'center' },
  readerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderWidth: 1, borderColor: '#ddd', borderRadius: 12, marginBottom: 10,
  },
  readerLabel: { fontSize: 15, fontWeight: '600' },
  connectText: { color: '#0a7', fontWeight: '700' },
  rescan: { padding: 14 },
  rescanText: { color: '#333', fontWeight: '600' },
});
