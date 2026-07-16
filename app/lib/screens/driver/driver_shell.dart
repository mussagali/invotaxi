import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_state.dart';
import '../../state/app_scope.dart';
import '../../widgets/bottom_nav.dart';
import '../shared/history_screen.dart';
import '../shared/profile_screen.dart';
import '../shared/tutorial_screen.dart';
import 'orders_screen.dart';
import 'pickup_screen.dart';
import 'wait_screen.dart';
import 'ride_steps_screen.dart';
import 'trip_complete_screen.dart';

class DriverShell extends StatefulWidget {
  const DriverShell({super.key});
  @override
  State<DriverShell> createState() => _DriverShellState();
}

class _DriverShellState extends State<DriverShell> {
  int _index = 0;
  DriverStage _last = DriverStage.idle;

  @override
  void initState() {
    super.initState();
    context.appRead.addListener(_onState);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || context.appRead.tutorialSeen) return;
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const TutorialScreen(isDriver: true)),
      );
    });
  }

  @override
  void dispose() {
    context.appRead.removeListener(_onState);
    super.dispose();
  }

  void _onState() {
    final s = context.appRead.driverStage;
    if (s != _last) {
      _last = s;
      if (s == DriverStage.pickup) {
        setState(() => _index = 1);
      } else if (s == DriverStage.idle) {
        setState(() => _index = 0);
      }
    }
  }

  Widget _rideTab(AppState app) {
    switch (app.driverStage) {
      case DriverStage.pickup:
        return const PickupScreen();
      case DriverStage.waiting:
        return const WaitScreen();
      case DriverStage.riding:
        return const RideStepsScreen();
      case DriverStage.completed:
        return const TripCompleteScreen();
      case DriverStage.idle:
        return const _NoActiveJob();
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.app;
    final tabs = <Widget>[
      const OrdersScreen(),
      _rideTab(app),
      const HistoryScreen(isDriver: true),
      const ProfileScreen(isDriver: true),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: tabs),
      bottomNavigationBar: AppBottomNav(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
      ),
    );
  }
}

class _NoActiveJob extends StatelessWidget {
  const _NoActiveJob();
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: p.brandSoft,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.directions_car_filled,
                  color: p.brand,
                  size: 34,
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'Нет активной поездки',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                'Примите заказ на вкладке «Заказ»,\nчтобы начать поездку.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  height: 1.4,
                  fontWeight: FontWeight.w500,
                  color: p.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
