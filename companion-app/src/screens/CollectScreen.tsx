import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';
import { fetchPendingSale, captureSale } from '../api';
import type { Settings, PendingSale } from '../api';

type Phase = 'idle' | 'collecting' | 'confirming' | 'capturing' | 'done' | 'error';

const POLL_MS = 2000;

/**
 * The actual loop: poll HoloBooth's backend for the one sale this booth is
 * waiting to collect, then drive the connected M2 through the SDK to take
 * the tap. HoloBooth itself is polling the same session on its own side
 * (see payments.js's StripeTerminalProvider) — this screen and the kiosk
 * never talk to each other directly, only through the server.
 */
export default function CollectScreen({ settings }: { settings: Settings }) {
  const { connectedReader, collectPaymentMethod, confirmPaymentIntent, retrievePaymentIntent, cancelCollectPaymentMethod } =
    useStripeTerminal();
  const [phase, setPhase] = useState<Phase>('idle');
  const [sale, setSale] = useState<PendingSale>(null);
  const [message, setMessage] = useState('Waiting for a sale from HoloBooth…');
  const collectingRef = useRef(false); // guards against double-handling the same poll tick

  useEffect(() => {
    const timer = setInterval(async () => {
      if (phase !== 'idle' || collectingRef.current) return;
      try {
        const pending = await fetchPendingSale(settings);
        if (pending) handleSale(pending);
      } catch (e: any) {
        setMessage(`Can't reach the server: ${e.message}`);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, settings]);

  const handleSale = async (pending: NonNullable<PendingSale>) => {
    collectingRef.current = true;
    setSale(pending);
    setPhase('collecting');
    setMessage('Tap, insert or swipe the card');
    try {
      const { paymentIntent: retrieved, error: retrieveErr } = await retrievePaymentIntent(pending.clientSecret);
      if (retrieveErr || !retrieved) throw new Error(retrieveErr?.message || 'Could not load the payment');

      const { paymentIntent: collected, error: collectErr } = await collectPaymentMethod({ paymentIntent: retrieved });
      if (collectErr || !collected) throw new Error(collectErr?.message || 'Card declined');

      setPhase('confirming');
      setMessage('Confirming…');
      const { paymentIntent: confirmed, error: confirmErr } = await confirmPaymentIntent({ paymentIntent: collected });
      if (confirmErr || !confirmed) throw new Error(confirmErr?.message || 'Could not confirm the payment');

      setPhase('capturing');
      await captureSale(settings, pending.id);

      setPhase('done');
      setMessage('Approved — the booth is printing.');
    } catch (e: any) {
      setPhase('error');
      setMessage(e.message || 'Something went wrong');
    } finally {
      collectingRef.current = false;
      setTimeout(() => { setPhase('idle'); setSale(null); setMessage('Waiting for a sale from HoloBooth…'); }, 2500);
    }
  };

  const cancel = async () => {
    await cancelCollectPaymentMethod().catch(() => {});
    collectingRef.current = false;
    setPhase('idle');
    setSale(null);
    setMessage('Cancelled — waiting for a sale from HoloBooth…');
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.readerStatus}>
        Reader: {connectedReader ? connectedReader.serialNumber : 'not connected'}
      </Text>

      {sale ? <Text style={styles.amount}>{(sale.amount / 100).toFixed(2)} {sale.currency.toUpperCase()}</Text> : null}

      <Text style={styles.message}>{message}</Text>

      {(phase === 'collecting' || phase === 'confirming' || phase === 'capturing') && (
        <>
          <ActivityIndicator size="large" style={{ marginTop: 24 }} />
          {phase === 'collecting' && (
            <Pressable style={styles.cancelBtn} onPress={cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  readerStatus: { position: 'absolute', top: 56, color: '#888', fontSize: 12 },
  amount: { fontSize: 48, fontWeight: '800' },
  message: { fontSize: 18, color: '#333', textAlign: 'center' },
  cancelBtn: { marginTop: 24, padding: 14 },
  cancelText: { color: '#b3261e', fontWeight: '700' },
});
