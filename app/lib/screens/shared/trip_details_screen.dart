import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../models/models.dart';
import '../../state/app_scope.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/map_background.dart';
import 'complaint_screen.dart';

class TripDetailsScreen extends StatelessWidget {
  const TripDetailsScreen({super.key, this.isDriver = false, this.item});
  final bool isDriver;
  final TripHistoryItem? item;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final history = context.app.history;
    final t = item ?? (history.isNotEmpty ? history.first : null);
    if (t == null) {
      return const Scaffold(body: Center(child: Text('Поездка не найдена')));
    }
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  SizedBox(
                    height: 220,
                    child: Stack(
                      children: [
                        const Positioned.fill(
                          child: MapBackground(showRoute: true, showPin: false),
                        ),
                        Positioned(
                          left: 16,
                          top: 8,
                          child: AppBackButton(
                            onPressed: () => Navigator.of(context).pop(),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Детали поездки',
                                style: Theme.of(
                                  context,
                                ).textTheme.headlineSmall,
                              ),
                            ),
                            StatusBadge(t.status),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${t.id} · ${t.minutes} мин',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: p.textTertiary,
                          ),
                        ),
                        const SizedBox(height: 16),
                        DetailRow(
                          icon: Icons.my_location,
                          label: 'Точка посадки',
                          value: t.from,
                        ),
                        const SizedBox(height: 10),
                        DetailRow(
                          icon: Icons.outlined_flag,
                          label: 'Пункт назначения',
                          value: t.to,
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: _StatBox(
                                label: 'Время',
                                value: '${t.minutes} мин',
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _StatBox(
                                label: 'Расстояние',
                                value:
                                    '${t.distanceKm.toString().replaceAll('.', ',')} км',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        _PersonRow(isDriver: isDriver, escort: t.escort),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 6, 18, 14),
              child: Column(
                children: [
                  PrimaryButton(
                    label: 'Подать жалобу',
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            ComplaintScreen(isDriver: isDriver, tripId: t.id),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextLinkButton(
                    label: 'Закрыть',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatBox extends StatelessWidget {
  const _StatBox({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: p.surfaceAlt,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w500,
              color: p.textTertiary,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: p.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.isDriver, required this.escort});
  final bool isDriver;
  final bool escort;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final driver = context.app.assignedDriver;
    final name = isDriver ? 'Пассажир' : driver.name;
    final role = isDriver ? 'Пассажир' : driver.car;
    return AppCard(
      color: p.surfaceAlt,
      border: false,
      radius: 16,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          SoftIconBox(
            icon: isDriver ? Icons.person_outline : Icons.local_taxi_outlined,
            size: 36,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: p.textPrimary,
                  ),
                ),
                Text(
                  role,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: p.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          if (escort) StatusBadge('Сопровождающий'),
        ],
      ),
    );
  }
}
