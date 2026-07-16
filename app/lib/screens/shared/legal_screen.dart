import 'package:flutter/material.dart';

enum LegalDocument { privacy, terms }

class LegalScreen extends StatelessWidget {
  const LegalScreen({super.key, required this.document});
  final LegalDocument document;

  @override
  Widget build(BuildContext context) {
    final privacy = document == LegalDocument.privacy;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          privacy ? 'Конфиденциальность' : 'Пользовательское соглашение',
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: privacy ? _privacy(context) : _terms(context),
      ),
    );
  }

  List<Widget> _privacy(BuildContext context) => [
    _p(context, 'Действует с 16 июля 2026 г.'),
    _h(context, 'Какие данные обрабатываются'),
    _p(
      context,
      'Номер телефона, имя, роль, адреса и координаты поездки, точная геопозиция водителя во время работы, сведения об автомобиле, история заказов и технические журналы.',
    ),
    _h(context, 'Цели и передача'),
    _p(
      context,
      'Данные нужны для входа, заказа, назначения и отображения водителя, поддержки, безопасности и отчётности. Карты и адресные подсказки может предоставлять Yandex Maps. Данные не продаются и не используются для межсервисного отслеживания.',
    ),
    _h(context, 'Геопозиция'),
    _p(
      context,
      'Приложение водителя передаёт положение во время активной работы. Сервер принимает GPS-точки с заявленной точностью не хуже 5 метров.',
    ),
    _h(context, 'Удаление'),
    _p(
      context,
      'В профиле доступна кнопка удаления аккаунта. Она стирает телефон, профиль, адреса, координаты и GPS-историю, отзывает сессии. Обезличенные операционные записи могут храниться для отчётности и разрешения споров.',
    ),
    _h(context, 'Контакт'),
    _p(context, 'support@invotaxi.kz\nВеб-версия: /privacy'),
  ];

  List<Widget> _terms(BuildContext context) => [
    _p(context, 'Действует с 16 июля 2026 г.'),
    _p(
      context,
      'Используя InvoTaxi, вы принимаете это соглашение и Политику конфиденциальности.',
    ),
    _h(context, 'Аккаунт и поездки'),
    _p(
      context,
      'Указывайте достоверный номер, адреса, время и необходимость сопровождения. Не передавайте доступ третьим лицам. Водитель обязан соблюдать правила дорожного движения и корректно отмечать этапы поездки.',
    ),
    _h(context, 'Ограничения'),
    _p(
      context,
      'Запрещены ложные заявки, вмешательство в сервис, обход авторизации и использование чужих данных. GPS, связь и сторонние карты могут временно работать с ограничениями.',
    ),
    _h(context, 'Прекращение и контакты'),
    _p(
      context,
      'Аккаунт можно удалить в профиле. Вопросы: support@invotaxi.kz. Применяется законодательство Республики Казахстан. Веб-версия: /terms',
    ),
  ];

  Widget _h(BuildContext context, String text) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 6),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
  Widget _p(BuildContext context, String text) =>
      Text(text, style: const TextStyle(height: 1.55));
}
