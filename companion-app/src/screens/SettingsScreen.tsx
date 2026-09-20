import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import type { Settings } from '../api';

/**
 * Four fields, entered once per phone: which server to talk to, which booth
 * this phone is standing next to, the shared key that keeps random phones
 * from polling someone else's payments, and the Stripe Location the M2 was
 * registered under (booth.config.json's payments.stripe.locationId).
 */
export default function SettingsScreen({ initial, onSaved }: { initial: Settings; onSaved: (s: Settings) => void }) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof Settings) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>HoloBooth Reader</Text>
      <Text style={styles.help}>Set these once per phone, per booth.</Text>

      <Field label="Server URL" value={form.serverUrl} onChangeText={set('serverUrl')}
        placeholder="http://192.168.1.50:4242" keyboardType="url" />
      <Field label="Booth ID" value={form.boothId} onChangeText={set('boothId')}
        placeholder="BOOTH-001" />
      <Field label="Stripe Location ID" value={form.locationId} onChangeText={set('locationId')}
        placeholder="tml_..." />
      <Field label="App key" value={form.appKey} onChangeText={set('appKey')}
        placeholder="matches COMPANION_APP_KEY on the server" secure />

      <Pressable style={styles.btn} onPress={() => onSaved(form)}>
        <Text style={styles.btnText}>Save & continue</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'url'; secure?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={props.keyboardType === 'url' ? 'url' : 'default'}
        secureTextEntry={props.secure}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 64, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' },
  help: { color: '#666', marginBottom: 8 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#333' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, fontSize: 16 },
  btn: { marginTop: 12, backgroundColor: '#12141a', borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
