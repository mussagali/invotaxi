import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../models/models.dart';

class AddressSuggestService {
  static Future<List<Place>> search(String query) async {
    final key = AppEnv.yandexSuggestApiKey.trim();
    if (query.trim().length < 2) return const [];
    final text = query.toLowerCase().contains('атырау')
        ? query.trim()
        : 'Атырау, ${query.trim()}';
    if (key.isEmpty) return _geocodeSearch(text);
    final uri = Uri.https('suggest-maps.yandex.ru', '/v1/suggest', {
      'apikey': key,
      'text': text,
      'bbox': '51.55,46.85~52.15,47.35',
      'strict_bounds': '1',
      'lang': 'ru',
      'results': '10',
      'types': 'biz,geo,street,house',
      'attrs': 'uri',
    });
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return _geocodeSearch(text);
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
      return _geocodeSearch(text);
    }
  }

  static Future<Place?> resolve(Place place) async {
    if (place.lat != null && place.lon != null) return place;
    final key = AppEnv.yandexMapsApiKey.trim();
    if (key.isEmpty) return null;
    final parameters = <String, String>{
      'apikey': key,
      'lang': 'ru_RU',
      'format': 'json',
      'results': '1',
      'bbox': '51.55,46.85~52.15,47.35',
      'rspn': '1',
      if ((place.uri ?? '').isNotEmpty) 'uri': place.uri!,
      if ((place.uri ?? '').isEmpty) 'geocode': place.displayName,
    };
    try {
      final response = await http
          .get(Uri.https('geocode-maps.yandex.ru', '/v1/', parameters))
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return null;
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      final collection = decoded['response']?['GeoObjectCollection'];
      final members = collection?['featureMember'];
      if (members is! List || members.isEmpty) return null;
      final position = members.first['GeoObject']?['Point']?['pos'];
      if (position is! String) return null;
      final values = position.split(' ').map(double.tryParse).toList();
      final lon = values.elementAtOrNull(0);
      final lat = values.elementAtOrNull(1);
      if (lat == null || lon == null) return null;
      if (lat < 46.85 || lat > 47.35 || lon < 51.55 || lon > 52.15) {
        return null;
      }
      return Place(
        place.title,
        place.subtitle,
        icon: place.icon,
        uri: place.uri,
        lat: lat,
        lon: lon,
      );
    } catch (_) {
      return null;
    }
  }

  static Future<List<Place>> _geocodeSearch(String text) async {
    final key = AppEnv.yandexMapsApiKey.trim();
    if (key.isEmpty) return const [];
    final uri = Uri.https('geocode-maps.yandex.ru', '/v1/', {
      'apikey': key,
      'geocode': text,
      'lang': 'ru_RU',
      'format': 'json',
      'results': '10',
      'bbox': '51.55,46.85~52.15,47.35',
      'rspn': '1',
    });
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return const [];
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      final collection = decoded['response']?['GeoObjectCollection'];
      final members = collection?['featureMember'];
      if (members is! List) return const [];
      return members
          .whereType<Map>()
          .map((member) {
            final object = member['GeoObject'];
            final position = object?['Point']?['pos'];
            final values = position is String
                ? position.split(' ').map(double.tryParse).toList()
                : const <double?>[];
            return Place(
              object?['name']?.toString() ?? '',
              object?['description']?.toString() ?? '',
              lon: values.elementAtOrNull(0),
              lat: values.elementAtOrNull(1),
            );
          })
          .where((place) {
            final lat = place.lat;
            final lon = place.lon;
            return place.title.isNotEmpty &&
                lat != null &&
                lon != null &&
                lat >= 46.85 &&
                lat <= 47.35 &&
                lon >= 51.55 &&
                lon <= 52.15;
          })
          .toList();
    } catch (_) {
      return const [];
    }
  }
}
