import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../models/models.dart';
import '../../services/address_suggest_service.dart';
import '../../services/location_context_service.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';

class MapPickerScreen extends StatefulWidget {
  const MapPickerScreen({
    super.key,
    required this.title,
    this.latitude,
    this.longitude,
    this.locationContext,
  });

  final String title;
  final double? latitude;
  final double? longitude;
  final CityLocationContext? locationContext;

  @override
  State<MapPickerScreen> createState() => _MapPickerScreenState();
}

class _MapPickerScreenState extends State<MapPickerScreen> {
  late LatLng _point;
  String _address = 'Коснитесь карты, чтобы изменить точку';
  bool _resolving = false;

  @override
  void initState() {
    super.initState();
    _point = LatLng(
      widget.latitude ?? widget.locationContext?.position.latitude ?? 47.0945,
      widget.longitude ?? widget.locationContext?.position.longitude ?? 51.9238,
    );
    _resolveAddress();
  }

  Future<void> _resolveAddress() async {
    setState(() => _resolving = true);
    final place = await AddressSuggestService.reverseGeocode(
      latitude: _point.latitude,
      longitude: _point.longitude,
      context: widget.locationContext,
    );
    if (!mounted) return;
    setState(() {
      _address = place.displayName;
      _resolving = false;
    });
  }

  Future<void> _select(LatLng value) async {
    setState(() => _point = value);
    await _resolveAddress();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            FlutterMap(
              options: MapOptions(
                initialCenter: _point,
                initialZoom: 15,
                onTap: (_, point) => _select(point),
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'kz.invotaxi.app',
                ),
                MarkerLayer(
                  markers: [
                    Marker(
                      point: _point,
                      width: 52,
                      height: 52,
                      child: const Icon(
                        Icons.location_pin,
                        color: Color(0xFFF86038),
                        size: 48,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            Positioned(
              top: 12,
              left: 12,
              right: 12,
              child: Row(
                children: [
                  Material(
                    color: p.surface,
                    borderRadius: BorderRadius.circular(16),
                    child: IconButton(
                      icon: const Icon(Icons.arrow_back),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Material(
                      color: p.surface,
                      borderRadius: BorderRadius.circular(16),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        child: Text(
                          widget.title,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              left: 16,
              right: 16,
              bottom: 16,
              child: Material(
                color: p.surface,
                borderRadius: BorderRadius.circular(20),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        _resolving ? 'Определяем адрес…' : _address,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'Нажмите на карту, если точка указана неверно.',
                        style: TextStyle(fontSize: 12, color: p.textSecondary),
                      ),
                      const SizedBox(height: 12),
                      PrimaryButton(
                        label: 'Сохранить точку',
                        onPressed: _resolving
                            ? null
                            : () => Navigator.of(context).pop(
                                Place(
                                  _address,
                                  '',
                                  lat: _point.latitude,
                                  lon: _point.longitude,
                                ),
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
