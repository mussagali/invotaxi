import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_state.dart';
import '../../state/app_scope.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/map_background.dart';
import '../../widgets/page_header.dart';
import 'force_majeure_screen.dart';

class PickupScreen extends StatelessWidget {
  const PickupScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final app = context.app;
    final order = app.driverOrder;
    return Scaffold(
      body: Column(
        children: [
          SizedBox(height: 200, child: MapBackground(showPin: true)),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Пассажир',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w500,
                              color: p.textTertiary,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            order?.passenger ?? 'Пассажир',
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                              color: p.textPrimary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    RoundSoftButton(
                      icon: Icons.chat_bubble_outline,
                      onPressed: () => showToast(context, 'Чат с пассажиром'),
                    ),
                    const SizedBox(width: 8),
                    RoundSoftButton(
                      icon: Icons.phone,
                      onPressed: () => showToast(context, 'Звоним пассажиру…'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                DetailRow(
                  icon: Icons.my_location,
                  label: 'Точка посадки',
                  value: order?.from ?? 'Адрес не указан',
                ),
                const SizedBox(height: 10),
                DetailRow(
                  icon: Icons.outlined_flag,
                  label: 'Пункт назначения',
                  value: order?.to ?? 'Адрес не указан',
                ),
                const SizedBox(height: 20),
                PrimaryButton(
                  label: 'Я приехал',
                  onPressed: () => app.setDriverStage(DriverStage.waiting),
                ),
                const SizedBox(height: 10),
                PrimaryButton(
                  label: 'Конфликт',
                  kind: PrimaryButtonKind.outline,
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const ForceMajeureScreen(),
                    ),
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
