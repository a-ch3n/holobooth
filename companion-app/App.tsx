import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native';
import { useSettings } from './src/useSettings';
import { fetchConnectionToken } from './src/api';
import SettingsScreen from './src/screens/SettingsScreen';
import PairScreen from './src/screens/PairScreen';
import CollectScreen from './src/screens/CollectScreen';

type Step = 'settings' | 'pair' | 'collect';

export default function App() {
  const { settings, save, loaded } = useSettings();
  const [step, setStep] = useState<Step>('settings');

  if (!loaded) return null;

  return (
    <StripeTerminalProvider logLevel="verbose" tokenProvider={() => fetchConnectionToken(settings)}>
      <SafeAreaView style={styles.root}>
        {step === 'settings' && (
          <SettingsScreen
            initial={settings}
            onSaved={next => { save(next); setStep('pair'); }}
          />
        )}
        {step === 'pair' && (
          <PairScreen settings={settings} onConnected={() => setStep('collect')} />
        )}
        {step === 'collect' && <CollectScreen settings={settings} />}
      </SafeAreaView>
    </StripeTerminalProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
});
