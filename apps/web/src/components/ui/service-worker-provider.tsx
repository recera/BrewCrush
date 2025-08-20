'use client';

import { useEffect, useCallback, useState } from 'react';
import { toast } from 'sonner';

export function ServiceWorkerProvider() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);

  const handleUpdate = useCallback(() => {
    if (registration?.waiting) {
      // Tell SW to skip waiting
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      
      // Reload once activated
      registration.waiting.addEventListener('statechange', (e) => {
        if ((e.target as ServiceWorker).state === 'activated') {
          window.location.reload();
        }
      });
    }
  }, [registration]);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      // Register service worker
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          setRegistration(reg);
          console.log('[SW] Service Worker registered');

          // Check for updates every hour
          setInterval(() => {
            reg.update();
          }, 60 * 60 * 1000);

          // Handle updates
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New service worker available
                  setIsUpdateAvailable(true);
                  toast.info('A new version is available!', {
                    action: {
                      label: 'Update',
                      onClick: handleUpdate,
                    },
                    duration: Infinity,
                  });
                }
              });
            }
          });

          // Handle messages from SW
          navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'SYNC_REQUESTED') {
              // Trigger sync from the offline sync manager
              import('@/lib/offline/sync').then(({ OfflineSyncManager }) => {
                OfflineSyncManager.getInstance().forceSyncNow();
              });
            }
          });
        })
        .catch((error) => {
          console.error('[SW] Service Worker registration failed:', error);
        });

      // Clean up on unmount
      return () => {
        // Service worker stays registered
      };
    }
  }, [handleUpdate]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      // Wait a bit before asking for permission
      const timer = setTimeout(() => {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            console.log('[Notifications] Permission granted');
          }
        });
      }, 30000); // Wait 30 seconds after app load

      return () => clearTimeout(timer);
    }
  }, []);

  // Handle background sync
  useEffect(() => {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        // Register periodic background sync
        return (reg as any).periodicSync?.register('sync-offline-actions', {
          minInterval: 5 * 60 * 1000, // 5 minutes
        });
      }).catch((error) => {
        console.log('[SW] Periodic sync not supported or failed:', error);
      });
    }
  }, []);

  return null;
}