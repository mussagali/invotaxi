import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_scope.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/pulse.dart';
import '../../widgets/page_header.dart';

class OrderCancelledScreen extends StatelessWidget {
  const OrderCancelledScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final app = context.app;
    final order = app.activeOrder;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Заказ отменён\nдиспетчером',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 20),
              Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    vertical: 26,
                    horizontal: 18,
                  ),
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: p.brandSoft,
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: const Center(
                    child: PulseIndicator(
                      icon: Icons.close,
                      size: 110,
                      spinning: false,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'Диспетчер не смог подтвердить заказ. Точки A и B сохранены — '
                'можно повторить за один шаг.',
                style: TextStyle(
                  fontSize: 13.5,
                  height: 1.45,
                  fontWeight: FontWeight.w500,
                  color: p.textSecondary,
                ),
              ),
              const SizedBox(height: 18),
              DetailRow(
                icon: Icons.info_outline,
                label: 'Причина',
                value: 'Пассажир не верифицирован.',
              ),
              const SizedBox(height: 10),
              DetailRow(
                icon: Icons.my_location,
                label: 'Сохранённый маршрут',
                value: order?.from ?? '—',
              ),
              const SizedBox(height: 10),
              DetailRow(
                icon: Icons.outlined_flag,
                label: 'Пункт назначения',
                value: order?.to ?? '—',
              ),
              const SizedBox(height: 10),
              DetailRow(
                icon: Icons.accessible,
                label: 'Сопровождающий',
                value: (order?.escort ?? false) ? 'Включён' : 'Выключен',
              ),
              const Spacer(),
              PrimaryButton(
                label: 'Повторить заказ',
                icon: Icons.refresh,
                onPressed: () => app.repeatOrder(),
              ),
              const SizedBox(height: 10),
              TextLinkButton(
                label: 'Позвонить диспетчеру',
                icon: Icons.phone,
                onPressed: () => showToast(context, 'Звоним диспетчеру…'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
