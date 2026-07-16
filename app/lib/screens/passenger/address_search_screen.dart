import 'dart:async';

import 'package:flutter/material.dart';
import '../../theme/app_palette.dart';
import '../../models/models.dart';
import '../../services/address_suggest_service.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';

class AddressSearchScreen extends StatefulWidget {
  const AddressSearchScreen({
    super.key,
    required this.from,
    required this.to,
    required this.editingFrom,
  });
  final String from;
  final String to;
  final bool editingFrom;

  @override
  State<AddressSearchScreen> createState() => _AddressSearchScreenState();
}

class _AddressSearchScreenState extends State<AddressSearchScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<Place> _results = const [];
  bool _loading = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    if (value.trim().length < 2) {
      setState(() => _results = const []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      setState(() => _loading = true);
      final results = await AddressSuggestService.search(value);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _results = results;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final results = _results;
    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 0),
              child: Row(
                children: [
                  SquareIconButton(
                    icon: Icons.close,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
              child: Column(
                children: [
                  _FieldRow(
                    icon: Icons.my_location,
                    label: 'Точка посадки',
                    hint: 'Откуда поедете?',
                    value: widget.from,
                    active: widget.editingFrom,
                    controller: widget.editingFrom ? _controller : null,
                    onChanged: _onQueryChanged,
                  ),
                  const SizedBox(height: 10),
                  _FieldRow(
                    icon: Icons.outlined_flag,
                    label: 'Пункт назначения',
                    hint: 'Куда поедете?',
                    value: widget.to,
                    active: !widget.editingFrom,
                    controller: !widget.editingFrom ? _controller : null,
                    onChanged: _onQueryChanged,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : results.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                      child: Text(
                        'Совпадений нет',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: p.textSecondary,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      itemCount: results.length,
                      separatorBuilder: (context, index) =>
                          Divider(height: 1, color: p.border, indent: 64),
                      itemBuilder: (context, i) {
                        final place = results[i];
                        return ListTile(
                          leading: Icon(place.icon, color: p.textSecondary),
                          title: Text(
                            place.title,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: p.textPrimary,
                            ),
                          ),
                          subtitle: Text(
                            place.subtitle,
                            style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w500,
                              color: p.textTertiary,
                            ),
                          ),
                          onTap: () async {
                            setState(() => _loading = true);
                            final resolved =
                                await AddressSuggestService.resolve(place);
                            if (!context.mounted) return;
                            if (resolved == null) {
                              setState(() => _loading = false);
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Не удалось определить координаты адреса',
                                  ),
                                ),
                              );
                              return;
                            }
                            Navigator.of(context).pop(resolved);
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({
    required this.icon,
    required this.label,
    required this.hint,
    required this.value,
    required this.active,
    required this.onChanged,
    this.controller,
  });
  final IconData icon;
  final String label;
  final String hint;
  final String value;
  final bool active;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: p.surfaceAlt,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: active ? p.brand : Colors.transparent,
          width: 1.6,
        ),
      ),
      child: Row(
        children: [
          SoftIconBox(icon: icon, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w500,
                    color: p.textTertiary,
                  ),
                ),
                active
                    ? TextField(
                        controller: controller,
                        autofocus: true,
                        onChanged: onChanged,
                        cursorColor: p.brand,
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: p.textPrimary,
                        ),
                        decoration: InputDecoration(
                          isDense: true,
                          contentPadding: EdgeInsets.zero,
                          border: InputBorder.none,
                          hintText: hint,
                          hintStyle: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w500,
                            color: p.textTertiary,
                          ),
                        ),
                      )
                    : Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          value,
                          style: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w600,
                            color: p.textPrimary,
                          ),
                        ),
                      ),
              ],
            ),
          ),
          MiniPill(label: 'Карта'),
        ],
      ),
    );
  }
}
