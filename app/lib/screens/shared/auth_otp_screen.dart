import 'package:flutter/material.dart';

import '../../api/backend_api.dart';
import '../../state/app_scope.dart';
import '../../state/app_state.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../../widgets/inputs.dart';
import '../driver/driver_shell.dart';
import '../passenger/passenger_shell.dart';

class AuthOtpScreen extends StatefulWidget {
  const AuthOtpScreen({super.key, required this.isDriver, required this.phone});

  final bool isDriver;
  final String phone;

  @override
  State<AuthOtpScreen> createState() => _AuthOtpScreenState();
}

class _AuthOtpScreenState extends State<AuthOtpScreen> {
  String _password = '';
  String? _error;
  bool _submitting = false;

  Future<void> _confirm() async {
    if (_password != '1111') {
      setState(() => _error = 'Для локального запуска введите 1111');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await context.appRead.login(
        phone: widget.phone,
        password: _password,
        selectedRole: widget.isDriver ? UserRole.driver : UserRole.passenger,
      );
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) =>
              widget.isDriver ? const DriverShell() : const PassengerShell(),
        ),
        (_) => false,
      );
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 16, 22, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Align(
                alignment: Alignment.centerLeft,
                child: AppBackButton(),
              ),
              const SizedBox(height: 30),
              Text(
                'Введите пароль',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 10),
              Text(
                'Номер ${widget.phone} сохранится после успешного входа',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: palette.textSecondary,
                ),
              ),
              const SizedBox(height: 28),
              OtpInput(
                error: _error != null,
                onChanged: (value) => setState(() {
                  _password = value;
                  _error = null;
                }),
                onCompleted: (_) => _confirm(),
              ),
              const SizedBox(height: 18),
              if (_error != null)
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFFE5484D),
                  ),
                ),
              const Spacer(),
              PrimaryButton(
                label: _submitting ? 'Входим…' : 'Войти',
                enabled: _password.length == 4 && !_submitting,
                onPressed: _password.length == 4 && !_submitting
                    ? _confirm
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
