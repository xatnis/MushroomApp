import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  FindItem,
  FindPhoto,
  FindRecord,
  Hotspot,
  HotspotWithHistory,
  ProfileSummary,
  RecordingDraft,
  SyncState,
  WeatherSnapshot,
} from '../domain/types';

const DATABASE_VERSION = 2;
export const LOCAL_PROFILE_ID = 'local:device';

type HotspotRow = Omit<Hotspot, 'accuracyM' | 'serverRevision' | 'locationName' | 'locationAdmin1' | 'locationAdmin2' | 'locationCountry'> & {
  accuracyM: number | null;
  serverRevision: number | null;
  locationName: string | null;
  locationAdmin1: string | null;
  locationAdmin2: string | null;
  locationCountry: string | null;
};

type FindRow = Omit<FindRecord, 'items' | 'photos' | 'weather' | 'observationAccuracyM' | 'serverRevision' | 'shareExactCommunityLocation'> & {
  observationAccuracyM: number | null;
  weatherJson: string;
  serverRevision: number | null;
  shareExactCommunityLocation: number;
};

type ItemRow = Omit<FindItem, 'quantity' | 'searchedFor'> & { quantity: number | null; searchedFor: number };
type PhotoRow = Omit<FindPhoto, 'width' | 'height'> & { width: number | null; height: number | null };

const nowIso = () => new Date().toISOString();
const nullable = <T>(value: T | undefined): T | null => value ?? null;

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((version?.user_version ?? 0) >= DATABASE_VERSION) return;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS local_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('local','cloud')),
      accountId TEXT,
      username TEXT,
      displayName TEXT,
      avatarUrl TEXT,
      createdAt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      attaching INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_account ON local_profiles(accountId) WHERE accountId IS NOT NULL;
    CREATE TABLE IF NOT EXISTS hotspots (
      id TEXT PRIMARY KEY NOT NULL,
      profileId TEXT NOT NULL REFERENCES local_profiles(id),
      latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
      longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
      title TEXT,
      notes TEXT,
      locationSource TEXT NOT NULL CHECK(locationSource IN ('gps','manual','imported')),
      accuracyM REAL,
      locationSharing TEXT NOT NULL CHECK(locationSharing IN ('private','friends')),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncState TEXT NOT NULL CHECK(syncState IN ('local','pending','synced','attention')),
      serverRevision INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_hotspots_profile ON hotspots(profileId, deletedAt, updatedAt);
    CREATE TABLE IF NOT EXISTS finds (
      id TEXT PRIMARY KEY NOT NULL,
      hotspotId TEXT NOT NULL REFERENCES hotspots(id),
      profileId TEXT NOT NULL REFERENCES local_profiles(id),
      observedAt TEXT NOT NULL,
      observationLatitude REAL NOT NULL CHECK(observationLatitude BETWEEN -90 AND 90),
      observationLongitude REAL NOT NULL CHECK(observationLongitude BETWEEN -180 AND 180),
      observationAccuracyM REAL,
      outcome TEXT NOT NULL CHECK(outcome IN ('found','nothing','unspecified')),
      notes TEXT,
      visibility TEXT NOT NULL CHECK(visibility IN ('private','friends','community')),
      shareExactCommunityLocation INTEGER NOT NULL DEFAULT 0,
      weatherJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncState TEXT NOT NULL CHECK(syncState IN ('local','pending','synced','attention')),
      serverRevision INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_finds_profile_date ON finds(profileId, deletedAt, observedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_finds_hotspot ON finds(hotspotId, deletedAt, observedAt DESC);
    CREATE TABLE IF NOT EXISTS find_items (
      id TEXT PRIMARY KEY NOT NULL,
      findId TEXT NOT NULL REFERENCES finds(id),
      speciesId TEXT,
      customName TEXT,
      quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
      unit TEXT CHECK(unit IS NULL OR unit IN ('pieces','g','kg')),
      searchedFor INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      syncState TEXT NOT NULL CHECK(syncState IN ('local','pending','synced','attention'))
    );
    CREATE INDEX IF NOT EXISTS idx_items_find ON find_items(findId, deletedAt);
    CREATE INDEX IF NOT EXISTS idx_items_species ON find_items(speciesId, deletedAt);
    CREATE TABLE IF NOT EXISTS find_photos (
      id TEXT PRIMARY KEY NOT NULL,
      findId TEXT NOT NULL REFERENCES finds(id),
      localUri TEXT NOT NULL,
      storagePath TEXT,
      width INTEGER,
      height INTEGER,
      uploadState TEXT NOT NULL CHECK(uploadState IN ('local','pending','uploaded','failed')),
      createdAt TEXT NOT NULL,
      deletedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_photos_find ON find_photos(findId, deletedAt);
    CREATE TABLE IF NOT EXISTS outbox (
      operationId TEXT PRIMARY KEY NOT NULL,
      accountId TEXT NOT NULL,
      entity TEXT NOT NULL,
      entityId TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('upsert','delete','upload','delete_file')),
      payload TEXT NOT NULL,
      retryCount INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','failed','done')),
      lastError TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_ready ON outbox(accountId, state, nextAttemptAt, createdAt);
    CREATE TABLE IF NOT EXISTS drafts (
      profileId TEXT PRIMARY KEY NOT NULL REFERENCES local_profiles(id),
      payload TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY NOT NULL,
      profileId TEXT NOT NULL,
      entity TEXT NOT NULL,
      entityId TEXT NOT NULL,
      localPayload TEXT NOT NULL,
      cloudPayload TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      resolvedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS weather_cache (
      cacheKey TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      fetchedAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      profileId TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(profileId, key)
    );
  `);
  if ((version?.user_version ?? 0) < 2) {
    const columns = new Set((await db.getAllAsync<{ name: string }>('PRAGMA table_info(hotspots)')).map((column) => column.name));
    for (const column of ['locationName', 'locationAdmin1', 'locationAdmin2', 'locationCountry']) {
      if (!columns.has(column)) await db.execAsync(`ALTER TABLE hotspots ADD COLUMN ${column} TEXT`);
    }
  }
  const createdAt = nowIso();
  await db.runAsync(
    `INSERT OR IGNORE INTO local_profiles (id, mode, createdAt, active) VALUES (?, 'local', ?, 1)`,
    LOCAL_PROFILE_ID,
    createdAt,
  );
  await db.runAsync(`UPDATE local_profiles SET active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE NOT EXISTS (SELECT 1 FROM local_profiles WHERE active = 1)`, LOCAL_PROFILE_ID);
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

function mapHotspot(row: HotspotRow): Hotspot {
  return {
    ...row,
    accuracyM: row.accuracyM ?? undefined,
    serverRevision: row.serverRevision ?? undefined,
    locationName: row.locationName ?? undefined,
    locationAdmin1: row.locationAdmin1 ?? undefined,
    locationAdmin2: row.locationAdmin2 ?? undefined,
    locationCountry: row.locationCountry ?? undefined,
  };
}

function mapFind(row: FindRow, items: ItemRow[], photos: PhotoRow[]): FindRecord {
  return {
    ...row,
    observationAccuracyM: row.observationAccuracyM ?? undefined,
    shareExactCommunityLocation: Boolean(row.shareExactCommunityLocation),
    weather: JSON.parse(row.weatherJson) as WeatherSnapshot,
    serverRevision: row.serverRevision ?? undefined,
    items: items.map((item) => ({ ...item, quantity: item.quantity ?? undefined, searchedFor: Boolean(item.searchedFor) })),
    photos: photos.map((photo) => ({ ...photo, width: photo.width ?? undefined, height: photo.height ?? undefined })),
  };
}

export class DiaryRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  get database(): SQLiteDatabase { return this.db; }

  async getActiveProfile(): Promise<ProfileSummary> {
    const row = await this.db.getFirstAsync<ProfileSummary>(
      `SELECT id, mode, accountId, username, displayName, avatarUrl, createdAt FROM local_profiles WHERE active = 1 LIMIT 1`,
    );
    if (row) return row;
    await this.db.runAsync(`UPDATE local_profiles SET active = 1 WHERE id = ?`, LOCAL_PROFILE_ID);
    return { id: LOCAL_PROFILE_ID, mode: 'local', createdAt: nowIso() };
  }

  async setActiveProfile(profileId: string): Promise<void> {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(`UPDATE local_profiles SET active = 0`);
      await tx.runAsync(`UPDATE local_profiles SET active = 1 WHERE id = ?`, profileId);
    });
  }

  async ensureCloudProfile(accountId: string, username?: string, displayName?: string): Promise<ProfileSummary> {
    const existing = await this.db.getFirstAsync<ProfileSummary>(
      `SELECT id, mode, accountId, username, displayName, avatarUrl, createdAt FROM local_profiles WHERE accountId = ?`,
      accountId,
    );
    if (existing) {
      await this.db.runAsync(`UPDATE local_profiles SET username = COALESCE(?, username), displayName = COALESCE(?, displayName) WHERE id = ?`, nullable(username), nullable(displayName), existing.id);
      return { ...existing, username: username ?? existing.username, displayName: displayName ?? existing.displayName };
    }
    const profile: ProfileSummary = { id: `cloud:${accountId}`, mode: 'cloud', accountId, username, displayName, createdAt: nowIso() };
    await this.db.runAsync(
      `INSERT INTO local_profiles (id, mode, accountId, username, displayName, createdAt, active) VALUES (?, 'cloud', ?, ?, ?, ?, 0)`,
      profile.id, accountId, nullable(username), nullable(displayName), profile.createdAt,
    );
    return profile;
  }

  async updateProfile(profileId: string, username: string | undefined, displayName: string | undefined): Promise<void> {
    await this.db.runAsync(`UPDATE local_profiles SET username=?,displayName=? WHERE id=?`, nullable(username), nullable(displayName), profileId);
  }

  async listHotspots(profileId: string): Promise<Hotspot[]> {
    const rows = await this.db.getAllAsync<HotspotRow>(`SELECT * FROM hotspots WHERE profileId = ? AND deletedAt IS NULL ORDER BY updatedAt DESC`, profileId);
    return rows.map(mapHotspot);
  }

  async getHotspot(profileId: string, id: string): Promise<HotspotWithHistory | undefined> {
    const row = await this.db.getFirstAsync<HotspotRow>(`SELECT * FROM hotspots WHERE id = ? AND profileId = ? AND deletedAt IS NULL`, id, profileId);
    if (!row) return undefined;
    const finds = await this.listFinds(profileId, { hotspotId: id });
    return { ...mapHotspot(row), finds };
  }

  async listFinds(profileId: string, filters?: { hotspotId?: string; speciesId?: string; from?: string; to?: string }): Promise<FindRecord[]> {
    const conditions = [`f.profileId = ?`, `f.deletedAt IS NULL`];
    const params: Array<string> = [profileId];
    if (filters?.hotspotId) { conditions.push(`f.hotspotId = ?`); params.push(filters.hotspotId); }
    if (filters?.from) { conditions.push(`f.observedAt >= ?`); params.push(filters.from); }
    if (filters?.to) { conditions.push(`f.observedAt <= ?`); params.push(filters.to); }
    if (filters?.speciesId) {
      conditions.push(`EXISTS (SELECT 1 FROM find_items fi WHERE fi.findId = f.id AND fi.speciesId = ? AND fi.deletedAt IS NULL)`);
      params.push(filters.speciesId);
    }
    const rows = await this.db.getAllAsync<FindRow>(`SELECT f.* FROM finds f WHERE ${conditions.join(' AND ')} ORDER BY f.observedAt DESC`, params);
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const items = await this.db.getAllAsync<ItemRow>(`SELECT * FROM find_items WHERE findId IN (${placeholders}) AND deletedAt IS NULL ORDER BY createdAt`, ids);
    const photos = await this.db.getAllAsync<PhotoRow>(`SELECT * FROM find_photos WHERE findId IN (${placeholders}) AND deletedAt IS NULL ORDER BY createdAt`, ids);
    return rows.map((row) => mapFind(row, items.filter((item) => item.findId === row.id), photos.filter((photo) => photo.findId === row.id)));
  }

  async getFind(profileId: string, id: string): Promise<FindRecord | undefined> {
    const rows = await this.listFinds(profileId);
    return rows.find((find) => find.id === id);
  }

  async saveVisit(input: {
    profile: ProfileSummary;
    hotspot?: Hotspot;
    newHotspot?: Omit<Hotspot, 'id' | 'profileId' | 'createdAt' | 'updatedAt' | 'syncState'>;
    find: Omit<FindRecord, 'id' | 'profileId' | 'createdAt' | 'updatedAt' | 'syncState' | 'serverRevision'> & { id?: string };
  }): Promise<{ hotspotId: string; findId: string }> {
    const timestamp = nowIso();
    const shouldSync = input.profile.mode === 'cloud' && Boolean(input.profile.accountId);
    const syncState: SyncState = shouldSync ? 'pending' : 'local';
    const hotspotId = input.hotspot?.id ?? Crypto.randomUUID();
    const findId = input.find.id ?? Crypto.randomUUID();
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (!input.hotspot && input.newHotspot) {
        const hotspot: Hotspot = {
          ...input.newHotspot,
          id: hotspotId,
          profileId: input.profile.id,
          createdAt: timestamp,
          updatedAt: timestamp,
          syncState,
        };
        await tx.runAsync(
          `INSERT INTO hotspots (id, profileId, latitude, longitude, title, locationName, locationAdmin1, locationAdmin2, locationCountry, notes, locationSource, accuracyM, locationSharing, createdAt, updatedAt, syncState)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          hotspot.id, hotspot.profileId, hotspot.latitude, hotspot.longitude, nullable(hotspot.title), nullable(hotspot.locationName), nullable(hotspot.locationAdmin1), nullable(hotspot.locationAdmin2), nullable(hotspot.locationCountry), nullable(hotspot.notes), hotspot.locationSource,
          nullable(hotspot.accuracyM), hotspot.locationSharing, hotspot.createdAt, hotspot.updatedAt, hotspot.syncState,
        );
        if (shouldSync) await this.queue(tx, input.profile.accountId!, 'hotspot', hotspot.id, 'upsert', hotspot);
      }
      const weather = input.find.weather;
      await tx.runAsync(
        `INSERT INTO finds (id, hotspotId, profileId, observedAt, observationLatitude, observationLongitude, observationAccuracyM, outcome, notes, visibility, shareExactCommunityLocation, weatherJson, createdAt, updatedAt, syncState)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        findId, hotspotId, input.profile.id, input.find.observedAt, input.find.observationLatitude, input.find.observationLongitude,
        nullable(input.find.observationAccuracyM), input.find.outcome, nullable(input.find.notes), input.find.visibility,
        input.find.shareExactCommunityLocation ? 1 : 0, JSON.stringify(weather), timestamp, timestamp, syncState,
      );
      const findPayload = { ...input.find, id: findId, hotspotId, profileId: input.profile.id, createdAt: timestamp, updatedAt: timestamp, syncState };
      if (shouldSync) await this.queue(tx, input.profile.accountId!, 'find', findId, 'upsert', findPayload);
      for (const item of input.find.items) {
        const record: FindItem = { ...item, findId, createdAt: item.createdAt || timestamp, updatedAt: timestamp, syncState };
        await tx.runAsync(
          `INSERT INTO find_items (id, findId, speciesId, customName, quantity, unit, searchedFor, createdAt, updatedAt, syncState) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          record.id, findId, nullable(record.speciesId), nullable(record.customName), nullable(record.quantity), nullable(record.unit), record.searchedFor ? 1 : 0,
          record.createdAt, record.updatedAt, record.syncState,
        );
        if (shouldSync) await this.queue(tx, input.profile.accountId!, 'find_item', record.id, 'upsert', record);
      }
      for (const photo of input.find.photos) {
        const record: FindPhoto = { ...photo, findId, uploadState: shouldSync ? 'pending' : 'local', createdAt: photo.createdAt || timestamp };
        await tx.runAsync(
          `INSERT INTO find_photos (id, findId, localUri, storagePath, width, height, uploadState, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          record.id, findId, record.localUri, nullable(record.storagePath), nullable(record.width), nullable(record.height), record.uploadState, record.createdAt,
        );
        if (shouldSync) await this.queue(tx, input.profile.accountId!, 'photo', record.id, 'upload', record);
      }
    });
    return { hotspotId, findId };
  }

  async updateFind(profile: ProfileSummary, updated: FindRecord): Promise<void> {
    const timestamp = nowIso();
    const shouldSync = profile.mode === 'cloud' && Boolean(profile.accountId);
    const syncState: SyncState = shouldSync ? 'pending' : 'local';
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const previousPhotos = await tx.getAllAsync<PhotoRow>(`SELECT * FROM find_photos WHERE findId=? AND deletedAt IS NULL`, updated.id);
      await tx.runAsync(
        `UPDATE finds SET observedAt=?, observationLatitude=?, observationLongitude=?, observationAccuracyM=?, outcome=?, notes=?, visibility=?, shareExactCommunityLocation=?, weatherJson=?, updatedAt=?, syncState=? WHERE id=? AND profileId=?`,
        updated.observedAt, updated.observationLatitude, updated.observationLongitude, nullable(updated.observationAccuracyM), updated.outcome,
        nullable(updated.notes), updated.visibility, updated.shareExactCommunityLocation ? 1 : 0, JSON.stringify(updated.weather), timestamp, syncState, updated.id, profile.id,
      );
      await tx.runAsync(`UPDATE find_items SET deletedAt=?, syncState=? WHERE findId=? AND deletedAt IS NULL`, timestamp, syncState, updated.id);
      for (const item of updated.items) {
        await tx.runAsync(
          `INSERT INTO find_items (id, findId, speciesId, customName, quantity, unit, searchedFor, createdAt, updatedAt, deletedAt, syncState)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT(id) DO UPDATE SET speciesId=excluded.speciesId, customName=excluded.customName, quantity=excluded.quantity, unit=excluded.unit, searchedFor=excluded.searchedFor, updatedAt=excluded.updatedAt, deletedAt=NULL, syncState=excluded.syncState`,
          item.id, updated.id, nullable(item.speciesId), nullable(item.customName), nullable(item.quantity), nullable(item.unit), item.searchedFor ? 1 : 0,
          item.createdAt || timestamp, timestamp, syncState,
        );
        if (shouldSync) await this.queue(tx, profile.accountId!, 'find_item', item.id, 'upsert', { ...item, findId: updated.id, updatedAt: timestamp });
      }
      const retainedPhotoIds = new Set(updated.photos.map((photo) => photo.id));
      for (const previous of previousPhotos) {
        if (!retainedPhotoIds.has(previous.id)) {
          await tx.runAsync(`UPDATE find_photos SET deletedAt=?,uploadState=? WHERE id=?`, timestamp, shouldSync ? 'pending' : 'local', previous.id);
          if (shouldSync) await this.queue(tx, profile.accountId!, 'photo', previous.id, 'delete_file', { ...previous, deletedAt: timestamp });
        }
      }
      for (const photo of updated.photos) {
        if (previousPhotos.some((previous) => previous.id === photo.id)) continue;
        await tx.runAsync(`INSERT INTO find_photos(id,findId,localUri,storagePath,width,height,uploadState,createdAt) VALUES(?,?,?,?,?,?,?,?)`,
          photo.id, updated.id, photo.localUri, nullable(photo.storagePath), nullable(photo.width), nullable(photo.height), shouldSync ? 'pending' : 'local', photo.createdAt || timestamp);
        if (shouldSync) await this.queue(tx, profile.accountId!, 'photo', photo.id, 'upload', { ...photo, findId: updated.id });
      }
      if (shouldSync) await this.queue(tx, profile.accountId!, 'find', updated.id, 'upsert', { ...updated, updatedAt: timestamp });
    });
  }

  async updateWeather(profile: ProfileSummary, findId: string, weather: WeatherSnapshot): Promise<void> {
    const updatedAt = nowIso();
    const syncState: SyncState = profile.mode === 'cloud' ? 'pending' : 'local';
    await this.db.runAsync(`UPDATE finds SET weatherJson=?, updatedAt=?, syncState=? WHERE id=? AND profileId=?`, JSON.stringify(weather), updatedAt, syncState, findId, profile.id);
    if (profile.mode === 'cloud' && profile.accountId) {
      const find = await this.getFind(profile.id, findId);
      if (find) await this.queue(this.db, profile.accountId, 'find', findId, 'upsert', find);
    }
  }

  async updateHotspot(profile: ProfileSummary, hotspot: Hotspot): Promise<void> {
    const updatedAt = nowIso();
    const syncState: SyncState = profile.mode === 'cloud' ? 'pending' : 'local';
    await this.db.runAsync(
      `UPDATE hotspots SET latitude=?, longitude=?, title=?, locationName=?, locationAdmin1=?, locationAdmin2=?, locationCountry=?, notes=?, locationSource=?, accuracyM=?, locationSharing=?, updatedAt=?, syncState=? WHERE id=? AND profileId=?`,
      hotspot.latitude, hotspot.longitude, nullable(hotspot.title), nullable(hotspot.locationName), nullable(hotspot.locationAdmin1), nullable(hotspot.locationAdmin2), nullable(hotspot.locationCountry), nullable(hotspot.notes), hotspot.locationSource, nullable(hotspot.accuracyM),
      hotspot.locationSharing, updatedAt, syncState, hotspot.id, profile.id,
    );
    if (profile.mode === 'cloud' && profile.accountId) await this.queue(this.db, profile.accountId, 'hotspot', hotspot.id, 'upsert', { ...hotspot, updatedAt });
  }

  async deleteFind(profile: ProfileSummary, findId: string): Promise<string[]> {
    const deletedAt = nowIso();
    const syncState: SyncState = profile.mode === 'cloud' ? 'pending' : 'local';
    const photoRows = await this.db.getAllAsync<{ localUri: string }>(`SELECT localUri FROM find_photos WHERE findId=? AND deletedAt IS NULL`, findId);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(`UPDATE finds SET deletedAt=?, updatedAt=?, syncState=? WHERE id=? AND profileId=?`, deletedAt, deletedAt, syncState, findId, profile.id);
      await tx.runAsync(`UPDATE find_items SET deletedAt=?, updatedAt=?, syncState=? WHERE findId=?`, deletedAt, deletedAt, syncState, findId);
      await tx.runAsync(`UPDATE find_photos SET deletedAt=?, uploadState=? WHERE findId=?`, deletedAt, profile.mode === 'cloud' ? 'pending' : 'local', findId);
      if (profile.mode === 'cloud' && profile.accountId) await this.queue(tx, profile.accountId, 'find', findId, 'delete', { id: findId, deletedAt });
    });
    return photoRows.map((row) => row.localUri);
  }

  async deleteHotspot(profile: ProfileSummary, hotspotId: string): Promise<string[]> {
    const deletedAt = nowIso();
    const syncState: SyncState = profile.mode === 'cloud' ? 'pending' : 'local';
    const photoRows = await this.db.getAllAsync<{ localUri: string }>(`SELECT p.localUri FROM find_photos p JOIN finds f ON f.id=p.findId WHERE f.hotspotId=? AND f.profileId=? AND p.deletedAt IS NULL`, hotspotId, profile.id);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const findRows = await tx.getAllAsync<{ id: string }>(`SELECT id FROM finds WHERE hotspotId=? AND profileId=? AND deletedAt IS NULL`, hotspotId, profile.id);
      await tx.runAsync(`UPDATE hotspots SET deletedAt=?, updatedAt=?, syncState=? WHERE id=? AND profileId=?`, deletedAt, deletedAt, syncState, hotspotId, profile.id);
      await tx.runAsync(`UPDATE finds SET deletedAt=?, updatedAt=?, syncState=? WHERE hotspotId=? AND profileId=?`, deletedAt, deletedAt, syncState, hotspotId, profile.id);
      if (profile.mode === 'cloud' && profile.accountId) {
        for (const find of findRows) await this.queue(tx, profile.accountId, 'find', find.id, 'delete', { id: find.id, deletedAt });
        await this.queue(tx, profile.accountId, 'hotspot', hotspotId, 'delete', { id: hotspotId, deletedAt });
      }
    });
    return photoRows.map((row) => row.localUri);
  }

  async saveDraft(profileId: string, draft: RecordingDraft): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO drafts (profileId, payload, updatedAt) VALUES (?, ?, ?) ON CONFLICT(profileId) DO UPDATE SET payload=excluded.payload, updatedAt=excluded.updatedAt`,
      profileId, JSON.stringify(draft), nowIso(),
    );
  }

  async loadDraft(profileId: string): Promise<RecordingDraft | undefined> {
    const row = await this.db.getFirstAsync<{ payload: string }>(`SELECT payload FROM drafts WHERE profileId=?`, profileId);
    return row ? JSON.parse(row.payload) as RecordingDraft : undefined;
  }

  async clearDraft(profileId: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM drafts WHERE profileId=?`, profileId);
  }

  async stats(profileId: string): Promise<{ hotspots: number; finds: number; thisYear: number; pending: number; attention: number }> {
    const yearStart = `${new Date().getFullYear()}-01-01T00:00:00.000Z`;
    const row = await this.db.getFirstAsync<{ hotspots: number; finds: number; thisYear: number }>(
      `SELECT
        (SELECT COUNT(*) FROM hotspots WHERE profileId=? AND deletedAt IS NULL) hotspots,
        (SELECT COUNT(*) FROM finds WHERE profileId=? AND deletedAt IS NULL) finds,
        (SELECT COUNT(*) FROM finds WHERE profileId=? AND deletedAt IS NULL AND observedAt>=?) thisYear`,
      profileId, profileId, profileId, yearStart,
    );
    const sync = await this.db.getFirstAsync<{ pending: number; attention: number }>(
      `SELECT SUM(CASE WHEN syncState='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN syncState='attention' THEN 1 ELSE 0 END) attention FROM (SELECT syncState FROM hotspots WHERE profileId=? UNION ALL SELECT syncState FROM finds WHERE profileId=?)`,
      profileId, profileId,
    );
    return { hotspots: row?.hotspots ?? 0, finds: row?.finds ?? 0, thisYear: row?.thisYear ?? 0, pending: sync?.pending ?? 0, attention: sync?.attention ?? 0 };
  }

  async exportData(profileId: string): Promise<object> {
    const profile = await this.db.getFirstAsync<ProfileSummary>(`SELECT id, mode, username, displayName, avatarUrl, createdAt FROM local_profiles WHERE id=?`, profileId);
    const hotspots = await this.listHotspots(profileId);
    const finds = await this.listFinds(profileId);
    return { format: 'MushroomApp diary export', version: 1, exportedAt: nowIso(), includesExactLocations: true, photoFilesIncluded: false, profile, hotspots, finds };
  }

  async attachLocalDiary(accountId: string, username?: string, displayName?: string): Promise<ProfileSummary> {
    const cloud = await this.ensureCloudProfile(accountId, username, displayName);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const hotspots = await tx.getAllAsync<HotspotRow>(`SELECT * FROM hotspots WHERE profileId=?`, LOCAL_PROFILE_ID);
      const finds = await tx.getAllAsync<FindRow>(`SELECT * FROM finds WHERE profileId=?`, LOCAL_PROFILE_ID);
      const findIds = finds.map((find) => find.id);
      await tx.runAsync(`UPDATE hotspots SET profileId=?, syncState='pending' WHERE profileId=?`, cloud.id, LOCAL_PROFILE_ID);
      await tx.runAsync(`UPDATE finds SET profileId=?, syncState='pending' WHERE profileId=?`, cloud.id, LOCAL_PROFILE_ID);
      if (findIds.length) {
        const marks = findIds.map(() => '?').join(',');
        await tx.runAsync(`UPDATE find_items SET syncState='pending' WHERE findId IN (${marks})`, findIds);
        await tx.runAsync(`UPDATE find_photos SET uploadState='pending' WHERE findId IN (${marks})`, findIds);
      }
      for (const hotspot of hotspots) await this.queue(tx, accountId, 'hotspot', hotspot.id, hotspot.deletedAt ? 'delete' : 'upsert', { ...mapHotspot(hotspot), profileId: cloud.id });
      for (const find of finds) {
        const items = await tx.getAllAsync<ItemRow>(`SELECT * FROM find_items WHERE findId=?`, find.id);
        const photos = await tx.getAllAsync<PhotoRow>(`SELECT * FROM find_photos WHERE findId=?`, find.id);
        const full = mapFind(find, items, photos);
        await this.queue(tx, accountId, 'find', find.id, find.deletedAt ? 'delete' : 'upsert', { ...full, profileId: cloud.id });
        for (const item of full.items) await this.queue(tx, accountId, 'find_item', item.id, item.deletedAt ? 'delete' : 'upsert', item);
        for (const photo of full.photos) await this.queue(tx, accountId, 'photo', photo.id, photo.deletedAt ? 'delete_file' : 'upload', photo);
      }
      await tx.runAsync(`UPDATE local_profiles SET active=0 WHERE id=?`, LOCAL_PROFILE_ID);
      await tx.runAsync(`UPDATE local_profiles SET active=1 WHERE id=?`, cloud.id);
    });
    return cloud;
  }

  async deleteLocalDiary(profileId: string): Promise<void> {
    if (profileId !== LOCAL_PROFILE_ID) throw new Error('Ta ukaz je namenjen le lokalnemu dnevniku.');
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(`DELETE FROM drafts WHERE profileId=?`, profileId);
      await tx.runAsync(`DELETE FROM find_photos WHERE findId IN (SELECT id FROM finds WHERE profileId=?)`, profileId);
      await tx.runAsync(`DELETE FROM find_items WHERE findId IN (SELECT id FROM finds WHERE profileId=?)`, profileId);
      await tx.runAsync(`DELETE FROM finds WHERE profileId=?`, profileId);
      await tx.runAsync(`DELETE FROM hotspots WHERE profileId=?`, profileId);
    });
  }

  async listPhotoUris(profileId: string): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ localUri: string }>(`SELECT p.localUri FROM find_photos p JOIN finds f ON f.id=p.findId WHERE f.profileId=?`, profileId);
    return rows.map((row) => row.localUri);
  }

  async deleteCloudProfileCache(accountId: string): Promise<void> {
    const profile = await this.db.getFirstAsync<{ id: string }>(`SELECT id FROM local_profiles WHERE accountId=?`, accountId);
    if (!profile) return;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(`DELETE FROM outbox WHERE accountId=?`, accountId);
      await tx.runAsync(`DELETE FROM drafts WHERE profileId=?`, profile.id);
      await tx.runAsync(`DELETE FROM find_photos WHERE findId IN (SELECT id FROM finds WHERE profileId=?)`, profile.id);
      await tx.runAsync(`DELETE FROM find_items WHERE findId IN (SELECT id FROM finds WHERE profileId=?)`, profile.id);
      await tx.runAsync(`DELETE FROM finds WHERE profileId=?`, profile.id);
      await tx.runAsync(`DELETE FROM hotspots WHERE profileId=?`, profile.id);
      await tx.runAsync(`DELETE FROM settings WHERE profileId=?`, profile.id);
      await tx.runAsync(`DELETE FROM local_profiles WHERE id=?`, profile.id);
      await tx.runAsync(`UPDATE local_profiles SET active=1 WHERE id=?`, LOCAL_PROFILE_ID);
    });
  }

  async getSetting(profileId: string, key: string): Promise<string | undefined> {
    const row = await this.db.getFirstAsync<{ value: string }>(`SELECT value FROM settings WHERE profileId=? AND key=?`, profileId, key);
    return row?.value;
  }

  async setSetting(profileId: string, key: string, value: string): Promise<void> {
    await this.db.runAsync(`INSERT INTO settings(profileId,key,value) VALUES(?,?,?) ON CONFLICT(profileId,key) DO UPDATE SET value=excluded.value`, profileId, key, value);
  }

  async listConflicts(profileId: string): Promise<Array<{ id: string; entity: 'hotspot' | 'find'; entityId: string; createdAt: string }>> {
    return this.db.getAllAsync(`SELECT id,entity,entityId,createdAt FROM sync_conflicts WHERE profileId=? AND resolvedAt IS NULL ORDER BY createdAt DESC`, profileId);
  }

  async resolveConflict(profile: ProfileSummary, conflictId: string, choice: 'mine' | 'cloud'): Promise<void> {
    const conflict = await this.db.getFirstAsync<{ entity: 'hotspot' | 'find'; entityId: string; localPayload: string; cloudPayload: string }>(`SELECT entity,entityId,localPayload,cloudPayload FROM sync_conflicts WHERE id=? AND profileId=? AND resolvedAt IS NULL`, conflictId, profile.id);
    if (!conflict) return;
    const table = conflict.entity === 'hotspot' ? 'hotspots' : 'finds';
    if (choice === 'mine') {
      const local = JSON.parse(conflict.localPayload) as Record<string, unknown>;
      await this.db.runAsync(`UPDATE ${table} SET syncState='pending' WHERE id=?`, conflict.entityId);
      if (profile.accountId) await this.queue(this.db, profile.accountId, conflict.entity, conflict.entityId, 'upsert', local);
    } else {
      const cloud = JSON.parse(conflict.cloudPayload) as Record<string, unknown>;
      if (conflict.entity === 'hotspot') {
        await this.db.runAsync(`UPDATE hotspots SET latitude=?,longitude=?,title=?,locationName=?,locationAdmin1=?,locationAdmin2=?,locationCountry=?,notes=?,locationSource=?,accuracyM=?,locationSharing=?,updatedAt=?,deletedAt=?,syncState='synced',serverRevision=? WHERE id=?`,
          cloud.latitude as number,cloud.longitude as number,nullable(cloud.title as string | undefined),nullable(cloud.location_name as string | undefined),nullable(cloud.location_admin1 as string | undefined),nullable(cloud.location_admin2 as string | undefined),nullable(cloud.location_country as string | undefined),nullable(cloud.notes as string | undefined),cloud.location_source as string,nullable(cloud.accuracy_m as number | undefined),cloud.location_sharing as string,cloud.client_updated_at as string,nullable(cloud.deleted_at as string | undefined),cloud.server_revision as number,conflict.entityId);
      } else {
        const weather = { provider: cloud.weather_provider ?? 'open-meteo', status: cloud.weather_status, weatherTime: cloud.weather_time ?? undefined, retrievedAt: cloud.weather_retrieved_at ?? undefined, dataset: cloud.weather_dataset ?? undefined, temperatureC: cloud.temperature_c ?? undefined, precipitationMm: cloud.precipitation_mm ?? undefined };
        await this.db.runAsync(`UPDATE finds SET hotspotId=?,observedAt=?,observationLatitude=?,observationLongitude=?,observationAccuracyM=?,outcome=?,notes=?,visibility=?,shareExactCommunityLocation=?,weatherJson=?,updatedAt=?,deletedAt=?,syncState='synced',serverRevision=? WHERE id=?`,
          cloud.hotspot_id as string,cloud.observed_at as string,cloud.observation_latitude as number,cloud.observation_longitude as number,nullable(cloud.observation_accuracy_m as number | undefined),cloud.outcome as string,nullable(cloud.notes as string | undefined),cloud.visibility as string,cloud.share_exact_community_location ? 1 : 0,JSON.stringify(weather),cloud.client_updated_at as string,nullable(cloud.deleted_at as string | undefined),cloud.server_revision as number,conflict.entityId);
      }
    }
    await this.db.runAsync(`UPDATE sync_conflicts SET resolvedAt=? WHERE id=?`, nowIso(), conflictId);
  }

  private async queue(db: SQLiteDatabase, accountId: string, entity: string, entityId: string, action: 'upsert' | 'delete' | 'upload' | 'delete_file', payload: object): Promise<void> {
    const timestamp = nowIso();
    await db.runAsync(
      `INSERT INTO outbox (operationId, accountId, entity, entityId, action, payload, nextAttemptAt, state, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      Crypto.randomUUID(), accountId, entity, entityId, action, JSON.stringify(payload), timestamp, timestamp, timestamp,
    );
  }
}
