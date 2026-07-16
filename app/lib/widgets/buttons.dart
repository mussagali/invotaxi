import 'package:flutter/material.dart';
import '../theme/app_palette.dart';

enum PrimaryButtonKind { filled, soft, outline, dark }

/// Full-width pill button used across the app.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.kind = PrimaryButtonKind.filled,
    this.icon,
    this.enabled = true,
    this.height = 56,
  });

  final String label;
  final VoidCallback? onPressed;
  final PrimaryButtonKind kind;
  final IconData? icon;
  final bool enabled;
  final double height;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final active = enabled && onPressed != null;

    late Color bg;
    late Color fg;
    BorderSide side = BorderSide.none;

    switch (kind) {
      case PrimaryButtonKind.filled:
        bg = active ? p.brand : p.disabled;
        fg = active ? Colors.white : p.onDisabled;
        break;
      case PrimaryButtonKind.soft:
        bg = p.disabled;
        fg = p.onDisabled;
        break;
      case PrimaryButtonKind.outline:
        bg = Colors.transparent;
        fg = p.textPrimary;
        side = BorderSide(color: p.border, width: 1.5);
        break;
      case PrimaryButtonKind.dark:
        bg = active ? const Color(0xFF17171B) : p.disabled;
        fg = Colors.white;
        break;
    }

    return SizedBox(
      height: height,
      width: double.infinity,
      child: Material(
        color: bg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: side,
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: active ? onPressed : null,
          child: Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 20, color: fg),
                  const SizedBox(width: 8),
                ],
                Text(
                  label,
                  style: TextStyle(
                    color: fg,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A brand-text link button, e.g. "Подать жалобу", "Позвонить диспетчеру".
class TextLinkButton extends StatelessWidget {
  const TextLinkButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.soft = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool soft;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return SizedBox(
      height: 52,
      width: double.infinity,
      child: Material(
        color: soft ? p.brandSoft : Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 18, color: p.brand),
                  const SizedBox(width: 8),
                ],
                Text(
                  label,
                  style: TextStyle(
                    color: p.brand,
                    fontSize: 15.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Rounded-square icon button used for back navigation and small round actions.
class SquareIconButton extends StatelessWidget {
  const SquareIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.size = 44,
    this.filledSoft = false,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final double size;
  final bool filledSoft;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: filledSoft ? p.brandSoft : p.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: filledSoft
            ? BorderSide.none
            : BorderSide(color: p.border, width: 1.2),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(
            icon,
            size: 20,
            color: filledSoft ? p.brand : p.textPrimary,
          ),
        ),
      ),
    );
  }
}

class AppBackButton extends StatelessWidget {
  const AppBackButton({super.key, this.onPressed});
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SquareIconButton(
      icon: Icons.chevron_left,
      onPressed: onPressed ?? () => Navigator.of(context).maybePop(),
    );
  }
}

/// Small round chat/call icon button as seen on driver cards.
class RoundSoftButton extends StatelessWidget {
  const RoundSoftButton({super.key, required this.icon, this.onPressed});
  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: p.brandSoft,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: SizedBox(
          width: 38,
          height: 38,
          child: Icon(icon, size: 18, color: p.brand),
        ),
      ),
    );
  }
}
