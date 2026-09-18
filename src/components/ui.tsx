import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../theme';
import type { SyncState } from '../domain/types';
import { t } from '../i18n';

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const content = scroll
    ? <ScrollView contentContainerStyle={[styles.screenContent, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[styles.screenContent, styles.flex, style]}>{children}</View>;
  return <SafeAreaView edges={['left', 'right']} style={styles.safe}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{content}</KeyboardAvoidingView></SafeAreaView>;
}

export function AppButton({ title, variant = 'primary', loading, style, ...props }: PressableProps & { title: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean; style?: ViewStyle }) {
  return (
    <Pressable accessibilityRole="button" disabled={loading || props.disabled} style={({ pressed }) => [styles.button, styles[`button_${variant}`], pressed && styles.pressed, (loading || props.disabled) && styles.disabled, style]} {...props}>
      {loading ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? colors.white : colors.primary} /> : <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{title}</Text>}
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label: string; hint?: string }>(function Field({ label, hint, ...props }, ref) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput ref={ref} placeholderTextColor={colors.muted} style={[styles.input, props.multiline && styles.multiline]} {...props} />{hint ? <Text style={styles.hint}>{hint}</Text> : null}</View>;
});

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

export function StatusPill({ state }: { state: SyncState }) {
  return <View style={[styles.status, styles[`status_${state}`]]}><Text style={styles.statusText}>{t.sync[state]}</Text></View>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'error' | 'success' }) {
  return <View style={[styles.notice, styles[`notice_${tone}`]]}><Text style={styles.noticeText}>{children}</Text></View>;
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <View style={styles.empty}><Text style={styles.emptyIcon}>🍄</Text><Text style={styles.heading}>{title}</Text><Text style={styles.mutedCenter}>{message}</Text>{action}</View>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <View style={styles.sectionHeader}><Text style={styles.heading}>{children}</Text>{action}</View>;
}

export const commonStyles = StyleSheet.create({
  title: { color: colors.text, fontSize: typography.title, fontWeight: '800' },
  heading: { color: colors.text, fontSize: typography.heading, fontWeight: '700' },
  body: { color: colors.text, fontSize: typography.body, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: typography.small, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gap: { gap: spacing.md },
  separator: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  screenContent: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  button: { minHeight: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  button_primary: { backgroundColor: colors.primary }, button_secondary: { backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.secondary },
  button_ghost: { backgroundColor: 'transparent' }, button_danger: { backgroundColor: colors.danger },
  buttonText: { fontSize: typography.body, fontWeight: '700' }, buttonText_primary: { color: colors.white }, buttonText_secondary: { color: colors.primary },
  buttonText_ghost: { color: colors.primary }, buttonText_danger: { color: colors.white }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.45 },
  field: { gap: spacing.xs }, label: { color: colors.text, fontSize: typography.body, fontWeight: '600' }, hint: { color: colors.muted, fontSize: typography.small },
  input: { minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, color: colors.text, fontSize: typography.body },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  chip: { minHeight: 40, borderRadius: radii.round, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.text, fontSize: typography.small, fontWeight: '600' }, chipTextSelected: { color: colors.white },
  status: { alignSelf: 'flex-start', borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  status_local: { backgroundColor: '#ECE7DB' }, status_pending: { backgroundColor: '#F4E1BB' }, status_synced: { backgroundColor: '#D9EAD9' }, status_attention: { backgroundColor: '#F4D0CC' }, statusText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  notice: { padding: spacing.md, borderRadius: radii.md, borderLeftWidth: 4 }, notice_info: { backgroundColor: '#DFEAF0', borderLeftColor: colors.info }, notice_warning: { backgroundColor: '#F5E8CD', borderLeftColor: colors.warning }, notice_error: { backgroundColor: '#F4D8D5', borderLeftColor: colors.danger }, notice_success: { backgroundColor: '#DCECDD', borderLeftColor: colors.secondary }, noticeText: { color: colors.text, fontSize: typography.small, lineHeight: 19 },
  empty: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl }, emptyIcon: { fontSize: 48 }, heading: { color: colors.text, fontSize: typography.heading, fontWeight: '700' }, mutedCenter: { color: colors.muted, textAlign: 'center', fontSize: typography.body, lineHeight: 23 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
});
