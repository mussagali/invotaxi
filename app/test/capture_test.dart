import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:invotaxi/state/app_state.dart';
import 'package:invotaxi/state/app_scope.dart';
import 'package:invotaxi/theme/app_theme.dart';
import 'package:invotaxi/models/models.dart';

import 'package:invotaxi/screens/role_select_screen.dart';
import 'package:invotaxi/screens/passenger/onboarding_screen.dart';
import 'package:invotaxi/screens/passenger/order_screen.dart';
import 'package:invotaxi/screens/passenger/waiting_screen.dart';
import 'package:invotaxi/screens/passenger/order_cancelled_screen.dart';
import 'package:invotaxi/screens/passenger/ride_screen.dart';
import 'package:invotaxi/screens/passenger/arrival_rating_screen.dart';
import 'package:invotaxi/screens/passenger/schedule_screen.dart';
import 'package:invotaxi/screens/shared/emergency_screen.dart';
import 'package:invotaxi/screens/shared/support_screen.dart';
import 'package:invotaxi/screens/shared/notifications_screen.dart';
import 'package:invotaxi/screens/shared/personal_info_screen.dart';
import 'package:invotaxi/screens/shared/complaint_screen.dart';
import 'package:invotaxi/screens/shared/history_screen.dart';
import 'package:invotaxi/screens/shared/profile_screen.dart';
import 'package:invotaxi/screens/driver/orders_screen.dart';
import 'package:invotaxi/screens/driver/pickup_screen.dart';
import 'package:invotaxi/screens/driver/wait_screen.dart';
import 'package:invotaxi/screens/driver/ride_steps_screen.dart';
import 'package:invotaxi/screens/driver/trip_complete_screen.dart';
import 'package:invotaxi/screens/driver/force_majeure_screen.dart';

const outDir =
    r'C:\Users\Qazx1\AppData\Local\Temp\claude\C--Users-Qazx1-Desktop-claude-skills\fc44f0b8-4eaa-4566-9955-7bc15398639b\scratchpad\shots';

Future<void> _loadFont(String family, List<String> paths) async {
  final loader = FontLoader(family);
  var any = false;
  for (final path in paths) {
    final f = File(path);
    if (f.existsSync()) {
      final bytes = f.readAsBytesSync();
      loader.addFont(Future.value(ByteData.sublistView(bytes)));
      any = true;
    }
  }
  if (any) await loader.load();
}

Future<void> _loadFonts() async {
  // Load real Windows fonts so the goldens show actual Cyrillic text.
  await _loadFont('AppFont', [
    r'C:\Windows\Fonts\arial.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\tahoma.ttf',
  ]);
  // Material icons for the UI glyphs.
  const iconPaths = [
    r'C:\Users\Qazx1\Desktop\claude-skills\invotaxi\build\web\assets\fonts\MaterialIcons-Regular.otf',
  ];
  await _loadFont('MaterialIcons', iconPaths);
}

void main() {
  final key = GlobalKey();

  setUpAll(() async {
    Directory(outDir).createSync(recursive: true);
    await _loadFonts();
  });

  Widget wrap(Widget screen, {bool dark = false, AppState? state}) {
    final s = state ?? AppState();
    if (dark) s.setDark(true);
    return AppScope(
      state: s,
      child: RepaintBoundary(
        key: key,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(fontFamily: 'AppFont'),
          darkTheme: AppTheme.dark(fontFamily: 'AppFont'),
          themeMode: dark ? ThemeMode.dark : ThemeMode.light,
          locale: const Locale('ru'),
          supportedLocales: const [Locale('ru'), Locale('en')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: screen,
        ),
      ),
    );
  }

  Future<void> shoot(
    WidgetTester tester,
    String name,
    Widget screen, {
    bool dark = false,
    AppState? state,
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(wrap(screen, dark: dark, state: state));
    await tester.pump(const Duration(milliseconds: 350));

    // Drain any layout-overflow exceptions so we still get an image to inspect.
    while (tester.takeException() != null) {}

    await tester.runAsync(() async {
      final boundary =
          key.currentContext!.findRenderObject() as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 2.5);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      File('$outDir\\$name.png').writeAsBytesSync(data!.buffer.asUint8List());
    });
  }

  AppState orderState() {
    final s = AppState();
    s.activeOrder = const OrderRequest(
      from: 'ул. Абая, 150',
      to: 'Медицинский центр «Кайрат»',
      escort: true,
    );
    return s;
  }

  AppState driverJob() {
    final s = AppState();
    s.acceptOrder(
      const DriverOrder(
        backendId: 'capture-order',
        status: 'driver_en_route',
        passenger: 'Алексей В.',
        timeLabel: 'Сегодня, 14:30',
        from: 'ул. Абая, 150',
        to: 'Медицинский центр «Кайрат»',
        escort: true,
      ),
    );
    return s;
  }

  testWidgets('capture screens', (tester) async {
    // Passenger — light
    await shoot(tester, '01_role_select', const RoleSelectScreen());
    await shoot(tester, '02_onboarding', const OnboardingScreen());
    await shoot(tester, '03_order', const OrderScreen());
    await shoot(tester, '04_schedule', const ScheduleScreen());
    await shoot(
      tester,
      '05_waiting',
      const WaitingScreen(),
      state: orderState(),
    );
    await shoot(
      tester,
      '06_cancelled',
      const OrderCancelledScreen(),
      state: orderState(),
    );
    await shoot(tester, '07_ride', const RideScreen(), state: orderState());
    await shoot(tester, '08_rating', const ArrivalRatingScreen());
    await shoot(tester, '09_emergency', const EmergencyScreen(isDriver: false));
    await shoot(tester, '10_history', const HistoryScreen(isDriver: false));
    await shoot(
      tester,
      '11_complaint',
      const ComplaintScreen(isDriver: false, tripId: '№78-AK'),
    );
    await shoot(tester, '12_support', const SupportScreen(isDriver: false));
    await shoot(
      tester,
      '13_notifications',
      const NotificationsScreen(isDriver: false),
    );
    await shoot(
      tester,
      '14_personal',
      const PersonalInfoScreen(isDriver: false),
    );
    await shoot(tester, '15_profile', const ProfileScreen(isDriver: false));

    // Driver — light
    await shoot(tester, '20_orders', const OrdersScreen());
    await shoot(tester, '21_pickup', const PickupScreen(), state: driverJob());
    await shoot(tester, '22_wait', const WaitScreen(), state: driverJob());
    await shoot(
      tester,
      '23_steps',
      const RideStepsScreen(),
      state: driverJob(),
    );
    await shoot(
      tester,
      '24_complete',
      const TripCompleteScreen(),
      state: driverJob(),
    );
    await shoot(tester, '25_force', const ForceMajeureScreen());

    // Dark theme samples
    await shoot(tester, '30_role_dark', const RoleSelectScreen(), dark: true);
    await shoot(tester, '31_order_dark', const OrderScreen(), dark: true);
    await shoot(
      tester,
      '32_waiting_dark',
      const WaitingScreen(),
      dark: true,
      state: orderState()..setDark(true),
    );
    await shoot(
      tester,
      '33_emergency_dark',
      const EmergencyScreen(isDriver: true),
      dark: true,
    );
    await shoot(tester, '34_orders_dark', const OrdersScreen(), dark: true);
  });
}
