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
import '../auth/auth_repository.dart';
import '../auth/login_validation.dart';
import '../auth/status_widgets.dart';
import '../auth/user_message.dart';
import '../legal/legal_links.dart';
import '../settings/language_switch.dart';
import '../settings/travel_preference.dart';
import 'account_repository.dart';
import 'account_sections.dart';

enum _Confirm { signOut, everywhere, delete }

/// «Профиль» (site src/features/account/account.tsx): identity and rename, «Мои прогулки»,
/// favourites and story requests, language, sign-out and account deletion, legal links.
/// A guest sees the sign-in invitation, the language switch and the legal links.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final store = ref.watch(sessionStoreProvider);
    final user = ref.watch(authUserProvider);
    return Scaffold(
      appBar: AppBar(title: Text(context.t('Профиль'))),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: store,
          builder: (context, _) {
            if (user != null) return _Profile(key: ValueKey(user.id), user: user);
            if (!store.known) return LoadingStatus(text: context.t('Открываем профиль…'));
            return const _Guest();
          },
        ),
      ),
    );
  }
}

class _Guest extends StatelessWidget {
  const _Guest();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
      Text(context.t('Ваши прогулки — с вами'), style: theme.textTheme.headlineMedium),
      const SizedBox(height: TokenSizes.spaceXs),
      Text(context.t('Войдите, чтобы открывать их на других устройствах и делиться ссылками.')),
      const SizedBox(height: TokenSizes.spaceMd),
      FilledButton(
        onPressed: () => context.push(Uri(path: '/login', queryParameters: {'returnTo': '/account'}).toString()),
        child: Text(context.t('Войти')),
      ),
      const SizedBox(height: TokenSizes.spaceXl),
      const LanguageSwitch(),
      const SizedBox(height: TokenSizes.spaceMd),
      const TravelPreference(),
      const SizedBox(height: TokenSizes.spaceLg),
      const LegalLinks(),
    ]);
  }
}

class _Profile extends ConsumerStatefulWidget {
  const _Profile({super.key, required this.user});

  final AuthUser user;

  @override
  ConsumerState<_Profile> createState() => _ProfileState();
}

class _ProfileState extends ConsumerState<_Profile> {
  final _name = TextEditingController();
  final _password = TextEditingController();
  var _favorites = const PagedList<Favorite>(loading: true);
  var _requests = const PagedList<StoryRequest>(loading: true);
  var _editing = false;
  String? _busy;
  String? _notice;
  String? _profileError;
  String? _settingsError;
  _Confirm? _confirm;

  AccountRepository get _account => ref.read(accountRepositoryProvider);
  AuthUser get _user => widget.user;

  @override
  void initState() {
    super.initState();
    _name.text = _user.name;
    unawaited(_loadFavorites());
    unawaited(_loadRequests());
  }

  @override
  void dispose() {
    _name.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _loadFavorites({bool more = false}) async {
    final cursor = more ? _favorites.cursor : null;
    if (more && (cursor == null || _busy != null)) return;
    setState(() {
      if (more) _busy = 'favorites';
      _favorites = PagedList(items: more ? _favorites.items : const [], cursor: _favorites.cursor, loading: true);
    });
    try {
      final page = await _account.favorites(cursor: cursor);
      if (!mounted) return;
      setState(() => _favorites = PagedList(
            items: more ? mergePage(_favorites.items, page.items, (item) => item.key) : page.items,
            cursor: page.nextCursor,
          ));
    } catch (error) {
      if (!mounted) return;
      final text = userMessage(context, error, more ? 'Не удалось загрузить следующую страницу.' : 'Не удалось загрузить раздел.');
      setState(() => _favorites = PagedList(items: _favorites.items, cursor: _favorites.cursor, error: text));
    } finally {
      if (mounted && more) setState(() => _busy = null);
    }
  }

  Future<void> _loadRequests({bool more = false}) async {
    final cursor = more ? _requests.cursor : null;
    if (more && (cursor == null || _busy != null)) return;
    setState(() {
      if (more) _busy = 'requests';
      _requests = PagedList(items: more ? _requests.items : const [], cursor: _requests.cursor, loading: true);
    });
    try {
      final page = await _account.requests(cursor: cursor);
      if (!mounted) return;
      setState(() => _requests = PagedList(
            items: more ? mergePage(_requests.items, page.items, (item) => item.key) : page.items,
            cursor: page.nextCursor,
          ));
    } catch (error) {
      if (!mounted) return;
      final text = userMessage(context, error, more ? 'Не удалось загрузить следующую страницу.' : 'Не удалось загрузить раздел.');
      setState(() => _requests = PagedList(items: _requests.items, cursor: _requests.cursor, error: text));
    } finally {
      if (mounted && more) setState(() => _busy = null);
    }
  }

  Future<void> _rename() async {
    final name = _name.text.trim();
    if (_busy != null || validateName(name) != null || name == _user.name) return;
    setState(() {
      _busy = 'profile';
      _notice = null;
      _profileError = null;
    });
    try {
      await _account.rename(name);
      if (!mounted) return;
      setState(() {
        _notice = 'Имя сохранено.';
        _editing = false;
      });
    } catch (error) {
      if (mounted) setState(() => _profileError = userMessage(context, error, 'Не удалось сохранить имя.'));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  void _ask(_Confirm action) => setState(() {
        _confirm = action;
        _settingsError = null;
        _password.clear();
      });

  void _cancelConfirm() => setState(() {
        _confirm = null;
        _password.clear();
      });

  Future<void> _confirmAction() async {
    final action = _confirm;
    if (action == null || _busy != null) return;
    if (action == _Confirm.delete && _user.telegram && _user.requiresReauthentication) return _reauthenticate();
    if (action == _Confirm.delete && !_user.telegram && validatePassword(_password.text) != null) {
      setState(() => _settingsError = context.t('Неверный пароль.'));
      return;
    }
    setState(() {
      _busy = 'settings';
      _settingsError = null;
    });
    final router = GoRouter.of(context);
    try {
      switch (action) {
        case _Confirm.delete:
          await _account.deleteAccount(password: _user.telegram ? null : _password.text);
        case _Confirm.everywhere:
          await _account.signOutEverywhere();
        case _Confirm.signOut:
          final messenger = ScaffoldMessenger.of(context);
          final postponed = context.t('Локальный выход выполнен. Сервер отзовёт сессию после восстановления сети.');
          if (!await ref.read(sessionStoreProvider).signOut()) messenger.showSnackBar(SnackBar(content: Text(postponed)));
      }
      router.go('/');
    } on ApiError catch (error) {
      if (!mounted) return;
      if (action == _Confirm.delete && _user.telegram && error.code == 'REAUTH_REQUIRED') {
        // The parent rebuilds this profile with the flag set; the notice explains why.
        _account.requireReauthentication();
        setState(() => _notice = 'Срок подтверждения Telegram истёк. Подтвердите аккаунт ещё раз.');
      } else {
        setState(() => _settingsError = userMessage(context, error, 'Не удалось выполнить действие.'));
      }
    } catch (error) {
      if (mounted) setState(() => _settingsError = userMessage(context, error, 'Не удалось выполнить действие.'));
    } finally {
      _password.clear();
      if (mounted) setState(() => _busy = null);
    }
  }

  /// A fresh Telegram sign-in through the app handoff; deletion goes on only for the same account.
  Future<void> _reauthenticate() async {
    final expected = _user.id;
    setState(() {
      _busy = 'settings';
      _settingsError = null;
    });
    try {
      final signedIn = await ref.read(authRepositoryProvider).signInWithTelegram();
      if (!mounted) return;
      if (signedIn.id != expected) setState(() => _notice = 'Удаление отменено: после подтверждения вошёл другой аккаунт.');
    } on AuthFailure catch (failure) {
      if (mounted && !failure.cancelled) setState(() => _settingsError = context.t(failure.message));
    } catch (error) {
      if (mounted) setState(() => _settingsError = userMessage(context, error, 'Не удалось подтвердить аккаунт через Telegram.'));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(padding: const EdgeInsets.all(TokenSizes.spaceMd), children: [
      _header(context),
      if (_editing) _renameForm(context),
      if (_notice != null) ...[const SizedBox(height: TokenSizes.spaceSm), StatusNotice(text: context.t(_notice!))],
      const SizedBox(height: TokenSizes.spaceMd),
      Card(
        child: ListTile(
          minTileHeight: 64,
          leading: const Icon(Icons.directions_walk),
          title: Text(context.t('Мои прогулки')),
          subtitle: Text(context.t('Сохранённые маршруты и черновики')),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.go('/account/walks'),
        ),
      ),
      const SizedBox(height: TokenSizes.spaceLg),
      _sectionTitle(context, 'Сохранённое'),
      FavoritesTile(
        list: _favorites,
        busy: _busy != null,
        onMore: () => _loadFavorites(more: true),
        onRetry: _loadFavorites,
      ),
      RequestsTile(
        list: _requests,
        busy: _busy != null,
        onMore: () => _loadRequests(more: true),
        onRetry: _loadRequests,
      ),
      const SizedBox(height: TokenSizes.spaceLg),
      _sectionTitle(context, 'Отголосок в соцсетях'),
      const SocialLinks(),
      const SizedBox(height: TokenSizes.spaceLg),
      _sectionTitle(context, 'Настройки аккаунта'),
      const SizedBox(height: TokenSizes.spaceXs),
      const LanguageSwitch(),
      const SizedBox(height: TokenSizes.spaceMd),
      const TravelPreference(),
      const SizedBox(height: TokenSizes.spaceMd),
      Wrap(spacing: TokenSizes.spaceXs, runSpacing: TokenSizes.spaceXs, children: [
        OutlinedButton(onPressed: _busy == null ? () => _ask(_Confirm.signOut) : null, child: Text(context.t('Выйти'))),
        OutlinedButton(onPressed: _busy == null ? () => _ask(_Confirm.everywhere) : null, child: Text(context.t('Выйти на всех устройствах'))),
        TextButton(
          onPressed: _busy == null ? () => _ask(_Confirm.delete) : null,
          style: TextButton.styleFrom(foregroundColor: theme.colorScheme.error),
          child: Text(context.t('Удалить аккаунт')),
        ),
      ]),
      if (_confirm != null) _confirmPanel(context, _confirm!),
      const SizedBox(height: TokenSizes.spaceLg),
      const LegalLinks(),
    ]);
  }

  Widget _sectionTitle(BuildContext context, String source) =>
      Semantics(header: true, child: Text(context.t(source), style: Theme.of(context).textTheme.titleLarge));

  Widget _header(BuildContext context) {
    final theme = Theme.of(context);
    final initials = _user.name.trim().split(RegExp(r'\s+')).where((part) => part.isNotEmpty).take(2).map((part) => part.characters.first).join().toUpperCase();
    return Row(children: [
      ExcludeSemantics(
        child: CircleAvatar(
          radius: 28,
          backgroundColor: TokenColors.mapGreen,
          foregroundColor: TokenColors.onDark,
          child: Text(initials, style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
      ),
      const SizedBox(width: TokenSizes.spaceSm),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Semantics(header: true, child: Text(_user.name, style: theme.textTheme.headlineMedium)),
          Text(_user.telegram || _user.email == null ? context.t('Telegram') : _user.email!, style: theme.textTheme.bodySmall),
        ]),
      ),
      IconButton(
        tooltip: context.t('Редактировать профиль'),
        onPressed: _busy == null
            ? () => setState(() {
                  _name.text = _user.name;
                  _editing = !_editing;
                  _notice = null;
                  _profileError = null;
                })
            : null,
        icon: const Icon(Icons.edit_outlined),
      ),
    ]);
  }

  Widget _renameForm(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: TokenSizes.spaceMd),
      child: ValueListenableBuilder(
        valueListenable: _name,
        builder: (context, value, _) {
          final name = value.text.trim();
          final canSave = _busy == null && validateName(name) == null && name != _user.name;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(
              key: const ValueKey('rename'),
              controller: _name,
              autofocus: true,
              enabled: _busy == null,
              decoration: InputDecoration(labelText: context.t('Ваше имя')),
              autofillHints: const [AutofillHints.name],
              inputFormatters: [LengthLimitingTextInputFormatter(nameMax)],
              onSubmitted: (_) => _rename(),
            ),
            if (_profileError != null) ...[const SizedBox(height: TokenSizes.spaceXs), AlertNotice(text: _profileError!)],
            const SizedBox(height: TokenSizes.spaceXs),
            Wrap(spacing: TokenSizes.spaceXs, children: [
              FilledButton(onPressed: canSave ? _rename : null, child: Text(context.t('Сохранить изменения'))),
              TextButton(
                onPressed: _busy == null
                    ? () => setState(() {
                          _editing = false;
                          _name.text = _user.name;
                          _profileError = null;
                        })
                    : null,
                child: Text(context.t('Отменить')),
              ),
            ]),
          ]);
        },
      ),
    );
  }

  Widget _confirmPanel(BuildContext context, _Confirm action) {
    final theme = Theme.of(context);
    final delete = action == _Confirm.delete;
    final reauth = delete && _user.telegram && _user.requiresReauthentication;
    return Padding(
      padding: const EdgeInsets.only(top: TokenSizes.spaceMd),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(TokenSizes.spaceMd),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(context.t(delete ? 'Удалить аккаунт навсегда?' : 'Подтвердите выход'), style: theme.textTheme.titleMedium),
            const SizedBox(height: TokenSizes.spaceXs),
            Text(context.t(delete
                ? 'Прогулки в аккаунте и избранное будут удалены без возможности восстановления. Локальные черновики останутся.'
                : 'Приватные материалы для прослушивания без сети будут удалены с этого устройства. Прогулки в аккаунте сохранятся.')),
            if (delete && !_user.telegram) ...[
              const SizedBox(height: TokenSizes.spaceSm),
              TextField(
                key: const ValueKey('delete-password'),
                controller: _password,
                obscureText: true,
                enabled: _busy == null,
                decoration: InputDecoration(labelText: context.t('Текущий пароль')),
                autofillHints: const [AutofillHints.password],
                inputFormatters: [LengthLimitingTextInputFormatter(passwordMax)],
              ),
            ],
            if (_settingsError != null) ...[const SizedBox(height: TokenSizes.spaceSm), AlertNotice(text: _settingsError!)],
            const SizedBox(height: TokenSizes.spaceSm),
            Wrap(spacing: TokenSizes.spaceXs, runSpacing: TokenSizes.spaceXs, children: [
              FilledButton(
                key: const ValueKey('confirm'),
                onPressed: _busy == null ? _confirmAction : null,
                style: delete && !reauth ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error) : null,
                child: Text(context.t(reauth
                    ? (_busy == 'settings' ? 'Открываем Telegram…' : 'Подтвердить в Telegram')
                    : delete
                        ? 'Удалить навсегда'
                        : 'Подтвердить выход')),
              ),
              OutlinedButton(onPressed: _busy == null ? _cancelConfirm : null, child: Text(context.t('Отмена'))),
            ]),
          ]),
        ),
      ),
    );
  }
}
