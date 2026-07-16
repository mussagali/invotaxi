import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../models/models.dart';
import '../../state/app_scope.dart';
import '../../widgets/common.dart';
import 'trip_details_screen.dart';
import 'complaint_screen.dart';

class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key, required this.isDriver});
  final bool isDriver;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
          children: [
            Text(
              'История поездок',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Жалобу можно подать в течение 7 дней после завершения. '
              'Видео хранится столько же.',
              style: TextStyle(
                fontSize: 13,
                height: 1.4,
                fontWeight: FontWeight.w500,
                color: p.textSecondary,
              ),
            ),
            const SizedBox(height: 18),
            for (final t in context.app.history) ...[
              _TripCard(item: t, isDriver: isDriver),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }
}

class _TripCard extends StatelessWidget {
  const _TripCard({required this.item, required this.isDriver});
  final TripHistoryItem item;
  final bool isDriver;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => TripDetailsScreen(isDriver: isDriver, item: item),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                item.dateLabel,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: p.textSecondary,
                ),
              ),
              const Spacer(),
              StatusBadge(item.status),
            ],
          ),
          const SizedBox(height: 12),
          _Line(label: 'Откуда', value: item.from),
          const SizedBox(height: 6),
          _Line(label: 'Куда', value: item.to),
          const SizedBox(height: 12),
          Divider(height: 1, color: p.border),
          const SizedBox(height: 10),
          Row(
            children: [
              Text(
                '${item.id} · ${item.minutes} мин',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: p.textTertiary,
                ),
              ),
              const Spacer(),
              GestureDetector(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) =>
                        ComplaintScreen(isDriver: isDriver, tripId: item.id),
                  ),
                ),
                child: Row(
                  children: [
                    Text(
                      'Жалоба',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: p.brand,
                      ),
                    ),
                    Icon(Icons.chevron_right, size: 18, color: p.brand),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 54,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w500,
              color: p.textTertiary,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              color: p.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}
