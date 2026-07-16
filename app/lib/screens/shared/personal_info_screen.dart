import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_scope.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/page_header.dart';

class PersonalInfoScreen extends StatelessWidget {
  const PersonalInfoScreen({super.key, required this.isDriver});
  final bool isDriver;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final app = context.app;
    final profile = app.session?.profile ?? const <String, dynamic>{};
    final name = app.profileName;

    final fields = isDriver
        ? [
            _Field(
              Icons.directions_car_outlined,
              'Автомобиль',
              profile['vehicle_model'] as String? ?? 'Не указан',
            ),
            _Field(
              Icons.badge_outlined,
              'Госномер',
              profile['plate'] as String? ?? 'Не указан',
            ),
            _Field(
              Icons.location_city_outlined,
              'Регион',
              profile['region'] as String? ?? 'Казахстан',
            ),
          ]
        : [
            _Field(
              Icons.accessible,
              'Нужен сопровождающий',
              profile['needs_escort'] == true ? 'Да' : 'Нет',
            ),
            _Field(
              Icons.notes_outlined,
              'Примечание',
              profile['notes'] as String? ?? 'Нет',
            ),
          ];

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 8),
                children: [
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: AppBackButton(),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'Персональная\nинформация',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: p.textPrimary,
                              ),
                            ),
                            Text(
                              app.phone,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w500,
                                color: p.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  for (final f in fields) ...[
                    DetailRow(icon: f.icon, label: f.label, value: f.value),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 6, 18, 14),
              child: PrimaryButton(
                label: 'Изменить имя',
                onPressed: app.busy
                    ? null
                    : () async {
                        final controller = TextEditingController(text: name);
                        final value = await showDialog<String>(
                          context: context,
                          builder: (dialogContext) => AlertDialog(
                            title: const Text('Ваше имя'),
                            content: TextField(
                              controller: controller,
                              autofocus: true,
                              maxLength: 200,
                              textCapitalization: TextCapitalization.words,
                              decoration: const InputDecoration(
                                labelText: 'Имя',
                              ),
                            ),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(dialogContext),
                                child: const Text('Отмена'),
                              ),
                              FilledButton(
                                onPressed: () => Navigator.pop(
                                  dialogContext,
                                  controller.text.trim(),
                                ),
                                child: const Text('Сохранить'),
                              ),
                            ],
                          ),
                        );
                        controller.dispose();
                        if (value == null ||
                            value.isEmpty ||
                            !context.mounted) {
                          return;
                        }
                        try {
                          await app.updateProfileName(value);
                          if (context.mounted) {
                            showToast(context, 'Имя сохранено');
                          }
                        } catch (error) {
                          if (context.mounted) {
                            showToast(context, error.toString());
                          }
                        }
                      },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Field {
  final IconData icon;
  final String label;
  final String value;
  const _Field(this.icon, this.label, this.value);
}
