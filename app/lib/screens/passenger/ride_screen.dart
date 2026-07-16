import 'dart:async';
import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_state.dart';
import '../../state/app_scope.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/map_background.dart';
import '../../widgets/notice_banner.dart';
import '../../widgets/page_header.dart';
import '../shared/emergency_screen.dart';
import '../shared/trip_details_screen.dart';
import 'chat_screen.dart';
import 'arrival_rating_screen.dart';

class RideScreen extends StatefulWidget {
  const RideScreen({super.key});
  @override
  State<RideScreen> createState() => _RideScreenState();
}

class _RideScreenState extends State<RideScreen> {
  Timer? _timer;
  int _freeWaitRemaining = 20 * 60;
  bool _started = false; // in-progress
  bool _navigatedToArrival = false;

  @override
  void initState() {
    super.initState();
    _started = context.appRead.stage == OrderStage.inProgress;
    _startTimer();
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      setState(() {
        if (!_started) {
          _freeWaitRemaining--;
          if (_freeWaitRemaining <= 20 * 60 - 10) {
            _started = true;
            context.appRead.setStage(OrderStage.inProgress);
          }
        } else {
          _elapsedInRide++;
          if (_elapsedInRide >= 10) {
            t.cancel();
            _goToArrival();
          }
        }
      });
    });
  }

  int _elapsedInRide = 0;

  void _goToArrival() {
    if (_navigatedToArrival) return;
    _navigatedToArrival = true;
    context.appRead.setStage(OrderStage.arrived);
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const ArrivalRatingScreen()));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final app = context.app;
    final order = app.activeOrder;
    final mm = (_freeWaitRemaining ~/ 60).toString().padLeft(2, '0');
    final ss = (_freeWaitRemaining % 60).toString().padLeft(2, '0');

    return Scaffold(
      body: Column(
        children: [
          // Map header with floating banner.
          SizedBox(
            height: 210,
            child: Stack(
              children: [
                Positioned.fill(
                  child: MapBackground(
                    showRoute: _started,
                    showCar: _started,
                    showPin: !_started,
                  ),
                ),
                Positioned(
                  left: 14,
                  right: 14,
                  top: MediaQuery.of(context).padding.top + 6,
                  child: _started
                      ? const NoticeBanner(
                          icon: Icons.videocam_outlined,
                          title: 'Поездка началась',
                          subtitle:
                              'Запись салона включена для вашей безопасности',
                        )
                      : const NoticeBanner(
                          icon: Icons.directions_car_filled,
                          title: 'Водитель у подъезда',
                          subtitle: 'Бесплатное ожидание — 20 минут',
                        ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
              children: [
                if (!_started) ...[
                  Center(
                    child: Column(
                      children: [
                        Text(
                          'Бесплатное ожидание',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: p.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '$mm:$ss',
                          style: TextStyle(
                            fontSize: 56,
                            fontWeight: FontWeight.w800,
                            height: 1.0,
                            letterSpacing: -1,
                            color: p.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'Назначен водитель',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: p.textPrimary,
                    ),
                  ),
                ] else ...[
                  Text(
                    'Время в пути 10 мин',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ],
                const SizedBox(height: 12),
                _DriverRow(),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: _ActionChip(
                        icon: Icons.chat_bubble_outline,
                        label: 'Чат',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => const ChatScreen()),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _ActionChip(
                        icon: Icons.report_gmailerrorred,
                        label: 'Конфликт',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) =>
                                const EmergencyScreen(isDriver: false),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _ActionChip(
                        icon: Icons.receipt_long_outlined,
                        label: 'Детали',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const TripDetailsScreen(),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                DetailRow(
                  icon: Icons.my_location,
                  label: 'Точка посадки',
                  value: order?.from ?? 'Адрес не указан',
                ),
                const SizedBox(height: 10),
                DetailRow(
                  icon: Icons.outlined_flag,
                  label: 'Пункт назначения',
                  value: order?.to ?? 'Адрес не указан',
                ),
                const SizedBox(height: 18),
                PrimaryButton(
                  label: 'Позвонить диспетчеру',
                  icon: Icons.phone,
                  onPressed: () => showToast(context, 'Звоним диспетчеру…'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DriverRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final d = context.app.assignedDriver;
    return Row(
      children: [
        const Avatar(asset: 'assets/images/avatar_driver.jpg', radius: 22),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    d.name,
                    style: TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                      color: p.textPrimary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  StatusBadge('${d.rating}', icon: Icons.star_rounded),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                d.car,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w500,
                  color: p.textSecondary,
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: p.surfaceAlt,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            d.plate,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: p.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: p.brandSoft,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            children: [
              Icon(icon, size: 20, color: p.brand),
              const SizedBox(height: 5),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: p.brand,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
