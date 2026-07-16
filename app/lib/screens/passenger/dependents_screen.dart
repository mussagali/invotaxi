import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../state/app_scope.dart';
import '../../theme/app_palette.dart';
import '../../widgets/buttons.dart';
import '../../widgets/common.dart';
import '../../widgets/page_header.dart';

/// Lets a parent keep a small list of children and select them for one trip.
/// A selected group is submitted as one backend order with one route.
class DependentsScreen extends StatefulWidget {
  const DependentsScreen({
    super.key,
    this.selectedIds = const <String>{},
    this.selectionMode = true,
  });

  final Set<String> selectedIds;
  final bool selectionMode;

  @override
  State<DependentsScreen> createState() => _DependentsScreenState();
}

class _DependentsScreenState extends State<DependentsScreen> {
  final Set<String> _selectedIds = <String>{};
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _selectedIds.addAll(widget.selectedIds);
  }

  Future<void> _addDependent() async {
    final nameController = TextEditingController();
    var needsEscort = false;
    final created = await showModalBottomSheet<Dependent>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            20 + MediaQuery.viewInsetsOf(sheetContext).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Добавить ребёнка',
                style: Theme.of(sheetContext).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              const Text('Укажите только имя или удобное для вас обозначение.'),
              const SizedBox(height: 18),
              TextField(
                controller: nameController,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Имя ребёнка',
                  hintText: 'Например, Алия',
                ),
              ),
              const SizedBox(height: 10),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Нужен сопровождающий'),
                subtitle: const Text('Будет учтено при оформлении заказа'),
                value: needsEscort,
                onChanged: (value) => setSheetState(() => needsEscort = value),
              ),
              const SizedBox(height: 12),
              PrimaryButton(
                label: 'Добавить',
                onPressed: () async {
                  final name = nameController.text.trim();
                  if (name.isEmpty) return;
                  try {
                    final dependent = await sheetContext.appRead.addDependent(
                      fullName: name,
                      needsEscort: needsEscort,
                    );
                    if (sheetContext.mounted) {
                      Navigator.of(sheetContext).pop(dependent);
                    }
                  } catch (error) {
                    if (sheetContext.mounted) {
                      ScaffoldMessenger.of(
                        sheetContext,
                      ).showSnackBar(SnackBar(content: Text(error.toString())));
                    }
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
    nameController.dispose();
    if (created != null && mounted) {
      setState(() => _selectedIds.add(created.id));
    }
  }

  Future<void> _archive(Dependent dependent) async {
    final approved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Убрать из списка?'),
        content: Text(
          '${dependent.fullName} больше не будет доступен для новых заказов.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Убрать'),
          ),
        ],
      ),
    );
    if (approved != true || !mounted) return;
    try {
      await context.appRead.archiveDependent(dependent.id);
      if (mounted) setState(() => _selectedIds.remove(dependent.id));
    } catch (error) {
      if (mounted) showToast(context, error.toString());
    }
  }

  Future<void> _continue() async {
    if (_saving) return;
    setState(() => _saving = true);
    if (!mounted) return;
    Navigator.of(context).pop(_selectedIds);
  }

  void _toggle(Dependent dependent) {
    if (!_selectedIds.contains(dependent.id) && _selectedIds.length >= 5) {
      showToast(context, 'В одном семейном заказе можно выбрать до 5 детей');
      return;
    }
    setState(() {
      if (_selectedIds.contains(dependent.id)) {
        _selectedIds.remove(dependent.id);
      } else {
        _selectedIds.add(dependent.id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final dependents = context.app.dependents;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.selectionMode ? 'Для кого поездка?' : 'Дети и подопечные',
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppCard(
                color: p.brandSoft,
                border: false,
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.family_restroom, color: p.brand),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        widget.selectionMode
                            ? 'Отметьте одного или нескольких детей. Для всех будет создан один семейный заказ с общим маршрутом.'
                            : 'Добавляйте детей, чтобы быстро выбирать их при оформлении семейной поездки.',
                        style: TextStyle(
                          height: 1.35,
                          fontWeight: FontWeight.w500,
                          color: p.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Expanded(
                child: dependents.isEmpty
                    ? Center(
                        child: Text(
                          'Пока никого нет в списке.\nДобавьте ребёнка, чтобы оформить поездку за него.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: p.textSecondary, height: 1.4),
                        ),
                      )
                    : ListView.separated(
                        itemCount: dependents.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 8),
                        itemBuilder: (_, index) {
                          final dependent = dependents[index];
                          final selected = _selectedIds.contains(dependent.id);
                          return AppCard(
                            border: selected,
                            onTap: widget.selectionMode
                                ? () => _toggle(dependent)
                                : null,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 8,
                            ),
                            child: Row(
                              children: [
                                SoftIconBox(
                                  icon: Icons.child_care_outlined,
                                  size: 42,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        dependent.fullName,
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w700,
                                          color: p.textPrimary,
                                        ),
                                      ),
                                      if (dependent.needsEscort)
                                        Text(
                                          'Нужен сопровождающий',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: p.textSecondary,
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                                if (widget.selectionMode)
                                  Checkbox(
                                    value: selected,
                                    onChanged: (_) => _toggle(dependent),
                                  ),
                                IconButton(
                                  tooltip: 'Убрать из списка',
                                  onPressed: () => _archive(dependent),
                                  icon: Icon(
                                    Icons.delete_outline,
                                    color: p.textTertiary,
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
              OutlinedButton.icon(
                onPressed: _addDependent,
                icon: const Icon(Icons.person_add_alt_1_outlined),
                label: const Text('Добавить ребёнка'),
              ),
              if (widget.selectionMode) ...[
                const SizedBox(height: 10),
                PrimaryButton(
                  label: _selectedIds.isEmpty
                      ? 'Заказать для себя'
                      : 'Продолжить · детей: ${_selectedIds.length}',
                  onPressed: _saving ? null : _continue,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
