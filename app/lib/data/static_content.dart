import '../models/models.dart';

class StaticContent {
  static const positiveTags = <String>[
    'Вежливый',
    'Чистый салон',
    'Аккуратное вождение',
    'Пунктуальный',
    'Помог с посадкой',
  ];

  static const quickReplies = <String>[
    'Я уже выхожу',
    'Подождите 2 минуты',
    'Я у входа',
  ];

  static const passengerFaq = <FaqItem>[
    FaqItem(
      'Как заказать поездку с сопровождающим?',
      'В заказе включите переключатель «Сопровождающий».',
    ),
    FaqItem(
      'Что делать, если водитель не приехал?',
      'Свяжитесь с диспетчером из карточки поездки.',
    ),
  ];

  static const driverFaq = <FaqItem>[
    FaqItem(
      'Где высадить пассажира?',
      'Максимально близко к доступному и безопасному входу.',
    ),
    FaqItem(
      'Что делать при ухудшении здоровья пассажира?',
      'Остановитесь в безопасном месте, вызовите 103 и сообщите диспетчеру.',
    ),
  ];

  static const passengerComplaintTypes = <ComplaintType>[
    ComplaintType('Безопасность', 'Нарушение ПДД или агрессия'),
    ComplaintType('Качество сервиса', 'Грубость или отказ в помощи'),
    ComplaintType('Состояние автомобиля', 'Чистота или неисправность'),
    ComplaintType('Другое', 'Опишите ситуацию подробнее'),
  ];

  static const driverComplaintTypes = <ComplaintType>[
    ComplaintType('Поведение', 'Конфликт или агрессия'),
    ComplaintType('Маршрут', 'Небезопасная просьба об остановке'),
    ComplaintType('Состояние салона', 'Повреждение или загрязнение'),
    ComplaintType('Другое', 'Опишите ситуацию подробнее'),
  ];
}
