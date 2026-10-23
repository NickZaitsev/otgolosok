import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/i18n/i18n.dart';

/// «Как передвигаемся» (site `TravelPreference`): the travel mode new walks start with.
class TravelPreference extends ConsumerStatefulWidget {
  const TravelPreference({super.key});

  @override
  ConsumerState<TravelPreference> createState() => _TravelPreferenceState();
}

class _TravelPreferenceState extends ConsumerState<TravelPreference> {
  late bool _driving = ref.read(settingsProvider).prefersDriving;

  Future<void> _choose(bool driving) async {
    if (driving == _driving) return;
    final previous = _driving;
    setState(() => _driving = driving);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final failed = context.t('Не удалось сохранить настройку.');
    try {
      await ref.read(settingsProvider).setPrefersDriving(driving);
    } catch (error) {
      debugPrint('travel mode: $error');
      if (mounted) setState(() => _driving = previous);
      messenger?.showSnackBar(SnackBar(content: Text(failed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(context.t('Как передвигаемся'), style: theme.textTheme.titleSmall),
      const SizedBox(height: 8),
      SegmentedButton<bool>(
        segments: [
          ButtonSegment(value: false, label: Text(context.t('Пешком'))),
          ButtonSegment(value: true, label: Text(context.t('На машине'))),
        ],
        selected: {_driving},
        showSelectedIcon: false,
        onSelectionChanged: (selection) => _choose(selection.single),
      ),
      const SizedBox(height: 4),
      Text(context.t('Выбор применяется к новым прогулкам на этом устройстве.'), style: theme.textTheme.bodySmall),
    ]);
  }
}
