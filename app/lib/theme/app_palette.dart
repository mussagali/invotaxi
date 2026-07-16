import 'package:flutter/material.dart';

/// Custom color palette exposed as a [ThemeExtension] so every widget can read
/// the exact InvoTaxi design tokens for both the light and dark themes.
@immutable
class AppPalette extends ThemeExtension<AppPalette> {
  const AppPalette({
    required this.brand,
    required this.brandPressed,
    required this.brandSoft,
    required this.onBrandSoft,
    required this.background,
    required this.surface,
    required this.surfaceAlt,
    required this.mapBase,
    required this.mapStroke,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.border,
    required this.disabled,
    required this.onDisabled,
    required this.warnSurface,
    required this.warnIcon,
    required this.star,
    required this.myBubble,
    required this.otherBubble,
    required this.shadow,
  });

  final Color brand; // primary orange
  final Color brandPressed;
  final Color brandSoft; // peach accent surface
  final Color onBrandSoft; // text/icon on peach
  final Color background;
  final Color surface;
  final Color surfaceAlt; // inputs, section rows
  final Color mapBase;
  final Color mapStroke;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color border;
  final Color disabled; // muted button fill
  final Color onDisabled;
  final Color warnSurface;
  final Color warnIcon;
  final Color star;
  final Color myBubble;
  final Color otherBubble;
  final Color shadow;

  static const brandColor = Color(0xFFF86038);

  static const light = AppPalette(
    brand: brandColor,
    brandPressed: Color(0xFFE24E2A),
    brandSoft: Color(0xFFFBE7DF),
    onBrandSoft: Color(0xFFE24E2A),
    background: Color(0xFFFFFFFF),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFF5F5F6),
    mapBase: Color(0xFFE8E8EA),
    mapStroke: Color(0xFFD3D3D8),
    textPrimary: Color(0xFF16161B),
    textSecondary: Color(0xFF8B8B92),
    textTertiary: Color(0xFFB6B6BD),
    border: Color(0xFFECECEE),
    disabled: Color(0xFFF9C9BA),
    onDisabled: Color(0xFFFFFFFF),
    warnSurface: Color(0xFFFCF3E4),
    warnIcon: Color(0xFFE59A34),
    star: Color(0xFFFFB020),
    myBubble: brandColor,
    otherBubble: Color(0xFFF1F1F3),
    shadow: Color(0x14000000),
  );

  static const dark = AppPalette(
    brand: brandColor,
    brandPressed: Color(0xFFE24E2A),
    brandSoft: Color(0xFF3A2A26),
    onBrandSoft: Color(0xFFF7B49E),
    background: Color(0xFF131318),
    surface: Color(0xFF1C1C22),
    surfaceAlt: Color(0xFF262A33),
    mapBase: Color(0xFF23262E),
    mapStroke: Color(0xFF31353F),
    textPrimary: Color(0xFFF4F4F6),
    textSecondary: Color(0xFF9A9AA4),
    textTertiary: Color(0xFF6C6C77),
    border: Color(0xFF2C2C35),
    disabled: Color(0xFF5C382E),
    onDisabled: Color(0xFFB89184),
    warnSurface: Color(0xFF352C1E),
    warnIcon: Color(0xFFE59A34),
    star: Color(0xFFFFB020),
    myBubble: brandColor,
    otherBubble: Color(0xFF262A33),
    shadow: Color(0x33000000),
  );

  @override
  AppPalette copyWith({
    Color? brand,
    Color? brandPressed,
    Color? brandSoft,
    Color? onBrandSoft,
    Color? background,
    Color? surface,
    Color? surfaceAlt,
    Color? mapBase,
    Color? mapStroke,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? border,
    Color? disabled,
    Color? onDisabled,
    Color? warnSurface,
    Color? warnIcon,
    Color? star,
    Color? myBubble,
    Color? otherBubble,
    Color? shadow,
  }) {
    return AppPalette(
      brand: brand ?? this.brand,
      brandPressed: brandPressed ?? this.brandPressed,
      brandSoft: brandSoft ?? this.brandSoft,
      onBrandSoft: onBrandSoft ?? this.onBrandSoft,
      background: background ?? this.background,
      surface: surface ?? this.surface,
      surfaceAlt: surfaceAlt ?? this.surfaceAlt,
      mapBase: mapBase ?? this.mapBase,
      mapStroke: mapStroke ?? this.mapStroke,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
      border: border ?? this.border,
      disabled: disabled ?? this.disabled,
      onDisabled: onDisabled ?? this.onDisabled,
      warnSurface: warnSurface ?? this.warnSurface,
      warnIcon: warnIcon ?? this.warnIcon,
      star: star ?? this.star,
      myBubble: myBubble ?? this.myBubble,
      otherBubble: otherBubble ?? this.otherBubble,
      shadow: shadow ?? this.shadow,
    );
  }

  @override
  AppPalette lerp(ThemeExtension<AppPalette>? other, double t) {
    if (other is! AppPalette) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return AppPalette(
      brand: l(brand, other.brand),
      brandPressed: l(brandPressed, other.brandPressed),
      brandSoft: l(brandSoft, other.brandSoft),
      onBrandSoft: l(onBrandSoft, other.onBrandSoft),
      background: l(background, other.background),
      surface: l(surface, other.surface),
      surfaceAlt: l(surfaceAlt, other.surfaceAlt),
      mapBase: l(mapBase, other.mapBase),
      mapStroke: l(mapStroke, other.mapStroke),
      textPrimary: l(textPrimary, other.textPrimary),
      textSecondary: l(textSecondary, other.textSecondary),
      textTertiary: l(textTertiary, other.textTertiary),
      border: l(border, other.border),
      disabled: l(disabled, other.disabled),
      onDisabled: l(onDisabled, other.onDisabled),
      warnSurface: l(warnSurface, other.warnSurface),
      warnIcon: l(warnIcon, other.warnIcon),
      star: l(star, other.star),
      myBubble: l(myBubble, other.myBubble),
      otherBubble: l(otherBubble, other.otherBubble),
      shadow: l(shadow, other.shadow),
    );
  }
}

/// Convenient accessor: `context.palette`
extension PaletteX on BuildContext {
  AppPalette get palette => Theme.of(this).extension<AppPalette>()!;
}
