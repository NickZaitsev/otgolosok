import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../core/i18n/user_message.dart';
import '../walks/format.dart';
import 'offline_packs.dart';

/// What the last action left to say under the offline controls.
sealed class OfflineCopyNotice {
  const OfflineCopyNotice();
}

class OfflineFoodSkipped extends OfflineCopyNotice {
  const OfflineFoodSkipped();
}

class OfflineSaveFailed extends OfflineCopyNotice {
  const OfflineSaveFailed(this.error);
  final Object error;
}

class OfflineRemoveFailed extends OfflineCopyNotice {
  const OfflineRemoveFailed();
}

/// State of the walk's offline copy (site `useOfflineCopy`); lives with the walk screen so a closed
/// sheet keeps a running save.
class OfflineCopyController extends ChangeNotifier {
  OfflineCopyController({required this._packs, required this.ref}) {
    _refresh();
  }

  final OfflinePackManager _packs;
  final OfflineWalkRef ref;

  int? _saved;
  OfflineCopyNotice? _notice;
  bool _busy = false;
  bool _disposed = false;

  /// Number of recordings in the saved copy; null while there is none.
  int? get saved => _saved;
  OfflineCopyNotice? get notice => _notice;
  bool get busy => _busy;

  Future<void> _refresh() async {
    final manifest = await _packs.status(ref);
    if (_disposed || _busy) return;
    _saved = manifest?.audio.length;
    _notify();
  }

  /// Saves [viewJson], the walk view as the server sent it.
  Future<void> save(Object? viewJson) async {
    if (_busy) return;
    _busy = true;
    _notice = null;
    _notify();
    try {
      final result = await _packs.save(viewJson, ref);
      _saved = result.availableAudio;
      if (result.foodWarning) _notice = const OfflineFoodSkipped();
    } on Object catch (error) {
      _notice = OfflineSaveFailed(error);
    } finally {
      _busy = false;
      _notify();
    }
  }

  Future<void> remove() async {
    if (_busy) return;
    _busy = true;
    _notice = null;
    _notify();
    try {
      await _packs.remove(ref);
      _saved = null;
    } on Object {
      _notice = const OfflineRemoveFailed();
    } finally {
      _busy = false;
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// «Офлайн-копия сохранена · N записей» with the Russian plural (site `offlineCopyLabel`).
String offlineCopyLabel(BuildContext context, int count) {
  final locale = context.appLocale;
  final key = switch (locale) {
    AppLocale.zh => 'Офлайн-копия сохранена · {count} записей',
    AppLocale.en => count == 1 ? 'Офлайн-копия сохранена · {count} запись' : 'Офлайн-копия сохранена · {count} записей',
    AppLocale.ru => switch (ruPlural(count)) {
        RuPlural.one => 'Офлайн-копия сохранена · {count} запись',
        RuPlural.few => 'Офлайн-копия сохранена · {count} записи',
        RuPlural.many => 'Офлайн-копия сохранена · {count} записей',
      },
  };
  return context.t(key, {'count': count});
}

/// Status line and buttons of the offline copy (site `OfflineCopyControls`).
class OfflineCopyControls extends StatelessWidget {
  const OfflineCopyControls({super.key, required this.copy, required this.viewJson});
  final OfflineCopyController copy;

  /// The walk view to save, as the server sent it.
  final Object? viewJson;

  String _status(BuildContext context) => switch (copy.notice) {
        OfflineFoodSkipped() => context.t('Заведения не сохранены'),
        OfflineSaveFailed(:final error) => userMessage(context, error, 'Не удалось сохранить офлайн-копию.'),
        OfflineRemoveFailed() => context.t('Не удалось удалить офлайн-копию.'),
        null => copy.saved == null ? context.t('Офлайн-копия ещё не сохранена') : offlineCopyLabel(context, copy.saved!),
      };

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: copy,
        builder: (context, _) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Semantics(liveRegion: true, child: Text(_status(context))),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.download_for_offline_outlined),
            onPressed: copy.busy ? null : () => copy.save(viewJson),
            label: Text(copy.busy
                ? context.t('Сохраняем…')
                : copy.saved == null
                    ? context.t('Сохранить прогулку без сети')
                    : context.t('Обновить офлайн-копию')),
          ),
          if (copy.saved != null)
            TextButton(onPressed: copy.busy ? null : copy.remove, child: Text(context.t('Удалить офлайн-копию'))),
        ]),
      );
}
