import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../config/env.dart';
import '../models/models.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class BackendSession {
  const BackendSession({required this.user, required this.profile});

  final Map<String, dynamic> user;
  final Map<String, dynamic> profile;

  String get role => user['role'] as String? ?? '';
  String get phone => user['phone'] as String? ?? '';
}

class BackendApi {
  BackendApi({http.Client? client}) : _client = client ?? http.Client();

  static const _phoneKey = 'auth.phone';
  static const _accessKey = 'auth.access';
  static const _refreshKey = 'auth.refresh';
  static const _roleKey = 'auth.role';
  static const _tutorialSeenKey = 'app.tutorial_seen';
  static const _requestTimeout = Duration(seconds: 15);

  final http.Client _client;
  SharedPreferences? _preferences;
  String? _accessToken;
  String? _refreshToken;
  Future<bool>? _refreshInFlight;
  WebSocketChannel? _socket;
  StreamSubscription<dynamic>? _socketSubscription;
  Timer? _socketReconnect;
  bool _socketClosedByClient = false;

  String get baseUrl => AppEnv.apiBaseUrl.replaceAll(RegExp(r'/+$'), '');
  String get savedPhone => _preferences?.getString(_phoneKey) ?? '';
  String get savedRole => _preferences?.getString(_roleKey) ?? '';
  bool get hasRefreshToken => (_refreshToken ?? '').isNotEmpty;
  bool get tutorialSeen => _preferences?.getBool(_tutorialSeenKey) ?? false;

  Future<void> initialize() async {
    _preferences = await SharedPreferences.getInstance();
    _accessToken = _preferences?.getString(_accessKey);
    _refreshToken = _preferences?.getString(_refreshKey);
  }

  Future<BackendSession?> restoreSession() async {
    if (!hasRefreshToken || !await _refresh()) return null;
    try {
      return await getSession();
    } on ApiException {
      await clearSession(keepPhone: true);
      return null;
    }
  }

  Future<BackendSession> login({
    required String phone,
    required String password,
    required String role,
  }) async {
    await _preferences?.setString(_phoneKey, phone.trim());
    Map<String, dynamic>? payload;
    ApiException? loginError;
    if (AppEnv.allowDevLogin && password == '1111') {
      try {
        payload = await _unauthenticatedPost('/auth/dev-login', {
          'phone': phone,
          'password': password,
          'role': role,
        });
      } on ApiException catch (error) {
        // A disabled test-registration endpoint is normal for a production
        // server. Continue with the standard account login in that case.
        if (error.statusCode != 404) loginError = error;
      }
    }
    if (payload == null) {
      try {
        payload = await _unauthenticatedPost('/auth/login', {
          'phone': phone,
          'password': password,
        });
      } on ApiException catch (error) {
        loginError = error;
      }
    }
    if (payload == null) {
      throw loginError ?? const ApiException('Не удалось войти');
    }

    final user = Map<String, dynamic>.from(payload['user'] as Map);
    if (user['role'] != role) {
      throw const ApiException('Этот номер зарегистрирован для другой роли');
    }
    await _saveTokens(Map<String, dynamic>.from(payload['tokens'] as Map));
    await _preferences?.setString(_roleKey, role);
    return getSession();
  }

  Future<BackendSession> getSession() async {
    final body = Map<String, dynamic>.from(
      await _request('GET', '/auth/me') as Map,
    );
    final user = Map<String, dynamic>.from(body['user'] as Map);
    final profileRaw = user['role'] == 'driver'
        ? body['driver_profile']
        : body['client_profile'];
    return BackendSession(
      user: user,
      profile: profileRaw is Map
          ? Map<String, dynamic>.from(profileRaw)
          : <String, dynamic>{},
    );
  }

  Future<BackendSession> updateProfileName(String fullName) async {
    await _request('PATCH', '/auth/me', body: {'full_name': fullName.trim()});
    return getSession();
  }

  Future<void> markTutorialSeen() async {
    await _preferences?.setBool(_tutorialSeenKey, true);
  }

  Future<List<Dependent>> listDependents() async {
    final body = await _request('GET', '/dependents') as List;
    return body
        .map(
          (item) => Dependent.fromJson(Map<String, dynamic>.from(item as Map)),
        )
        .toList();
  }

  Future<Dependent> createDependent({
    required String fullName,
    bool needsEscort = false,
  }) async {
    final body = Map<String, dynamic>.from(
      await _request(
            'POST',
            '/dependents',
            body: {'full_name': fullName.trim(), 'needs_escort': needsEscort},
          )
          as Map,
    );
    return Dependent.fromJson(body);
  }

  Future<void> archiveDependent(String id) async {
    await _request('DELETE', '/dependents/$id');
  }

  Future<void> updateDriverRegion(String region) async {
    await _request('PATCH', '/auth/me', body: {'region': region.trim()});
  }

  Future<List<Map<String, dynamic>>> listOrders() async {
    final body = await _request('GET', '/orders?limit=100');
    return (body as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  Future<Map<String, dynamic>> createOrder({
    required String pickup,
    required String dropoff,
    required bool escort,
    required DateTime serviceAt,
    double? pickupLat,
    double? pickupLon,
    double? dropoffLat,
    double? dropoffLon,
    List<String> dependentIds = const [],
  }) async {
    final date =
        '${serviceAt.year.toString().padLeft(4, '0')}-'
        '${serviceAt.month.toString().padLeft(2, '0')}-'
        '${serviceAt.day.toString().padLeft(2, '0')}';
    final time =
        '${serviceAt.hour.toString().padLeft(2, '0')}:'
        '${serviceAt.minute.toString().padLeft(2, '0')}:00';
    return Map<String, dynamic>.from(
      await _request(
            'POST',
            '/orders',
            body: {
              'service_date': date,
              'desired_time': time,
              'pickup_addr': pickup,
              'dropoff_addr': dropoff,
              'escort': escort,
              if (dependentIds.isNotEmpty) 'dependent_ids': dependentIds,
              'pickup_lat': ?pickupLat,
              'pickup_lon': ?pickupLon,
              'dropoff_lat': ?dropoffLat,
              'dropoff_lon': ?dropoffLon,
            },
          )
          as Map,
    );
  }

  Future<void> cancelOrder(String orderId) async {
    await _request(
      'POST',
      '/orders/$orderId/cancel',
      body: {'reason': 'Отменено пользователем в приложении'},
    );
  }

  Future<Map<String, dynamic>> correctOrderAddress({
    required String orderId,
    required bool pickup,
    required Place place,
  }) async {
    final lat = place.lat;
    final lon = place.lon;
    if (lat == null || lon == null) {
      throw const ApiException('Выберите точку на карте');
    }
    return Map<String, dynamic>.from(
      await _request(
            'PATCH',
            '/orders/$orderId',
            body: pickup
                ? {
                    'pickup_addr': place.displayName,
                    'pickup_lat': lat,
                    'pickup_lon': lon,
                  }
                : {
                    'dropoff_addr': place.displayName,
                    'dropoff_lat': lat,
                    'dropoff_lon': lon,
                  },
          )
          as Map,
    );
  }

  Future<Map<String, dynamic>> transitionDriverOrder(
    String orderId,
    String status,
  ) async {
    return Map<String, dynamic>.from(
      await _request(
            'POST',
            '/orders/$orderId/driver-transition',
            body: {'to': status, 'meta': <String, dynamic>{}},
          )
          as Map,
    );
  }

  Future<void> setDriverOnline(bool online) async {
    await _request('POST', '/drivers/me/${online ? 'online' : 'offline'}');
  }

  Future<void> sendLocation({
    required double latitude,
    required double longitude,
    required double accuracy,
    double? speed,
    double? heading,
  }) async {
    await _request(
      'POST',
      '/drivers/me/location',
      body: {
        'lat': latitude,
        'lon': longitude,
        'accuracy_m': accuracy,
        'ts': DateTime.now().toUtc().toIso8601String(),
        if (speed != null && speed >= 0) 'speed': speed,
        if (heading != null && heading >= 0) 'heading': heading,
      },
    );
  }

  void connectRealtime(void Function(Map<String, dynamic> event) onEvent) {
    _socketClosedByClient = false;
    _socketReconnect?.cancel();
    _socketSubscription?.cancel();
    _socket?.sink.close();
    final token = _accessToken;
    if (token == null || token.isEmpty) return;
    final apiUri = Uri.parse(baseUrl);
    final wsUri = apiUri.replace(
      scheme: apiUri.scheme == 'https' ? 'wss' : 'ws',
      path: '${apiUri.path}/ws',
      queryParameters: {'token': token},
    );
    _socket = WebSocketChannel.connect(wsUri);
    _socketSubscription = _socket!.stream.listen(
      (raw) {
        final decoded = jsonDecode(raw as String);
        if (decoded is! Map) return;
        final event = Map<String, dynamic>.from(decoded);
        if (event['type'] == 'ping') {
          _socket?.sink.add(jsonEncode({'type': 'pong'}));
        } else {
          onEvent(event);
        }
      },
      onError: (_) => _scheduleReconnect(onEvent),
      onDone: () => _scheduleReconnect(onEvent),
      cancelOnError: true,
    );
  }

  void _scheduleReconnect(void Function(Map<String, dynamic>) onEvent) {
    if (_socketClosedByClient) return;
    _socketReconnect?.cancel();
    _socketReconnect = Timer(const Duration(seconds: 3), () async {
      await _refresh();
      connectRealtime(onEvent);
    });
  }

  Future<void> logout() async {
    try {
      await _request('POST', '/auth/logout');
    } on ApiException {
      // Local logout must still complete when the server is unavailable.
    }
    await clearSession(keepPhone: true);
  }

  Future<void> deleteAccount() async {
    await _request('DELETE', '/auth/me');
    await clearSession(keepPhone: false);
  }

  Future<void> clearSession({required bool keepPhone}) async {
    _socketClosedByClient = true;
    _socketReconnect?.cancel();
    await _socketSubscription?.cancel();
    await _socket?.sink.close();
    _socket = null;
    _accessToken = null;
    _refreshToken = null;
    await _preferences?.remove(_accessKey);
    await _preferences?.remove(_refreshKey);
    await _preferences?.remove(_roleKey);
    if (!keepPhone) await _preferences?.remove(_phoneKey);
  }

  Future<Map<String, dynamic>> _unauthenticatedPost(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _sendUnauthenticatedPost(path, body);
    final decoded = _decode(response);
    return Map<String, dynamic>.from(decoded as Map);
  }

  Future<http.Response> _sendUnauthenticatedPost(
    String path,
    Map<String, dynamic> body,
  ) async {
    try {
      return await _client
          .post(
            Uri.parse('$baseUrl$path'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(_requestTimeout);
    } on TimeoutException {
      throw const ApiException(
        'Сервер не отвечает. Проверьте интернет и повторите попытку.',
      );
    } on http.ClientException {
      throw const ApiException(
        'Нет соединения с сервером. Проверьте интернет.',
      );
    }
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool retry = true,
  }) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'));
    request.headers['Accept'] = 'application/json';
    if (_accessToken != null) {
      request.headers['Authorization'] = 'Bearer $_accessToken';
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await _sendAuthenticatedRequest(request);
    if (response.statusCode == 401 && retry && await _refresh()) {
      return _request(method, path, body: body, retry: false);
    }
    return _decode(response);
  }

  Future<http.Response> _sendAuthenticatedRequest(http.Request request) async {
    try {
      final streamed = await _client.send(request).timeout(_requestTimeout);
      return await http.Response.fromStream(streamed).timeout(_requestTimeout);
    } on TimeoutException {
      throw const ApiException(
        'Сервер не отвечает. Проверьте интернет и повторите попытку.',
      );
    } on http.ClientException {
      throw const ApiException(
        'Нет соединения с сервером. Проверьте интернет.',
      );
    }
  }

  dynamic _decode(http.Response response) {
    dynamic decoded;
    if (response.body.isNotEmpty) decoded = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;
    var message = 'Ошибка сервера (${response.statusCode})';
    if (decoded is Map) {
      final error = decoded['error'];
      if (error is Map && error['message'] is String) {
        message = error['message'] as String;
      } else if (decoded['detail'] is String) {
        message = decoded['detail'] as String;
      }
    }
    throw ApiException(message, statusCode: response.statusCode);
  }

  Future<bool> _refresh() {
    final running = _refreshInFlight;
    if (running != null) return running;
    final future = _performRefresh();
    _refreshInFlight = future;
    return future.whenComplete(() => _refreshInFlight = null);
  }

  Future<bool> _performRefresh() async {
    final token = _refreshToken;
    if (token == null || token.isEmpty) return false;
    try {
      final payload = await _unauthenticatedPost('/auth/refresh', {
        'refresh_token': token,
      });
      await _saveTokens(payload);
      return true;
    } on ApiException {
      await clearSession(keepPhone: true);
      return false;
    }
  }

  Future<void> _saveTokens(Map<String, dynamic> tokens) async {
    _accessToken = tokens['access_token'] as String?;
    _refreshToken = tokens['refresh_token'] as String?;
    if (_accessToken != null) {
      await _preferences?.setString(_accessKey, _accessToken!);
    }
    if (_refreshToken != null) {
      await _preferences?.setString(_refreshKey, _refreshToken!);
    }
  }

  void dispose() {
    _socketClosedByClient = true;
    _socketReconnect?.cancel();
    _socketSubscription?.cancel();
    _socket?.sink.close();
    _client.close();
  }
}
