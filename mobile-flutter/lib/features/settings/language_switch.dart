import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/router.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';

/// «Язык интерфейса» (site `LanguageSwitcher`): while a walk runs the change is confirmed first,
/// because the walk's content is in the previous language.
class LanguageSwitch extends ConsumerStatefulWidget {
  const LanguageSwitch({super.key});

  @override
  ConsumerState<LanguageSwitch> createState() => _LanguageSwitchState();
}

class _LanguageSwitchState extends ConsumerState<LanguageSwitch> {
  bool _busy = false;

  /// Rebuilds the field after a cancelled change so it shows the current language again.
  int _resets = 0;

  Future<void> _choose(AppLocale? next) async {
    final current = ref.read(localeProvider);
    if (next == null || next == current || _busy) return;
    if (ref.read(walkActiveProvider)) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          content: Text(context.t('Смена языка прервёт прогулку. Продолжить?')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(context.t('Отмена'))),
            TextButton(onPressed: () => Navigator.pop(context, true), child: Text(context.t('Продолжить'))),
          ],
        ),
      );
      if (!mounted) return;
      if (confirmed != true) {
        setState(() => _resets++);
        return;
      }
    }
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final failed = context.t('Не удалось сохранить настройку.');
    try {
      await ref.read(localeProvider.notifier).choose(next);
    } catch (error) {
      debugPrint('locale: $error');
      messenger?.showSnackBar(SnackBar(content: Text(failed)));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _resets++;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final locale = ref.watch(localeProvider);
    return DropdownButtonFormField<AppLocale>(
      initialValue: locale,
      key: ValueKey((locale, _resets)),
      decoration: InputDecoration(labelText: context.t('Язык интерфейса')),
      items: [
        for (final value in AppLocale.values) DropdownMenuItem(value: value, child: Text(value.nativeName)),
      ],
      onChanged: _busy ? null : _choose,
    );
  }
}
