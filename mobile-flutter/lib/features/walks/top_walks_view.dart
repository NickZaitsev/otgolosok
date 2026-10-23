import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/user_message.dart';
import '../../walk_engine/cities.dart';
import '../reviews/review_model.dart';
import 'current_city.dart';
import 'metro_select.dart';
import 'route_preview.dart';
import 'top_model.dart';

sealed class _TopState {
  const _TopState();
}

class _Loading extends _TopState {
  const _Loading();
}

class _Failed extends _TopState {
  const _Failed(this.error);
  final Object error;
}

class _Ready extends _TopState {
  const _Ready(this.page, {this.more = _More.idle, this.moreError});
  final TopWalkPage page;
  final _More more;
  final Object? moreError;

  _Ready copyWith({TopWalkPage? page, _More? more, Object? moreError}) => _Ready(page ?? this.page, more: more ?? this.more, moreError: moreError);
}

enum _More { idle, loading, error }

/// The public ranking with server-side filters and 20-walk pages (site `top-walks.tsx`).
/// [header] scrolls with the list; [filterable] adds the city switch and the metro and duration filters.
class TopWalksView extends ConsumerStatefulWidget {
  const TopWalksView({super.key, this.filterable = false, this.header});
  final bool filterable;
  final Widget? header;

  @override
  ConsumerState<TopWalksView> createState() => _TopWalksViewState();
}

class _TopWalksViewState extends ConsumerState<TopWalksView> {
  TopFilters _filters = TopFilters.none;
  TopFacets _facets = TopFacets.empty;
  _TopState _state = const _Loading();
  CancelToken? _load;
  CancelToken? _more;
  late String _city;

  @override
  void initState() {
    super.initState();
    _city = ref.read(currentCityProvider).id;
    _fetch();
  }

  @override
  void dispose() {
    _load?.cancel();
    _more?.cancel();
    super.dispose();
  }

  void _fetch() {
    _load?.cancel();
    _more?.cancel();
    _more = null;
    final token = _load = CancelToken();
    final filters = _filters;
    ref
        .read(apiProvider)
        .get('/api/top-walks', validateTopWalkPage, query: topWalksQuery(0, filters, _city), cancel: token)
        .then((page) {
      if (!mounted || token.isCancelled) return;
      setState(() {
        _facets = page.filters;
        _state = _Ready(page);
      });
    }, onError: (Object error) {
      if (!mounted || token.isCancelled || (error is ApiError && error.isCancelled)) return;
      setState(() => _state = _Failed(error));
    });
  }

  void _loadMore() {
    final state = _state;
    if (state is! _Ready || state.page.nextOffset == null || state.more != _More.idle || _more != null) return;
    final offset = state.page.nextOffset!;
    final token = _more = CancelToken();
    setState(() => _state = state.copyWith(more: _More.loading));
    ref
        .read(apiProvider)
        .get('/api/top-walks', validateTopWalkPageAfter(offset), query: topWalksQuery(offset, _filters, _city), cancel: token)
        .then((page) {
      if (!mounted || token.isCancelled) return;
      _more = null;
      final current = _state;
      if (current is! _Ready) return;
      setState(() => _state = current.copyWith(
            page: TopWalkPage(
              walks: appendTopWalks(current.page.walks, page.walks),
              total: page.total,
              nextOffset: page.nextOffset,
              filters: current.page.filters,
            ),
            more: _More.idle,
          ));
    }, onError: (Object error) {
      if (!mounted || token.isCancelled) return;
      _more = null;
      final current = _state;
      if (current is _Ready) setState(() => _state = current.copyWith(more: _More.error, moreError: error));
    });
  }

  void _changeFilters(TopFilters next) {
    if (next == _filters) return;
    setState(() {
      _filters = next;
      _state = const _Loading();
    });
    _fetch();
  }

  /// Stations differ between cities: the metro filters and the shown page go, the duration stays.
  void _cityChanged(City city) {
    if (city.id == _city) return;
    setState(() {
      _city = city.id;
      _state = const _Loading();
      _facets = TopFacets.empty;
      _filters = _filters.copyWith(start: '', end: '');
    });
    _fetch();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(currentCityProvider, (previous, next) => _cityChanged(next));
    final state = _state;
    final children = <Widget>[
      ?widget.header,
      if (widget.filterable) ..._controls(context),
      ...switch (state) {
        _Loading() => [_Status(context.t('Загружаем топ прогулок…'))],
        _Failed(:final error) => [
            _Notice(
              message: userMessage(context, error, 'Не удалось загрузить топ прогулок.'),
              onRetry: () {
                setState(() => _state = const _Loading());
                _fetch();
              },
            ),
          ],
        _Ready() => _results(context, state),
      },
    ];
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification.metrics.extentAfter < 400) _loadMore();
        return false;
      },
      child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: children),
    );
  }

  List<Widget> _controls(BuildContext context) {
    final city = ref.watch(currentCityProvider);
    List<MetroOption> options(List<String> names, String value) => metroOptions(names, value, _facets.stations,
        label: context.t('Внутри Кольцевой'), hint: context.t('Станции Кольцевой линии и центра'));
    return [
      Semantics(
        container: true,
        label: context.t('Город'),
        child: Wrap(spacing: 8, children: [
          for (final item in cities)
            ChoiceChip(
              label: Text(context.t(item.name)),
              selected: item.id == city.id,
              onSelected: (_) => ref.read(currentCityProvider.notifier).choose(item),
            ),
        ]),
      ),
      const SizedBox(height: 12),
      Semantics(
        container: true,
        label: context.t('Фильтры прогулок'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          MetroSelect(
            label: context.t('Ближайшее метро к старту'),
            value: _filters.start,
            options: options(_facets.starts, _filters.start),
            onChanged: (start) => _changeFilters(_filters.copyWith(start: start)),
          ),
          const SizedBox(height: 12),
          MetroSelect(
            label: context.t('Ближайшее метро к финишу'),
            value: _filters.end,
            options: options(_facets.ends, _filters.end),
            onChanged: (end) => _changeFilters(_filters.copyWith(end: end)),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<TopDuration>(
            initialValue: _filters.duration,
            isExpanded: true,
            decoration: InputDecoration(labelText: context.t('Продолжительность')),
            items: [
              DropdownMenuItem(value: TopDuration.any, child: Text(context.t('Любая продолжительность'))),
              DropdownMenuItem(value: TopDuration.upTo30, child: Text(context.t('До 30 минут'))),
              DropdownMenuItem(value: TopDuration.from31To60, child: Text(context.t('31–60 минут'))),
              DropdownMenuItem(value: TopDuration.from61To90, child: Text(context.t('61–90 минут'))),
            ],
            onChanged: (duration) => _changeFilters(_filters.copyWith(duration: duration)),
          ),
          if (_filters.selected)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(onPressed: () => _changeFilters(TopFilters.none), child: Text(context.t('Сбросить фильтры'))),
            ),
        ]),
      ),
      const SizedBox(height: 12),
    ];
  }

  List<Widget> _results(BuildContext context, _Ready state) {
    final page = state.page;
    final selected = _filters.selected;
    return [
      if (widget.filterable && selected) _Status(context.t('Найдено: {count}', {'count': page.total})),
      if (page.walks.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(selected
                ? context.t('По выбранным фильтрам прогулок нет.')
                : context.t('В топе пока пусто. Откройте свою прогулку всем — после проверки она появится здесь.')),
            if (selected) TextButton(onPressed: () => _changeFilters(TopFilters.none), child: Text(context.t('Сбросить фильтры'))),
          ]),
        )
      else
        for (final walk in page.walks) Padding(padding: const EdgeInsets.only(bottom: 12), child: TopWalkCard(walk: walk)),
      if (page.total > 0) _Status(context.t('Загружено: {loaded} из {total}', {'loaded': page.walks.length, 'total': page.total})),
      if (page.nextOffset != null)
        state.more == _More.error
            ? _Notice(
                message: userMessage(context, state.moreError!, 'Не удалось загрузить ещё прогулки.'),
                onRetry: () => setState(() => _state = state.copyWith(more: _More.idle)),
              )
            : Center(
                child: OutlinedButton(
                  onPressed: state.more == _More.loading ? null : _loadMore,
                  child: Text(state.more == _More.loading ? context.t('Загружаем ещё прогулки…') : context.t('Загрузить ещё')),
                ),
              ),
    ];
  }
}

/// One ranked card; the whole card opens the walk.
class TopWalkCard extends StatelessWidget {
  const TopWalkCard({super.key, required this.walk});
  final TopWalk walk;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final locale = context.appLocale;
    final rating = formatRatingSummary(walk.rating, locale);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(walk.location),
        child: Semantics(
          button: true,
          label: context.t('Подробнее о маршруте «{title}»', {'title': walk.title}),
          excludeSemantics: true,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${walk.rank}', style: theme.textTheme.titleLarge?.copyWith(color: TokenColors.mapOrange)),
                    const SizedBox(width: 8),
                    Expanded(child: Text(walk.title, style: theme.textTheme.titleMedium)),
                  ]),
                  const SizedBox(height: 4),
                  Text(rating.isEmpty ? context.t('Пока без оценок') : rating, style: theme.textTheme.bodySmall),
                  Text(formatTopWalkMeta(walk, locale, context.t), style: theme.textTheme.bodySmall),
                  if (walk.startMetro != null || walk.endMetro != null) ...[
                    const SizedBox(height: 4),
                    _MetroRow(
                      station: walk.startMetro,
                      text: walk.startMetro == null
                          ? context.t('Старт: метро не указано')
                          : context.t('Старт: м. {station}', {'station': walk.startMetro!.name}),
                    ),
                    _MetroRow(
                      station: walk.endMetro,
                      text: walk.endMetro == null
                          ? context.t('Финиш: метро не указано')
                          : context.t('Финиш: м. {station}', {'station': walk.endMetro!.name}),
                    ),
                  ],
                ]),
              ),
              const SizedBox(width: 12),
              Column(children: [
                RoutePreview(walk: walk),
                if (walk.mapPreview != null) const OsmAttribution(),
              ]),
            ]),
          ),
        ),
      ),
    );
  }
}

class _MetroRow extends StatelessWidget {
  const _MetroRow({required this.station, required this.text});
  final MetroStation? station;
  final String text;

  @override
  Widget build(BuildContext context) {
    final lines = station?.lines ?? const <MetroLine>[];
    Widget mark(MetroLine? line) => Container(
          width: 18,
          height: 18,
          margin: const EdgeInsets.only(right: 3),
          alignment: Alignment.center,
          decoration: BoxDecoration(shape: BoxShape.circle, color: line == null ? TokenColors.controlBorder : hexColor(line.color)),
          child: Text('M',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: line == null || metroTextIsBlack(line.color) ? Colors.black : Colors.white,
              )),
        );
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(children: [
        if (lines.isEmpty) mark(null) else for (final line in lines) mark(line),
        const SizedBox(width: 4),
        Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
      ]),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Semantics(liveRegion: true, child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
      );
}

/// An error with «Повторить», as the site's `ui-notice`.
class _Notice extends StatelessWidget {
  const _Notice({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ErrorNotice(message: message, onRetry: onRetry);
}

/// A failed request with a retry; shared by the walk screens.
class ErrorNotice extends StatelessWidget {
  const ErrorNotice({super.key, required this.message, this.onRetry, this.retryLabel});
  final String message;
  final VoidCallback? onRetry;
  final String? retryLabel;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: TokenColors.alertSurface, borderRadius: BorderRadius.circular(TokenSizes.radiusSm)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Semantics(liveRegion: true, child: Text(message, style: const TextStyle(color: TokenColors.alertInk))),
          if (onRetry != null) TextButton(onPressed: onRetry, child: Text(retryLabel ?? context.t('Повторить'))),
        ]),
      );
}
