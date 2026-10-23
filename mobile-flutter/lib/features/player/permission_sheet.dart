import 'package:flutter/material.dart';
import 'package:walk_service/walk_service.dart' as ws;

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../core/settings/settings_store.dart';

/// The walk explained notifications once; afterwards a refusal is not asked about again.
const notificationsExplainedKey = 'otgolosok:walk-notifications-explained';

/// What the walker chose in the explainer.
enum PermissionChoice {
  /// Start the walk; [PermissionOutcome.locationGranted] tells how.
  start,

  /// «Не сейчас»: the walk does not start.
  cancel,
}

class PermissionOutcome {
  const PermissionOutcome(this.choice, {this.locationGranted = false});

  final PermissionChoice choice;
  final bool locationGranted;
}

/// Whether the explainer has something to ask before the start.
bool needsExplainer(ws.PermissionState? permissions, SettingsStore settings) {
  if (permissions == null) return false;
  if (permissions.location != ws.PermissionStatus.granted) return true;
  return permissions.notifications == ws.PermissionStatus.denied && settings.readString(notificationsExplainedKey) == null;
}

/// Before the first start: why the walk wants location and notifications. Never a dead end —
/// without location the walk still starts, with manual switching (the site's status text says so).
///
/// [request] asks Android (a tap is in progress); [openSettings] opens the app's settings page.
Future<PermissionOutcome> showPermissionExplainer(
  BuildContext context, {
  required ws.PermissionState permissions,
  required Future<ws.PermissionState?> Function() request,
  required Future<ws.PermissionState?> Function() check,
  required Future<void> Function() openSettings,
  required SettingsStore settings,
}) async {
  try {
    await settings.writeString(notificationsExplainedKey, '1');
  } on Object catch (error) {
    debugPrint('permission flag was not saved: ${error.runtimeType}');
  }
  if (!context.mounted) return const PermissionOutcome(PermissionChoice.cancel);
  final outcome = await showModalBottomSheet<PermissionOutcome>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (sheet) => _PermissionSheet(permissions: permissions, request: request, check: check, openSettings: openSettings),
  );
  return outcome ?? const PermissionOutcome(PermissionChoice.cancel);
}

class _PermissionSheet extends StatefulWidget {
  const _PermissionSheet({required this.permissions, required this.request, required this.check, required this.openSettings});

  final ws.PermissionState permissions;
  final Future<ws.PermissionState?> Function() request;
  final Future<ws.PermissionState?> Function() check;
  final Future<void> Function() openSettings;

  @override
  State<_PermissionSheet> createState() => _PermissionSheetState();
}

class _PermissionSheetState extends State<_PermissionSheet> {
  late ws.PermissionState _permissions = widget.permissions;
  bool _asking = false;
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _refresh);
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  /// Back from the phone settings: the sheet shows what is allowed now.
  Future<void> _refresh() async {
    final answer = await widget.check();
    if (mounted && answer != null) setState(() => _permissions = answer);
  }

  bool get _locationBlocked => _permissions.location == ws.PermissionStatus.permanentlyDenied;
  bool get _askable =>
      _permissions.location == ws.PermissionStatus.denied || _permissions.notifications == ws.PermissionStatus.denied;

  Future<void> _allow() async {
    setState(() => _asking = true);
    final answer = await widget.request();
    if (!mounted) return;
    if (answer != null) _permissions = answer;
    setState(() => _asking = false);
    if (_permissions.location == ws.PermissionStatus.granted || !_askable) {
      Navigator.of(context).pop(PermissionOutcome(
        PermissionChoice.start,
        locationGranted: _permissions.location == ws.PermissionStatus.granted,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final locationMissing = _permissions.location != ws.PermissionStatus.granted;
    return Padding(
      padding: const EdgeInsets.all(TokenSizes.spaceMd),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Semantics(header: true, child: Text(context.t('Разрешения для прогулки'), style: theme.textTheme.titleLarge)),
        const SizedBox(height: TokenSizes.spaceSm),
        if (locationMissing) ...[
          Text(context.t('Геолокация включает рассказ, когда вы подходите к точке. Координаты остаются на устройстве.')),
          const SizedBox(height: TokenSizes.spaceXs),
        ],
        if (_permissions.notifications != ws.PermissionStatus.granted) ...[
          Text(context.t('Уведомление показывает остановку и кнопки плеера на экране блокировки.')),
          const SizedBox(height: TokenSizes.spaceXs),
        ],
        if (_locationBlocked)
          Semantics(
            liveRegion: true,
            child: Text(
              context.t('Доступ к геолокации запрещён в настройках телефона. Разрешите его там или начните без геолокации — остановки будут переключаться кнопкой «Дальше».'),
              style: const TextStyle(color: TokenColors.warningInk),
            ),
          ),
        const SizedBox(height: TokenSizes.spaceMd),
        if (_askable)
          FilledButton(onPressed: _asking ? null : _allow, child: Text(context.t('Разрешить')))
        else if (_locationBlocked)
          FilledButton(onPressed: widget.openSettings, child: Text(context.t('Открыть настройки'))),
        if (locationMissing)
          TextButton(
            onPressed: _asking ? null : () => Navigator.of(context).pop(const PermissionOutcome(PermissionChoice.start)),
            child: Text(context.t('Начать без геолокации')),
          )
        else
          TextButton(
            onPressed: _asking ? null : () => Navigator.of(context).pop(const PermissionOutcome(PermissionChoice.start, locationGranted: true)),
            child: Text(context.t('Начать прогулку')),
          ),
        TextButton(
          onPressed: _asking ? null : () => Navigator.of(context).pop(const PermissionOutcome(PermissionChoice.cancel)),
          child: Text(context.t('Не сейчас')),
        ),
      ]),
    );
  }
}
