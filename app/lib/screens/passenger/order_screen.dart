import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_scope.dart';
import '../../models/models.dart';
import '../../services/location_context_service.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/map_background.dart';
import '../../widgets/page_header.dart';
import 'address_search_screen.dart';
import 'schedule_screen.dart';

class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key});
  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  String _from = '';
  String _to = '';
  double? _pickupLat;
  double? _pickupLon;
  double? _dropoffLat;
  double? _dropoffLon;
  bool _escort = false;
  DateTime? _scheduledAt;
  CityLocationContext? _locationContext;
  bool _detectingLocation = true;
  String? _locationError;

  @override
  void initState() {
    super.initState();
    _detectCurrentLocation();
  }

  Future<void> _detectCurrentLocation({bool force = false}) async {
    setState(() {
      _detectingLocation = true;
      _locationError = null;
    });
    try {
      final location = await LocationContextService.detectCurrentCity(
        force: force,
      );
      if (!mounted) return;
      setState(() {
        _locationContext = location;
        _from = location.currentAddress;
        _pickupLat = location.position.latitude;
        _pickupLon = location.position.longitude;
        _detectingLocation = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _detectingLocation = false;
        _locationError = error.toString();
      });
    }
  }

  Future<void> _pick(bool isFrom) async {
    var location = _locationContext;
    if (location == null) {
      await _detectCurrentLocation(force: true);
      if (!mounted) return;
      location = _locationContext;
    }
    if (location == null) {
      showToast(
        context,
        _locationError ?? 'Не удалось определить текущий город',
      );
      return;
    }
    final result = await Navigator.of(context).push<Place>(
      MaterialPageRoute(
        builder: (_) => AddressSearchScreen(
          from: _from,
          to: _to,
          editingFrom: isFrom,
          locationContext: location!,
        ),
      ),
    );
    if (result != null) {
      setState(() {
        if (isFrom) {
          _from = result.displayName;
          _pickupLat = result.lat;
          _pickupLon = result.lon;
        } else {
          _to = result.displayName;
          _dropoffLat = result.lat;
          _dropoffLon = result.lon;
        }
      });
    }
  }

  Future<void> _schedule() async {
    final dt = await Navigator.of(
      context,
    ).push<DateTime>(MaterialPageRoute(builder: (_) => const ScheduleScreen()));
    if (dt != null) setState(() => _scheduledAt = dt);
  }

  Future<void> _order() async {
    if (_from.trim().isEmpty || _to.trim().isEmpty) {
      showToast(context, 'Выберите адрес посадки и назначения');
      return;
    }
    try {
      await context.appRead.createOrder(
        OrderRequest(
          from: _from,
          to: _to,
          pickupLat: _pickupLat,
          pickupLon: _pickupLon,
          dropoffLat: _dropoffLat,
          dropoffLon: _dropoffLon,
          escort: _escort,
          scheduledAt: _scheduledAt,
        ),
      );
    } catch (_) {
      if (mounted) {
        showToast(
          context,
          context.appRead.lastError ?? 'Не удалось создать заказ',
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: MapBackground(showPin: true)),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              decoration: BoxDecoration(
                color: p.surface,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(28),
                ),
                boxShadow: [
                  BoxShadow(
                    color: p.shadow,
                    blurRadius: 24,
                    offset: const Offset(0, -6),
                  ),
                ],
              ),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 14),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Center(
                        child: Container(
                          width: 40,
                          height: 4,
                          decoration: BoxDecoration(
                            color: p.border,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Куда едем?',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 8),
                      if (_detectingLocation)
                        Row(
                          children: [
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: p.brand,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'Определяем город и точный адрес…',
                              style: TextStyle(
                                fontSize: 12.5,
                                color: p.textSecondary,
                              ),
                            ),
                          ],
                        )
                      else if (_locationContext case final location?)
                        Row(
                          children: [
                            Icon(Icons.my_location, size: 16, color: p.brand),
                            const SizedBox(width: 7),
                            Expanded(
                              child: Text(
                                location.cityName,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                  color: p.textSecondary,
                                ),
                              ),
                            ),
                            Text(
                              location.accuracyLabel,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: location.isFiveMeterFix
                                    ? Colors.green
                                    : Colors.orange,
                              ),
                            ),
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              tooltip: 'Уточнить местоположение',
                              onPressed: () =>
                                  _detectCurrentLocation(force: true),
                              icon: const Icon(Icons.refresh, size: 18),
                            ),
                          ],
                        )
                      else
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _locationError ??
                                    'Не удалось определить геопозицию',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Colors.redAccent,
                                ),
                              ),
                            ),
                            TextButton(
                              onPressed: () =>
                                  _detectCurrentLocation(force: true),
                              child: const Text('Повторить'),
                            ),
                          ],
                        ),
                      const SizedBox(height: 16),
                      _AddressField(
                        icon: Icons.my_location,
                        label: 'Точка посадки',
                        value: _from,
                        onTap: () => _pick(true),
                      ),
                      const SizedBox(height: 10),
                      _AddressField(
                        icon: Icons.outlined_flag,
                        label: 'Пункт назначения',
                        value: _to,
                        onTap: () => _pick(false),
                      ),
                      const SizedBox(height: 10),
                      _EscortRow(
                        value: _escort,
                        onChanged: (v) => setState(() => _escort = v),
                      ),
                      if (_scheduledAt != null) ...[
                        const SizedBox(height: 10),
                        _ScheduledRow(
                          at: _scheduledAt!,
                          onClear: () => setState(() => _scheduledAt = null),
                        ),
                      ],
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          SquareIconButton(
                            icon: Icons.schedule,
                            size: 56,
                            onPressed: _schedule,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: PrimaryButton(
                              label: _scheduledAt == null
                                  ? 'Заказать'
                                  : 'Запланировать',
                              onPressed: _order,
                            ),
                          ),
                          const SizedBox(width: 10),
                          SquareIconButton(
                            icon: Icons.tune,
                            size: 56,
                            onPressed: () =>
                                showToast(context, 'Дополнительные параметры'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Center(
                        child: Text(
                          'После заказа потребуется голосовое подтверждение диспетчеру',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 12,
                            height: 1.35,
                            fontWeight: FontWeight.w500,
                            color: p.textTertiary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AddressField extends StatelessWidget {
  const _AddressField({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return DetailRow(
      icon: icon,
      label: label,
      value: value,
      onTap: onTap,
      trailing: MiniPill(label: 'Карта', onTap: onTap),
    );
  }
}

class _EscortRow extends StatelessWidget {
  const _EscortRow({required this.value, required this.onChanged});
  final bool value;
  final ValueChanged<bool> onChanged;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      color: p.surfaceAlt,
      border: false,
      radius: 16,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          SoftIconBox(icon: Icons.accessible, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Сопровождающий',
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: p.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Доступно I группы и детей-инвалидов',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w500,
                    color: p.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

class _ScheduledRow extends StatelessWidget {
  const _ScheduledRow({required this.at, required this.onClear});
  final DateTime at;
  final VoidCallback onClear;
  @override
  Widget build(BuildContext context) {
    const months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ];
    final label =
        '${at.day} ${months[at.month - 1]}, ${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
    return DetailRow(
      icon: Icons.event,
      label: 'Запланировано',
      value: label,
      trailing: IconButton(
        icon: const Icon(Icons.close, size: 18),
        onPressed: onClear,
      ),
    );
  }
}
