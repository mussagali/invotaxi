import 'package:flutter/material.dart';

import '../../state/app_scope.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';

class _TutorialPage {
  const _TutorialPage(this.icon, this.title, this.body);

  final IconData icon;
  final String title;
  final String body;
}

class TutorialScreen extends StatefulWidget {
  const TutorialScreen({super.key, required this.isDriver});

  final bool isDriver;

  @override
  State<TutorialScreen> createState() => _TutorialScreenState();
}

class _TutorialScreenState extends State<TutorialScreen> {
  final _controller = PageController();
  var _index = 0;

  List<_TutorialPage> get _pages => widget.isDriver
      ? const [
          _TutorialPage(
            Icons.format_list_bulleted_rounded,
            'Заказы на линии',
            'На вкладке «Заказ» видны доступные заявки. Выберите подходящую и подтвердите принятие.',
          ),
          _TutorialPage(
            Icons.navigation_outlined,
            'Статусы поездки',
            'Последовательно отмечайте путь к пассажиру, ожидание, посадку и завершение поездки.',
          ),
          _TutorialPage(
            Icons.location_searching_outlined,
            'Точная геопозиция',
            'Разрешите доступ к геопозиции: приложение передаёт координаты только во время работы на линии.',
          ),
        ]
      : const [
          _TutorialPage(
            Icons.location_on_outlined,
            'Выберите маршрут',
            'На вкладке «Заказ» укажите точку посадки и пункт назначения. Приложение определит ваш город.',
          ),
          _TutorialPage(
            Icons.family_restroom_outlined,
            'Семейный заказ',
            'Нажмите кнопку с семьёй, добавьте детей и отметьте тех, кто едет. Для одной точки назначения создаётся один заказ.',
          ),
          _TutorialPage(
            Icons.support_agent_outlined,
            'Подтвердите поездку',
            'После оформления диспетчер подтвердит заказ. Статус и назначенный водитель появятся в приложении.',
          ),
        ];

  Future<void> _next() async {
    if (_index < _pages.length - 1) {
      await _controller.nextPage(
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOut,
      );
      return;
    }
    await _finish();
  }

  Future<void> _finish() async {
    await context.appRead.completeTutorial();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 18, 24, 22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: _finish,
                  child: Text(
                    _index == _pages.length - 1 ? 'Готово' : 'Пропустить',
                  ),
                ),
              ),
              Expanded(
                child: PageView.builder(
                  controller: _controller,
                  itemCount: _pages.length,
                  onPageChanged: (value) => setState(() => _index = value),
                  itemBuilder: (_, index) {
                    final page = _pages[index];
                    return Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 118,
                          height: 118,
                          decoration: BoxDecoration(
                            color: p.brandSoft,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(page.icon, color: p.brand, size: 56),
                        ),
                        const SizedBox(height: 34),
                        Text(
                          page.title,
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 14),
                        Text(
                          page.body,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 15,
                            height: 1.45,
                            color: p.textSecondary,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  _pages.length,
                  (index) => AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    height: 7,
                    width: _index == index ? 22 : 7,
                    decoration: BoxDecoration(
                      color: _index == index ? p.brand : p.border,
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              PrimaryButton(
                label: _index == _pages.length - 1 ? 'Готово' : 'Дальше',
                onPressed: _next,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
