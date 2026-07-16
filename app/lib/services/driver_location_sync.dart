import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../api/backend_api.dart';

class DriverLocationSync {
  DriverLocationSync(this.api);

  final BackendApi api;
  Timer? _timer;
  bool _sending = false;

  Future<void> start() async {
    if (!await Geolocator.isLocationServiceEnabled()) return;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return;
    }
    await api.setDriverOnline(true);
    await _sendOnce();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 7), (_) => _sendOnce());
  }

  Future<void> _sendOnce() async {
    if (_sending) return;
    _sending = true;
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.bestForNavigation,
          timeLimit: Duration(seconds: 12),
        ),
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
