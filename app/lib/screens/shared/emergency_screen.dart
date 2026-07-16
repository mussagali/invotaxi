import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/notice_banner.dart';
import '../../widgets/page_header.dart';
import 'complaint_screen.dart';

class EmergencyScreen extends StatefulWidget {
  const EmergencyScreen({super.key, required this.isDriver});
  final bool isDriver;
  @override
  State<EmergencyScreen> createState() => _EmergencyScreenState();
}

class _EmergencyScreenState extends State<EmergencyScreen> {
  bool _sosSent = false;

  void _call(String service) {
    setState(() => _sosSent = true);
    showToast(context, 'Соединяем: $service');
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const AppBackButton(),
              if (_sosSent) ...[
                const SizedBox(height: 14),
                const NoticeBanner(
                  icon: Icons.sos,
                  title: 'SOS отправлен',
                  subtitle: 'Служба поддержки получила вашу геолокацию',
                ),
              ],
              const SizedBox(height: 18),
              Text(
                'Экстренная\nпомощь',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: p.warnSurface,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.warning_amber_rounded,
                      color: p.warnIcon,
                      size: 26,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Что-то пошло не так?',
                            style: TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w700,
                              color: p.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            'Вызовите экстренную службу — мы автоматически '
                            'отметим поездку и уведомим диспетчера.',
                            style: TextStyle(
                              fontSize: 12.5,
                              height: 1.35,
                              fontWeight: FontWeight.w500,
                              color: p.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              _ServiceRow(
                color: const Color(0xFFE5484D),
                title: '112',
                subtitle: 'Единая служба спасения',
                onTap: () => _call('112'),
              ),
              const SizedBox(height: 10),
              _ServiceRow(
                color: const Color(0xFFF5A623),
                title: '103',
                subtitle: 'Скорая помощь',
                onTap: () => _call('103'),
              ),
              const SizedBox(height: 10),
              _ServiceRow(
                color: p.brand,
                title: 'Техподдержка',
                subtitle: 'Служба поддержки',
                icon: Icons.headset_mic_outlined,
                onTap: () => _call('Техподдержка'),
              ),
              const Spacer(),
              PrimaryButton(
                label: 'Поделиться поездкой',
                onPressed: () =>
                    showToast(context, 'Ссылка на поездку скопирована'),
              ),
              if (_sosSent) ...[
                const SizedBox(height: 10),
                TextLinkButton(
                  label: 'Подать жалобу',
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => ComplaintScreen(
                        isDriver: widget.isDriver,
                        tripId: '№84-AK',
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Text(
                'При вызове экстренной службы мы передадим ваши координаты и '
                'данные о поездке.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11.5,
                  height: 1.35,
                  fontWeight: FontWeight.w500,
                  color: p.textTertiary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ServiceRow extends StatelessWidget {
  const _ServiceRow({
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.icon = Icons.call,
  });
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: p.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 12.5,
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
