import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

enum NavigationApp { yandex, twoGis }

Future<void> showExternalNavigationPicker(
  BuildContext context, {
  required String destination,
  double? latitude,
  double? longitude,
}) async {
  final selected = await showModalBottomSheet<NavigationApp>(
    context: context,
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Открыть маршрут', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(destination, maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.navigation),
              title: const Text('Яндекс Навигатор'),
              onTap: () => Navigator.pop(context, NavigationApp.yandex),
            ),
            ListTile(
              leading: const Icon(Icons.map_outlined),
              title: const Text('2ГИС'),
              onTap: () => Navigator.pop(context, NavigationApp.twoGis),
            ),
          ],
        ),
      ),
    ),
  );
  if (selected == null || !context.mounted) return;

  final hasCoordinates = latitude != null && longitude != null;
  final encodedAddress = Uri.encodeComponent(destination);
  final Uri appUri;
  final Uri webUri;
  if (selected == NavigationApp.yandex) {
    appUri = hasCoordinates
        ? Uri.parse('yandexnavi://build_route_on_map?lat_to=$latitude&lon_to=$longitude')
        : Uri.parse('yandexmaps://maps.yandex.com/?text=$encodedAddress');
    webUri = hasCoordinates
        ? Uri.parse('https://yandex.kz/maps/?rtext=~$latitude,$longitude&rtt=auto')
        : Uri.parse('https://yandex.kz/maps/?text=$encodedAddress');
  } else {
    appUri = hasCoordinates
        ? Uri.parse('dgismobile://2gis.ru/routeSearch/rsType/car/to/$longitude,$latitude')
        : Uri.parse('dgismobile://2gis.ru/search/$encodedAddress');
    webUri = hasCoordinates
        ? Uri.parse('https://2gis.kz/atyrau/directions/points/|$longitude,$latitude;to')
        : Uri.parse('https://2gis.kz/atyrau/search/$encodedAddress');
  }

  if (await canLaunchUrl(appUri)) {
    await launchUrl(appUri, mode: LaunchMode.externalApplication);
  } else {
    await launchUrl(webUri, mode: LaunchMode.externalApplication);
  }
}
