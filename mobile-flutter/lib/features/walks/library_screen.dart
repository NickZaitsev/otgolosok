import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/i18n/i18n.dart';
import 'access_sheet.dart';
import 'format.dart';
import 'local_walks.dart';
import 'top_walks_view.dart';
import 'user_message.dart';
import 'walk_cards.dart';

enum LibraryTab { mine, top }

enum LibraryMode { all, mine }

/// `?tab=` wins; otherwise «Мои» once own walks have loaded, or «Топ» for a viewer with none.
/// A failed load is not «no walks»: «Мои» stays open so its error and retry remain visible.
LibraryTab? selectedLibraryTab(String? param, {required bool loading, required int ownCount, bool failed = false}) {
  if (param == 'top') return LibraryTab.top;
  if (param == 'mine') return LibraryTab.mine;
  if (loading) return null;
  return ownCount > 0 || failed ? LibraryTab.mine : LibraryTab.top;
}

/// «История» (`/history?tab=`).
class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key, this.tab});
  final String? tab;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(), body: WalkLibraryView(tab: tab));
}

/// The walk library of the site's `walk-library.tsx`: own walks (account and device) and, in
/// [LibraryMode.all], the top in a second tab. «Мои прогулки» of the profile uses [LibraryMode.mine].
class WalkLibraryView extends ConsumerStatefulWidget {
  const WalkLibraryView({super.key, this.mode = LibraryMode.all, this.tab});
  final LibraryMode mode;
  final String? tab;

  @override
  ConsumerState<WalkLibraryView> createState() => _WalkLibraryViewState();
}

class _WalkLibraryViewState extends ConsumerState<WalkLibraryView> {
  List<WalkCard> _local = const [];
  List<WalkCard> _account = const [];
  final Map<String, Object> _errors = {};
  bool _loading = true;
  bool _guest = false;
  String? _cursor;
  bool _paging = false;
  String _notice = '';
  bool _draftsOnly = false;
  LibraryTab? _chosenTab;
  bool _topOpened = false;
  int _generation = 0;
  String? _loadedFor;

  late final SessionStore _session = ref.read(sessionStoreProvider);

  @override
  void initState() {
    super.initState();
    // `known` flips without a user change for a guest, which authUserProvider does not report.
    _session.addListener(_sessionChanged);
    _chosenTab = switch (widget.tab) {
      'top' => LibraryTab.top,
      'mine' => LibraryTab.mine,
      _ => null,
    };
  }

  void _sessionChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _session.removeListener(_sessionChanged);
    super.dispose();
  }

  Future<void> _load(AuthUser? user) async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _errors.clear();
    });
    final errors = <String, Object>{};
    var local = const <WalkCard>[];
    try {
      local = [for (final walk in await ref.read(localWalkStoreProvider).list()) WalkCard.local(walk)];
    } on Object catch (error) {
      errors['local'] = error;
    }
    var account = const <WalkCard>[];
    String? cursor;
    if (user != null) {
      try {
        final page = await AccountWalksApi(ref.read(apiProvider)).list();
        account = page.walks;
        cursor = page.nextCursor;
      } on ApiError catch (error) {
        if (!error.isCancelled) errors['account'] = error;
      }
    }
    if (!mounted || generation != _generation) return;
    setState(() {
      _local = local;
      _account = account;
      _cursor = cursor;
      _guest = user == null;
      _errors.addAll(errors);
      _loading = false;
    });
  }

  Future<void> _more() async {
    final cursor = _cursor;
    if (cursor == null || _paging) return;
    setState(() => _paging = true);
    try {
      final page = await AccountWalksApi(ref.read(apiProvider)).list(cursor: cursor);
      if (!mounted) return;
      setState(() {
        _account = mergeCardPage(_account, page.walks);
        _cursor = page.nextCursor;
      });
    } on ApiError catch (error) {
      if (mounted) setState(() => _errors['page'] = error);
    } finally {
      if (mounted) setState(() => _paging = false);
    }
  }

  Future<void> _copy(String token, String done) async {
    final url = sharedWalkUrl(ref.read(configProvider).origin, token, context.appLocale).toString();
    final failed = context.t('Скопируйте ссылку: {url}', {'url': url});
    try {
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) setState(() => _notice = done);
    } on PlatformException {
      if (mounted) setState(() => _notice = failed);
    }
  }

  Future<void> _openAccess(WalkCard card) async {
    setState(() => _notice = '');
    final access = await showAccessSheet(context, card);
    if (access == null || !mounted) return;
    final updated = card.withAccess(access);
    setState(() => _account = [for (final item in _account) item.id == card.id ? updated : item]);
    final token = access.shareToken;
    if (token == null) {
      setState(() => _notice = context.t('Доступ закрыт: прогулку видите только вы.'));
      return;
    }
    final awaitsReview = access.visibility == WalkVisibility.public &&
        access.listingStatus == ListingStatus.pending &&
        !(card.visibility == WalkVisibility.public && card.listingStatus == ListingStatus.pending);
    await _copy(token, awaitsReview ? context.t('Ссылка скопирована. Прогулка появится в топе после проверки.') : context.t('Ссылка скопирована.'));
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    final user = ref.watch(authUserProvider);
    // The session answer (or its failure) decides between an account and a guest; reload on change.
    final key = session.known ? 'user:${user?.id}:${context.appLocale.name}' : null;
    if (key != null && key != _loadedFor) {
      _loadedFor = key;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_load(user));
      });
    }
    final cards = sortCards([..._account, ..._local]);
    final waiting = _loading || !session.known;
    final tab = widget.mode == LibraryMode.mine
        ? LibraryTab.mine
        : _chosenTab ?? selectedLibraryTab(null, loading: waiting, ownCount: cards.length, failed: _errors.isNotEmpty);
    if (tab == LibraryTab.top) _topOpened = true;
    final theme = Theme.of(context);
    final mine = widget.mode == LibraryMode.mine;
    final header = Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(mine ? context.t('Профиль') : context.t('Ваши маршруты'), style: theme.textTheme.labelSmall),
        Semantics(
          header: true,
          child: Text(mine ? context.t('Мои прогулки') : context.t('История прогулок'), style: theme.textTheme.headlineLarge),
        ),
        Text(
          mine ? context.t('Сохранённые маршруты и черновики') : context.t('Знакомые места. Новые открытия. Всё, к чему хочется вернуться.'),
          style: theme.textTheme.bodySmall,
        ),
        if (!mine) ...[
          const SizedBox(height: 12),
          Semantics(
            label: context.t('Прогулки'),
            child: SegmentedButton<LibraryTab>(
              showSelectedIcon: false,
              emptySelectionAllowed: true,
              segments: [
                ButtonSegment(value: LibraryTab.mine, label: Text(context.t('Мои прогулки'))),
                ButtonSegment(value: LibraryTab.top, label: Text(context.t('Топ прогулок'))),
              ],
              selected: {?tab},
              onSelectionChanged: (selection) {
                if (selection.isNotEmpty) setState(() => _chosenTab = selection.first);
              },
            ),
          ),
        ],
      ]),
    );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      header,
      Expanded(
        child: IndexedStack(index: tab == LibraryTab.top ? 1 : 0, children: [
          _mine(context, cards, waiting),
          if (_topOpened) const TopWalksView() else const SizedBox.shrink(),
        ]),
      ),
    ]);
  }

  Widget _mine(BuildContext context, List<WalkCard> cards, bool waiting) {
    final visible = _draftsOnly ? cards.where((card) => card.draft).toList() : cards;
    final returnTo = widget.mode == LibraryMode.mine ? '/account/walks' : '/history';
    return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 32), children: [
      Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        ChoiceChip(label: Text(context.t('Все прогулки')), selected: !_draftsOnly, onSelected: (_) => setState(() => _draftsOnly = false)),
        ChoiceChip(label: Text(context.t('Черновики')), selected: _draftsOnly, onSelected: (_) => setState(() => _draftsOnly = true)),
        FilledButton(onPressed: () => context.go('/builder'), child: Text('${context.t('Новая прогулка')} ＋')),
      ]),
      for (final MapEntry(:key, :value) in _errors.entries)
        ErrorNotice(
          key: ValueKey(key),
          message: userMessage(
            context,
            value,
            key == 'page' ? context.t('Не удалось загрузить следующую страницу.') : context.t('Не удалось открыть прогулки.'),
          ),
          onRetry: () {
            _loadedFor = null;
            setState(() => _errors.clear());
          },
        ),
      if (waiting)
        Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Text(context.t('Загружаем ваши прогулки…')))
      else ...[
        if (visible.isNotEmpty)
          for (final card in visible)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: _LibraryCard(
                card: card,
                busy: _paging,
                onAccess: () => _openAccess(card),
                onCopy: card.shareToken == null ? null : () => _copy(card.shareToken!, context.t('Ссылка скопирована.')),
              ),
            )
        else
          _Empty(drafts: _draftsOnly),
        if (_cursor != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: OutlinedButton(onPressed: _paging ? null : _more, child: Text(context.t('Показать ещё'))),
          ),
        if (_notice.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Semantics(liveRegion: true, child: Text(_notice))),
        if (_guest)
          Card(
            margin: const EdgeInsets.only(top: 16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(context.t('Ваши прогулки — с вами'), style: Theme.of(context).textTheme.titleMedium),
                Text(context.t('Войдите, чтобы открывать их на других устройствах и делиться ссылками.')),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () => context.push(Uri(path: '/login', queryParameters: {'returnTo': returnTo}).toString()),
                  child: Text(context.t('Войти')),
                ),
              ]),
            ),
          ),
      ],
    ]);
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.drafts});
  final bool drafts;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(children: [
          const ExcludeSemantics(child: Text('↗', style: TextStyle(fontSize: 32, color: TokenColors.mapGreen))),
          Text(
            drafts ? context.t('Нет незаконченных прогулок') : context.t('Начните свою историю города'),
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 4),
          Text(
            '${context.t('Выберите дом на карте или задайте начало маршрута.')}\n${context.t('Сохранённые прогулки появятся здесь.')}',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          FilledButton(onPressed: () => context.go('/builder'), child: Text(context.t('Создать прогулку'))),
        ]),
      );
}

class _LibraryCard extends StatelessWidget {
  const _LibraryCard({required this.card, required this.busy, required this.onAccess, this.onCopy});
  final WalkCard card;
  final bool busy;
  final VoidCallback onAccess;
  final VoidCallback? onCopy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final locale = context.appLocale;
    final updated = DateTime.tryParse(card.updatedAt ?? '');
    final meta = [
      if (card.driving)
        context.t('На машине · {minutes} мин', {'minutes': formatUpToOne(card.totalMinutes ?? 0, locale)})
      else if (card.walkingMinutes case final minutes? when minutes > 0)
        context.t('{minutes} мин пешком', {'minutes': formatUpToOne(minutes, locale)}),
      if (card.distanceM case final distance? when distance > 0) context.t('{distance} км', {'distance': formatFixed(distance / 1000, locale)}),
      if (updated != null) MaterialLocalizations.of(context).formatCompactDate(updated.toLocal()),
    ].join(' · ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
            card.draft
                ? context.t('Черновик')
                : card.kind == WalkCardKind.local
                    ? context.t('На устройстве')
                    : context.t('В аккаунте'),
            style: theme.textTheme.labelSmall,
          ),
          InkWell(
            onTap: () => context.push(card.location),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Align(alignment: Alignment.centerLeft, child: Text(card.title, style: theme.textTheme.headlineMedium)),
            ),
          ),
          if (card.subtitle case final subtitle? when subtitle.isNotEmpty) Text(subtitle),
          if (meta.isNotEmpty) Text(meta, style: theme.textTheme.bodySmall),
          if (card.kind == WalkCardKind.account) Text(context.t('Доступ: {access}', {'access': accessLabel(context, card)})),
          Wrap(spacing: 8, children: [
            TextButton(onPressed: () => context.go(card.editLocation), child: Text(context.t('Редактировать'))),
            if (card.kind == WalkCardKind.account) TextButton(onPressed: busy ? null : onAccess, child: Text(context.t('Доступ'))),
            if (onCopy != null) TextButton(onPressed: onCopy, child: Text(context.t('Скопировать ссылку'))),
          ]),
        ]),
      ),
    );
  }
}
