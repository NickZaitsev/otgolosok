import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../auth/status_widgets.dart';
import '../legal/legal_links.dart';
import 'account_repository.dart';

/// A paged account list (favourites, requests) with its own loading and error state.
class PagedList<T> {
  const PagedList({this.items = const [], this.cursor, this.loading = false, this.error});

  final List<T> items;
  final String? cursor;
  final bool loading;

  /// The translated error of the last failed load.
  final String? error;
}

/// `/api/me/favorites` in the «Сохранённое» section.
class FavoritesTile extends StatelessWidget {
  const FavoritesTile({super.key, required this.list, required this.busy, required this.onMore, required this.onRetry});

  final PagedList<Favorite> list;
  final bool busy;
  final VoidCallback onMore;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      key: const PageStorageKey('favorites'),
      tilePadding: EdgeInsets.zero,
      title: Text(context.t('Избранное')),
      trailing: list.items.isEmpty ? null : Text('${list.items.length}'),
      children: [
        ..._state(context, list, onRetry, 'Здесь появятся любимые истории и прогулки.'),
        for (final item in list.items)
          ListTile(
            contentPadding: EdgeInsets.zero,
            minTileHeight: TokenSizes.controlPrimaryMin,
            title: Text(item.href == null ? context.t('Материал недоступен') : item.title ?? context.t('Сохранённый материал')),
            trailing: item.walkLocation == null ? null : const Icon(Icons.chevron_right),
            onTap: item.walkLocation == null ? null : () => context.push(item.walkLocation!),
          ),
        if (list.cursor != null) _MoreButton(busy: busy, onPressed: onMore),
      ],
    );
  }
}

/// `/api/me/requests` in the «Подготовка историй» section.
class RequestsTile extends StatelessWidget {
  const RequestsTile({super.key, required this.list, required this.busy, required this.onMore, required this.onRetry});

  final PagedList<StoryRequest> list;
  final bool busy;
  final VoidCallback onMore;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final material = MaterialLocalizations.of(context);
    String when(String value) {
      final time = DateTime.parse(value).toLocal();
      return '${material.formatMediumDate(time)} ${material.formatTimeOfDay(TimeOfDay.fromDateTime(time), alwaysUse24HourFormat: true)}';
    }

    return ExpansionTile(
      key: const PageStorageKey('requests'),
      tilePadding: EdgeInsets.zero,
      title: Text(context.t('Подготовка историй')),
      children: [
        ..._state(context, list, onRetry, 'Вы ещё не заказывали истории.'),
        for (final item in list.items)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(context.t(item.walkResearch ? 'Исследование прогулки' : 'История места')),
            subtitle: Text(when(item.createdAt)),
          ),
        if (list.cursor != null) _MoreButton(busy: busy, onPressed: onMore),
      ],
    );
  }
}

List<Widget> _state<T>(BuildContext context, PagedList<T> list, VoidCallback onRetry, String empty) => [
      if (list.error != null) AlertNotice(text: list.error!, onRetry: onRetry, retryLabel: 'Повторить загрузку'),
      if (list.loading && list.items.isEmpty) const LinearProgressIndicator(),
      if (!list.loading && list.error == null && list.items.isEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
          child: Align(alignment: Alignment.centerLeft, child: Text(context.t(empty), style: Theme.of(context).textTheme.bodySmall)),
        ),
    ];

class _MoreButton extends StatelessWidget {
  const _MoreButton({required this.busy, required this.onPressed});

  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) =>
      OutlinedButton(onPressed: busy ? null : onPressed, child: Text(context.t('Показать ещё')));
}

/// «Отголосок в соцсетях»: the project's channels (site `SOCIAL_LINKS`).
class SocialLinks extends StatelessWidget {
  const SocialLinks({super.key});

  static final _links = [
    (title: 'Telegram', note: 'Новости и истории мест', url: Uri.parse('https://t.me/otgolosok_online'), icon: Icons.send_rounded, color: const Color(0xFF229ED9)),
    (
      title: 'YouTube',
      note: 'Короткие видео о прогулках',
      url: Uri.parse('https://www.youtube.com/@otgolosok-online/shorts'),
      icon: Icons.play_arrow_rounded,
      color: const Color(0xFFFF0000),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      for (final link in _links)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: CircleAvatar(backgroundColor: link.color, foregroundColor: Colors.white, child: Icon(link.icon)),
          title: Text(link.title),
          subtitle: Text(context.t(link.note)),
          trailing: const Icon(Icons.open_in_new),
          onTap: () => openUrl(context, link.url, external: true),
        ),
    ]);
  }
}
