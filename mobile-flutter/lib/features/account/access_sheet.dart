import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../auth/status_widgets.dart';
import '../auth/user_message.dart';
import 'account_repository.dart';

const _options = [
  (value: WalkVisibility.private, label: 'Только я', hint: 'Прогулку видите только вы.'),
  (value: WalkVisibility.shared, label: 'По ссылке', hint: 'Открыть сможет любой, у кого есть ссылка.'),
  (value: WalkVisibility.public, label: 'Доступно всем', hint: 'По ссылке и в «Топе прогулок» после проверки редакцией.'),
];

/// «Доступ к прогулке» (site access-dialog.tsx); pops with the updated walk, or null when unchanged.
Future<AccountWalk?> showAccessSheet(BuildContext context, AccountWalk walk) => showModalBottomSheet<AccountWalk>(
      context: context,
      isScrollControlled: true,
      builder: (context) => AccessSheet(walk: walk),
    );

class AccessSheet extends ConsumerStatefulWidget {
  const AccessSheet({super.key, required this.walk});

  final AccountWalk walk;

  @override
  ConsumerState<AccessSheet> createState() => _AccessSheetState();
}

class _AccessSheetState extends ConsumerState<AccessSheet> {
  late var _choice = widget.walk.visibility;
  var _busy = false;
  String? _error;

  Future<void> _save() async {
    if (_busy) return;
    if (_choice == widget.walk.visibility) {
      Navigator.pop(context);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final walk = await ref.read(accountRepositoryProvider).setVisibility(widget.walk, _choice);
      if (mounted) Navigator.pop(context, walk);
    } catch (error) {
      if (!mounted) return;
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
    final theme = Theme.of(context);
    final walk = widget.walk;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, 0, TokenSizes.spaceMd, TokenSizes.spaceMd),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Semantics(header: true, child: Text(context.t('Доступ к прогулке'), style: theme.textTheme.titleLarge)),
          Text(walk.title, style: theme.textTheme.bodySmall),
          const SizedBox(height: TokenSizes.spaceSm),
          Text(context.t('Кто может открыть прогулку'), style: theme.textTheme.labelMedium),
          RadioGroup<WalkVisibility>(
            groupValue: _choice,
            onChanged: (value) {
              if (!_busy && value != null) setState(() => _choice = value);
            },
            child: Column(children: [
              for (final option in _options)
                RadioListTile<WalkVisibility>(
                  value: option.value,
                  enabled: !_busy && !(option.value == WalkVisibility.public && walk.draft),
                  contentPadding: EdgeInsets.zero,
                  title: Text(context.t(option.label)),
                  subtitle: Text(option.value == WalkVisibility.public && walk.draft
                      ? '${context.t(option.hint)}\n${context.t('Сначала постройте маршрут.')}'
                      : context.t(option.hint)),
                ),
            ]),
          ),
          if (walk.visibility == WalkVisibility.public && walk.listingStatus == ListingStatus.hidden)
            Padding(
              padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
              child: StatusNotice(text: context.t('Редакция скрыла прогулку из топа. Ссылка продолжает работать.')),
            ),
          if (_error != null) ...[AlertNotice(text: _error!), const SizedBox(height: TokenSizes.spaceSm)],
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            TextButton(onPressed: () => Navigator.pop(context), child: Text(context.t('Отмена'))),
            const SizedBox(width: TokenSizes.spaceXs),
            FilledButton(
              key: const ValueKey('access-save'),
              onPressed: _busy ? null : _save,
              child: Text(context.t(_busy ? 'Сохраняем…' : 'Сохранить')),
            ),
          ]),
        ]),
      ),
    );
  }
}
