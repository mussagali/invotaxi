import 'package:flutter/foundation.dart';

class AppEnv {
  static const _configuredApiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:8000/api/v1',
  );

  static String get apiBaseUrl {
    if (!kIsWeb &&
        defaultTargetPlatform == TargetPlatform.android &&
        Uri.parse(_configuredApiBaseUrl).host == 'localhost') {
      return _configuredApiBaseUrl.replaceFirst('localhost', '10.0.2.2');
    }
    return _configuredApiBaseUrl;
  }

  static const allowDevLogin = bool.fromEnvironment(
    'ALLOW_DEV_LOGIN',
    defaultValue: true,
  );
  static const yandexMapsApiKey = String.fromEnvironment('YANDEX_MAPS_API_KEY');
  static const yandexSuggestApiKey = String.fromEnvironment(
    'YANDEX_MAPS_SUGGEST_API_KEY',
  );
}
