import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'state/app_state.dart';
import 'state/app_scope.dart';
import 'theme/app_theme.dart';
import 'screens/role_select_screen.dart';
import 'screens/driver/driver_shell.dart';
import 'screens/passenger/passenger_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState();
  await state.initialize();
  runApp(InvoTaxiApp(state: state));
}

class InvoTaxiApp extends StatefulWidget {
  const InvoTaxiApp({super.key, this.state});
  final AppState? state;
  @override
  State<InvoTaxiApp> createState() => _InvoTaxiAppState();
}

class _InvoTaxiAppState extends State<InvoTaxiApp> {
  late final AppState _state = widget.state ?? AppState();

  @override
  void dispose() {
    _state.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: _state,
      child: AnimatedBuilder(
        animation: _state,
        builder: (context, _) {
          final overlay = _state.isDark
              ? SystemUiOverlayStyle.light
              : SystemUiOverlayStyle.dark;
          return AnnotatedRegion<SystemUiOverlayStyle>(
            value: overlay.copyWith(
              statusBarColor: Colors.transparent,
              systemNavigationBarColor: _state.isDark
                  ? const Color(0xFF131318)
                  : Colors.white,
            ),
            child: MaterialApp(
              title: 'InvoTaxi',
              debugShowCheckedModeBanner: false,
              theme: AppTheme.light(),
              darkTheme: AppTheme.dark(),
              themeMode: _state.themeMode,
              locale: const Locale('ru'),
              supportedLocales: const [Locale('ru'), Locale('en')],
              localizationsDelegates: const [
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
              home: switch (_state.role) {
                UserRole.passenger => const PassengerShell(),
                UserRole.driver => const DriverShell(),
                _ => const RoleSelectScreen(),
              },
            ),
          );
        },
      ),
    );
  }
}
