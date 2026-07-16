import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../state/app_scope.dart';
import '../../widgets/common.dart';
import 'personal_info_screen.dart';
import 'support_screen.dart';
import 'notifications_screen.dart';
import 'legal_screen.dart';
import '../role_select_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, this.isDriver = false});
  final bool isDriver;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final app = context.app;
    final name = app.profileName;
    final avatar = isDriver
        ? 'assets/images/avatar_driver.jpg'
        : 'assets/images/avatar_passenger.jpg';

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
          children: [
            Row(
              children: [
                Avatar(asset: avatar, radius: 26),
                const SizedBox(width: 14),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 2),
                    Text(
                      '${app.phone} · Атырау',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: p.textSecondary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 24),
            _MenuRow(
              icon: Icons.person_outline,
              label: 'Персональная информация',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => PersonalInfoScreen(isDriver: isDriver),
                ),
              ),
            ),
            _MenuRow(
              icon: Icons.headset_mic_outlined,
              label: 'Служба поддержки',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => SupportScreen(isDriver: isDriver),
                ),
              ),
            ),
            _MenuRow(
              icon: Icons.notifications_none,
              label: 'Уведомления',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => NotificationsScreen(isDriver: isDriver),
                ),
              ),
            ),
            _MenuRow(
              icon: Icons.dark_mode_outlined,
              label: 'Тёмная тема',
              trailing: Switch(value: app.isDark, onChanged: app.setDark),
            ),
            _MenuRow(
              icon: Icons.privacy_tip_outlined,
              label: 'Политика конфиденциальности',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) =>
                      const LegalScreen(document: LegalDocument.privacy),
                ),
              ),
            ),
            _MenuRow(
              icon: Icons.description_outlined,
              label: 'Пользовательское соглашение',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) =>
                      const LegalScreen(document: LegalDocument.terms),
                ),
              ),
            ),
            const SizedBox(height: 16),
            InkWell(
              onTap: () {
                app.signOut();
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (_) => const RoleSelectScreen()),
                  (route) => false,
                );
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Row(
                  children: [
                    Icon(Icons.logout, size: 20, color: p.brand),
                    const SizedBox(width: 10),
                    Text(
                      'Выход',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: p.brand,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              icon: const Icon(Icons.delete_outline),
              label: const Text('Удалить аккаунт'),
              style: TextButton.styleFrom(foregroundColor: Colors.red),
              onPressed: app.busy
                  ? null
                  : () async {
                      final confirmed = await showDialog<bool>(
                        context: context,
                        builder: (dialogContext) => AlertDialog(
                          title: const Text('Удалить аккаунт?'),
                          content: const Text(
                            'Телефон, профиль, адреса, координаты и GPS-история будут удалены. Это действие нельзя отменить.',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () =>
                                  Navigator.pop(dialogContext, false),
                              child: const Text('Отмена'),
                            ),
                            FilledButton(
                              onPressed: () =>
                                  Navigator.pop(dialogContext, true),
                              child: const Text('Удалить'),
                            ),
                          ],
                        ),
                      );
                      if (confirmed != true || !context.mounted) return;
                      try {
                        await app.deleteAccount();
                        if (!context.mounted) return;
                        Navigator.of(context).pushAndRemoveUntil(
                          MaterialPageRoute(
                            builder: (_) => const RoleSelectScreen(),
                          ),
                          (route) => false,
                        );
                      } catch (error) {
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(error.toString())),
                        );
                      }
                    },
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({
    required this.icon,
    required this.label,
    this.onTap,
    this.trailing,
  });
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 2),
        child: Row(
          children: [
            SoftIconBox(icon: icon, size: 38),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: p.textPrimary,
                ),
              ),
            ),
            trailing ?? Icon(Icons.chevron_right, color: p.textTertiary),
          ],
        ),
      ),
    );
  }
}
