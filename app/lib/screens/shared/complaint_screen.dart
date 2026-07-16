import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../models/models.dart';
import '../../data/static_content.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/inputs.dart';
import '../../widgets/page_header.dart';

class ComplaintScreen extends StatefulWidget {
  const ComplaintScreen({
    super.key,
    required this.isDriver,
    required this.tripId,
  });
  final bool isDriver;
  final String tripId;

  @override
  State<ComplaintScreen> createState() => _ComplaintScreenState();
}

class _ComplaintScreenState extends State<ComplaintScreen> {
  int? _selected;
  final _description = TextEditingController();

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  List<ComplaintType> get _types => widget.isDriver
      ? StaticContent.driverComplaintTypes
      : StaticContent.passengerComplaintTypes;

  void _submit() {
    if (_selected == null) {
      showToast(context, 'Выберите тип проблемы');
      return;
    }
    Navigator.of(context).pop();
    showToast(context, 'Жалоба отправлена. Мы свяжемся с вами.');
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
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
                  const SizedBox(height: 16),
                  Text(
                    'Жалоба',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Поездка ${widget.tripId}',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: p.textTertiary,
                    ),
                  ),
                  const SizedBox(height: 16),
                  _VideoCard(),
                  const SizedBox(height: 20),
                  const SectionLabel('Тип проблемы'),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _types.length,
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          mainAxisSpacing: 10,
                          crossAxisSpacing: 10,
                          childAspectRatio: 1.95,
                        ),
                    itemBuilder: (context, i) {
                      final t = _types[i];
                      final sel = _selected == i;
                      return _TypeCard(
                        type: t,
                        selected: sel,
                        onTap: () => setState(() => _selected = i),
                      );
                    },
                  ),
                  const SizedBox(height: 20),
                  const SectionLabel('Описание'),
                  AppTextField(
                    controller: _description,
                    hint: widget.isDriver
                        ? 'Что произошло, когда и кто участвовал. Минимум 10 символов.'
                        : 'Что произошло, когда и кто участвовал. Минимум 10 символов.',
                    maxLines: 4,
                    minLines: 3,
                  ),
                  const SizedBox(height: 20),
                  const SectionLabel('Файл (необязательно)'),
                  _AttachBox(),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Icon(
                        Icons.error_outline,
                        size: 15,
                        color: p.textTertiary,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Срок подачи · 7 дней',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: p.textTertiary,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 6, 18, 14),
              child: PrimaryButton(
                label: widget.isDriver
                    ? 'Сообщить о проблеме'
                    : 'Отправить жалобу',
                onPressed: _submit,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VideoCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
            child: Stack(
              children: [
                Image.asset(
                  'assets/images/car_interior.jpg',
                  height: 170,
                  width: double.infinity,
                  fit: BoxFit.cover,
                ),
                Positioned.fill(
                  child: Container(color: Colors.black.withValues(alpha: 0.12)),
                ),
                const Positioned.fill(
                  child: Center(
                    child: CircleAvatar(
                      radius: 22,
                      backgroundColor: Colors.white,
                      child: Icon(
                        Icons.play_arrow_rounded,
                        color: AppPalette.brandColor,
                        size: 26,
                      ),
                    ),
                  ),
                ),
                Positioned(
                  right: 12,
                  bottom: 10,
                  child: Text(
                    '00:00 / 27:35',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: p.brand,
                    ),
                  ),
                ),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 30,
                  child: Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: p.brand,
                          shape: BoxShape.circle,
                        ),
                      ),
                      Expanded(
                        child: Container(
                          height: 2,
                          color: Colors.white.withValues(alpha: 0.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              'Запись с регистратора или салона поможет быстрее разобраться '
              'в ситуации. Доступ к фрагменту только у службы поддержки.',
              style: TextStyle(
                fontSize: 12,
                height: 1.35,
                fontWeight: FontWeight.w500,
                color: p.textTertiary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TypeCard extends StatelessWidget {
  const _TypeCard({
    required this.type,
    required this.selected,
    required this.onTap,
  });
  final ComplaintType type;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: selected ? p.brand : p.surface,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? p.brand : p.border,
              width: 1.3,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                type.title,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                  color: selected ? Colors.white : p.textPrimary,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                type.subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  height: 1.25,
                  fontWeight: FontWeight.w500,
                  color: selected
                      ? Colors.white.withValues(alpha: 0.85)
                      : p.textTertiary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AttachBox extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return DottedContainer(
      child: Row(
        children: [
          Icon(Icons.attach_file, size: 18, color: p.textSecondary),
          const SizedBox(width: 10),
          Text(
            'Прикрепить фото или PDF',
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w500,
              color: p.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class DottedContainer extends StatelessWidget {
  const DottedContainer({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      decoration: BoxDecoration(
        color: p.surfaceAlt,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: p.border, width: 1.3),
      ),
      child: child,
    );
  }
}
