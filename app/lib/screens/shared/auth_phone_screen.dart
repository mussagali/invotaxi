import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../../widgets/inputs.dart';
import '../../state/app_scope.dart';
import '../../services/legal_links.dart';
import 'auth_otp_screen.dart';

class AuthPhoneScreen extends StatefulWidget {
  const AuthPhoneScreen({super.key, required this.isDriver});
  final bool isDriver;

  @override
  State<AuthPhoneScreen> createState() => _AuthPhoneScreenState();
}

class _AuthPhoneScreenState extends State<AuthPhoneScreen> {
  final _controller = TextEditingController();
  bool _prefilled = false;
  bool get _valid =>
      _controller.text.replaceAll(RegExp(r'\D'), '').length >= 11;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => setState(() {}));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_prefilled) {
      _prefilled = true;
      _controller.text = context.appRead.savedPhone;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

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
              const SizedBox(height: 26),
              Text(
                'Ваш номер',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 10),
              Text(
                'Номер будет сохранён на устройстве. Временный пароль для локального запуска — 1111.',
                style: TextStyle(
                  fontSize: 14,
                  height: 1.45,
                  fontWeight: FontWeight.w500,
                  color: p.textSecondary,
                ),
              ),
              const SizedBox(height: 26),
              AppTextField(
                controller: _controller,
                hint: '+7 700 000 00 00',
                keyboardType: TextInputType.phone,
                autofocus: true,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
                  LengthLimitingTextInputFormatter(16),
                ],
              ),
              const Spacer(),
              PrimaryButton(
                label: 'Продолжить',
                enabled: _valid,
                onPressed: _valid
                    ? () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => AuthOtpScreen(
                            isDriver: widget.isDriver,
                            phone: _controller.text.trim(),
                          ),
                        ),
                      )
                    : null,
              ),
              const SizedBox(height: 14),
              _Terms(),
            ],
          ),
        ),
      ),
    );
  }
}

class _Terms extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text('Регистрируясь, вы соглашаетесь с ', style: TextStyle(fontSize: 12, color: p.textTertiary)),
        TextButton(onPressed: () => openLegalUrl(termsUrl), child: const Text('условиями использования')),
        Text(' и ', style: TextStyle(fontSize: 12, color: p.textTertiary)),
        TextButton(onPressed: () => openLegalUrl(privacyUrl), child: const Text('политикой конфиденциальности.')),
      ],
    );
  }
}
