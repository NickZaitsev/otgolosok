/// Like or dislike of a map place and what to improve (port of `src/features/place-feedback`).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/user_message.dart';
import '../feedback/improvement_model.dart';
import '../feedback/improvement_sheet.dart' show improvementIssueLabel;

const placeFeedbackTextMax = 1000;

enum PlaceFeedbackStatus { open, resolved }

@immutable
class PlaceFeedback {
  const PlaceFeedback({required this.rating, required this.issues, required this.text, required this.status, required this.updatedAt});

  /// 1 or -1.
  final int rating;
  final List<ImprovementIssue> issues;
  final String text;
  final PlaceFeedbackStatus status;
  final String updatedAt;
}

final _osmPlace = RegExp(r'^osm:(node|way|relation):\d+$');

/// Votes belong to an OSM place: other ids have nothing the server could store a vote for.
bool canRatePlace(String placeId) => _osmPlace.hasMatch(placeId);

String placeFeedbackPath(String placeId) {
  if (!canRatePlace(placeId)) throw ArgumentError.value(placeId, 'placeId', 'Неверное место.');
  return '/api/content/places/$placeId/feedback/mine';
}

/// `{mine: null}` or the viewer's vote; anything else is malformed.
PlaceFeedback? validatePlaceFeedback(Object? value) {
  if (value is! Map<String, Object?>) throw const FormatException('Неверный ответ оценки.');
  if (!value.containsKey('mine')) throw const FormatException('Неверная оценка.');
  final mine = value['mine'];
  if (mine == null) return null;
  const invalid = FormatException('Неверная оценка.');
  if (mine is! Map<String, Object?>) throw invalid;
  final rating = mine['rating'];
  final issues = mine['issues'];
  final text = mine['text'];
  final status = switch (mine['status']) {
    'open' => PlaceFeedbackStatus.open,
    'resolved' => PlaceFeedbackStatus.resolved,
    _ => null,
  };
  if ((rating != 1 && rating != -1) || issues is! List<Object?> || text is! String || status == null || mine['updatedAt'] is! String) {
    throw invalid;
  }
  final parsed = [for (final issue in issues) ImprovementIssue.values.where((value) => value.wire == issue).firstOrNull];
  if (parsed.contains(null) || parsed.toSet().length != parsed.length || text.length > placeFeedbackTextMax) throw invalid;
  if (rating == 1 && (parsed.isNotEmpty || text.isNotEmpty)) throw invalid;
  return PlaceFeedback(
    rating: (rating! as num).toInt(),
    issues: canonicalIssues(parsed.whereType<ImprovementIssue>()),
    text: text,
    status: status,
    updatedAt: mine['updatedAt']! as String,
  );
}

/// A signed-in viewer is identified by the session, a guest by the device review key.
class PlaceFeedbackApi {
  const PlaceFeedbackApi(this._api);

  final ApiClient _api;

  Future<PlaceFeedback?> load(String placeId) => _api.get(placeFeedbackPath(placeId), validatePlaceFeedback, guestKey: true);

  Future<PlaceFeedback?> save(String placeId, {required int? rating, List<ImprovementIssue> issues = const [], String text = ''}) =>
      _api.send(
        'PUT',
        placeFeedbackPath(placeId),
        validatePlaceFeedback,
        body: {'rating': rating, 'issues': [for (final issue in issues) issue.wire], 'text': text},
        idempotent: true,
        guestKey: true,
      );
}

final placeFeedbackApiProvider = Provider<PlaceFeedbackApi>((ref) => PlaceFeedbackApi(ref.watch(apiProvider)));

/// Like/dislike of one place. The parent keys it by place id: drafts and requests never cross places.
class PlaceFeedbackPanel extends ConsumerStatefulWidget {
  const PlaceFeedbackPanel({super.key, required this.placeId, required this.title});

  final String placeId;
  final String title;

  @override
  ConsumerState<PlaceFeedbackPanel> createState() => _PlaceFeedbackPanelState();
}

class _PlaceFeedbackPanelState extends ConsumerState<PlaceFeedbackPanel> {
  var _loaded = false;
  PlaceFeedback? _mine;
  var _failed = false;
  var _busy = false;
  String _error = '';
  String _notice = '';
  var _attempt = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final attempt = ++_attempt;
    setState(() {
      _failed = false;
    });
    try {
      final mine = await ref.read(placeFeedbackApiProvider).load(widget.placeId);
      if (!mounted || attempt != _attempt) return;
      setState(() {
        _loaded = true;
        _mine = mine;
      });
    } on Object catch (error) {
      if (!mounted || attempt != _attempt) return;
      if (error is! ApiError && error is! FormatException) debugPrint('Place feedback failed to load: $error');
      setState(() => _failed = true);
    }
  }

  /// Saves and returns the stored vote, or null after an error (shown in [_error] or [onError]).
  Future<(bool, PlaceFeedback?)> _save({required int? rating, List<ImprovementIssue> issues = const [], String text = '', void Function(String)? onError}) async {
    if (!_loaded || _busy) return (false, null);
    setState(() {
      _busy = true;
      _error = '';
      _notice = '';
    });
    try {
      final mine = await ref.read(placeFeedbackApiProvider).save(widget.placeId, rating: rating, issues: issues, text: text);
      if (!mounted) return (false, null);
      setState(() {
        _mine = mine;
        _busy = false;
      });
      return (true, mine);
    } on Object catch (error) {
      if (!mounted) return (false, null);
      if (error is! ApiError && error is! FormatException) debugPrint('Place feedback failed to save: $error');
      final message = userMessage(context, error, 'Не удалось сохранить оценку. Повторите попытку.');
      setState(() {
        _busy = false;
        if (onError == null) _error = message;
      });
      onError?.call(message);
      return (false, null);
    }
  }

  Future<void> _rate(int rating) async {
    final next = _mine?.rating == rating ? null : rating;
    final (saved, mine) = await _save(rating: next);
    if (!saved || !mounted) return;
    if (next == -1) {
      await _improve(mine);
    } else {
      setState(() => _notice = context.t(next == 1 ? 'Спасибо за оценку!' : 'Оценка снята.'));
    }
  }

  Future<void> _improve(PlaceFeedback? mine) async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (sheetContext) => _ImproveSheet(
        title: widget.title,
        initial: mine,
        submit: (issues, text, onError) async => (await _save(rating: -1, issues: issues, text: text, onError: onError)).$1,
      ),
    );
    if (sent == true && mounted) setState(() => _notice = context.t('Спасибо! Передали редакции, что можно улучшить.'));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rating = _mine?.rating;
    Widget vote(int value, IconData icon, String label) {
      final pressed = rating == value;
      final onPressed = !_loaded || _busy ? null : () => _rate(value);
      return Semantics(
        toggled: pressed,
        child: pressed
            ? FilledButton.tonalIcon(onPressed: onPressed, icon: Icon(icon), label: Text(label))
            : OutlinedButton.icon(onPressed: onPressed, icon: Icon(icon), label: Text(label)),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Semantics(
          container: true,
          label: context.t('Оценка места'),
          child: Wrap(spacing: TokenSizes.spaceXs, runSpacing: TokenSizes.spaceXs, children: [
            vote(1, Icons.thumb_up_outlined, context.t('Нравится')),
            vote(-1, Icons.thumb_down_outlined, context.t('Не нравится')),
          ]),
        ),
        if (rating == -1)
          TextButton(onPressed: _busy ? null : () => _improve(_mine), child: Text(context.t('Что можно улучшить?'))),
        if (_failed)
          Padding(
            padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
            child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
              Semantics(liveRegion: true, child: Text(context.t('Не удалось загрузить оценку.'))),
              TextButton(onPressed: _load, child: Text(context.t('Повторить'))),
            ]),
          ),
        if (!_loaded && !_failed)
          Padding(
            padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
            child: Text(context.t('Загружаем оценку…'), style: theme.textTheme.bodySmall),
          ),
        if (_notice.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
            child: Semantics(liveRegion: true, child: Text(_notice)),
          ),
        if (_error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
            child: Semantics(liveRegion: true, child: Text(_error, style: TextStyle(color: theme.colorScheme.error))),
          ),
      ],
    );
  }
}

typedef _Submit = Future<bool> Function(List<ImprovementIssue> issues, String text, void Function(String message) onError);

class _ImproveSheet extends StatefulWidget {
  const _ImproveSheet({required this.title, required this.initial, required this.submit});

  final String title;
  final PlaceFeedback? initial;
  final _Submit submit;

  @override
  State<_ImproveSheet> createState() => _ImproveSheetState();
}

class _ImproveSheetState extends State<_ImproveSheet> {
  late final Set<ImprovementIssue> _selected = {...?widget.initial?.issues};
  late final TextEditingController _text = TextEditingController(text: widget.initial?.text ?? '');
  var _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _text.addListener(_changed);
  }

  void _changed() => setState(() {});

  @override
  void dispose() {
    _text
      ..removeListener(_changed)
      ..dispose();
    super.dispose();
  }

  bool get _unchanged {
    final issues = canonicalIssues(_selected);
    final initial = widget.initial;
    return _sameIssues(issues, initial?.issues ?? const []) && _text.text.trim() == (initial?.text ?? '');
  }

  static bool _sameIssues(List<ImprovementIssue> a, List<ImprovementIssue> b) =>
      a.length == b.length && [for (var i = 0; i < a.length; i++) a[i] == b[i]].every((same) => same);

  Future<void> _send() async {
    final initial = widget.initial;
    final issues = canonicalIssues(_selected);
    final text = _text.text.trim();
    // Nothing to send: no reason now and nothing stored to clear.
    if (_unchanged || (issues.isEmpty && text.isEmpty && (initial?.text ?? '').isEmpty && (initial?.issues ?? const []).isEmpty)) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    final sent = await widget.submit(issues, text, (message) {
      if (mounted) setState(() => _error = message);
    });
    if (!mounted) return;
    if (sent) {
      Navigator.of(context).pop(true);
    } else {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, 0, TokenSizes.spaceMd, TokenSizes.spaceLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Semantics(header: true, child: Text(context.t('Что улучшить в этом месте?'), style: theme.textTheme.titleLarge)),
                  Text(widget.title, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                ]),
              ),
              IconButton(
                tooltip: context.t('Закрыть'),
                onPressed: () => Navigator.of(context).pop(false),
                icon: const Icon(Icons.close),
              ),
            ]),
            const SizedBox(height: TokenSizes.spaceSm),
            Text(context.t('Отметьте, что мешает. Можно несколько вариантов.')),
            for (final issue in ImprovementIssue.values)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _selected.contains(issue),
                onChanged: _busy
                    ? null
                    : (checked) => setState(() => checked == true ? _selected.add(issue) : _selected.remove(issue)),
                title: Text(improvementIssueLabel(context, issue)),
              ),
            const SizedBox(height: TokenSizes.spaceSm),
            TextField(
              controller: _text,
              enabled: !_busy,
              minLines: 3,
              maxLines: 6,
              maxLength: placeFeedbackTextMax,
              decoration: InputDecoration(
                labelText: context.t('Ваш комментарий'),
                helperText: context.t('(необязательно)'),
                border: const OutlineInputBorder(),
              ),
            ),
            Text(context.t('Можно выбрать причину или написать своими словами. Дизлайк уже сохранён.'), style: theme.textTheme.bodySmall),
            if (_error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
                child: Semantics(liveRegion: true, child: Text(_error, style: TextStyle(color: theme.colorScheme.error))),
              ),
            const SizedBox(height: TokenSizes.spaceMd),
            FilledButton(
              onPressed: _busy || _unchanged ? null : _send,
              child: Text(context.t(_busy ? 'Отправляем…' : 'Отправить')),
            ),
          ],
        ),
      ),
    );
  }
}
