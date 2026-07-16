import 'dart:math';
import 'package:flutter/material.dart';
import '../theme/app_palette.dart';

/// A stylised, self-contained neutral street-map background.
///
/// Optionally draws an orange route and pickup / drop-off markers.
class MapBackground extends StatelessWidget {
  const MapBackground({
    super.key,
    this.showRoute = false,
    this.showPin = true,
    this.showCar = false,
    this.badge,
  });

  final bool showRoute;
  final bool showPin;
  final bool showCar;
  final String? badge; // e.g. "30 мин"

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return ClipRect(
      child: CustomPaint(
        painter: _MapPainter(
          base: p.mapBase,
          stroke: p.mapStroke,
          brand: p.brand,
          isDark: Theme.of(context).brightness == Brightness.dark,
          showRoute: showRoute,
          showPin: showPin,
          showCar: showCar,
        ),
        child: badge == null
            ? const SizedBox.expand()
            : Stack(
                children: [
                  Positioned(
                    right: 28,
                    top: 26,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: p.brand,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        badge!,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 12.5,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _MapPainter extends CustomPainter {
  _MapPainter({
    required this.base,
    required this.stroke,
    required this.brand,
    required this.isDark,
    required this.showRoute,
    required this.showPin,
    required this.showCar,
  });

  final Color base, stroke, brand;
  final bool isDark, showRoute, showPin, showCar;

  @override
  void paint(Canvas canvas, Size size) {
    final bg = Paint()..color = base;
    canvas.drawRect(Offset.zero & size, bg);

    // Blocks (buildings)
    final block = Paint()
      ..color = isDark
          ? stroke.withValues(alpha: 0.35)
          : Colors.white.withValues(alpha: 0.55);
    final rnd = Random(7);
    const cell = 68.0;
    for (double y = -20; y < size.height + cell; y += cell) {
      for (double x = -20; x < size.width + cell; x += cell) {
        if (rnd.nextDouble() < 0.55) {
          final w = cell * (0.45 + rnd.nextDouble() * 0.4);
          final h = cell * (0.45 + rnd.nextDouble() * 0.4);
          canvas.drawRRect(
            RRect.fromRectAndRadius(
              Rect.fromLTWH(x + 8, y + 8, w, h),
              const Radius.circular(3),
            ),
            block,
          );
        }
      }
    }

    // Streets grid
    final road = Paint()
      ..color = stroke
      ..strokeWidth = 6
      ..style = PaintingStyle.stroke;
    for (double x = 30; x < size.width; x += cell) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), road);
    }
    for (double y = 40; y < size.height; y += cell) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), road);
    }
    // A couple of wider avenues
    final avenue = Paint()
      ..color = isDark ? stroke.withValues(alpha: 0.9) : Colors.white
      ..strokeWidth = 12
      ..style = PaintingStyle.stroke;
    canvas.drawLine(
      Offset(0, size.height * 0.62),
      Offset(size.width, size.height * 0.52),
      avenue,
    );

    // Route
    if (showRoute) {
      final path = Path()
        ..moveTo(size.width * 0.2, size.height * 0.78)
        ..lineTo(size.width * 0.32, size.height * 0.5)
        ..lineTo(size.width * 0.6, size.height * 0.42)
        ..lineTo(size.width * 0.82, size.height * 0.24);
      final routePaint = Paint()
        ..color = brand
        ..strokeWidth = 6
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      canvas.drawPath(path, routePaint);
      _dot(canvas, Offset(size.width * 0.2, size.height * 0.78), brand);
      if (showCar) {
        _car(canvas, Offset(size.width * 0.6, size.height * 0.42), brand);
      }
      _pin(canvas, Offset(size.width * 0.82, size.height * 0.24), brand);
    }

    if (showPin && !showRoute) {
      _marker(canvas, Offset(size.width / 2, size.height * 0.52), brand);
    }
  }

  void _marker(Canvas c, Offset o, Color color) {
    c.drawCircle(o, 22, Paint()..color = color.withValues(alpha: 0.18));
    c.drawCircle(o, 13, Paint()..color = color);
    c.drawCircle(o, 5, Paint()..color = Colors.white);
  }

  void _dot(Canvas c, Offset o, Color color) {
    c.drawCircle(o, 8, Paint()..color = Colors.white);
    c.drawCircle(o, 6, Paint()..color = color);
  }

  void _pin(Canvas c, Offset o, Color color) {
    final path = Path();
    path.addOval(Rect.fromCircle(center: o.translate(0, -8), radius: 11));
    path.moveTo(o.dx - 7, o.dy - 4);
    path.lineTo(o.dx, o.dy + 8);
    path.lineTo(o.dx + 7, o.dy - 4);
    path.close();
    c.drawPath(path, Paint()..color = color);
    c.drawCircle(o.translate(0, -8), 4, Paint()..color = Colors.white);
  }

  void _car(Canvas c, Offset o, Color color) {
    final r = RRect.fromRectAndRadius(
      Rect.fromCenter(center: o, width: 30, height: 16),
      const Radius.circular(5),
    );
    c.drawRRect(r, Paint()..color = const Color(0xFF17171B));
    c.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: o, width: 16, height: 9),
        const Radius.circular(3),
      ),
      Paint()..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant _MapPainter old) =>
      old.base != base ||
      old.brand != brand ||
      old.showRoute != showRoute ||
      old.showCar != showCar;
}
