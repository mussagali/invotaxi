import 'package:flutter/material.dart';
import '../theme/app_palette.dart';
import '../state/app_scope.dart';
import '../widgets/common.dart';
import 'passenger/onboarding_screen.dart';
import 'driver/driver_onboarding_screen.dart';
import 'shared/legal_screen.dart';

/// Entry launcher letting you experience either the passenger or the driver app
/// (in the real product these ship as two separate apps).
class RoleSelectScreen extends StatelessWidget {
  const RoleSelectScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final app = context.app;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 20, 22, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _Logo(),
                  const Spacer(),
                  IconButton(
                    onPressed: app.toggleTheme,
                    icon: Icon(
                      app.isDark ? Icons.light_mode : Icons.dark_mode_outlined,
                      color: p.textSecondary,
                    ),
                  ),
                ],
              ),
              const Spacer(),
              Text(
                'Инклюзивное такси\nдля всех',
                style: Theme.of(context).textTheme.displaySmall,
              ),
              const SizedBox(height: 12),
              Text(
                'Заказ по номеру телефона, сопровождающий и диспетчер, '
                'который всегда на связи.',
                style: TextStyle(
                  fontSize: 15,
                  height: 1.45,
                  fontWeight: FontWeight.w500,
                  color: p.textSecondary,
                ),
              ),
              const SizedBox(height: 34),
              _RoleCard(
                icon: Icons.person_pin_circle_outlined,
                title: 'Я пассажир',
                subtitle: 'Заказать поездку с сопровождением',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const OnboardingScreen()),
                ),
              ),
              const SizedBox(height: 14),
              _RoleCard(
                icon: Icons.directions_car_filled_outlined,
                title: 'Я водитель',
                subtitle: 'Принимать заказы и выходить на линию',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const DriverOnboardingScreen(),
                  ),
                ),
              ),
              const Spacer(),
              Center(
                child: Text(
                  'InvoTaxi · подключено к серверу',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                    color: p.textTertiary,
                  ),
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            const LegalScreen(document: LegalDocument.privacy),
                      ),
                    ),
                    child: const Text('Конфиденциальность'),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            const LegalScreen(document: LegalDocument.terms),
                      ),
                    ),
                    child: const Text('Соглашение'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Logo extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: p.brand,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(
            Icons.local_taxi_rounded,
            color: Colors.white,
            size: 24,
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'InvoTaxi',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: p.textPrimary,
            letterSpacing: -0.5,
          ),
        ),
      ],
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(18),
      child: Row(
        children: [
          SoftIconBox(icon: icon, size: 52, filled: true),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: p.textPrimary,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: p.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: p.textTertiary),
        ],
      ),
    );
  }
}
