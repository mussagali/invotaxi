import 'package:flutter/material.dart';
import 'app_palette.dart';

/// Builds the light & dark [ThemeData] from an [AppPalette].
class AppTheme {
  static ThemeData light({String? fontFamily}) =>
      _build(AppPalette.light, Brightness.light, fontFamily);
  static ThemeData dark({String? fontFamily}) =>
      _build(AppPalette.dark, Brightness.dark, fontFamily);

  static ThemeData _build(
    AppPalette p,
    Brightness brightness,
    String? fontFamily,
  ) {
    final base = ThemeData(
      brightness: brightness,
      useMaterial3: true,
      fontFamily: fontFamily,
    );
    final textTheme = _textTheme(base.textTheme, p, fontFamily);

    return base.copyWith(
      scaffoldBackgroundColor: p.background,
      canvasColor: p.background,
      primaryColor: p.brand,
      splashColor: p.brand.withValues(alpha: 0.10),
      highlightColor: p.brand.withValues(alpha: 0.06),
      dividerColor: p.border,
      extensions: [p],
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: p.brand,
        onPrimary: Colors.white,
        secondary: p.brand,
        onSecondary: Colors.white,
        error: const Color(0xFFE5484D),
        onError: Colors.white,
        surface: p.surface,
        onSurface: p.textPrimary,
      ),
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: p.background,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: p.textPrimary),
        titleTextStyle: textTheme.titleLarge,
      ),
      iconTheme: IconThemeData(color: p.textPrimary),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) => Colors.white),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.brand : p.surfaceAlt,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.brand : p.border,
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: p.surface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
      ),
      splashFactory: InkRipple.splashFactory,
    );
  }

  static TextTheme _textTheme(
    TextTheme base,
    AppPalette p,
    String? fontFamily,
  ) {
    TextStyle s(double size, FontWeight w, {Color? c, double? h, double? ls}) =>
        TextStyle(
          fontFamily: fontFamily,
          fontSize: size,
          fontWeight: w,
          color: c ?? p.textPrimary,
          height: h,
          letterSpacing: ls,
        );
    return base.copyWith(
      displaySmall: s(30, FontWeight.w800, h: 1.1, ls: -0.5),
      headlineMedium: s(26, FontWeight.w800, h: 1.12, ls: -0.4),
      headlineSmall: s(22, FontWeight.w700, h: 1.15, ls: -0.3),
      titleLarge: s(19, FontWeight.w700, h: 1.2, ls: -0.2),
      titleMedium: s(16, FontWeight.w600, h: 1.25),
      bodyLarge: s(15.5, FontWeight.w500, h: 1.35),
      bodyMedium: s(14, FontWeight.w500, h: 1.4, c: p.textSecondary),
      bodySmall: s(12.5, FontWeight.w500, h: 1.35, c: p.textSecondary),
      labelLarge: s(15.5, FontWeight.w600),
      labelSmall: s(11, FontWeight.w600, c: p.textSecondary, ls: 0.4),
    );
  }
}
