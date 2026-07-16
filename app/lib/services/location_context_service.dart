import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;

import '../config/env.dart';

class LocationContextException implements Exception {
  const LocationContextException(this.message);

  final String message;

  @override
  String toString() => message;
}

class CityBounds {
  const CityBounds({
    required this.minLat,
    required this.minLon,
    required this.maxLat,
    required this.maxLon,
  });

  final double minLat;
  final double minLon;
  final double maxLat;
  final double maxLon;

  String get yandexBbox => '$minLon,$minLat~$maxLon,$maxLat';

  bool contains(double latitude, double longitude) =>
      latitude >= minLat &&
      latitude <= maxLat &&
      longitude >= minLon &&
      longitude <= maxLon;
}

class CityLocationContext {
  const CityLocationContext({
    required this.cityName,
    required this.currentAddress,
    required this.position,
    required this.bounds,
  });

  final String cityName;
  final String currentAddress;
  final Position position;
  final CityBounds bounds;

  String get accuracyLabel => 'GPS ±${position.accuracy.ceil()} м';
  bool get isFiveMeterFix => position.accuracy <= 5;
}

class PreciseLocationService {
  static Future<void> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationContextException(
        'Включите геолокацию (GPS) на телефоне',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      throw const LocationContextException(
        'Доступ к геолокации запрещён. Разрешите точную геопозицию в настройках приложения',
      );
    }
    if (permission == LocationPermission.denied) {
      throw const LocationContextException(
        'Без доступа к геолокации нельзя определить город',
      );
    }

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      try {
        final status = await Geolocator.getLocationAccuracy();
        if (status == LocationAccuracyStatus.reduced) {
          await Geolocator.requestTemporaryFullAccuracy(
            purposeKey: 'PrecisePickupLocation',
          );
        }
      } catch (_) {
        // Older iOS versions already provide precise location after permission.
      }
    }
  }

  static Future<Position> bestCurrentPosition({
    Duration initialTimeout = const Duration(seconds: 15),
    Duration refineFor = const Duration(seconds: 6),
  }) async {
    await ensurePermission();
    var best = await Geolocator.getCurrentPosition(
      locationSettings: LocationSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        timeLimit: initialTimeout,
      ),
    );
    if (best.accuracy <= 5 || refineFor == Duration.zero) return best;

    final completer = Completer<Position>();
    late final StreamSubscription<Position> subscription;
    final timer = Timer(refineFor, () {
      if (!completer.isCompleted) completer.complete(best);
    });
    subscription =
        Geolocator.getPositionStream(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.bestForNavigation,
            distanceFilter: 0,
          ),
        ).listen(
          (position) {
            if (position.accuracy < best.accuracy) best = position;
            if (best.accuracy <= 5 && !completer.isCompleted) {
              completer.complete(best);
            }
          },
          onError: (_) {
            if (!completer.isCompleted) completer.complete(best);
          },
        );
    final result = await completer.future;
    timer.cancel();
    await subscription.cancel();
    return result;
  }
}

class LocationContextService {
  static const _kazakhstanBounds = CityBounds(
    minLat: 40.45,
    minLon: 46.40,
    maxLat: 55.50,
    maxLon: 87.40,
  );
  static CityLocationContext? _cached;
  static CityLocationContext? get cached => _cached;

  static Future<CityLocationContext> detectCurrentCity({
    bool force = false,
  }) async {
    final cached = _cached;
    if (!force && cached != null) return cached;

    final position = await PreciseLocationService.bestCurrentPosition();
    if (!_kazakhstanBounds.contains(position.latitude, position.longitude)) {
      throw const LocationContextException(
        'Сервис работает только на территории Казахстана',
      );
    }

    final key = AppEnv.yandexMapsApiKey.trim();
    if (key.isEmpty) {
      throw const LocationContextException(
        'Не задан ключ Yandex Geocoder для определения города',
      );
    }

    final exactObject = await _firstGeoObject(
      key: key,
      geocode: '${position.longitude},${position.latitude}',
    );
    final city =
        _component(exactObject, 'locality') ??
        _component(exactObject, 'area') ??
        _component(exactObject, 'province');
    if (city == null || city.trim().isEmpty) {
      throw const LocationContextException(
        'Не удалось определить город по текущей геопозиции',
      );
    }

    final countryCode = _countryCode(exactObject);
    if (countryCode != null && countryCode != 'KZ') {
      throw const LocationContextException(
        'Текущая геопозиция находится за пределами Казахстана',
      );
    }

    final cityObject = await _firstGeoObject(
      key: key,
      geocode: '$city, Казахстан',
      kind: 'locality',
    );
    final context = CityLocationContext(
      cityName: city,
      currentAddress: _formattedAddress(exactObject) ?? city,
      position: position,
      bounds: _bounds(cityObject, position),
    );
    _cached = context;
    return context;
  }

  static Future<Map<String, dynamic>> _firstGeoObject({
    required String key,
    required String geocode,
    String? kind,
  }) async {
    final uri = Uri.https('geocode-maps.yandex.ru', '/v1/', {
      'apikey': key,
      'geocode': geocode,
      'lang': 'ru_RU',
      'format': 'json',
      'results': '1',
      'kind': ?kind,
    });
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) {
        throw const LocationContextException(
          'Сервис адресов временно недоступен',
        );
      }
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      final members =
          decoded['response']?['GeoObjectCollection']?['featureMember'];
      if (members is! List || members.isEmpty) {
        throw const LocationContextException(
          'Не удалось определить адрес по геопозиции',
        );
      }
      return Map<String, dynamic>.from(
        (members.first as Map)['GeoObject'] as Map,
      );
    } on LocationContextException {
      rethrow;
    } catch (_) {
      throw const LocationContextException(
        'Не удалось определить город. Проверьте интернет и GPS',
      );
    }
  }

  static Map<String, dynamic>? _metadata(Map<String, dynamic> object) {
    final raw = object['metaDataProperty']?['GeocoderMetaData'];
    return raw is Map ? Map<String, dynamic>.from(raw) : null;
  }

  static String? _component(Map<String, dynamic> object, String kind) {
    final components = _metadata(object)?['Address']?['Components'];
    if (components is! List) return null;
    for (final item in components.whereType<Map>()) {
      if (item['kind'] == kind && item['name'] is String) {
        return item['name'] as String;
      }
    }
    return null;
  }

  static String? _countryCode(Map<String, dynamic> object) =>
      _metadata(object)?['Address']?['country_code']?.toString().toUpperCase();

  static String? _formattedAddress(Map<String, dynamic> object) =>
      _metadata(object)?['Address']?['formatted']?.toString();

  static CityBounds _bounds(Map<String, dynamic> object, Position position) {
    final envelope = object['boundedBy']?['Envelope'];
    final lower = _coordinatePair(envelope?['lowerCorner']);
    final upper = _coordinatePair(envelope?['upperCorner']);
    if (lower != null && upper != null) {
      return CityBounds(
        minLat: lower.$2,
        minLon: lower.$1,
        maxLat: upper.$2,
        maxLon: upper.$1,
      );
    }
    return CityBounds(
      minLat: position.latitude - 0.25,
      minLon: position.longitude - 0.35,
      maxLat: position.latitude + 0.25,
      maxLon: position.longitude + 0.35,
    );
  }

  static (double, double)? _coordinatePair(dynamic raw) {
    if (raw is! String) return null;
    final values = raw.split(' ').map(double.tryParse).toList();
    final longitude = values.elementAtOrNull(0);
    final latitude = values.elementAtOrNull(1);
    if (longitude == null || latitude == null) return null;
    return (longitude, latitude);
  }
}
