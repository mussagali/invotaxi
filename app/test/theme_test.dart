import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:invotaxi/main.dart';

void main() {
  testWidgets('App launches in light theme by default', (tester) async {
    // Simulate a device whose platform prefers dark, to prove themeMode.light wins.
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);

    await tester.pumpWidget(const InvoTaxiApp());
    await tester.pumpAndSettle();

    final materialApp = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(materialApp.themeMode, ThemeMode.light);

    // Resolve the actual Theme used inside the home screen.
    final BuildContext ctx = tester.element(find.text('Я пассажир'));
    expect(Theme.of(ctx).brightness, Brightness.light);
  });
}
