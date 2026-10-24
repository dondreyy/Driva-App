import type { UploadTicket } from '@driva/shared';
import * as ImagePicker from 'expo-image-picker';

export interface Photo {
  uri: string;
  contentType: 'image/jpeg' | 'image/png';
}

/** Opens the camera. Returns null if the driver cancels. */
export async function takePhoto(selfie: boolean): Promise<Photo | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Allow camera access in your phone settings to add photos.');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    cameraType: selfie ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    contentType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
  };
}

/** Sends the photo straight to storage with the signed link from the API. */
export async function uploadPhoto(ticket: UploadTicket, photo: Photo): Promise<void> {
  const blob = await (await fetch(photo.uri)).blob();
  const res = await fetch(ticket.url, {
    method: ticket.method,
    headers: ticket.headers,
    body: blob,
  });
  if (!res.ok) throw new Error('The photo did not upload. Check your connection and try again.');
}
