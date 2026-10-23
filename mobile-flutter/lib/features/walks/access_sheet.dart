import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/user_message.dart';
import 'walk_cards.dart';

/// «Доступ к прогулке» (site `access-dialog.tsx`): the three access levels of an account walk, for
/// the walk library and the builder.
/// Resolves with the server's new access, or null when the sheet was closed without a change.
Future<WalkAccess?> showAccessSheet(BuildContext context, WalkCard card) => showModalBottomSheet<WalkAccess>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => AccessSheet(card: card),
    );

class AccessSheet extends ConsumerStatefulWidget {
  const AccessSheet({super.key, required this.card});
  final WalkCard card;

  @override
  ConsumerState<AccessSheet> createState() => _AccessSheetState();
}

class _AccessSheetState extends ConsumerState<AccessSheet> {
  late WalkVisibility _choice = widget.card.visibility ?? WalkVisibility.private;
  bool _busy = false;
  String _error = '';

  Future<void> _save() async {
    final card = widget.card;
    if (_busy) return;
    if (_choice == card.visibility) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final access = await AccountWalksApi(ref.read(apiProvider)).setVisibility(card.id, card.revision, _choice);
      if (mounted) Navigator.of(context).pop(access);
    } on Object catch (error) {
      if (!mounted || (error is ApiError && error.isCancelled)) return;
      setState(() {
        _busy = false;
        _error = error is ApiError && error.status == 409 && error.code != 'WALK_NOT_READY'
            ? context.t('Прогулка изменилась на другом устройстве. Обновите страницу и повторите.')
            : userMessage(context, error, 'Не удалось изменить доступ.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final card = widget.card;
    final theme = Theme.of(context);
    final options = [
      (WalkVisibility.private, context.t('Только я'), context.t('Прогулку видите только вы.')),
      (WalkVisibility.shared, context.t('По ссылке'), context.t('Открыть сможет любой, у кого есть ссылка.')),
      (WalkVisibility.public, context.t('Доступно всем'), context.t('По ссылке и в «Топе прогулок» после проверки редакцией.')),
    ];
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Semantics(header: true, child: Text(context.t('Доступ к прогулке'), style: theme.textTheme.titleLarge)),
        Text(card.title, style: theme.textTheme.bodySmall),
        const SizedBox(height: 12),
        Text(context.t('Кто может открыть прогулку'), style: theme.textTheme.labelMedium),
        RadioGroup<WalkVisibility>(
          groupValue: _choice,
          onChanged: (value) {
            if (!_busy && value != null) setState(() => _choice = value);
          },
          child: Column(children: [
            for (final (value, label, hint) in options)
              RadioListTile<WalkVisibility>(
                value: value,
                enabled: !_busy && !(value == WalkVisibility.public && card.draft),
                contentPadding: EdgeInsets.zero,
                title: Text(label),
                subtitle: Text(value == WalkVisibility.public && card.draft ? '$hint ${context.t('Сначала постройте маршрут.')}' : hint),
              ),
          ]),
        ),
        if (card.visibility == WalkVisibility.public && card.listingStatus == ListingStatus.hidden)
          Text(context.t('Редакция скрыла прогулку из топа. Ссылка продолжает работать.'), style: theme.textTheme.bodySmall),
        if (_error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Semantics(liveRegion: true, child: Text(_error, style: const TextStyle(color: TokenColors.dangerInk))),
          ),
        const SizedBox(height: 12),
        Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(context.t('Отмена'))),
          const SizedBox(width: 8),
          FilledButton(key: const ValueKey('access-save'), onPressed: _busy ? null : _save, child: Text(_busy ? context.t('Сохраняем…') : context.t('Сохранить'))),
        ]),
      ]),
    );
  }
}
