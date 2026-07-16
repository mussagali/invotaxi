import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../shared/auth_phone_screen.dart';

class _Slide {
  final String image;
  final String title;
  final String body;
  const _Slide(this.image, this.title, this.body);
}

const _slides = <_Slide>[
  _Slide(
    'assets/images/onboarding_1.png',
    'Быстрый вход',
    'Регистрация по номеру телефона и моментальное подтверждение через СМС.',
  ),
  _Slide(
    'assets/images/onboarding_2.png',
    'Личные параметры',
    'Выберите категорию инвалидности и добавьте право на сопровождение.',
  ),
  _Slide(
    'assets/images/onboarding_3.png',
    'Безопасность',
    'Пройдите проверку документов в офисе для доступа к поездкам.',
  ),
];

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _next() {
    if (_index < _slides.length - 1) {
      _controller.nextPage(
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOut,
      );
    } else {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => const AuthPhoneScreen(isDriver: false),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: _slides.length,
                onPageChanged: (i) => setState(() => _index = i),
                itemBuilder: (context, i) {
                  final s = _slides[i];
                  return Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(24),
                      child: Image.asset(s.image, fit: BoxFit.cover),
                    ),
                  );
                },
              ),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(24, 22, 24, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: List.generate(_slides.length, (i) {
                      final active = i == _index;
                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 250),
                        margin: const EdgeInsets.only(right: 6),
                        width: active ? 20 : 7,
                        height: 7,
                        decoration: BoxDecoration(
                          color: active ? p.brand : p.border,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    _slides[_index].title,
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: p.brand,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _slides[_index].body,
                    style: TextStyle(
                      fontSize: 14.5,
                      height: 1.45,
                      fontWeight: FontWeight.w500,
                      color: p.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 22),
                  PrimaryButton(
                    label: _index == _slides.length - 1
                        ? 'Регистрация'
                        : 'Дальше',
                    onPressed: _next,
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
