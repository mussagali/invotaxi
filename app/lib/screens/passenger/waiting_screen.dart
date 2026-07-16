import 'dart:async';
import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_scope.dart';
import '../../widgets/buttons.dart';
import '../../widgets/pulse.dart';
import '../../widgets/page_header.dart';

class _Step {
  final String title;
  final String body;
  const _Step(this.title, this.body);
}

const _steps = [
  _Step('Передано диспетчеру', 'Заказ в очереди на проверку'),
  _Step('Проверка профиля', 'Категория и право на сопровождение'),
  _Step('Голосовое подтверждение', 'Ожидаем звонок диспетчера'),
  _Step('Звонок подтверждён', 'Назначение водителя'),
];

class WaitingScreen extends StatefulWidget {
  const WaitingScreen({super.key});
  @override
  State<WaitingScreen> createState() => _WaitingScreenState();
}

class _WaitingScreenState extends State<WaitingScreen> {
  static const _sla = 90;
  int _elapsed = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      setState(() => _elapsed++);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  int get _activeStep => 0;

  void _confirmCancel() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _CancelSheet(
        onConfirm: () {
          Navigator.of(ctx).pop();
          unawaited(context.appRead.cancelOrder());
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final remaining = (_sla - _elapsed).clamp(0, _sla);
    final mm = (remaining ~/ 60).toString().padLeft(2, '0');
    final ss = (remaining % 60).toString().padLeft(2, '0');

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Ожидает решения\nдиспетчера',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 20),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  vertical: 24,
                  horizontal: 18,
                ),
                decoration: BoxDecoration(
                  color: p.brandSoft,
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Column(
                  children: [
                    const PulseIndicator(icon: Icons.autorenew, size: 118),
                    const SizedBox(height: 22),
                    Row(
                      children: [
                        Text(
                          'Ожидание · SLA 90 сек',
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: p.onBrandSoft,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          'Осталось $mm:$ss',
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: p.textSecondary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: _elapsed / _sla,
                        minHeight: 4,
                        backgroundColor: p.brand.withValues(alpha: 0.2),
                        color: p.brand,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Expanded(
                child: ListView.builder(
                  itemCount: _steps.length,
                  itemBuilder: (context, i) {
                    final done = i < _activeStep;
                    final active = i == _activeStep;
                    return _StepRow(
                      step: _steps[i],
                      done: done,
                      active: active,
                      index: i + 1,
                    );
                  },
                ),
              ),
              Row(
                children: [
                  Icon(Icons.phone_outlined, size: 16, color: p.textTertiary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Диспетчер может позвонить для уточнения деталей. Не выключайте телефон.',
                      style: TextStyle(
                        fontSize: 11.5,
                        height: 1.35,
                        fontWeight: FontWeight.w500,
                        color: p.textTertiary,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextLinkButton(
                label: 'Позвонить диспетчеру',
                icon: Icons.phone,
                onPressed: () => showToast(context, 'Звоним диспетчеру…'),
              ),
              const SizedBox(height: 10),
              PrimaryButton(
                label: 'Отменить',
                icon: Icons.close,
                onPressed: _confirmCancel,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CancelSheet extends StatelessWidget {
  const _CancelSheet({required this.onConfirm});
  final VoidCallback onConfirm;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 18),
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
              const SizedBox(height: 18),
              Text(
                'Отменить заказ?',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                'Если вы отмените сейчас, диспетчер увидит причину. '
                'Частые отмены влияют на приоритет в очереди.',
                style: TextStyle(
                  fontSize: 13.5,
                  height: 1.4,
                  fontWeight: FontWeight.w500,
                  color: p.textSecondary,
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(label: 'Да, отменить', onPressed: onConfirm),
              const SizedBox(height: 10),
              TextLinkButton(
                label: 'Оставить заказ',
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({
    required this.step,
    required this.done,
    required this.active,
    required this.index,
  });
  final _Step step;
  final bool done;
  final bool active;
  final int index;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: done ? p.brand : (active ? p.brand : p.surfaceAlt),
              shape: BoxShape.circle,
            ),
            child: done
                ? const Icon(Icons.check, size: 16, color: Colors.white)
                : active
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: Padding(
                      padding: EdgeInsets.all(6),
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    ),
                  )
                : Center(
                    child: Text(
                      '$index',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: p.textTertiary,
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
                  step.title,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: (done || active) ? p.textPrimary : p.textTertiary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  step.body,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: p.textTertiary,
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
