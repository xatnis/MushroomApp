import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { FindPhoto } from '../domain/types';

export const MAX_IMAGE_EDGE = 1600;

async function ensurePhotoDirectory(): Promise<string> {
  if (!FileSystem.documentDirectory) throw new Error('Trajna shramba ni na voljo.');
  const directory = `${FileSystem.documentDirectory}mushroom-photos/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

export async function persistPickedPhoto(uri: string, width?: number, height?: number): Promise<FindPhoto> {
  const id = Crypto.randomUUID();
  const directory = await ensurePhotoDirectory();
  const longest = Math.max(width ?? MAX_IMAGE_EDGE, height ?? MAX_IMAGE_EDGE);
  const actions: ImageManipulator.Action[] = longest > MAX_IMAGE_EDGE
    ? [{ resize: width && height && width >= height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE } }]
    : [];
  const processed = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG });
  const destination = `${directory}${id}.jpg`;
  await FileSystem.copyAsync({ from: processed.uri, to: destination });
  return {
    id, findId: '', localUri: destination, width: processed.width, height: processed.height,
    uploadState: 'local', createdAt: new Date().toISOString(),
  };
}

export async function takePhoto(): Promise<FindPhoto | undefined> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Za fotografiranje je potrebno dovoljenje za kamero.');
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  if (result.canceled) return undefined;
  const asset = result.assets[0];
  return persistPickedPhoto(asset.uri, asset.width, asset.height);
}

export async function choosePhotos(): Promise<FindPhoto[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Za izbor fotografij je potrebno dovoljenje.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, exif: false });
  if (result.canceled) return [];
  return Promise.all(result.assets.map((asset) => persistPickedPhoto(asset.uri, asset.width, asset.height)));
}

export async function removeLocalPhoto(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function writeExportFile(payload: object): Promise<string> {
  if (!FileSystem.cacheDirectory) throw new Error('Začasna shramba ni na voljo.');
  const uri = `${FileSystem.cacheDirectory}mushroomapp-izvoz-${new Date().toISOString().slice(0, 10)}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
  return uri;
}
