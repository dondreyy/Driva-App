import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface TokenStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

/**
 * Keeps the refresh token in the iOS Keychain or Android Keystore. Web builds are for local
 * testing only and fall back to localStorage, which is not secure.
 */
export function deviceTokenStorage(key: string): TokenStorage {
  if (Platform.OS === 'web') {
    const local = (globalThis as { localStorage?: Storage }).localStorage;
    return {
      get: async () => local?.getItem(key) ?? null,
      set: async (value) => local?.setItem(key, value),
      remove: async () => local?.removeItem(key),
    };
  }
  return {
    get: () => SecureStore.getItemAsync(key),
    set: (value) => SecureStore.setItemAsync(key, value),
    remove: () => SecureStore.deleteItemAsync(key),
  };
}
