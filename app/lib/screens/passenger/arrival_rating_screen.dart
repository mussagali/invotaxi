import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_scope.dart';
import '../../data/static_content.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/inputs.dart';
import '../../widgets/page_header.dart';
import '../shared/complaint_screen.dart';

class ArrivalRatingScreen extends StatefulWidget {
  const ArrivalRatingScreen({super.key});
  @override
  State<ArrivalRatingScreen> createState() => _ArrivalRatingScreenState();
}

class _ArrivalRatingScreenState extends State<ArrivalRatingScreen> {
  int _rating = 0;
  final Set<String> _tags = {};

  void _finish() {
    Navigator.of(context).pop();
    context.appRead.cancelOrder();
    showToast(context, 'Спасибо! Поездка завершена');
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
                padding: const EdgeInsets.fromLTRB(22, 30, 22, 8),
                children: [
                  Text(
                    'Вы прибыли!',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Как вам поездка?',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: p.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 22),
                  RatingStars(
                    value: _rating,
                    size: 40,
                    onChanged: (v) => setState(() => _rating = v),
                  ),
                  const SizedBox(height: 26),
                  Center(
                    child: Text(
                      'ЧТО ВАМ ПОНРАВИЛОСЬ?',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.5,
                        color: p.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 9,
                    runSpacing: 10,
                    children: [
                      for (final tag in StaticContent.positiveTags)
                        ChoiceChipPill(
                          label: tag,
                          selected: _tags.contains(tag),
                          onTap: () => setState(() {
                            _tags.contains(tag)
                                ? _tags.remove(tag)
                                : _tags.add(tag);
                          }),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const AppTextField(
                    hint: 'Напишите свой отзыв (необязательно)',
                    maxLines: 4,
                    minLines: 4,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 6, 22, 14),
              child: Column(
                children: [
                  PrimaryButton(label: 'Завершить поездку', onPressed: _finish),
                  const SizedBox(height: 10),
                  TextLinkButton(
                    label: 'Подать жалобу',
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const ComplaintScreen(
                          isDriver: false,
                          tripId: '№84-AK',
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
