import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_state.dart';
import '../../state/app_scope.dart';
import '../../widgets/bottom_nav.dart';
import '../shared/history_screen.dart';
import '../shared/profile_screen.dart';
import 'order_screen.dart';
import 'waiting_screen.dart';
import 'order_cancelled_screen.dart';
import 'ride_screen.dart';

class PassengerShell extends StatefulWidget {
  const PassengerShell({super.key});
  @override
  State<PassengerShell> createState() => _PassengerShellState();
}

class _PassengerShellState extends State<PassengerShell> {
  int _index = 0;
  OrderStage _lastStage = OrderStage.idle;

  @override
  void initState() {
    super.initState();
    context.appRead.addListener(_onState);
  }

  @override
  void dispose() {
    context.appRead.removeListener(_onState);
    super.dispose();
  }

  void _onState() {
    final stage = context.appRead.stage;
    if (stage != _lastStage) {
      _lastStage = stage;
      // Auto-focus the relevant tab when the ride begins / ends.
      if (stage == OrderStage.freeWaiting || stage == OrderStage.inProgress) {
        setState(() => _index = 1);
      } else if (stage == OrderStage.idle) {
        setState(() => _index = 0);
      }
    }
  }

  Widget _orderTab(AppState app) {
    switch (app.stage) {
      case OrderStage.dispatching:
        return const WaitingScreen();
      case OrderStage.cancelledByDispatcher:
        return const OrderCancelledScreen();
      default:
        return const OrderScreen();
    }
  }

  Widget _rideTab(AppState app) {
    if (app.stage == OrderStage.freeWaiting ||
        app.stage == OrderStage.inProgress) {
      return const RideScreen();
    }
    return const _NoActiveRide();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.app;
    final tabs = <Widget>[
      _orderTab(app),
      _rideTab(app),
      const HistoryScreen(isDriver: false),
      const ProfileScreen(),
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

class _NoActiveRide extends StatelessWidget {
  const _NoActiveRide();
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
                child: Icon(Icons.local_taxi_rounded, color: p.brand, size: 34),
              ),
              const SizedBox(height: 18),
              Text(
                'Нет активных поездок',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                'Оформите заказ на вкладке «Заказ» —\nздесь появится текущая поездка.',
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
