import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../legal/legal_links.dart';
import '../settings/language_switch.dart';
import 'auth_repository.dart';
import 'login_validation.dart';
import 'status_widgets.dart';
import 'user_message.dart';

enum _Mode { signIn, signUp }

enum _Telegram { loading, enabled, disabled, error }

/// Sign-in and sign-up by email or Telegram (site src/features/auth/login.tsx).
///
/// Sign-up and Telegram need the current terms version from `GET /api/legal/publication`;
/// while it is unknown or the documents are not published both stay disabled.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.returnTo});

  /// An app location to open after sign-in; anything else falls back to `/account`.
  final String? returnTo;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  var _mode = _Mode.signIn;
  var _termsAccepted = false;
  var _busy = false;
  var _telegramBusy = false;
  String? _error;
  LegalPublication? _publication;
  Object? _publicationError;
  var _telegram = _Telegram.loading;
  var _left = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadPublication());
    unawaited(_loadProviders());
    // Already signed in (or signed in elsewhere while this screen is open): go on, as the site does.
    ref.listenManual(authUserProvider, (previous, next) {
      if (next != null) _leave();
    }, fireImmediately: true);
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  AuthRepository get _auth => ref.read(authRepositoryProvider);

  Future<void> _loadPublication() async {
    setState(() {
      _publication = null;
      _publicationError = null;
    });
    try {
      final publication = await _auth.publication();
      if (mounted) setState(() => _publication = publication);
    } catch (error) {
      if (mounted) setState(() => _publicationError = error);
    }
  }

  Future<void> _loadProviders() async {
    setState(() => _telegram = _Telegram.loading);
    try {
      final enabled = await _auth.telegramAvailable();
      if (mounted) setState(() => _telegram = enabled ? _Telegram.enabled : _Telegram.disabled);
    } catch (_) {
      if (mounted) setState(() => _telegram = _Telegram.error);
    }
  }

  void _leave() {
    if (_left) return;
    _left = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.go(safeReturnTo(widget.returnTo));
    });
  }

  bool get _legalReady => _publication?.ready ?? false;

  Future<void> _submit() async {
    if (_busy || _telegramBusy) return;
    if (_mode == _Mode.signUp && (!_legalReady || !_termsAccepted)) {
      setState(() => _error = context.t(AuthMessages.termsRequired));
      return;
    }
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_mode == _Mode.signUp) {
        await _auth.signUp(
          name: _name.text.trim(),
          email: _email.text.trim(),
          password: _password.text,
          termsVersion: _publication!.termsVersion,
        );
      } else {
        await _auth.signIn(email: _email.text.trim(), password: _password.text);
      }
      _leave();
    } catch (error) {
      if (mounted) setState(() => _error = userMessage(context, error, 'Не удалось войти.'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signInWithTelegram() async {
    if (_busy || _telegramBusy) return;
    if (!_legalReady || !_termsAccepted) {
      setState(() => _error = context.t(AuthMessages.termsRequired));
      return;
    }
    setState(() {
      _telegramBusy = true;
      _error = null;
    });
    try {
      await _auth.signInWithTelegram(termsVersion: _publication!.termsVersion);
      _leave();
    } on AuthFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        if (failure.termsRequired) {
          _mode = _Mode.signUp;
          _termsAccepted = false;
        }
        _error = context.t(failure.message);
      });
    } catch (error) {
      if (mounted) setState(() => _error = userMessage(context, error, AuthMessages.telegramUnavailable));
    } finally {
      if (mounted) setState(() => _telegramBusy = false);
    }
  }

  void _switchMode() {
    setState(() {
      _termsAccepted = false;
      _mode = _mode == _Mode.signIn ? _Mode.signUp : _Mode.signIn;
      _error = null;
    });
    _form.currentState?.reset();
  }

  String? _validated(String? Function(String) rule, String? value) {
    final source = rule(value ?? '');
    return source == null ? null : context.t(source);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final signUp = _mode == _Mode.signUp;
    final working = _busy || _telegramBusy;
    final telegramEnabled = _telegram == _Telegram.enabled;
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, 0, TokenSizes.spaceMd, TokenSizes.spaceXl),
          children: [
            const LanguageSwitch(),
            const SizedBox(height: TokenSizes.spaceLg),
            Text(context.t('Личный кабинет').toUpperCase(), style: theme.textTheme.labelSmall),
            const SizedBox(height: TokenSizes.spaceXs),
            Semantics(header: true, child: Text(context.t(signUp ? 'Регистрация' : 'Вход'), style: theme.textTheme.headlineLarge)),
            const SizedBox(height: TokenSizes.spaceXs),
            Text(context.t(signUp
                ? 'Создайте аккаунт, чтобы сохранять прогулки и открывать их на других устройствах.'
                : 'Войдите, чтобы открыть свои прогулки и сохранённые истории.')),
            const SizedBox(height: TokenSizes.spaceMd),
            if (signUp || telegramEnabled) ..._legalState(context),
            if (signUp || telegramEnabled) _TermsCheckbox(
              value: _termsAccepted,
              enabled: !working,
              onChanged: (value) => setState(() => _termsAccepted = value),
            ),
            if (telegramEnabled) ...[
              const SizedBox(height: TokenSizes.spaceXs),
              FilledButton.icon(
                key: const ValueKey('telegram'),
                onPressed: working || !_termsAccepted || !_legalReady ? null : _signInWithTelegram,
                style: FilledButton.styleFrom(backgroundColor: const Color(0xFF229ED9)),
                icon: const Icon(Icons.send_rounded),
                label: Text(context.t(_telegramBusy ? 'Открываем Telegram…' : 'Продолжить через Telegram')),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: TokenSizes.spaceSm),
                child: Row(children: [
                  const Expanded(child: Divider()),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: TokenSizes.spaceSm),
                    child: Text(context.t('или по email'), style: theme.textTheme.bodySmall),
                  ),
                  const Expanded(child: Divider()),
                ]),
              ),
            ],
            if (_telegram == _Telegram.error)
              Padding(
                padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
                child: AlertNotice(text: context.t('Не удалось проверить доступность входа через Telegram.'), onRetry: _loadProviders),
              ),
            _fields(context, signUp, working),
            if (_error != null) ...[
              const SizedBox(height: TokenSizes.spaceSm),
              AlertNotice(text: _error!),
            ],
            const SizedBox(height: TokenSizes.spaceMd),
            FilledButton(
              key: const ValueKey('submit'),
              onPressed: working || (signUp && (!_termsAccepted || !_legalReady)) ? null : _submit,
              child: Text(context.t(_busy ? 'Подождите…' : signUp ? 'Создать аккаунт' : 'Войти')),
            ),
            const SizedBox(height: TokenSizes.spaceXs),
            TextButton(
              onPressed: working ? null : _switchMode,
              child: Text(context.t(signUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться')),
            ),
            const SizedBox(height: TokenSizes.spaceLg),
            const LegalLinks(),
          ],
        ),
      ),
    );
  }

  /// Loading, failure and «not published» states of the terms publication.
  List<Widget> _legalState(BuildContext context) {
    if (_publicationError != null) {
      return [
        AlertNotice(text: userMessage(context, _publicationError!, 'Не удалось выполнить запрос.'), onRetry: _loadPublication),
        const SizedBox(height: TokenSizes.spaceXs),
      ];
    }
    if (_publication == null) return [const LinearProgressIndicator(), const SizedBox(height: TokenSizes.spaceXs)];
    if (!_publication!.ready && _mode == _Mode.signUp) {
      return [StatusNotice(text: context.t(AuthMessages.legalUnavailable)), const SizedBox(height: TokenSizes.spaceXs)];
    }
    return const [];
  }

  Widget _fields(BuildContext context, bool signUp, bool working) {
    return Form(
      key: _form,
      child: AutofillGroup(
        child: Column(children: [
          if (signUp) ...[
            TextFormField(
              key: const ValueKey('name'),
              controller: _name,
              enabled: !working,
              decoration: InputDecoration(labelText: context.t('Имя')),
              autofillHints: const [AutofillHints.name],
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              inputFormatters: [LengthLimitingTextInputFormatter(nameMax)],
              validator: (value) => _validated(validateName, value),
            ),
            const SizedBox(height: TokenSizes.spaceSm),
          ],
          TextFormField(
            key: const ValueKey('email'),
            controller: _email,
            enabled: !working,
            decoration: const InputDecoration(labelText: 'Email'),
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            autocorrect: false,
            textInputAction: TextInputAction.next,
            validator: (value) => _validated(validateEmail, value),
          ),
          const SizedBox(height: TokenSizes.spaceSm),
          TextFormField(
            key: const ValueKey('password'),
            controller: _password,
            enabled: !working,
            obscureText: true,
            decoration: InputDecoration(labelText: context.t('Пароль')),
            autofillHints: [signUp ? AutofillHints.newPassword : AutofillHints.password],
            inputFormatters: [LengthLimitingTextInputFormatter(passwordMax)],
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _submit(),
            validator: (value) => _validated(validatePassword, value),
          ),
          if (signUp)
            Padding(
              padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
              child: Text(context.t('Не менее 10 символов. Восстановление пароля пока недоступно.'), style: Theme.of(context).textTheme.bodySmall),
            ),
          const SizedBox(height: TokenSizes.spaceXs),
          _PrivacyHint(),
        ]),
      ),
    );
  }
}

class _TermsCheckbox extends ConsumerWidget {
  const _TermsCheckbox({required this.value, required this.enabled, required this.onChanged});

  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(children: [
      Checkbox(
        key: const ValueKey('terms'),
        value: value,
        onChanged: enabled ? (checked) => onChanged(checked ?? false) : null,
        semanticLabel: '${context.t('Я принимаю')} ${context.t('условия использования')}',
      ),
      Expanded(
        child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text('${context.t('Я принимаю')} '),
          TextButton(
            onPressed: () => openLegalDocument(context, ref, LegalDocument.terms),
            style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, TokenSizes.controlPrimaryMin)),
            child: Text(context.t('условия использования')),
          ),
          const Text('.'),
        ]),
      ),
    ]);
  }
}

class _PrivacyHint extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final style = Theme.of(context).textTheme.bodySmall;
    return Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
      Text(context.t('Для работы аккаунта обрабатываем имя, email или идентификатор Telegram и данные сессии.'), style: style),
      TextButton(
        onPressed: () => openLegalDocument(context, ref, LegalDocument.privacy),
        style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, TokenSizes.controlPrimaryMin)),
        child: Text(context.t('Политика обработки данных')),
      ),
    ]);
  }
}
