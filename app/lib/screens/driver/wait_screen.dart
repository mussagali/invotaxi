import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_state.dart';
import '../../state/app_scope.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/map_background.dart';

class WaitScreen extends StatelessWidget {
  const WaitScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final app = context.app;
    final order = app.driverOrder;
    return Scaffold(
      body: Column(
        children: [
          SizedBox(height: 180, child: MapBackground(showPin: true)),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
              children: [
                Center(
                  child: Column(
                    children: [
                      Text(
                        'Бесплатное ожидание',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: p.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '20:00',
                        style: TextStyle(
                          fontSize: 56,
                          fontWeight: FontWeight.w800,
                          height: 1.0,
                          letterSpacing: -1,
                          color: p.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Ждите пассажира до окончания таймера',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w500,
                          color: p.textTertiary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                _PickupPointRow(from: order?.from ?? 'Адрес не указан'),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: p.brandSoft,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.videocam_outlined, size: 18, color: p.brand),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'После «Начать поездку» автоматически включится '
                          'запись салона до завершения поездки.',
                          style: TextStyle(
                            fontSize: 12,
                            height: 1.35,
                            fontWeight: FontWeight.w500,
                            color: p.onBrandSoft,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                PrimaryButton(
                  label: 'Начать поездку',
                  onPressed: () => app.setDriverStage(DriverStage.riding),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PickupPointRow extends StatelessWidget {
  const _PickupPointRow({required this.from});
  final String from;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      color: p.surfaceAlt,
      border: false,
      radius: 16,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(color: p.brand, shape: BoxShape.circle),
            child: const Center(
              child: Text(
                'A',
                style: TextStyle(
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
                  from,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: p.textPrimary,
                  ),
                ),
                Text(
                  'Точка посадки',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w500,
                    color: p.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          RoundSoftButton(icon: Icons.chat_bubble_outline),
          const SizedBox(width: 8),
          RoundSoftButton(icon: Icons.phone),
        ],
      ),
    );
  }
}
