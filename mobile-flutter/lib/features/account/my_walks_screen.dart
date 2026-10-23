import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../auth/status_widgets.dart';
import '../auth/user_message.dart';
import 'access_sheet.dart';
import 'account_repository.dart';

/// «Мои прогулки» (site walk-library.tsx, mode `mine`): walks saved in the account with paging,
/// the drafts filter, access levels and share links. A guest is invited to sign in.
class MyWalksScreen extends ConsumerWidget {
  const MyWalksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final store = ref.watch(sessionStoreProvider);
    final user = ref.watch(authUserProvider);
    return Scaffold(
      appBar: AppBar(title: Text(context.t('Мои прогулки'))),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: store,
          builder: (context, _) {
            if (user != null) return _AccountWalks(key: ValueKey(user.id));
            if (!store.known) return LoadingStatus(text: context.t('Загружаем ваши прогулки…'));
            return const _SignInInvitation();
          },
        ),
      ),
    );
  }
}

class _SignInInvitation extends StatelessWidget {
  const _SignInInvitation();

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
      Text(context.t('Ваши прогулки — с вами'), style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: TokenSizes.spaceXs),
      Text(context.t('Войдите, чтобы открывать их на других устройствах и делиться ссылками.')),
      const SizedBox(height: TokenSizes.spaceMd),
      FilledButton(
        onPressed: () => context.push(Uri(path: '/login', queryParameters: {'returnTo': '/account/walks'}).toString()),
        child: Text(context.t('Войти')),
      ),
    ]);
  }
}

class _AccountWalks extends ConsumerStatefulWidget {
  const _AccountWalks({super.key});

  @override
  ConsumerState<_AccountWalks> createState() => _AccountWalksState();
}

class _AccountWalksState extends ConsumerState<_AccountWalks> {
  List<AccountWalk> _walks = const [];
  String? _cursor;
  var _loading = true;
  var _loadingMore = false;
  var _draftsOnly = false;
  String? _error;
  String? _notice;

  AccountRepository get _account => ref.read(accountRepositoryProvider);

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _account.walks();
      if (!mounted) return;
      setState(() {
        _walks = page.items;
        _cursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted) setState(() => _error = userMessage(context, error, 'Не удалось открыть прогулки.'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    final cursor = _cursor;
    if (cursor == null || _loadingMore) return;
    setState(() {
      _loadingMore = true;
      _error = null;
    });
    try {
      final page = await _account.walks(cursor: cursor);
      if (!mounted) return;
      setState(() {
        _walks = mergePage(_walks, page.items, (walk) => walk.id);
        _cursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted) setState(() => _error = userMessage(context, error, 'Не удалось загрузить следующую страницу.'));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  /// The public share link: `/walk?share=<token>`, under `/en` or `/zh` for those languages.
  Uri _shareUrl(String token) {
    final locale = ref.read(localeProvider);
    final path = locale == AppLocale.ru ? '/walk' : '/${locale.name}/walk';
    return ref.read(configProvider).siteUrl(path, {'share': token});
  }

  Future<void> _copy(String token, [String done = 'Ссылка скопирована.']) async {
    final url = _shareUrl(token).toString();
    try {
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) setState(() => _notice = context.t(done));
    } on Exception catch (error) {
      // No clipboard service: show the link so it can still be copied by hand.
      debugPrint('clipboard: ${error.runtimeType}');
      if (mounted) setState(() => _notice = context.t('Скопируйте ссылку: {url}', {'url': url}));
    }
  }

  Future<void> _access(AccountWalk previous) async {
    setState(() => _notice = null);
    final walk = await showAccessSheet(context, previous);
    if (walk == null || !mounted) return;
    setState(() => _walks = [for (final item in _walks) item.id == previous.id ? walk : item]);
    final token = walk.shareToken;
    if (token == null) {
      setState(() => _notice = context.t('Доступ закрыт: прогулку видите только вы.'));
      return;
    }
    final review = walk.awaitsReview && !previous.awaitsReview;
    await _copy(token, review ? 'Ссылка скопирована. Прогулка появится в топе после проверки.' : 'Ссылка скопирована.');
  }

  @override
  Widget build(BuildContext context) {
    final visible = _draftsOnly ? _walks.where((walk) => walk.draft).toList() : _walks;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
        Text(context.t('Сохранённые маршруты и черновики'), style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: TokenSizes.spaceSm),
        Wrap(spacing: TokenSizes.spaceXs, runSpacing: TokenSizes.spaceXs, crossAxisAlignment: WrapCrossAlignment.center, children: [
          ChoiceChip(label: Text(context.t('Все прогулки')), selected: !_draftsOnly, onSelected: (_) => setState(() => _draftsOnly = false)),
          ChoiceChip(label: Text(context.t('Черновики')), selected: _draftsOnly, onSelected: (_) => setState(() => _draftsOnly = true)),
          FilledButton.icon(onPressed: () => context.go('/builder'), icon: const Icon(Icons.add), label: Text(context.t('Новая прогулка'))),
        ]),
        const SizedBox(height: TokenSizes.spaceMd),
        if (_error != null) ...[AlertNotice(text: _error!, onRetry: _walks.isEmpty ? _load : _more), const SizedBox(height: TokenSizes.spaceSm)],
        if (_loading && _walks.isEmpty)
          LoadingStatus(text: context.t('Загружаем ваши прогулки…'))
        else if (visible.isEmpty && _error == null)
          _Empty(draftsOnly: _draftsOnly)
        else
          for (final walk in visible) ...[
            _WalkCard(walk: walk, onAccess: () => _access(walk), onCopy: walk.shareToken == null ? null : () => _copy(walk.shareToken!)),
            const SizedBox(height: TokenSizes.spaceSm),
          ],
        if (_cursor != null && !_loading)
          OutlinedButton(onPressed: _loadingMore ? null : _more, child: Text(context.t('Показать ещё'))),
        if (_notice != null) ...[const SizedBox(height: TokenSizes.spaceSm), StatusNotice(text: _notice!)],
      ]),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.draftsOnly});

  final bool draftsOnly;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TokenSizes.spaceLg),
      child: Column(children: [
        Text(context.t(draftsOnly ? 'Нет незаконченных прогулок' : 'Начните свою историю города'),
            style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: TokenSizes.spaceXs),
        Text('${context.t('Выберите дом на карте или задайте начало маршрута.')}\n${context.t('Сохранённые прогулки появятся здесь.')}',
            textAlign: TextAlign.center),
        const SizedBox(height: TokenSizes.spaceMd),
        FilledButton(onPressed: () => context.go('/builder'), child: Text(context.t('Создать прогулку'))),
      ]),
    );
  }
}

class _WalkCard extends StatelessWidget {
  const _WalkCard({required this.walk, required this.onAccess, required this.onCopy});

  final AccountWalk walk;
  final VoidCallback onAccess;
  final VoidCallback? onCopy;

  String _meta(BuildContext context) {
    final locale = context.appLocale;
    final minutes = walk.driving ? walk.totalMinutes : walk.walkingMinutes;
    final distance = walk.distanceM;
    final updated = walk.updatedAt == null ? null : DateTime.tryParse(walk.updatedAt!);
    return [
      if (walk.driving)
        context.t('На машине · {minutes} мин', {'minutes': (minutes ?? 0).round()})
      else if (minutes != null && minutes > 0)
        context.t('{minutes} мин пешком', {'minutes': minutes.round()}),
      if (distance != null && distance > 0)
        context.t('{distance} км', {'distance': formatKilometres(distance, locale)}),
      if (updated != null) MaterialLocalizations.of(context).formatShortDate(updated.toLocal()),
    ].join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final meta = _meta(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(TokenSizes.spaceSm),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(context.t(walk.draft ? 'Черновик' : 'В аккаунте'), style: theme.textTheme.labelSmall),
          InkWell(
            onTap: () => context.push(Uri(path: '/walk', queryParameters: {'id': walk.id}).toString()),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: TokenSizes.controlPrimaryMin),
              child: Align(alignment: Alignment.centerLeft, child: Text(walk.title, style: theme.textTheme.headlineMedium)),
            ),
          ),
          if (meta.isNotEmpty) Text(meta, style: theme.textTheme.bodySmall),
          Text(context.t('Доступ: {access}', {'access': context.t(walk.accessLabel)}), style: theme.textTheme.bodySmall),
          Wrap(spacing: TokenSizes.spaceXs, children: [
            TextButton(onPressed: onAccess, child: Text(context.t('Доступ'))),
            if (onCopy != null) TextButton(onPressed: onCopy, child: Text(context.t('Скопировать ссылку'))),
          ]),
        ]),
      ),
    );
  }
}

/// `1,2` in Russian, `1.2` in English and Chinese, one decimal as the site's `toLocaleString`.
String formatKilometres(num metres, AppLocale locale) {
  final value = (metres / 1000).toStringAsFixed(1);
  return locale == AppLocale.ru ? value.replaceAll('.', ',') : value;
}
