import type { ConditionsSnapshot } from './types';

export function visitConditionsText(snapshot?: ConditionsSnapshot) {
  return snapshot ? `Pogoji ob obisku: ${snapshot.score} / 100 · ${snapshot.label}` : undefined;
}

/** Conditions snapshots remain device-local; never put them in a cloud/community outbox. */
export function withoutLocalConditions(payload: object): object {
  const { conditionsSnapshot: _snapshot, conditionsSnapshotJson: _json, ...rest } = payload as Record<string, unknown>;
  return rest;
}
