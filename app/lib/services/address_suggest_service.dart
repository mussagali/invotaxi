import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../models/models.dart';
import 'location_context_service.dart';

class AddressSuggestService {
  static Future<Place> reverseGeocode({
    required double latitude,
    required double longitude,
    CityLocationContext? context,
  }) async {
    final fallback = Place(
      '${latitude.toStringAsFixed(6)}, ${longitude.toStringAsFixed(6)}',
      'Точка выбрана на карте',
      lat: latitude,
      lon: longitude,
    );
    final key = AppEnv.yandexMapsApiKey.trim();
    if (key.isEmpty) return fallback;
    try {
      final response = await http
          .get(
            Uri.https('geocode-maps.yandex.ru', '/v1/', {
              'apikey': key,
              'geocode': '$longitude,$latitude',
              'lang': 'ru_RU',
              'format': 'json',
              'results': '1',
            }),
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return fallback;
      final object = _firstObject(jsonDecode(response.body));
      if (object == null) return fallback;
      final coordinates = _coordinates(object);
      if (coordinates == null ||
          (context != null &&
              !context.bounds.contains(coordinates.$2, coordinates.$1))) {
        return fallback;
      }
      return Place(
        object['name']?.toString() ?? fallback.title,
        object['description']?.toString() ?? '',
        lat: coordinates.$2,
        lon: coordinates.$1,
      );
    } catch (_) {
      return fallback;
    }
  }

  static Future<List<Place>> search(
    String query,
    CityLocationContext context,
  ) async {
    if (query.trim().length < 2) return const [];
    final text = _withCity(query, context.cityName);
    final key = AppEnv.yandexSuggestApiKey.trim();
    if (key.isEmpty) return _geocodeSearch(text, context);

    final uri = Uri.https('suggest-maps.yandex.ru', '/v1/suggest', {
      'apikey': key,
      'text': text,
      'bbox': context.bounds.yandexBbox,
      'strict_bounds': '1',
      'lang': 'ru',
      'results': '10',
      'types': 'biz,geo,street,house',
      'attrs': 'uri',
    });
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) {
        return _geocodeSearch(text, context);
      }
      final decoded = jsonDecode(response.body);
      if (decoded is! Map || decoded['results'] is! List) return const [];
      return (decoded['results'] as List)
          .whereType<Map>()
          .map((item) {
            final title = item['title'];
            final subtitle = item['subtitle'];
            return Place(
              title is Map ? '${title['text'] ?? ''}' : '',
              subtitle is Map ? '${subtitle['text'] ?? ''}' : '',
              uri: item['uri']?.toString(),
            );
          })
          .where((item) => item.title.isNotEmpty)
          .toList();
    } catch (_) {
      return _geocodeSearch(text, context);
    }
  }

  static Future<Place?> resolve(
    Place place,
    CityLocationContext context,
  ) async {
    if (place.lat != null && place.lon != null) {
      return context.bounds.contains(place.lat!, place.lon!) ? place : null;
    }
    final key = AppEnv.yandexMapsApiKey.trim();
    if (key.isEmpty) return null;
    final parameters = <String, String>{
      'apikey': key,
      'lang': 'ru_RU',
      'format': 'json',
      'results': '1',
      'bbox': context.bounds.yandexBbox,
      'rspn': '1',
      if ((place.uri ?? '').isNotEmpty) 'uri': place.uri!,
      if ((place.uri ?? '').isEmpty)
        'geocode': _withCity(place.displayName, context.cityName),
    };
    try {
      final response = await http
          .get(Uri.https('geocode-maps.yandex.ru', '/v1/', parameters))
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return null;
      final object = _firstObject(jsonDecode(response.body));
      if (object == null || !_belongsToCity(object, context.cityName)) {
        return null;
      }
      final coordinates = _coordinates(object);
      if (coordinates == null ||
          !context.bounds.contains(coordinates.$2, coordinates.$1)) {
        return null;
      }
      return Place(
        place.title,
        place.subtitle,
        icon: place.icon,
        uri: place.uri,
        lat: coordinates.$2,
        lon: coordinates.$1,
      );
    } catch (_) {
      return null;
    }
  }

  static Future<List<Place>> _geocodeSearch(
    String text,
    CityLocationContext context,
  ) async {
    final key = AppEnv.yandexMapsApiKey.trim();
    if (key.isEmpty) return const [];
    final uri = Uri.https('geocode-maps.yandex.ru', '/v1/', {
      'apikey': key,
      'geocode': text,
      'lang': 'ru_RU',
      'format': 'json',
      'results': '10',
      'bbox': context.bounds.yandexBbox,
      'rspn': '1',
    });
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return const [];
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      final members =
          decoded['response']?['GeoObjectCollection']?['featureMember'];
      if (members is! List) return const [];
      return members
          .whereType<Map>()
          .map((member) => member['GeoObject'])
          .whereType<Map>()
          .map((raw) => Map<String, dynamic>.from(raw))
          .where((object) => _belongsToCity(object, context.cityName))
          .map((object) {
            final coordinates = _coordinates(object);
            return Place(
              object['name']?.toString() ?? '',
              object['description']?.toString() ?? '',
              lon: coordinates?.$1,
              lat: coordinates?.$2,
            );
          })
          .where((place) {
            final lat = place.lat;
            final lon = place.lon;
            return place.title.isNotEmpty &&
                lat != null &&
                lon != null &&
                context.bounds.contains(lat, lon);
          })
          .toList();
    } catch (_) {
      return const [];
    }
  }

  static String _withCity(String query, String city) {
    final normalizedQuery = _normalize(query);
    return normalizedQuery.contains(_normalize(city))
        ? query.trim()
        : '$city, ${query.trim()}';
  }

  static Map<String, dynamic>? _firstObject(dynamic decoded) {
    if (decoded is! Map) return null;
    final members =
        decoded['response']?['GeoObjectCollection']?['featureMember'];
    if (members is! List || members.isEmpty || members.first is! Map) {
      return null;
    }
    final raw = (members.first as Map)['GeoObject'];
    return raw is Map ? Map<String, dynamic>.from(raw) : null;
  }

  static (double, double)? _coordinates(Map<String, dynamic> object) {
    final position = object['Point']?['pos'];
    if (position is! String) return null;
    final values = position.split(' ').map(double.tryParse).toList();
    final longitude = values.elementAtOrNull(0);
    final latitude = values.elementAtOrNull(1);
    if (longitude == null || latitude == null) return null;
    return (longitude, latitude);
  }

  static bool _belongsToCity(Map<String, dynamic> object, String city) {
    final components =
        object['metaDataProperty']?['GeocoderMetaData']?['Address']?['Components'];
    if (components is! List) return false;
    final localities = components
        .whereType<Map>()
        .where((item) => item['kind'] == 'locality')
        .map((item) => item['name']?.toString() ?? '')
        .where((name) => name.isNotEmpty);
    return localities.any((name) => _normalize(name) == _normalize(city));
  }

  static String _normalize(String value) => value
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replaceAll(RegExp(r'[^a-zа-я0-9]+'), ' ')
      .trim();
}
