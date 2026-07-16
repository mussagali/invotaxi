import 'package:flutter/material.dart';
import '../theme/app_palette.dart';

class NavDest {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  const NavDest(this.icon, this.activeIcon, this.label);
}

const kAppTabs = <NavDest>[
  NavDest(Icons.home_outlined, Icons.home_rounded, 'Заказ'),
  NavDest(Icons.location_on_outlined, Icons.location_on, 'Поездка'),
  NavDest(Icons.favorite_border, Icons.favorite, 'История'),
  NavDest(Icons.person_outline, Icons.person, 'Профиль'),
];

class AppBottomNav extends StatelessWidget {
  const AppBottomNav({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        border: Border(top: BorderSide(color: p.border, width: 1)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 62,
          child: Row(
            children: [
              for (int i = 0; i < kAppTabs.length; i++)
                Expanded(
                  child: _Item(
                    dest: kAppTabs[i],
                    active: i == currentIndex,
                    onTap: () => onTap(i),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({required this.dest, required this.active, required this.onTap});
  final NavDest dest;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final color = active ? p.brand : p.textTertiary;
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(active ? dest.activeIcon : dest.icon, size: 24, color: color),
          const SizedBox(height: 4),
          Text(
            dest.label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: active ? FontWeight.w600 : FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
