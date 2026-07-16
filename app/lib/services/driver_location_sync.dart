import 'dart:async';

import '../api/backend_api.dart';
import 'location_context_service.dart';

class DriverLocationSync {
  DriverLocationSync(this.api);

  final BackendApi api;
  Timer? _timer;
  bool _sending = false;

  Future<void> start() async {
    try {
      await PreciseLocationService.ensurePermission();
    } on LocationContextException {
      return;
    }
    await api.setDriverOnline(true);
    try {
      final context = await LocationContextService.detectCurrentCity();
      await api.updateDriverRegion(context.cityName);
    } catch (_) {
      // GPS pings still work if reverse geocoding is temporarily unavailable.
    }
    await _sendOnce();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 7), (_) => _sendOnce());
  }

  Future<void> _sendOnce() async {
    if (_sending) return;
    _sending = true;
    try {
      final position = await PreciseLocationService.bestCurrentPosition(
        initialTimeout: const Duration(seconds: 12),
        refineFor: const Duration(seconds: 4),
      );
      // The server enforces the same boundary. Never label a coarse fix as precise.
      if (position.accuracy > 5) return;
      await api.sendLocation(
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: position.speed,
        heading: position.heading,
      );
    } catch (_) {
      // A temporary GPS/network failure is retried on the next 7-second tick.
    } finally {
      _sending = false;
    }
  }

  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    try {
      await api.setDriverOnline(false);
    } on ApiException {
      // Logout/offline still completes locally when the API is unavailable.
    }
  }

  void dispose() => _timer?.cancel();
}
