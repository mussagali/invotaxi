import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_scope.dart';
import '../../models/models.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/page_header.dart';

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
          children: [
            Text('Заказы', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            for (final o in context.app.driverOrders) ...[
              _OrderCard(order: o),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order});
  final DriverOrder order;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
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
                      order.passenger,
                      style: TextStyle(
                        fontSize: 16,
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
          const SizedBox(height: 10),
          StatusBadge(order.timeLabel, icon: Icons.event),
          const SizedBox(height: 14),
          _Point(
            icon: Icons.my_location,
            label: 'Точка посадки',
            value: order.from,
          ),
          const SizedBox(height: 10),
          _Point(
            icon: Icons.outlined_flag,
            label: 'Пункт назначения',
            value: order.to,
          ),
          const SizedBox(height: 16),
          PrimaryButton(
            label: 'Принять заказ',
            onPressed: () => context.appRead.acceptOrder(order),
          ),
        ],
      ),
    );
  }
}

class _Point extends StatelessWidget {
  const _Point({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Row(
      children: [
        SoftIconBox(icon: icon, size: 36),
        const SizedBox(width: 12),
        Expanded(
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
    );
  }
}
