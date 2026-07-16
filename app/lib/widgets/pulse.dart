import 'package:flutter/material.dart';
import '../theme/app_palette.dart';

/// Concentric pulsing rings with a central icon — used for the dispatcher
/// "Ожидает решения" loader and the SOS confirmation.
class PulseIndicator extends StatefulWidget {
  const PulseIndicator({
    super.key,
    this.icon = Icons.autorenew,
    this.size = 128,
    this.spinning = true,
  });
  final IconData icon;
  final double size;
  final bool spinning;

  @override
  State<PulseIndicator> createState() => _PulseIndicatorState();
}

class _PulseIndicatorState extends State<PulseIndicator>
    with TickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();
  late final AnimationController _spin = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, _) {
          return Stack(
            alignment: Alignment.center,
            children: [
              for (int i = 0; i < 3; i++) _ring(i, p.brand),
              Container(
                width: widget.size * 0.44,
                height: widget.size * 0.44,
                decoration: BoxDecoration(
                  color: p.brand,
                  shape: BoxShape.circle,
                ),
                child: widget.spinning
                    ? RotationTransition(
                        turns: _spin,
                        child: Icon(
                          widget.icon,
                          color: Colors.white,
                          size: widget.size * 0.2,
                        ),
                      )
                    : Icon(
                        widget.icon,
                        color: Colors.white,
                        size: widget.size * 0.22,
                      ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _ring(int index, Color color) {
    final t = ((_pulse.value + index / 3) % 1.0);
    final scale = 0.5 + t * 0.5;
    final opacity = (1 - t) * 0.35;
    return Opacity(
      opacity: opacity,
      child: Container(
        width: widget.size * scale,
        height: widget.size * scale,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}
