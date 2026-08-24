import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_state.dart';
import '../../state/app_scope.dart';
import '../../services/external_navigation.dart';
import '../../models/models.dart';
import '../../widgets/buttons.dart';
import '../../widgets/page_header.dart';
import '../shared/emergency_screen.dart';
import '../shared/map_picker_screen.dart';

class RideStepsScreen extends StatefulWidget {
  const RideStepsScreen({super.key});
  @override
  State<RideStepsScreen> createState() => _RideStepsScreenState();
}

class _RideStepsScreenState extends State<RideStepsScreen> {
  int _step = 0; // 0..4

  bool get _stop1Done => _step >= 2;
  bool get _stop2Done => _step >= 4;
  int get _activeStop => _step < 2 ? 1 : (_step < 4 ? 2 : 0);

  void _advance() {
    if (_step >= 4) {
      context.appRead.setDriverStage(DriverStage.completed);
      return;
    }
    setState(() => _step++);
  }

  Future<void> _correctCurrentPoint(DriverOrder order) async {
    final pickup = _step < 2;
    final place = await Navigator.of(context).push<Place>(
      MaterialPageRoute(
        builder: (_) => MapPickerScreen(
          title: pickup
              ? 'Уточнить точку посадки'
              : 'Уточнить пункт назначения',
          latitude: pickup ? order.pickupLat : order.dropoffLat,
          longitude: pickup ? order.pickupLon : order.dropoffLon,
        ),
      ),
    );
    if (place == null || !mounted) return;
    try {
      await context.appRead.correctDriverOrderAddress(
        order: order,
        pickup: pickup,
        place: place,
      );
      if (mounted) showToast(context, 'Адрес поездки обновлён');
    } on Exception catch (error) {
      if (mounted) showToast(context, error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.app;
    final order = app.driverOrder;

    late String label;
    late PrimaryButtonKind kind;
    switch (_step) {
      case 0:
        label = 'Прибыл на точку';
        kind = PrimaryButtonKind.dark;
        break;
      case 1:
        label = 'Посадил пассажира';
        kind = PrimaryButtonKind.filled;
        break;
      case 2:
        label = 'Прибыл на точку';
        kind = PrimaryButtonKind.dark;
        break;
      case 3:
        label = 'Высадил пассажира';
        kind = PrimaryButtonKind.filled;
        break;
      default:
        label = 'Завершить поездку';
        kind = PrimaryButtonKind.filled;
    }

    return Scaffold(
      body: Column(
        children: [
          Container(
            height: 150,
            color: context.palette.brandSoft,
            child: const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.navigation, size: 42),
                  SizedBox(height: 8),
                  Text('Навигация строится в Яндекс Навигаторе или 2ГИС'),
                ],
              ),
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
              children: [
                Text(
                  'Поездка',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w500,
                    color: context.palette.textTertiary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '4,2 км · 12 мин',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 16),
                _StopRow(
                  index: 1,
                  kind: 'Посадка',
                  value: order?.from ?? 'Адрес не указан',
                  done: _stop1Done,
                  active: _activeStop == 1,
                ),
                const SizedBox(height: 10),
                _StopRow(
                  index: 2,
                  kind: 'Высадка',
                  value: order?.to ?? 'Адрес не указан',
                  done: _stop2Done,
                  active: _activeStop == 2,
                ),
                const SizedBox(height: 16),
                PrimaryButton(
                  label: 'Открыть маршрут в Яндекс / 2ГИС',
                  kind: PrimaryButtonKind.outline,
                  onPressed: order == null
                      ? null
                      : () {
                          final toDropoff = _step >= 2;
                          showExternalNavigationPicker(
                            context,
                            destination: toDropoff ? order.to : order.from,
                            latitude: toDropoff
                                ? order.dropoffLat
                                : order.pickupLat,
                            longitude: toDropoff
                                ? order.dropoffLon
                                : order.pickupLon,
                          );
                        },
                ),
                const SizedBox(height: 10),
                PrimaryButton(
                  label: _step < 2
                      ? 'Исправить точку посадки на карте'
                      : 'Исправить пункт назначения на карте',
                  kind: PrimaryButtonKind.outline,
                  onPressed: order == null
                      ? null
                      : () => _correctCurrentPoint(order),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _Chip(
                        icon: Icons.chat_bubble_outline,
                        label: 'Чат',
                        onTap: () => showToast(context, 'Чат с пассажиром'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _Chip(
                        icon: Icons.report_gmailerrorred,
                        label: 'Конфликт',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) =>
                                const EmergencyScreen(isDriver: true),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _Chip(
                        icon: Icons.ios_share,
                        label: 'Поделиться',
                        onTap: () => showToast(context, 'Ссылка скопирована'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                PrimaryButton(label: label, kind: kind, onPressed: _advance),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StopRow extends StatelessWidget {
  const _StopRow({
    required this.index,
    required this.kind,
    required this.value,
    required this.done,
    required this.active,
  });
  final int index;
  final String kind;
  final String value;
  final bool done;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: active ? p.brandSoft : p.surfaceAlt,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: active ? p.brand : Colors.transparent,
          width: 1.4,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: done ? const Color(0xFF17171B) : p.brand,
              shape: BoxShape.circle,
            ),
            child: done
                ? const Icon(Icons.check, size: 15, color: Colors.white)
                : Center(
                    child: Text(
                      '$index',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  kind,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w500,
                    color: p.textTertiary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: p.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: p.brandSoft,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            children: [
              Icon(icon, size: 20, color: p.brand),
              const SizedBox(height: 5),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: p.brand,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
