import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';

class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key});
  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  late DateTime _date;
  int _hour = 9;
  int _minute = 0;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now().add(const Duration(hours: 1));
    _date = DateTime(now.year, now.month, now.day);
    _hour = now.hour;
    _minute = (now.minute ~/ 5) * 5;
  }

  static const _weekdays = [
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота',
    'Воскресенье',
  ];
  static const _months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];

  void _quick(Duration d) {
    final t = DateTime.now().add(d);
    setState(() {
      _date = DateTime(t.year, t.month, t.day);
      _hour = t.hour;
      _minute = (t.minute ~/ 5) * 5;
    });
  }

  void _quickTomorrow() {
    final t = DateTime.now().add(const Duration(days: 1));
    setState(() {
      _date = DateTime(t.year, t.month, t.day);
      _hour = 19;
      _minute = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final labelDate =
        '${_weekdays[_date.weekday - 1]}, ${_date.day} ${_months[_date.month - 1]}, '
        '${_hour.toString().padLeft(2, '0')}:${_minute.toString().padLeft(2, '0')}';

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: AppBackButton(),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'Когда подать машину?',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    labelDate,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: p.brand,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Не раньше чем через 1 час от сейчас.',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w500,
                      color: p.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 8),
                children: [
                  const SectionLabel('Быстрый выбор'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _quickChip(
                        'Через 1 ч',
                        () => _quick(const Duration(hours: 1)),
                      ),
                      _quickChip(
                        'Через 2 ч',
                        () => _quick(const Duration(hours: 2)),
                      ),
                      _quickChip(
                        'Через 3 ч',
                        () => _quick(const Duration(hours: 3)),
                      ),
                      _quickChip('Завтра, 19:00', _quickTomorrow),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const SectionLabel('День'),
                  AppCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    child: CalendarDatePicker(
                      initialDate: _date,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 60)),
                      onDateChanged: (d) => setState(
                        () => _date = DateTime(d.year, d.month, d.day),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  const SectionLabel('Время'),
                  AppCard(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: SizedBox(
                      height: 120,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          _wheel(24, _hour, (v) => setState(() => _hour = v)),
                          Text(
                            ':',
                            style: TextStyle(
                              fontSize: 30,
                              fontWeight: FontWeight.w700,
                              color: p.textPrimary,
                            ),
                          ),
                          _wheel(
                            12,
                            _minute ~/ 5,
                            (v) => setState(() => _minute = v * 5),
                            multiplier: 5,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 6, 18, 14),
              child: PrimaryButton(
                label: 'Готово',
                onPressed: () => Navigator.of(context).pop(
                  DateTime(_date.year, _date.month, _date.day, _hour, _minute),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _quickChip(String label, VoidCallback onTap) {
    final p = context.palette;
    return Material(
      color: p.surfaceAlt,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: p.textPrimary,
            ),
          ),
        ),
      ),
    );
  }

  Widget _wheel(
    int count,
    int selected,
    ValueChanged<int> onChanged, {
    int multiplier = 1,
  }) {
    final p = context.palette;
    return SizedBox(
      width: 70,
      child: ListWheelScrollView.useDelegate(
        controller: FixedExtentScrollController(initialItem: selected),
        itemExtent: 44,
        physics: const FixedExtentScrollPhysics(),
        perspective: 0.004,
        onSelectedItemChanged: onChanged,
        childDelegate: ListWheelChildBuilderDelegate(
          childCount: count,
          builder: (context, i) {
            final active = i == selected;
            return Center(
              child: Text(
                (i * multiplier).toString().padLeft(2, '0'),
                style: TextStyle(
                  fontSize: active ? 30 : 22,
                  fontWeight: FontWeight.w700,
                  color: active ? p.textPrimary : p.textTertiary,
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
