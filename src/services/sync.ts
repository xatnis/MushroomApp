import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';

interface OutboxRow {
  operationId: string;
  accountId: string;
  entity: 'hotspot' | 'find' | 'find_item' | 'photo';
  entityId: string;
  action: 'upsert' | 'delete' | 'upload' | 'delete_file';
  payload: string;
  retryCount: number;
}

const TABLES = { hotspot: 'hotspots', find: 'finds', find_item: 'find_items', photo: 'find_photos' } as const;

const mapPayload = (entity: OutboxRow['entity'], raw: Record<string, unknown>, ownerId: string) => {
  if (entity === 'hotspot') return {
    id: raw.id, owner_id: ownerId, latitude: raw.latitude, longitude: raw.longitude, title: raw.title ?? null,
    location_name: raw.locationName ?? null, location_admin1: raw.locationAdmin1 ?? null, location_admin2: raw.locationAdmin2 ?? null, location_country: raw.locationCountry ?? null,
    notes: raw.notes ?? null,
    location_source: raw.locationSource, accuracy_m: raw.accuracyM ?? null, location_sharing: raw.locationSharing,
    client_updated_at: raw.updatedAt, deleted_at: raw.deletedAt ?? null,
  };
  if (entity === 'find') {
    const weather = (raw.weather ?? {}) as Record<string, unknown>;
    return {
      id: raw.id, hotspot_id: raw.hotspotId, owner_id: ownerId, observed_at: raw.observedAt,
      observation_latitude: raw.observationLatitude, observation_longitude: raw.observationLongitude,
      observation_accuracy_m: raw.observationAccuracyM ?? null, outcome: raw.outcome, notes: raw.notes ?? null,
      visibility: raw.visibility, share_exact_community_location: false,
      weather_status: weather.status ?? 'pending', weather_provider: weather.provider ?? 'open-meteo', weather_time: weather.weatherTime ?? null,
      weather_retrieved_at: weather.retrievedAt ?? null, weather_dataset: weather.dataset ?? null,
      temperature_c: weather.temperatureC ?? null, precipitation_mm: weather.precipitationMm ?? null,
      client_updated_at: raw.updatedAt, deleted_at: raw.deletedAt ?? null,
    };
  }
  if (entity === 'find_item') return {
    id: raw.id, find_id: raw.findId, species_id: raw.speciesId ?? null, custom_name: raw.customName ?? null,
    quantity: raw.quantity ?? null, unit: raw.unit ?? null, searched_for: raw.searchedFor ?? false,
    client_updated_at: raw.updatedAt, deleted_at: raw.deletedAt ?? null,
  };
  return raw;
};

export class SyncEngine {
  private running = false;
  constructor(private readonly db: SQLiteDatabase, private readonly client: SupabaseClient) {}

  async run(accountId: string): Promise<boolean> {
    if (this.running) return false;
    const network = await NetInfo.fetch();
    if (!network.isConnected || network.isInternetReachable === false) return false;
    const { data: sessionData } = await this.client.auth.getSession();
    const user = sessionData.session?.user;
    if (!user || user.id !== accountId) return false;
    this.running = true;
    let hadErrors = false;
    try {
      const rows = await this.db.getAllAsync<OutboxRow>(
        `SELECT * FROM outbox WHERE accountId=? AND state IN ('pending','failed') AND nextAttemptAt<=? ORDER BY CASE entity WHEN 'hotspot' THEN 1 WHEN 'find' THEN 2 WHEN 'find_item' THEN 3 ELSE 4 END, createdAt LIMIT 50`,
        accountId, new Date().toISOString(),
      );
      for (const row of rows) if (!await this.process(row, user.id)) hadErrors = true;
      await this.pull(accountId, user.id);
    } finally {
      this.running = false;
    }
    return hadErrors;
  }

  private async pull(accountId: string, ownerId: string): Promise<void> {
    const profileId = `cloud:${accountId}`;
    const setting = await this.db.getFirstAsync<{ value: string }>(`SELECT value FROM settings WHERE profileId=? AND key='last_cloud_pull'`, profileId);
    const since = setting?.value ?? '1970-01-01T00:00:00.000Z';
    const pulledAt = new Date().toISOString();
    const hotspotsResult = await this.client.from('hotspots').select('*').eq('owner_id', ownerId).gt('server_updated_at', since).order('server_updated_at').limit(500);
    if (hotspotsResult.error) throw hotspotsResult.error;
    for (const cloud of hotspotsResult.data ?? []) {
      const local = await this.db.getFirstAsync<{ syncState: string; serverRevision: number | null }>(`SELECT syncState,serverRevision FROM hotspots WHERE id=?`, cloud.id);
      if (local && local.syncState !== 'synced' && local.syncState !== 'local') {
        if ((local.serverRevision ?? 0) !== cloud.server_revision) await this.addConflict(profileId, 'hotspot', cloud.id, cloud);
        continue;
      }
      await this.db.runAsync(`INSERT INTO hotspots(id,profileId,latitude,longitude,title,locationName,locationAdmin1,locationAdmin2,locationCountry,notes,locationSource,accuracyM,locationSharing,createdAt,updatedAt,deletedAt,syncState,serverRevision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,title=excluded.title,locationName=excluded.locationName,locationAdmin1=excluded.locationAdmin1,locationAdmin2=excluded.locationAdmin2,locationCountry=excluded.locationCountry,notes=excluded.notes,locationSource=excluded.locationSource,accuracyM=excluded.accuracyM,locationSharing=excluded.locationSharing,updatedAt=excluded.updatedAt,deletedAt=excluded.deletedAt,syncState='synced',serverRevision=excluded.serverRevision`,
        cloud.id, profileId, cloud.latitude, cloud.longitude, cloud.title, cloud.location_name, cloud.location_admin1, cloud.location_admin2, cloud.location_country, cloud.notes, cloud.location_source, cloud.accuracy_m, cloud.location_sharing,
        cloud.client_updated_at, cloud.client_updated_at, cloud.deleted_at, 'synced', cloud.server_revision);
    }
    const findsResult = await this.client.from('finds').select('*').eq('owner_id', ownerId).gt('server_updated_at', since).order('server_updated_at').limit(500);
    if (findsResult.error) throw findsResult.error;
    for (const cloud of findsResult.data ?? []) {
      const local = await this.db.getFirstAsync<{ syncState: string; serverRevision: number | null }>(`SELECT syncState,serverRevision FROM finds WHERE id=?`, cloud.id);
      if (local && local.syncState !== 'synced' && local.syncState !== 'local') {
        if ((local.serverRevision ?? 0) !== cloud.server_revision) await this.addConflict(profileId, 'find', cloud.id, cloud);
        continue;
      }
      const weather = { provider: cloud.weather_provider ?? 'open-meteo', status: cloud.weather_status, weatherTime: cloud.weather_time ?? undefined, retrievedAt: cloud.weather_retrieved_at ?? undefined, dataset: cloud.weather_dataset ?? undefined, temperatureC: cloud.temperature_c ?? undefined, precipitationMm: cloud.precipitation_mm ?? undefined };
      await this.db.runAsync(`INSERT INTO finds(id,hotspotId,profileId,observedAt,observationLatitude,observationLongitude,observationAccuracyM,outcome,notes,visibility,shareExactCommunityLocation,weatherJson,createdAt,updatedAt,deletedAt,syncState,serverRevision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hotspotId=excluded.hotspotId,observedAt=excluded.observedAt,observationLatitude=excluded.observationLatitude,observationLongitude=excluded.observationLongitude,observationAccuracyM=excluded.observationAccuracyM,outcome=excluded.outcome,notes=excluded.notes,visibility=excluded.visibility,shareExactCommunityLocation=excluded.shareExactCommunityLocation,weatherJson=excluded.weatherJson,updatedAt=excluded.updatedAt,deletedAt=excluded.deletedAt,syncState='synced',serverRevision=excluded.serverRevision`,
        cloud.id, cloud.hotspot_id, profileId, cloud.observed_at, cloud.observation_latitude, cloud.observation_longitude, cloud.observation_accuracy_m,
        cloud.outcome, cloud.notes, cloud.visibility, 0, JSON.stringify(weather), cloud.client_updated_at, cloud.client_updated_at, cloud.deleted_at, 'synced', cloud.server_revision);
    }
    const itemsResult = await this.client.from('find_items').select('*, finds!inner(owner_id)').eq('finds.owner_id', ownerId).gt('server_updated_at', since).order('server_updated_at').limit(1000);
    if (itemsResult.error) throw itemsResult.error;
    for (const item of itemsResult.data ?? []) {
      await this.db.runAsync(`INSERT INTO find_items(id,findId,speciesId,customName,quantity,unit,searchedFor,createdAt,updatedAt,deletedAt,syncState)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET speciesId=excluded.speciesId,customName=excluded.customName,quantity=excluded.quantity,unit=excluded.unit,searchedFor=excluded.searchedFor,updatedAt=excluded.updatedAt,deletedAt=excluded.deletedAt,syncState='synced'`,
        item.id,item.find_id,item.species_id,item.custom_name,item.quantity,item.unit,item.searched_for?1:0,item.client_updated_at,item.client_updated_at,item.deleted_at,'synced');
    }
    const photosResult = await this.client.from('find_photos').select('*').eq('owner_id', ownerId).order('created_at').limit(1000);
    if (photosResult.error) throw photosResult.error;
    if (LegacyFileSystem.documentDirectory) await LegacyFileSystem.makeDirectoryAsync(`${LegacyFileSystem.documentDirectory}mushroom-photos/`, { intermediates: true });
    for (const photo of photosResult.data ?? []) {
      const local = await this.db.getFirstAsync<{ localUri: string }>(`SELECT localUri FROM find_photos WHERE id=?`, photo.id);
      let localUri = local?.localUri;
      if (!localUri && !photo.deleted_at && LegacyFileSystem.documentDirectory) {
        const signed = await this.client.storage.from('find-photos').createSignedUrl(photo.storage_path, 120);
        if (signed.error) throw signed.error;
        localUri = `${LegacyFileSystem.documentDirectory}mushroom-photos/${photo.id}.jpg`;
        await LegacyFileSystem.downloadAsync(signed.data.signedUrl, localUri);
      }
      if (localUri) await this.db.runAsync(`INSERT INTO find_photos(id,findId,localUri,storagePath,width,height,uploadState,createdAt,deletedAt)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET storagePath=excluded.storagePath,width=excluded.width,height=excluded.height,uploadState='uploaded',deletedAt=excluded.deletedAt`,
        photo.id,photo.find_id,localUri,photo.storage_path,photo.width,photo.height,'uploaded',photo.created_at,photo.deleted_at);
    }
    await this.db.runAsync(`INSERT INTO settings(profileId,key,value) VALUES(?,'last_cloud_pull',?) ON CONFLICT(profileId,key) DO UPDATE SET value=excluded.value`, profileId, pulledAt);
  }

  private async addConflict(profileId: string, entity: string, entityId: string, cloud: object): Promise<void> {
    const exists = await this.db.getFirstAsync<{ id: string }>(`SELECT id FROM sync_conflicts WHERE entity=? AND entityId=? AND resolvedAt IS NULL`, entity, entityId);
    if (exists) return;
    const table = entity === 'hotspot' ? 'hotspots' : 'finds';
    const local = await this.db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=?`, entityId);
    const id = Crypto.randomUUID();
    await this.db.runAsync(`INSERT INTO sync_conflicts(id,profileId,entity,entityId,localPayload,cloudPayload,createdAt) VALUES(?,?,?,?,?,?,?)`, id, profileId, entity, entityId, JSON.stringify(local ?? {}), JSON.stringify(cloud), new Date().toISOString());
    await this.db.runAsync(`UPDATE ${table} SET syncState='attention' WHERE id=?`, entityId);
  }

  private async process(row: OutboxRow, ownerId: string): Promise<boolean> {
    await this.db.runAsync(`UPDATE outbox SET state='running',updatedAt=? WHERE operationId=?`, new Date().toISOString(), row.operationId);
    try {
      const receipt = await this.client.from('mutation_receipts').select('mutation_id').eq('mutation_id', row.operationId).maybeSingle();
      if (receipt.error) throw receipt.error;
      if (!receipt.data) {
        const raw = JSON.parse(row.payload) as Record<string, unknown>;
        if (row.entity === 'photo') await this.processPhoto(row, raw, ownerId);
        else if (row.action === 'delete') {
          const result = await this.client.from(TABLES[row.entity]).update({ deleted_at: raw.deletedAt ?? new Date().toISOString() }).eq('id', row.entityId);
          if (result.error) throw result.error;
        } else {
          const result = await this.client.from(TABLES[row.entity]).upsert(mapPayload(row.entity, raw, ownerId), { onConflict: 'id' });
          if (result.error) throw result.error;
        }
        const receiptResult = await this.client.from('mutation_receipts').insert({ mutation_id: row.operationId, owner_id: ownerId });
        if (receiptResult.error && receiptResult.error.code !== '23505') throw receiptResult.error;
      }
      await this.db.runAsync(`UPDATE outbox SET state='done',updatedAt=?,lastError=NULL WHERE operationId=?`, new Date().toISOString(), row.operationId);
      if (row.entity === 'hotspot' || row.entity === 'find') {
        await this.db.runAsync(`UPDATE ${TABLES[row.entity]} SET syncState='synced' WHERE id=? AND NOT EXISTS (SELECT 1 FROM outbox WHERE entityId=? AND state IN ('pending','running','failed'))`, row.entityId, row.entityId);
      }
      return true;
    } catch (error) {
      const retryCount = row.retryCount + 1;
      const message = error instanceof Error ? error.message : String(error);
      const delayMinutes = Math.min(360, 2 ** Math.min(retryCount, 8));
      const state = retryCount >= 6 ? 'failed' : 'pending';
      await this.db.runAsync(
        `UPDATE outbox SET state=?,retryCount=?,nextAttemptAt=?,lastError=?,updatedAt=? WHERE operationId=?`,
        state, retryCount, new Date(Date.now() + delayMinutes * 60_000).toISOString(), message, new Date().toISOString(), row.operationId,
      );
      if (retryCount >= 6 && (row.entity === 'hotspot' || row.entity === 'find')) await this.db.runAsync(`UPDATE ${TABLES[row.entity]} SET syncState='attention' WHERE id=?`, row.entityId);
      if (retryCount >= 6 && row.entity === 'photo') await this.db.runAsync(`UPDATE find_photos SET uploadState='failed' WHERE id=?`, row.entityId);
      return false;
    }
  }

  private async processPhoto(row: OutboxRow, raw: Record<string, unknown>, ownerId: string): Promise<void> {
    const storagePath = `${ownerId}/${String(raw.findId)}/${row.entityId}.jpg`;
    if (row.action === 'delete_file') {
      const result = await this.client.storage.from('find-photos').remove([String(raw.storagePath ?? storagePath)]);
      if (result.error) throw result.error;
      await this.client.from('find_photos').update({ deleted_at: raw.deletedAt ?? new Date().toISOString() }).eq('id', row.entityId);
      return;
    }
    const file = new File(String(raw.localUri));
    const bytes = await file.arrayBuffer();
    const upload = await this.client.storage.from('find-photos').upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: true });
    if (upload.error) throw upload.error;
    const metadata = await this.client.from('find_photos').upsert({
      id: row.entityId, find_id: raw.findId, owner_id: ownerId, storage_path: storagePath,
      width: raw.width ?? null, height: raw.height ?? null,
    }, { onConflict: 'id' });
    if (metadata.error) throw metadata.error;
    await this.db.runAsync(`UPDATE find_photos SET storagePath=?,uploadState='uploaded' WHERE id=?`, storagePath, row.entityId);
  }

  async retryFailed(accountId: string): Promise<void> {
    await this.db.runAsync(`UPDATE outbox SET state='pending',retryCount=0,nextAttemptAt=?,lastError=NULL WHERE accountId=? AND state='failed'`, new Date().toISOString(), accountId);
    await this.run(accountId);
  }
}
