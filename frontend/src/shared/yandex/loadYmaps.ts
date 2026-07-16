/**
 * Динамическая загрузка Yandex Maps JS API 2.1 с ключами из env
 * (вместо захардкоженного script в index.html).
 */

declare global {
  interface Window {
    __ymapsPromise?: Promise<typeof ymaps>;
  }
}

export function areYandexKeysConfigured(): boolean {
  const apiKey = import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined;
  return Boolean(apiKey?.trim());
}

export function loadYmaps(): Promise<typeof ymaps> {
  if (typeof window.ymaps !== 'undefined' && window.ymaps) {
    return new Promise((resolve, reject) => {
      window.ymaps.ready(() => {
        if (window.ymaps.multiRouter?.MultiRoute) {
          resolve(window.ymaps);
          return;
        }
        window.ymaps.modules.require(
          ['multiRouter.MultiRoute'],
          () => resolve(window.ymaps),
          () => reject(new Error('Не удалось загрузить модуль маршрутизации Yandex Maps')),
        );
      });
    });
  }

  if (window.__ymapsPromise) {
    return window.__ymapsPromise;
  }

  window.__ymapsPromise = new Promise((resolve, reject) => {
    const apiKey = import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined;
    const suggestApiKey = import.meta.env.VITE_YANDEX_MAPS_SUGGEST_API_KEY as string | undefined;

    const params = new URLSearchParams({ lang: 'ru_RU', load: 'package.full' });
    if (apiKey) params.set('apikey', apiKey);
    if (suggestApiKey) params.set('suggest_apikey', suggestApiKey);

    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?${params.toString()}`;
    script.async = true;

    script.onload = () => {
      window.ymaps.ready(() => {
        if (window.ymaps.multiRouter?.MultiRoute) {
          resolve(window.ymaps);
          return;
        }
        window.ymaps.modules.require(
          ['multiRouter.MultiRoute'],
          () => resolve(window.ymaps),
          () => reject(new Error('Не удалось загрузить модуль маршрутизации Yandex Maps')),
        );
      });
    };

    script.onerror = () => {
      delete window.__ymapsPromise;
      reject(new Error('Не удалось загрузить Yandex Maps API'));
    };

    document.head.appendChild(script);
  });

  return window.__ymapsPromise;
}
