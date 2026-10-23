import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../reviews/review_model.dart';
import '../walks/user_message.dart';
import 'improvement_model.dart';

/// How long the thank-you message stays before the sheet closes itself.
const improvementSentClose = Duration(seconds: 3);

/// «Что улучшить в прогулке?» (site `improvement-dialog.tsx`): the viewer ticks what is wrong with
/// the walk. One request per viewer and walk; sending again replaces it, unticking everything withdraws it.
Future<void> showImprovementSheet(BuildContext context, {required ReviewTarget target, required String walkTitle}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => ImprovementSheet(target: target, walkTitle: walkTitle),
    );

/// Russian labels of the options, in canonical order.
String improvementIssueLabel(BuildContext context, ImprovementIssue issue) => switch (issue) {
      ImprovementIssue.shortText => context.t('Мало информации: тексты слишком короткие'),
      ImprovementIssue.noImages => context.t('Нет превью изображений'),
      ImprovementIssue.voiceover => context.t('Не нравится озвучка'),
    };

class ImprovementSheet extends ConsumerStatefulWidget {
  const ImprovementSheet({super.key, required this.target, required this.walkTitle});
  final ReviewTarget target;
  final String walkTitle;

  @override
  ConsumerState<ImprovementSheet> createState() => _ImprovementSheetState();
}

enum _Load { loading, ready, failed }

class _ImprovementSheetState extends ConsumerState<ImprovementSheet> {
  late final ImprovementsApi _api = ImprovementsApi(ref.read(apiProvider));
  _Load _load = _Load.loading;
  MyImprovement? _mine;
  Set<ImprovementIssue> _selected = {};
  bool _busy = false;
  String _error = '';
  String? _sent;
  Timer? _close;
  int _attempt = 0;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _close?.cancel();
    super.dispose();
  }

  // Every opening reads the stored request afresh: it may have been changed on another device.
  Future<void> _fetch() async {
    final attempt = ++_attempt;
    setState(() => _load = _Load.loading);
    try {
      final mine = await _api.load(widget.target);
      if (!mounted || attempt != _attempt) return;
      setState(() {
        _mine = mine;
        _selected = {...?mine?.issues};
        _load = _Load.ready;
      });
    } on Exception {
      if (!mounted || attempt != _attempt) return;
      setState(() => _load = _Load.failed);
    }
  }

  List<ImprovementIssue> get _issues => canonicalIssues(_selected);
  bool get _withdraw => _selected.isEmpty;
  bool get _unchanged {
    final mine = _mine;
    return mine != null && mine.status == ImprovementStatus.open && _sameIssues(_issues, canonicalIssues(mine.issues));
  }

  bool get _canSubmit => !_busy && !_unchanged && !(_withdraw && _mine == null);

  static bool _sameIssues(List<ImprovementIssue> a, List<ImprovementIssue> b) {
    if (a.length != b.length) return false;
    for (var index = 0; index < a.length; index++) {
      if (a[index] != b[index]) return false;
    }
    return true;
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final mine = await _api.save(widget.target, _issues);
      if (!mounted) return;
      setState(() {
        _mine = mine;
        _busy = false;
        _sent = mine != null ? context.t('Спасибо! Передали редакции — постараемся улучшить прогулку.') : context.t('Запрос отозван.');
      });
      _close = Timer(improvementSentClose, () {
        if (mounted) Navigator.of(context).maybePop();
      });
    } on Exception catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = userMessage(context, error, context.t('Не удалось отправить запрос. Повторите попытку.'));
      });
    }
  }

  String _submitLabel() {
    if (_busy) return context.t('Отправляем…');
    if (_error.isNotEmpty) return context.t('Повторить');
    if (_withdraw && _mine != null) return context.t('Отозвать запрос');
    if (_mine?.status == ImprovementStatus.open) return context.t('Сохранить изменения');
    return context.t('Отправить');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mine = _mine;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Semantics(header: true, child: Text(context.t('Что улучшить в прогулке?'), style: theme.textTheme.titleLarge)),
              Text(widget.walkTitle, style: theme.textTheme.bodySmall),
            ]),
          ),
          IconButton(tooltip: context.t('Закрыть'), icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
        ]),
        const SizedBox(height: 8),
        if (_sent != null)
          Semantics(liveRegion: true, child: Text(_sent!, style: theme.textTheme.titleMedium))
        else if (_load == _Load.failed) ...[
          Semantics(liveRegion: true, child: Text(context.t('Не удалось загрузить форму.'))),
          Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: _fetch, child: Text(context.t('Повторить')))),
        ] else if (_load == _Load.loading)
          Semantics(liveRegion: true, child: Text(context.t('Загружаем…')))
        else ...[
          if (mine?.status == ImprovementStatus.resolved)
            Text(context.t('Редакция уже поработала над вашим прошлым запросом. Если проблема осталась, отправьте его снова.')),
          Text(context.t('Отметьте, что мешает. Можно несколько вариантов.'), style: theme.textTheme.bodySmall),
          for (final issue in ImprovementIssue.values)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _selected.contains(issue),
              title: Text(improvementIssueLabel(context, issue)),
              onChanged: _busy
                  ? null
                  : (checked) => setState(() {
                        _selected = {..._selected};
                        checked == true ? _selected.add(issue) : _selected.remove(issue);
                      }),
            ),
          if (mine?.status == ImprovementStatus.open)
            Text(context.t('Ваш запрос уже у редакции. Измените отметки или снимите все, чтобы отозвать его.'), style: theme.textTheme.bodySmall),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Semantics(liveRegion: true, child: Text(_error, style: const TextStyle(color: TokenColors.dangerInk))),
            ),
          const SizedBox(height: 12),
          FilledButton(onPressed: _canSubmit ? _submit : null, child: Text(_submitLabel())),
        ],
      ]),
    );
  }
}
