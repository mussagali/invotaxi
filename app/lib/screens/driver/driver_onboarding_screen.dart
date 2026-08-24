import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../../services/legal_links.dart';
import '../shared/auth_phone_screen.dart';

/// Driver entry splash — matches the "Войти по номеру телефона" start screen.
class DriverOnboardingScreen extends StatelessWidget {
  const DriverOnboardingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 16, 22, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const AppBackButton(),
              const Spacer(),
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: p.brand,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Icon(
                  Icons.directions_car_filled,
                  color: Colors.white,
                  size: 34,
                ),
              ),
              const SizedBox(height: 22),
              Text(
                'InvoTaxi для\nводителей',
                style: Theme.of(context).textTheme.displaySmall,
              ),
              const SizedBox(height: 12),
              Text(
                'Принимайте заказы от пассажиров с инвалидностью, '
                'помогайте с посадкой и работайте с диспетчером.',
                style: TextStyle(
                  fontSize: 15,
                  height: 1.45,
                  fontWeight: FontWeight.w500,
                  color: p.textSecondary,
                ),
              ),
              const Spacer(),
              PrimaryButton(
                label: 'Войти по номеру телефона',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const AuthPhoneScreen(isDriver: true),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Нажимая «Войти», вы соглашаетесь с ', style: TextStyle(fontSize: 12, color: p.textTertiary)),
                  TextButton(onPressed: () => openLegalUrl(termsUrl), child: const Text('условиями использования')),
                  Text(' и ', style: TextStyle(fontSize: 12, color: p.textTertiary)),
                  TextButton(onPressed: () => openLegalUrl(privacyUrl), child: const Text('политикой конфиденциальности')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
