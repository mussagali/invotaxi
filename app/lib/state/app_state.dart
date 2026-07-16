import 'dart:async';

import 'package:flutter/material.dart';

import '../api/backend_api.dart';
import '../models/models.dart';
import '../services/driver_location_sync.dart';

enum UserRole { none, passenger, driver }

class AppState extends ChangeNotifier {
  AppState({BackendApi? api}) : api = api ?? BackendApi() {
    _locationSync = DriverLocationSync(this.api);
  }

  final BackendApi api;
  late final DriverLocationSync _locationSync;

  ThemeMode _themeMode = ThemeMode.light;
  ThemeMode get themeMode => _themeMode;
  bool get isDark => _themeMode == ThemeMode.dark;

  bool initializing = false;
  bool busy = false;
  String? lastError;
  String savedPhone = '';
  UserRole role = UserRole.none;
  BackendSession? session;
  List<Map<String, dynamic>> _orders = const [];

  OrderRequest? activeOrder;
  OrderStage stage = OrderStage.idle;
  DriverStage driverStage = DriverStage.idle;
  DriverOrder? driverOrder;

  String get profileName =>
      session?.profile['full_name'] as String? ?? 'Пользователь';
  String get phone => session?.phone ?? savedPhone;

  Driver get assignedDriver => Driver(
    name: role == UserRole.driver ? profileName : 'Назначенный водитель',
    car: session?.profile['vehicle_model'] as String? ?? 'Автомобиль',
    plate: session?.profile['plate'] as String? ?? '',
    rating: 0,
  );

  List<DriverOrder> get driverOrders => _orders
      .where((item) => !{'completed', 'cancelled'}.contains(item['status']))
      .map(_toDriverOrder)
      .toList();

  List<TripHistoryItem> get history => _orders.map(_toHistoryItem).toList();

  List<AppNotification> get notifications => const [];

  Future<void> initialize() async {
    initializing = true;
    notifyListeners();
    await api.initialize();
    savedPhone = api.savedPhone;
    final restored = await api.restoreSession();
    if (restored != null) await _activateSession(restored);
    initializing = false;
    notifyListeners();
  }

  Future<void> login({
    required String phone,
    required String password,
    required UserRole selectedRole,
  }) async {
    busy = true;
    lastError = null;
    notifyListeners();
    try {
      final backendRole = selectedRole == UserRole.driver ? 'driver' : 'client';
      final result = await api.login(
        phone: phone,
        password: password,
        role: backendRole,
      );
      savedPhone = api.savedPhone;
      await _activateSession(result);
    } on ApiException catch (error) {
      lastError = error.message;
      rethrow;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> _activateSession(BackendSession value) async {
    session = value;
    role = value.role == 'driver' ? UserRole.driver : UserRole.passenger;
    await refreshOrders();
    api.connectRealtime((_) => unawaited(refreshOrders()));
    if (role == UserRole.driver) unawaited(_locationSync.start());
  }

  Future<void> refreshOrders() async {
    try {
      _orders = await api.listOrders();
      _syncOrderState();
      lastError = null;
    } on ApiException catch (error) {
      lastError = error.message;
    }
    notifyListeners();
  }

  void _syncOrderState() {
    final active = _orders.cast<Map<String, dynamic>?>().firstWhere(
      (item) =>
          item != null &&
          !{'completed', 'cancelled', 'exception'}.contains(item['status']),
      orElse: () => null,
    );
    activeOrder = active == null ? null : _toOrderRequest(active);
    if (active == null) {
      stage = OrderStage.idle;
    } else {
      stage = switch (active['status']) {
        'assigned' || 'driver_en_route' => OrderStage.assigned,
        'picked_up' => OrderStage.inProgress,
        'completed' => OrderStage.arrived,
        'cancelled' || 'exception' => OrderStage.cancelledByDispatcher,
        _ => OrderStage.dispatching,
      };
    }
  }

  void setDark(bool value) {
    _themeMode = value ? ThemeMode.dark : ThemeMode.light;
    notifyListeners();
  }

  void toggleTheme() => setDark(!isDark);

  Future<void> createOrder(OrderRequest order) async {
    busy = true;
    lastError = null;
    notifyListeners();
    try {
      final now = DateTime.now();
      final created = await api.createOrder(
        pickup: order.from,
        dropoff: order.to,
        escort: order.escort,
        serviceAt: order.scheduledAt ?? now.add(const Duration(minutes: 5)),
        pickupLat: order.pickupLat,
        pickupLon: order.pickupLon,
        dropoffLat: order.dropoffLat,
        dropoffLon: order.dropoffLon,
      );
      _orders = [created, ..._orders];
      _syncOrderState();
    } on ApiException catch (error) {
      lastError = error.message;
      rethrow;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> repeatOrder() async {
    final order = activeOrder;
    if (order != null) await createOrder(order);
  }

  void setStage(OrderStage value) {
    stage = value;
    notifyListeners();
  }

  Future<void> cancelOrder() async {
    final id = activeOrder?.backendId;
    if (id != null) await api.cancelOrder(id);
    await refreshOrders();
  }

  void acceptOrder(DriverOrder order) => unawaited(_acceptOrder(order));

  Future<void> _acceptOrder(DriverOrder order) async {
    driverOrder = order;
    if (order.status == 'assigned') {
      await api.transitionDriverOrder(order.backendId, 'driver_en_route');
    }
    driverStage = switch (order.status) {
      'picked_up' => DriverStage.riding,
      'completed' => DriverStage.completed,
      _ => DriverStage.pickup,
    };
    notifyListeners();
  }

  void setDriverStage(DriverStage value) => unawaited(_setDriverStage(value));

  Future<void> _setDriverStage(DriverStage value) async {
    final order = driverOrder;
    if (order != null && value == DriverStage.riding) {
      await api.transitionDriverOrder(order.backendId, 'picked_up');
    } else if (order != null && value == DriverStage.completed) {
      await api.transitionDriverOrder(order.backendId, 'completed');
    }
    driverStage = value;
    notifyListeners();
    await refreshOrders();
  }

  void finishDriverJob() {
    driverStage = DriverStage.idle;
    driverOrder = null;
    unawaited(refreshOrders());
  }

  void signOut() => unawaited(_signOut());

  Future<void> _signOut() async {
    if (role == UserRole.driver) await _locationSync.stop();
    await api.logout();
    session = null;
    role = UserRole.none;
    activeOrder = null;
    stage = OrderStage.idle;
    driverStage = DriverStage.idle;
    driverOrder = null;
    _orders = const [];
    notifyListeners();
  }

  Future<void> deleteAccount() async {
    busy = true;
    lastError = null;
    notifyListeners();
    try {
      if (role == UserRole.driver) await _locationSync.stop();
      await api.deleteAccount();
      savedPhone = '';
      session = null;
      role = UserRole.none;
      activeOrder = null;
      stage = OrderStage.idle;
      driverStage = DriverStage.idle;
      driverOrder = null;
      _orders = const [];
    } on ApiException catch (error) {
      lastError = error.message;
      rethrow;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  OrderRequest _toOrderRequest(Map<String, dynamic> item) => OrderRequest(
    backendId: item['id'] as String?,
    status: item['status'] as String? ?? 'created',
    from: item['pickup_addr'] as String? ?? 'Адрес не указан',
    to: item['dropoff_addr'] as String? ?? 'Адрес не указан',
    pickupLat: (item['pickup_lat'] as num?)?.toDouble(),
    pickupLon: (item['pickup_lon'] as num?)?.toDouble(),
    dropoffLat: (item['dropoff_lat'] as num?)?.toDouble(),
    dropoffLon: (item['dropoff_lon'] as num?)?.toDouble(),
    escort: item['escort'] as bool? ?? false,
    scheduledAt: _parseServiceDate(item),
  );

  DriverOrder _toDriverOrder(Map<String, dynamic> item) => DriverOrder(
    backendId: item['id'] as String? ?? '',
    status: item['status'] as String? ?? 'assigned',
    passenger: 'Пассажир',
    timeLabel: '${item['service_date'] ?? ''}, ${item['desired_time'] ?? ''}',
    from: item['pickup_addr'] as String? ?? 'Адрес не указан',
    to: item['dropoff_addr'] as String? ?? 'Адрес не указан',
    escort: item['escort'] as bool? ?? false,
  );

  TripHistoryItem _toHistoryItem(Map<String, dynamic> item) => TripHistoryItem(
    id: (item['id'] as String? ?? '').split('-').first,
    dateLabel: '${item['service_date'] ?? ''} · ${item['desired_time'] ?? ''}',
    from: item['pickup_addr'] as String? ?? 'Адрес не указан',
    to: item['dropoff_addr'] as String? ?? 'Адрес не указан',
    minutes: 0,
    distanceKm: 0,
    escort: item['escort'] as bool? ?? false,
    status: item['status'] as String? ?? '',
  );

  DateTime? _parseServiceDate(Map<String, dynamic> item) {
    final date = item['service_date'] as String?;
    final time = item['desired_time'] as String?;
    if (date == null || time == null) return null;
    return DateTime.tryParse('${date}T$time');
  }

  @override
  void dispose() {
    _locationSync.dispose();
    api.dispose();
    super.dispose();
  }
}

enum DriverStage { idle, pickup, waiting, riding, completed }

enum OrderStage {
  idle,
  dispatching,
  cancelledByDispatcher,
  assigned,
  freeWaiting,
  inProgress,
  arrived,
}
