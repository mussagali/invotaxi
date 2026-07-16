import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/page_header.dart';

class ForceMajeureScreen extends StatefulWidget {
  const ForceMajeureScreen({super.key});
  @override
  State<ForceMajeureScreen> createState() => _ForceMajeureScreenState();
}

class _ForceMajeureScreenState extends State<ForceMajeureScreen> {
  int? _selected;

  static const _options = [
    ('Поломка автомобиля', Icons.build_outlined),
    ('ДТП', Icons.car_crash_outlined),
    ('Состояние здоровья', Icons.health_and_safety_outlined),
    ('Погода / дорога', Icons.cloud_outlined),
    ('Другая причина', Icons.more_horiz),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const AppBackButton(),
              const SizedBox(height: 20),
              Text(
                'Форс-мажор',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 20),
              for (int i = 0; i < _options.length; i++) ...[
                _OptionRow(
                  label: _options[i].$1,
                  icon: _options[i].$2,
                  selected: _selected == i,
                  onTap: () => setState(() => _selected = i),
                ),
                const SizedBox(height: 10),
              ],
              const Spacer(),
              PrimaryButton(
                label: 'Сообщить диспетчеру',
                enabled: _selected != null,
                onPressed: _selected == null
                    ? null
                    : () {
                        Navigator.of(context).pop();
                        showToast(context, 'Диспетчер уведомлён');
                      },
              ),
              const SizedBox(height: 10),
              TextLinkButton(
                label: 'Отмена',
                soft: false,
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OptionRow extends StatelessWidget {
  const _OptionRow({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      onTap: onTap,
      color: selected ? p.brandSoft : p.surface,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      child: Row(
        children: [
          SoftIconBox(icon: icon, size: 40, filled: selected),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: p.textPrimary,
              ),
            ),
          ),
          if (selected) Icon(Icons.check_circle, color: p.brand, size: 22),
        ],
      ),
    );
  }
}
