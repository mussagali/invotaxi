// Smoke test for InvoTaxi.
import 'package:flutter_test/flutter_test.dart';

import 'package:invotaxi/main.dart';

void main() {
  testWidgets('Role select screen renders', (WidgetTester tester) async {
    await tester.pumpWidget(const InvoTaxiApp());
    await tester.pumpAndSettle();

    expect(find.text('Я пассажир'), findsOneWidget);
    expect(find.text('Я водитель'), findsOneWidget);
  });
}
